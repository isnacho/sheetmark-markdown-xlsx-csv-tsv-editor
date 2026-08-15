// Table boundary editing for CM6 Preview Edit mode.
//
// Runtime: WEBVIEW (browser). Pure compute helpers are headlessly testable;
// the keymap/atomicRanges extensions wire in livePreviewEditor.ts.
//
// Prevents backspace at the start of a line after a table from merging paragraph
// text into a table row (which corrupts GFM). Blank separator lines above a
// paragraph are removed one at a time; once the cursor sits directly below a
// table, the next backspace arms the table (highlight), and a second backspace
// deletes the whole block.
//
// Kept separate from tableWidget.ts so headless tests can import this module
// without pulling DOM/markdown-it dependencies.

import { EditorState, StateEffect, StateField, Prec, EditorSelection } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView, keymap, Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

function lineIsInsideFencedCode(state: EditorState, lineNumber: number): boolean {
    const line = state.doc.line(lineNumber);
    let inside = false;
    syntaxTree(state).iterate({
        from: line.from,
        to: line.to,
        enter(node) {
            if (node.name === 'FencedCode') {
                inside = true;
            }
        },
    });
    return inside;
}

export interface TableRange {
    from: number;
    to: number;
}

// ===== Shared cell grid helpers (also used by tableWidget.ts) =====

export interface CellRange {
    from: number;
    to: number;
}

export interface ActiveCell extends CellRange {
    row: number;
    col: number;
}

function rangesIntersect(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
    return aFrom <= bTo && aTo >= bFrom;
}

export function splitTableRowCells(text: string): string[] {
    let trimmed = text.trim();
    if (trimmed.startsWith('|')) { trimmed = trimmed.slice(1); }
    if (trimmed.endsWith('|')) { trimmed = trimmed.slice(0, -1); }
    const parts: string[] = [];
    let current = '';
    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === '\\' && trimmed[i + 1] === '|') { current += '\\|'; i++; continue; }
        if (ch === '|') { parts.push(current.trim()); current = ''; continue; }
        current += ch;
    }
    parts.push(current.trim());
    return parts;
}

function cellRangesFromLine(state: EditorState, lineFrom: number, lineTo: number): CellRange[] {
    const lineText = state.sliceDoc(lineFrom, lineTo);
    const cellTexts = splitTableRowCells(lineText);
    const ranges: CellRange[] = [];

    const findPipe = (from: number): number => {
        for (let i = from; i < lineText.length; i++) {
            if (lineText[i] === '\\' && lineText[i + 1] === '|') { i++; continue; }
            if (lineText[i] === '|') { return i; }
        }
        return lineText.length;
    };

    let scan = findPipe(0);
    for (const cellText of cellTexts) {
        void cellText;
        scan++;
        const contentStart = scan;
        const closingPipe = findPipe(scan);
        const raw = lineText.slice(contentStart, closingPipe);
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
            ranges.push({ from: lineFrom + contentStart, to: lineFrom + contentStart });
        } else {
            const leadingPad = raw.length - raw.trimStart().length;
            const trailingPad = raw.length - raw.trimEnd().length;
            ranges.push({
                from: lineFrom + contentStart + leadingPad,
                to: lineFrom + closingPipe - trailingPad,
            });
        }
        scan = closingPipe;
    }
    return ranges;
}

function cellRangesFromRowLine(state: EditorState, rowNode: SyntaxNode): CellRange[] {
    return cellRangesFromLine(state, rowNode.from, rowNode.to);
}

/** GFM delimiter row (`| --- |`, `| - |`, `:---:`). */
function isDelimiterRowLine(text: string): boolean {
    const cells = splitTableRowCells(text);
    return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

function buildCellGridFromRange(state: EditorState, range: TableRange): CellRange[][] {
    const grid: CellRange[][] = [];
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let n = startLine; n <= endLine; n++) {
        const line = state.doc.line(n);
        if (!isTableRowLine(line.text) || isDelimiterRowLine(line.text)) { continue; }
        grid.push(cellRangesFromLine(state, line.from, line.to));
    }
    return grid;
}

export function buildCellGrid(state: EditorState, tableNode: SyntaxNode): CellRange[][] {
    return buildCellGridFromRange(state, effectiveTableRange(state, tableNode));
}

function isEmptyTableCellContent(state: EditorState, cell: CellRange): boolean {
    return state.sliceDoc(cell.from, cell.to).trim().length === 0;
}

export function findActiveCell(state: EditorState, grid: readonly CellRange[][], selFrom: number, selTo: number): ActiveCell | null {
    if (selFrom !== selTo) {
        for (let row = 0; row < grid.length; row++) {
            const cols = grid[row];
            for (let col = 0; col < cols.length; col++) {
                const cell = cols[col];
                if (rangesIntersect(selFrom, selTo, cell.from, cell.to)) {
                    return { row, col, from: cell.from, to: cell.to };
                }
            }
        }
        return null;
    }

    const pos = selFrom;
    const line = state.doc.lineAt(pos).number;
    for (let row = 0; row < grid.length; row++) {
        const cols = grid[row];
        if (cols.length === 0 || state.doc.lineAt(cols[0].from).number !== line) { continue; }
        for (let col = 0; col < cols.length; col++) {
            const cell = cols[col];
            if (isEmptyTableCellContent(state, cell) && pos >= cell.from && pos <= cell.to) {
                return { row, col, from: cell.from, to: cell.to };
            }
            const midLow = col === 0 ? -Infinity : (cols[col - 1].to + cell.from) / 2;
            const midHigh = col === cols.length - 1 ? Infinity : (cell.to + cols[col + 1].from) / 2;
            if (pos >= midLow && pos <= midHigh) {
                return { row, col, from: cell.from, to: cell.to };
            }
        }
    }
    return null;
}

export function nextCell(grid: readonly CellRange[][], active: ActiveCell): ActiveCell | null {
    const row = grid[active.row];
    if (row && active.col + 1 < row.length) {
        return { ...row[active.col + 1], row: active.row, col: active.col + 1 };
    }
    const nextRow = grid[active.row + 1];
    if (nextRow && nextRow.length > 0) {
        return { ...nextRow[0], row: active.row + 1, col: 0 };
    }
    return null;
}

export function prevCell(grid: readonly CellRange[][], active: ActiveCell): ActiveCell | null {
    if (active.col - 1 >= 0) {
        const row = grid[active.row];
        return { ...row[active.col - 1], row: active.row, col: active.col - 1 };
    }
    const prevRow = grid[active.row - 1];
    if (prevRow && prevRow.length > 0) {
        return { ...prevRow[prevRow.length - 1], row: active.row - 1, col: prevRow.length - 1 };
    }
    return null;
}

export function cellBelow(grid: readonly CellRange[][], active: ActiveCell): ActiveCell | null {
    const below = grid[active.row + 1]?.[active.col];
    return below ? { ...below, row: active.row + 1, col: active.col } : null;
}

export function cellAbove(grid: readonly CellRange[][], active: ActiveCell): ActiveCell | null {
    const above = grid[active.row - 1]?.[active.col];
    return above ? { ...above, row: active.row - 1, col: active.col } : null;
}

export function collapsedClickPosForCell(state: EditorState, cell: CellRange): number {
    return isEmptyTableCellContent(state, cell) ? cell.from : cell.to;
}

/** True when `text` looks like a GFM pipe-table row (not a paragraph). */
export function isTableRowLine(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.startsWith('|') && trimmed.includes('|', 1);
}

/** Contiguous pipe-row block containing `lineNumber`, if that line is a table row. */
export function tableBlockRangeForLine(state: EditorState, lineNumber: number): TableRange | null {
    if (lineIsInsideFencedCode(state, lineNumber)) {
        return null;
    }
    const line = state.doc.line(lineNumber);
    if (!isTableRowLine(line.text)) { return null; }

    let startLine = lineNumber;
    let endLine = lineNumber;
    while (startLine > 1 && isTableRowLine(state.doc.line(startLine - 1).text)) { startLine--; }
    while (endLine < state.doc.lines && isTableRowLine(state.doc.line(endLine + 1).text)) { endLine++; }

    return {
        from: state.doc.line(startLine).from,
        to: state.doc.line(endLine).to,
    };
}

/**
 * Trim a Lezer `Table` node to consecutive pipe-row lines only — excludes any
 * trailing non-row lines the parser incorrectly absorbed.
 */
export function effectiveTableRange(state: EditorState, tableNode: SyntaxNode): TableRange {
    const startLine = state.doc.lineAt(tableNode.from);
    let endLineNum = startLine.number;

    for (let n = startLine.number; n <= state.doc.lines; n++) {
        const line = state.doc.line(n);
        if (line.from >= tableNode.to && line.from > tableNode.from) { break; }
        if (!isTableRowLine(line.text)) {
            if (n === startLine.number) {
                return { from: tableNode.from, to: tableNode.to };
            }
            break;
        }
        endLineNum = n;
    }

    return { from: tableNode.from, to: state.doc.line(endLineNum).to };
}

export const setTableArmedEffect = StateEffect.define<TableRange>();
export const clearTableArmedEffect = StateEffect.define<null>();

/** Cursor at column 0 on a line that can backspace toward (or delete) a table. */
export function isTableDeleteBoundary(state: EditorState): boolean {
    const sel = state.selection.main;
    if (!sel.empty) { return false; }
    const pos = sel.head;
    const line = state.doc.lineAt(pos);
    if (pos !== line.from) { return false; }
    if (line.number === 1) { return false; }
    if (lineIsInsideFencedCode(state, line.number)) { return false; }

    const prevLine = state.doc.line(line.number - 1);
    if (prevLine.text.trim() === '') {
        if (line.number >= 3 && isTableRowLine(state.doc.line(line.number - 2).text)) {
            return !lineIsInsideFencedCode(state, line.number - 2);
        }
        return false;
    }
    if (!isTableRowLine(prevLine.text)) { return false; }
    return !lineIsInsideFencedCode(state, prevLine.number);
}

export const tableDeleteArmedField = StateField.define<TableRange | null>({
    create: () => null,
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setTableArmedEffect)) { return effect.value; }
            if (effect.is(clearTableArmedEffect)) { return null; }
        }
        if (value && tr.docChanged) { return null; }
        if (value && !tr.docChanged && !isTableDeleteBoundary(tr.state)) { return null; }
        return value;
    },
});

function deleteTableSpec(range: TableRange, state: EditorState): TransactionSpec {
    let to = range.to;
    if (to < state.doc.length && state.sliceDoc(to, to + 1) === '\n') { to += 1; }
    return {
        changes: { from: range.from, to, insert: '' },
        effects: clearTableArmedEffect.of(null),
        selection: EditorSelection.cursor(range.from),
    };
}

/**
 * Custom Backspace when the cursor is at the start of a line adjacent to a
 * table. Returns null to fall through to CM6/markdown defaults.
 */
export function computeTableBoundaryBackspace(state: EditorState): TransactionSpec | null {
    const sel = state.selection.main;
    if (!sel.empty) { return null; }
    const pos = sel.head;
    const line = state.doc.lineAt(pos);
    if (pos !== line.from) { return null; }

    const armed = state.field(tableDeleteArmedField, false);
    if (armed) {
        return deleteTableSpec(armed, state);
    }

    if (line.number === 1) { return null; }
    if (lineIsInsideFencedCode(state, line.number)) { return null; }
    const prevLine = state.doc.line(line.number - 1);

    if (prevLine.text.trim() === '') {
        if (line.number >= 3) {
            const beforeBlank = state.doc.line(line.number - 2);
            if (isTableRowLine(beforeBlank.text) && !lineIsInsideFencedCode(state, beforeBlank.number)) {
                return {
                    changes: { from: prevLine.from, to: line.from, insert: '' },
                    selection: EditorSelection.cursor(prevLine.from),
                };
            }
        }
        return null;
    }

    if (!isTableRowLine(prevLine.text) || lineIsInsideFencedCode(state, prevLine.number)) { return null; }
    const tableRange = tableBlockRangeForLine(state, prevLine.number);
    if (!tableRange) { return null; }

    return {
        effects: setTableArmedEffect.of(tableRange),
        selection: EditorSelection.cursor(line.from),
    };
}

export function runTableBoundaryBackspace(view: EditorView): boolean {
    const spec = computeTableBoundaryBackspace(view.state);
    if (!spec) { return false; }
    view.dispatch(spec);
    return true;
}

// ===== Vertical arrow navigation around / through table atomic ranges =====
// `tableAtomicRanges` treats each table as one cursor unit so backspace can't
// merge paragraph text into pipe rows. Without explicit ArrowUp/Down handling,
// the caret skips the whole table (e.g. line 59 → 43) or refuses to enter from
// the line above.

interface ResolvedTable {
    tableNode: SyntaxNode | null;
    range: TableRange;
    grid: CellRange[][];
}

function resolveTableAtLine(state: EditorState, lineNumber: number): ResolvedTable | null {
    if (lineIsInsideFencedCode(state, lineNumber)) {
        return null;
    }
    const line = state.doc.line(lineNumber);
    if (!isTableRowLine(line.text)) { return null; }
    const range = tableBlockRangeForLine(state, lineNumber);
    if (!range) { return null; }
    let node: SyntaxNode | null = syntaxTree(state).resolve(range.from, 1);
    for (; node; node = node.parent) {
        if (node.name === 'Table') {
            return { tableNode: node, range, grid: buildCellGrid(state, node) };
        }
    }
    return { tableNode: null, range, grid: buildCellGridFromRange(state, range) };
}

/** True when `pos` sits inside any GFM table pipe-row block. */
export function isPosInsideTable(state: EditorState, pos: number): boolean {
    const line = state.doc.lineAt(pos);
    if (lineIsInsideFencedCode(state, line.number)) {
        return false;
    }
    if (isTableRowLine(line.text)) {
        const block = tableBlockRangeForLine(state, line.number);
        if (block && pos >= block.from && pos <= block.to) { return true; }
    }
    let inside = false;
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name !== 'Table') { return; }
            const range = effectiveTableRange(state, node.node);
            if (pos >= range.from && pos <= range.to) {
                inside = true;
            }
        },
    });
    return inside;
}

function rowIndexForLine(state: EditorState, grid: readonly CellRange[][], lineNumber: number): number {
    for (let row = 0; row < grid.length; row++) {
        const cols = grid[row];
        if (cols.length > 0 && state.doc.lineAt(cols[0].from).number === lineNumber) {
            return row;
        }
    }
    return -1;
}

/** Column-aware cell in a visual grid row (header or body — delimiter excluded). */
function pickCellInRow(state: EditorState, grid: readonly CellRange[][], rowIndex: number, hintPos: number): CellRange {
    const cols = grid[rowIndex];
    if (!cols || cols.length === 0) { throw new Error('empty table row'); }
    const hintLine = state.doc.lineAt(hintPos);
    const offsetInHintLine = hintPos - hintLine.from;
    const rowLine = state.doc.lineAt(cols[0].from);
    const mappedPos = Math.min(rowLine.from + offsetInHintLine, rowLine.to);
    const active = findActiveCell(state, grid, mappedPos, mappedPos);
    if (active) {
        return { from: active.from, to: active.to };
    }
    return cols[0];
}

function computeInsideTableArrow(
    state: EditorState,
    table: ResolvedTable,
    direction: 'up' | 'down' | 'left' | 'right',
    pos: number,
): TransactionSpec | null {
    const line = state.doc.lineAt(pos);

    if (direction === 'left' || direction === 'right') {
        const lineRanges = cellRangesFromLine(state, line.from, line.to);
        if (lineRanges.length === 0) { return null; }
        const active = findActiveCell(state, [lineRanges], pos, pos);
        if (!active) { return null; }
        const targetCol = direction === 'right' ? active.col + 1 : active.col - 1;
        if (targetCol < 0 || targetCol >= lineRanges.length) { return null; }
        return selectionSpecForCell(state, lineRanges[targetCol]);
    }

    let rowIndex = rowIndexForLine(state, table.grid, line.number);
    if (rowIndex < 0) {
        if (direction === 'down' && table.grid.length > 1) {
            return selectionSpecForCell(state, pickCellInRow(state, table.grid, 1, pos));
        }
        if (direction === 'up') {
            return selectionSpecForCell(state, pickCellInRow(state, table.grid, 0, pos));
        }
        return null;
    }

    if (direction === 'down') {
        if (rowIndex < table.grid.length - 1) {
            return selectionSpecForCell(state, pickCellInRow(state, table.grid, rowIndex + 1, pos));
        }
        const nextLineNum = line.number + 1;
        if (nextLineNum > state.doc.lines) { return null; }
        const below = state.doc.line(nextLineNum);
        if (isTableRowLine(below.text)) { return null; }
        return { selection: EditorSelection.cursor(below.from) };
    }
    if (rowIndex > 0) {
        return selectionSpecForCell(state, pickCellInRow(state, table.grid, rowIndex - 1, pos));
    }
    const prevLineNum = line.number - 1;
    if (prevLineNum < 1) { return null; }
    const above = state.doc.line(prevLineNum);
    if (isTableRowLine(above.text)) { return null; }
    return { selection: EditorSelection.cursor(above.to, -1) };
}

/** Cell-grid arrow navigation inside a table, or enter/exit at boundaries. */
export function computeTableArrow(
    state: EditorState,
    direction: 'up' | 'down' | 'left' | 'right',
): TransactionSpec | null {
    const sel = state.selection.main;
    if (!sel.empty) { return null; }
    const line = state.doc.lineAt(sel.head);

    if (isTableRowLine(line.text)) {
        const table = resolveTableAtLine(state, line.number);
        if (table) {
            return computeInsideTableArrow(state, table, direction, sel.head);
        }
    }

    if (direction === 'left' || direction === 'right') { return null; }
    return direction === 'down'
        ? computeTableBoundaryArrowDown(state)
        : computeTableBoundaryArrowUp(state);
}

function runTableArrow(view: EditorView, direction: 'up' | 'down' | 'left' | 'right'): boolean {
    const spec = computeTableArrow(view.state, direction);
    if (!spec) {
        if (isPosInsideTable(view.state, view.state.selection.main.head)) {
            return true;
        }
        return false;
    }
    const pos = view.state.update(spec).state.selection.main.head;
    view.dispatch({ ...spec, effects: EditorView.scrollIntoView(pos) });
    return true;
}

export const tableNavigationKeymap = Prec.highest(keymap.of([
    { key: 'ArrowUp', run: (view) => runTableArrow(view, 'up') },
    { key: 'ArrowDown', run: (view) => runTableArrow(view, 'down') },
    { key: 'ArrowLeft', run: (view) => runTableArrow(view, 'left') },
    { key: 'ArrowRight', run: (view) => runTableArrow(view, 'right') },
]));

function selectionSpecForCell(state: EditorState, cell: CellRange): TransactionSpec {
    const pos = collapsedClickPosForCell(state, cell);
    return { selection: EditorSelection.cursor(pos) };
}

export function computeTableBoundaryArrowDown(state: EditorState): TransactionSpec | null {
    const sel = state.selection.main;
    if (!sel.empty) { return null; }
    const line = state.doc.lineAt(sel.head);

    if (isTableRowLine(line.text)) { return null; }

    const nextLineNum = line.number + 1;
    if (nextLineNum > state.doc.lines) { return null; }
    const nextLine = state.doc.line(nextLineNum);
    if (!isTableRowLine(nextLine.text)) { return null; }
    const table = resolveTableAtLine(state, nextLineNum);
    if (!table) { return null; }
    const cell = pickCellInRow(state, table.grid, 0, sel.head);
    return selectionSpecForCell(state, cell);
}

export function computeTableBoundaryArrowUp(state: EditorState): TransactionSpec | null {
    const sel = state.selection.main;
    if (!sel.empty) { return null; }
    const line = state.doc.lineAt(sel.head);

    if (isTableRowLine(line.text)) { return null; }

    const prevLineNum = line.number - 1;
    if (prevLineNum < 1) { return null; }
    const prevLine = state.doc.line(prevLineNum);
    if (!isTableRowLine(prevLine.text)) { return null; }
    const table = resolveTableAtLine(state, prevLineNum);
    if (!table) { return null; }
    const lastRow = table.grid.length - 1;
    const cell = pickCellInRow(state, table.grid, lastRow, sel.head);
    return selectionSpecForCell(state, cell);
}

function buildTableAtomicRanges(state: EditorState): DecorationSet {
    const marker = Decoration.mark({});
    const ranges: ReturnType<typeof marker.range>[] = [];
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name === 'Table') {
                const range = effectiveTableRange(state, node.node);
                ranges.push(marker.range(range.from, range.to));
            }
        },
    });
    return Decoration.set(ranges);
}

export const tableAtomicRanges = EditorView.atomicRanges.of((view) => buildTableAtomicRanges(view.state));

export const tableBoundaryKeymap = Prec.highest(keymap.of([
    { key: 'Backspace', run: runTableBoundaryBackspace },
]));

export const tableBoundaryExtensions = [
    tableDeleteArmedField,
    tableBoundaryKeymap,
    tableNavigationKeymap,
    tableAtomicRanges,
];
