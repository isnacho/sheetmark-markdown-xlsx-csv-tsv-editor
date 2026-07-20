// Table rendering for the Markdown "Preview Edit" mode.
//
// Runtime: WEBVIEW (browser) for the StateField/WidgetType; the pure grid/
// active-cell helpers below have no DOM dependency, so they're exercised
// headlessly in tableWidget.test.mts. Only TableWidget's DOM wiring
// (toDOM/updateDOM and the editable-cell event handlers) needs a real
// browser and is verified by manual F5 testing, per this project's test
// infrastructure (see CLAUDE.md and .docs/PLAN-obsidian-live-preview.md).
//
// CM6 has no built-in table grid — unlike headings/bold/italic (inline
// Decoration.mark/replace), a table needs an actual rendered <table> element,
// so this uses a block Decoration.replace with a WidgetType, provided via a
// StateField (`tableWidgetField`), NOT a ViewPlugin — CM6 throws "Block
// decorations may not be specified via plugins" otherwise (see the field's
// own comment below for how this was confirmed against @codemirror/view's
// actual source, not assumed). Because of that, this can't scope to
// `view.visibleRanges` the way the rest of the engine does (StateFields don't
// see viewport info) — it scans the whole document, filtered to `Table`
// nodes only.
//
// UNLIKE the rest of this engine, the table itself never reverts to raw
// markdown as a block: the rendered <table> stays mounted at all times, and
// only the single cell the cursor is in becomes directly editable in place
// (Notion/Obsidian-style), rather than the whole table flipping to raw pipes.
// The active cell shows its RAW markdown text while editing (never
// markdown-it-rendered HTML) — same principle as revealing a heading's "#" on
// cursor-enter, just scoped to one table cell. This is deliberate: editing
// *rendered* HTML and converting back to markdown on blur is exactly the
// `contentEditable` + `turndown` architecture this project already replaced
// project-wide because it can't preserve raw-markdown fidelity. Editing raw
// text directly, verbatim, never has that problem.
//
// Reuses markdown-it (already a project dependency, not CM6-specific) to render
// the table's own source text — this guarantees the widget's table markup and
// `.md-table` styling are pixel-identical to the Reading-mode renderer's table
// output (resources/md/mdWebview.css's `.markdown-preview table.md-table` rules
// apply automatically since #markdownPreview carries the `.markdown-preview`
// class regardless of which engine is mounted inside it). This is a separate,
// bare MarkdownIt instance — not the fully-configured one in mdWebview.ts, to
// avoid a livePreview/ <-> mdWebview.ts circular import. Table cells still get
// full inline formatting (bold/italic/code/links) when NOT the active cell,
// since that's core markdown-it behavior; extras like emoji/katex inside cells
// are an accepted v1 gap (mdWebview.ts's plugin-loaded instance isn't
// reachable here).
//
// Column widths: raw GFM pipe-table syntax has no field for column width, so
// a resized width can't live in the .md file's own table syntax. It's kept in
// `columnWidthsField` (a CM6 StateField, table-order-index -> px per column),
// seeded per-mount from persisted extension-host storage (see
// livePreviewEditor.ts/mdWebview.ts) and updated by `setColumnWidthsEffect` on
// drag-end only — never per-pixel, same "commit rarely, mutate DOM live in
// between" principle that keeps cell editing's widget lifecycle sane (see
// TableWidget.updateDOM below). The actual persistence round-trip to the
// extension host happens outside this file entirely; this file only owns the
// in-webview CM6 state and the drag UI.

import MarkdownIt from 'markdown-it';
import { EditorState, StateField, StateEffect } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { VisibleRange } from './revealDecorations';

/** Below this, a column stops shrinking under drag. */
const MIN_COL_WIDTH_PX = 40;

const md = new MarkdownIt();
const defaultTableOpen = md.renderer.rules.table_open || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrJoin('class', 'md-table');
    const openTag = defaultTableOpen(tokens, idx, options, env, self);
    // Always emit a <colgroup> (even with no explicit widths) so drag code
    // never has to special-case "no colgroup yet" on a table's first-ever
    // resize — a <col> with no width style is visually inert under the
    // default table-layout:auto, so untouched tables render exactly as
    // before. `colCount`/`widths` are threaded through markdown-it's own
    // per-render `env` param (not widget state — this rule is a shared
    // singleton across every TableWidget instance).
    const colCount: number = (env as { colCount?: number } | undefined)?.colCount ?? 0;
    const widths: readonly number[] | null = (env as { widths?: readonly number[] } | undefined)?.widths ?? null;
    if (colCount === 0) { return openTag; }
    let colgroup = '<colgroup>';
    for (let i = 0; i < colCount; i++) {
        const w = widths?.[i];
        colgroup += w ? `<col style="width:${w}px">` : '<col>';
    }
    colgroup += '</colgroup>';
    return openTag + colgroup;
};

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

/**
 * Row-major grid of a Table node's cells (row 0 = TableHeader, rows 1..n =
 * TableRow), in absolute doc positions. Verified against the real parse tree
 * (not assumed): `TableCell.from`/`.to` already exclude the surrounding pipe
 * delimiters and padding whitespace, so these ranges can be used directly
 * both for `rangesIntersect` selection checks and as CM6 transaction targets.
 */
export function buildCellGrid(tableNode: SyntaxNode): CellRange[][] {
    const grid: CellRange[][] = [];
    for (let row = tableNode.firstChild; row; row = row.nextSibling) {
        if (row.name !== 'TableHeader' && row.name !== 'TableRow') { continue; }
        const cells: CellRange[] = [];
        for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
            if (cell.name === 'TableCell') { cells.push({ from: cell.from, to: cell.to }); }
        }
        grid.push(cells);
    }
    return grid;
}

/**
 * The cell the selection is inside, or null if it truly matches none (e.g. a
 * range selection landing outside every cell).
 *
 * For a RANGE selection (Tab/Enter/Shift+Tab nav always dispatches one — see
 * `selectRange` below) this requires an exact intersection with a cell's
 * trimmed `TableCell` range, which is unambiguous since we're the ones who
 * picked that exact range.
 *
 * For a COLLAPSED selection (typing, clicking, Arrow nav) this instead finds
 * the NEAREST cell on the same line, splitting the gap between neighboring
 * cells at its midpoint, rather than requiring strict containment in the
 * trimmed range. This is necessary, not cosmetic: `TableCell.from`/`.to`
 * excludes trailing padding (verified against the real parser — a cell
 * "Cell 1   " has a node covering only "Cell 1"). Typing a trailing space
 * while editing a cell moves the cursor into that excluded padding zone on
 * the very next re-parse; a strict containment check would report "no active
 * cell" and the widget would lose focus on every space bar press. Widening
 * the match keeps the SAME cell active through its own padding, while a
 * position sitting deep enough in the gap to be genuinely closer to the next
 * cell still resolves there rather than to neither.
 */
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
            const midLow = col === 0 ? -Infinity : (cols[col - 1].to + cell.from) / 2;
            const midHigh = col === cols.length - 1 ? Infinity : (cell.to + cols[col + 1].from) / 2;
            if (pos >= midLow && pos <= midHigh) {
                return { row, col, from: cell.from, to: cell.to };
            }
        }
    }
    return null;
}

/** Neighbor lookups for Tab/Shift+Tab/Enter/Arrow cell navigation — row-major order, wraps at row ends. */
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

// ===== Row-context-menu structural ops (delete/move/insert row or column,
// clear cell/row/column) — pure functions of EditorState, headlessly testable
// like formatCommands.ts's computeXxx functions (see slashMenu.ts's file
// header for why that's the shared idiom in this engine). Row ops rewrite
// just the affected physical line(s) (same "swap two adjacent lines" trick as
// formatCommands.ts's computeMoveLineUp/Down); column ops necessarily touch
// EVERY row's line at once, so they regenerate the whole table's source
// instead — a deliberate reflow, not a bug: there's no way to change a
// table's column count without rewriting every row.

interface TableRowNodes {
    header: SyntaxNode;
    delimiter: SyntaxNode;
    body: SyntaxNode[];
}

/**
 * Direct children of a Table node, by role — distinct from `buildCellGrid`'s
 * per-CELL ranges: these are per-ROW ranges (one full source line each, per
 * the real lezer/markdown GFM table parser — confirmed against its source,
 * not assumed), needed by the row ops below, which rewrite whole lines rather
 * than individual cells.
 */
function tableRowNodes(tableNode: SyntaxNode): TableRowNodes {
    let header: SyntaxNode | null = null;
    let delimiter: SyntaxNode | null = null;
    const body: SyntaxNode[] = [];
    for (let n = tableNode.firstChild; n; n = n.nextSibling) {
        if (n.name === 'TableHeader') { header = n; }
        else if (n.name === 'TableDelimiter') { delimiter = n; }
        else if (n.name === 'TableRow') { body.push(n); }
    }
    if (!header || !delimiter) { throw new Error('malformed table: missing header or delimiter row'); }
    return { header, delimiter, body };
}

/**
 * Splits the raw "| --- | :--: |" alignment line into per-column tokens,
 * respecting a `\|` escape the same way cell content can. There's no
 * per-cell parse node for this one row (unlike TableCell for header/body rows
 * — see the file header comment on `buildCellGrid`), so it's the only row
 * that has to be split by hand rather than read off the syntax tree.
 */
function splitTableRowCells(text: string): string[] {
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

/** Pads/truncates a row's cells to `colCount` — keeps column ops well-defined even against a ragged (malformed) row. */
function normalizeRowCells(cells: readonly string[], colCount: number): string[] {
    const out = cells.slice(0, colCount);
    while (out.length < colCount) { out.push(''); }
    return out;
}

function withColumnDeleted<T>(arr: readonly T[], col: number): T[] {
    const out = arr.slice();
    out.splice(col, 1);
    return out;
}

function withColumnInserted<T>(arr: readonly T[], col: number, value: T): T[] {
    const out = arr.slice();
    out.splice(col, 0, value);
    return out;
}

function withColumnsSwapped<T>(arr: readonly T[], a: number, b: number): T[] {
    const out = arr.slice();
    [out[a], out[b]] = [out[b], out[a]];
    return out;
}

function buildTableSource(headerCells: readonly string[], delimiterTokens: readonly string[], bodyRows: readonly (readonly string[])[]): string {
    const rowLine = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
    return [rowLine(headerCells), rowLine(delimiterTokens), ...bodyRows.map(rowLine)].join('\n');
}

interface ColumnData {
    colCount: number;
    header: string[];
    delimiter: string[];
    body: string[][];
}

function readColumnData(state: EditorState, tableNode: SyntaxNode, grid: readonly CellRange[][]): ColumnData {
    const colCount = grid[0]?.length ?? 0;
    const header = normalizeRowCells((grid[0] ?? []).map(c => state.sliceDoc(c.from, c.to)), colCount);
    const delimiterNode = tableRowNodes(tableNode).delimiter;
    const delimiter = normalizeRowCells(splitTableRowCells(state.sliceDoc(delimiterNode.from, delimiterNode.to)), colCount);
    const body = grid.slice(1).map(row => normalizeRowCells(row.map(c => state.sliceDoc(c.from, c.to)), colCount));
    return { colCount, header, delimiter, body };
}

export function computeClearCell(grid: readonly CellRange[][], row: number, col: number): TransactionSpec | null {
    const cell = grid[row]?.[col];
    if (!cell) { return null; }
    return { changes: { from: cell.from, to: cell.to, insert: '' } };
}

export function computeClearRow(grid: readonly CellRange[][], row: number): TransactionSpec | null {
    const cells = grid[row];
    if (!cells || cells.length === 0) { return null; }
    return { changes: cells.map(c => ({ from: c.from, to: c.to, insert: '' })) };
}

export function computeClearColumn(grid: readonly CellRange[][], col: number): TransactionSpec | null {
    const changes = grid
        .map(r => r[col])
        .filter((c): c is CellRange => c !== undefined)
        .map(c => ({ from: c.from, to: c.to, insert: '' }));
    if (changes.length === 0) { return null; }
    return { changes };
}

export function computeMoveRowUp(state: EditorState, tableNode: SyntaxNode, _grid: readonly CellRange[][], row: number): TransactionSpec | null {
    if (row < 2) { return null; } // header (0) can't move; body row 1 can't move above the header
    const { body } = tableRowNodes(tableNode);
    const current = body[row - 1];
    const prev = body[row - 2];
    if (!current || !prev) { return null; }
    const currentText = state.sliceDoc(current.from, current.to);
    const prevText = state.sliceDoc(prev.from, prev.to);
    return { changes: { from: prev.from, to: current.to, insert: currentText + '\n' + prevText } };
}

export function computeMoveRowDown(state: EditorState, tableNode: SyntaxNode, grid: readonly CellRange[][], row: number): TransactionSpec | null {
    if (row === 0 || row >= grid.length - 1) { return null; } // header can't move; last row has nothing below it
    const { body } = tableRowNodes(tableNode);
    const current = body[row - 1];
    const next = body[row];
    if (!current || !next) { return null; }
    const currentText = state.sliceDoc(current.from, current.to);
    const nextText = state.sliceDoc(next.from, next.to);
    return { changes: { from: current.from, to: next.to, insert: nextText + '\n' + currentText } };
}

/** Deleting the header promotes the first body row to take its place — the alternative (a table with no header) isn't valid GFM. */
export function computeDeleteRow(state: EditorState, tableNode: SyntaxNode, _grid: readonly CellRange[][], row: number): TransactionSpec | null {
    const { header, delimiter, body } = tableRowNodes(tableNode);
    if (row === 0) {
        const promoted = body[0];
        if (!promoted) { return null; }
        const promotedText = state.sliceDoc(promoted.from, promoted.to);
        return {
            changes: [
                { from: header.from, to: header.to, insert: promotedText },
                { from: delimiter.to, to: promoted.to, insert: '' },
            ],
        };
    }
    const current = body[row - 1];
    if (!current) { return null; }
    const prevEnd = row === 1 ? delimiter.to : body[row - 2].to;
    return { changes: { from: prevEnd, to: current.to, insert: '' } };
}

export function computeInsertRow(state: EditorState, tableNode: SyntaxNode, grid: readonly CellRange[][], row: number, position: 'above' | 'below'): TransactionSpec | null {
    const { delimiter, body } = tableRowNodes(tableNode);
    const colCount = grid[0]?.length ?? 0;
    const newRowText = `| ${Array(colCount).fill('').join(' | ')} |`;

    if (row === 0) {
        if (position === 'above') { return null; } // nothing valid can sit between the header and its mandatory delimiter line
        return { changes: { from: delimiter.to, to: delimiter.to, insert: '\n' + newRowText } };
    }

    const current = body[row - 1];
    if (!current) { return null; }
    return position === 'above'
        ? { changes: { from: current.from, to: current.from, insert: newRowText + '\n' } }
        : { changes: { from: current.to, to: current.to, insert: '\n' + newRowText } };
}

export function computeMoveColumn(state: EditorState, tableNode: SyntaxNode, grid: readonly CellRange[][], col: number, direction: 'left' | 'right'): TransactionSpec | null {
    const { colCount, header, delimiter, body } = readColumnData(state, tableNode, grid);
    const target = direction === 'left' ? col - 1 : col + 1;
    if (target < 0 || target >= colCount) { return null; }
    const insert = buildTableSource(
        withColumnsSwapped(header, col, target),
        withColumnsSwapped(delimiter, col, target),
        body.map(row => withColumnsSwapped(row, col, target)),
    );
    return { changes: { from: tableNode.from, to: tableNode.to, insert } };
}

export function computeDeleteColumn(state: EditorState, tableNode: SyntaxNode, grid: readonly CellRange[][], col: number): TransactionSpec | null {
    const { colCount, header, delimiter, body } = readColumnData(state, tableNode, grid);
    if (colCount <= 1) { return null; }
    const insert = buildTableSource(
        withColumnDeleted(header, col),
        withColumnDeleted(delimiter, col),
        body.map(row => withColumnDeleted(row, col)),
    );
    return { changes: { from: tableNode.from, to: tableNode.to, insert } };
}

export function computeInsertColumn(state: EditorState, tableNode: SyntaxNode, grid: readonly CellRange[][], col: number, position: 'left' | 'right'): TransactionSpec {
    const { header, delimiter, body } = readColumnData(state, tableNode, grid);
    const at = position === 'left' ? col : col + 1;
    const insert = buildTableSource(
        withColumnInserted(header, at, ''),
        withColumnInserted(delimiter, at, '---'),
        body.map(row => withColumnInserted(row, at, '')),
    );
    return { changes: { from: tableNode.from, to: tableNode.to, insert } };
}

export type TableMenuActionId =
    | 'clearCell' | 'clearRow' | 'clearColumn'
    | 'insertRowAbove' | 'insertRowBelow' | 'moveRowUp' | 'moveRowDown' | 'deleteRow'
    | 'insertColumnLeft' | 'insertColumnRight' | 'moveColumnLeft' | 'moveColumnRight' | 'deleteColumn';

export interface TableMenuItem {
    id: TableMenuActionId;
    label: string;
    enabled: boolean;
    disabledReason?: string;
}

/**
 * What the right-click menu offers for the cell at (row, col) — a pure
 * function of the grid's shape, computed at menu-open time straight off the
 * widget's already-captured `grid` (no syntax-tree access needed just to
 * decide what to show). Three groups: the clicked cell, its row, its column.
 * Impossible actions (move off an edge, move/delete the header itself) stay
 * in the menu but disabled with a reason — deliberately not hidden, so
 * right-clicking the leftmost column visibly explains why "Move column left"
 * can't run instead of silently omitting it.
 */
export function computeTableContextMenu(grid: readonly CellRange[][], row: number, col: number): TableMenuItem[][] {
    const rowCount = grid.length;
    const colCount = grid[0]?.length ?? 0;
    const isHeaderRow = row === 0;

    const cellGroup: TableMenuItem[] = [
        { id: 'clearCell', label: 'Clear cell', enabled: true },
    ];

    const moveUpEnabled = row >= 2;
    const moveDownEnabled = !isHeaderRow && row < rowCount - 1;
    const deleteRowEnabled = isHeaderRow ? rowCount > 1 : true;

    const rowGroup: TableMenuItem[] = [
        { id: 'clearRow', label: 'Clear row', enabled: true },
        { id: 'insertRowAbove', label: 'Insert row above', enabled: !isHeaderRow, disabledReason: isHeaderRow ? "Can't insert above the header row" : undefined },
        { id: 'insertRowBelow', label: 'Insert row below', enabled: true },
        { id: 'moveRowUp', label: 'Move row up', enabled: moveUpEnabled, disabledReason: moveUpEnabled ? undefined : (isHeaderRow ? "Header row can't be moved" : "Can't move above the header row") },
        { id: 'moveRowDown', label: 'Move row down', enabled: moveDownEnabled, disabledReason: moveDownEnabled ? undefined : (isHeaderRow ? "Header row can't be moved" : 'Already the last row') },
        { id: 'deleteRow', label: 'Delete row', enabled: deleteRowEnabled, disabledReason: deleteRowEnabled ? undefined : 'Table needs a header row' },
    ];

    const moveLeftEnabled = col >= 1;
    const moveRightEnabled = col < colCount - 1;
    const deleteColumnEnabled = colCount > 1;

    const columnGroup: TableMenuItem[] = [
        { id: 'clearColumn', label: 'Clear column', enabled: true },
        { id: 'insertColumnLeft', label: 'Insert column left', enabled: true },
        { id: 'insertColumnRight', label: 'Insert column right', enabled: true },
        { id: 'moveColumnLeft', label: 'Move column left', enabled: moveLeftEnabled, disabledReason: moveLeftEnabled ? undefined : 'Already the first column' },
        { id: 'moveColumnRight', label: 'Move column right', enabled: moveRightEnabled, disabledReason: moveRightEnabled ? undefined : 'Already the last column' },
        { id: 'deleteColumn', label: 'Delete column', enabled: deleteColumnEnabled, disabledReason: deleteColumnEnabled ? undefined : 'Table needs at least one column' },
    ];

    return [cellGroup, rowGroup, columnGroup];
}

/** One entry point for every menu action — mirrors formatCommands.ts's `runFormatCommand` dispatch table. */
export function computeTableMenuTransaction(
    state: EditorState,
    tableNode: SyntaxNode,
    grid: readonly CellRange[][],
    row: number,
    col: number,
    actionId: TableMenuActionId,
): TransactionSpec | null {
    switch (actionId) {
        case 'clearCell': return computeClearCell(grid, row, col);
        case 'clearRow': return computeClearRow(grid, row);
        case 'clearColumn': return computeClearColumn(grid, col);
        case 'insertRowAbove': return computeInsertRow(state, tableNode, grid, row, 'above');
        case 'insertRowBelow': return computeInsertRow(state, tableNode, grid, row, 'below');
        case 'moveRowUp': return computeMoveRowUp(state, tableNode, grid, row);
        case 'moveRowDown': return computeMoveRowDown(state, tableNode, grid, row);
        case 'deleteRow': return computeDeleteRow(state, tableNode, grid, row);
        case 'insertColumnLeft': return computeInsertColumn(state, tableNode, grid, col, 'left');
        case 'insertColumnRight': return computeInsertColumn(state, tableNode, grid, col, 'right');
        case 'moveColumnLeft': return computeMoveColumn(state, tableNode, grid, col, 'left');
        case 'moveColumnRight': return computeMoveColumn(state, tableNode, grid, col, 'right');
        case 'deleteColumn': return computeDeleteColumn(state, tableNode, grid, col);
        default: return null;
    }
}

/** The Nth Table node in the document, in the same order-of-appearance scheme `computeTableDecorations` uses to assign `tableIndex`. */
export function findTableNodeByIndex(state: EditorState, tableIndex: number): SyntaxNode | null {
    let found: SyntaxNode | null = null;
    let i = 0;
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name !== 'Table') { return; }
            if (i === tableIndex) { found = node.node; }
            i++;
        },
    });
    return found;
}

/** Strip newlines a paste might inject — GFM pipe-table rows are one physical line each. */
function sanitizeCellInput(text: string): string {
    return text.replace(/[\r\n]+/g, ' ');
}

function selectRange(view: EditorView, target: CellRange): void {
    view.dispatch({ selection: { anchor: target.from, head: target.to } });
}

function placeCollapsed(view: EditorView, pos: number): void {
    view.dispatch({ selection: { anchor: pos } });
}

function caretOffsetIn(el: HTMLElement): number | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) { return null; }
    const range = sel.getRangeAt(0);
    if (range.startContainer === el) {
        return range.startOffset === 0 ? 0 : (el.textContent?.length ?? 0);
    }
    if (range.startContainer === el.firstChild) { return range.startOffset; }
    return null;
}

function placeCaretAtOffset(el: HTMLElement, offset: number): void {
    const textNode = el.firstChild ?? el.appendChild(document.createTextNode(''));
    const range = document.createRange();
    range.setStart(textNode, Math.max(0, Math.min(offset, textNode.textContent?.length ?? 0)));
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
}

function selectAllTextIn(el: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
}

/** The rendered <td>/<th> for a grid position — row 0 is markdown-it's <thead>, others <tbody>. */
function domCellFor(wrap: HTMLElement, row: number, col: number): HTMLElement | null {
    if (row === 0) {
        return (wrap.querySelectorAll('thead th')[col] as HTMLElement | undefined) ?? null;
    }
    const bodyRow = wrap.querySelectorAll('tbody tr')[row - 1];
    return (bodyRow?.children[col] as HTMLElement | undefined) ?? null;
}

/** Inverse of `domCellFor` — the grid position for a rendered <th>/<td>. */
function resolveCellPosition(wrap: HTMLElement, cellEl: HTMLElement): { row: number; col: number } | null {
    const row = cellEl.closest('thead') ? 0 : 1 + Array.from(wrap.querySelectorAll('tbody tr')).indexOf(cellEl.parentElement as HTMLElement);
    const col = Array.from(cellEl.parentElement?.children ?? []).indexOf(cellEl);
    if (row < 0 || col < 0) { return null; }
    return { row, col };
}

function widthsEqual(a: readonly number[] | null, b: readonly number[] | null): boolean {
    if (a === b) { return true; }
    if (!a || !b) { return false; }
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * A thin drag strip on a <th>'s right edge — resize handles live only on the
 * header row, one per column (Excel/Sheets/Notion convention: resize from the
 * header, not per-cell). Drag is DOM-only (mutating the <col>'s style.width
 * directly) until `mouseup`; only then is ONE `setColumnWidthsEffect`
 * dispatched, reading back every column's current width (not just the
 * dragged one — neighbors may already have explicit widths from earlier
 * resizes). This mirrors why cell editing commits per-keystroke rather than
 * per-DOM-mutation-frame: dispatching on every `mousemove` would fight the
 * widget lifecycle (`updateDOM`/`eq`) for zero benefit, since nothing outside
 * this drag needs to observe the in-progress width.
 */
function wireResizeHandle(th: HTMLElement, table: HTMLTableElement, view: EditorView, col: number, tableIndex: number): void {
    const handle = document.createElement('div');
    handle.className = 'cm-md-col-resize-handle';
    th.appendChild(handle);

    const currentCols = () => Array.from(table.querySelectorAll(':scope > colgroup > col')) as HTMLTableColElement[];
    const currentThs = () => Array.from(table.querySelectorAll('thead th')) as HTMLElement[];

    handle.addEventListener('mousedown', (event) => {
        // Without this, the event bubbles to the <th>'s own mousedown
        // listener (from the cell-activation feature) and starting a drag
        // would also activate the header cell for text editing.
        event.preventDefault();
        event.stopPropagation();

        const cols = currentCols();
        if (!table.classList.contains('cm-md-table-resized')) {
            // First-ever resize of this table: seed every column's <col>
            // from its current RENDERED width (measured off the <th>, not
            // the <col> itself — <col> boxes aren't reliably measurable
            // across browsers) before flipping to fixed layout, so columns
            // that weren't dragged don't visibly jump.
            const ths = currentThs();
            cols.forEach((c, i) => {
                c.style.width = `${Math.round(ths[i]?.getBoundingClientRect().width ?? MIN_COL_WIDTH_PX)}px`;
            });
            table.classList.add('cm-md-table-resized');
        }

        const targetTh = currentThs()[col];
        const targetCol = cols[col];
        if (!targetTh || !targetCol) { return; }
        const startX = event.clientX;
        const startWidth = targetTh.getBoundingClientRect().width;

        const onMove = (moveEvent: MouseEvent) => {
            const next = Math.max(MIN_COL_WIDTH_PX, startWidth + (moveEvent.clientX - startX));
            targetCol.style.width = `${next}px`;
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const widths = cols.map(c => Math.round(parseFloat(c.style.width) || 0));
            view.dispatch({ effects: setColumnWidthsEffect.of({ tableIndex, widths }) });
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    // Excel/Sheets/Notion convention: double-click a handle clears that
    // column's manual override. Under table-layout:fixed this means "share
    // remaining space with other auto columns," not a true content-measuring
    // autofit — an honest v1 simplification, not real content measurement.
    handle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!table.classList.contains('cm-md-table-resized')) { return; }
        const cols = currentCols();
        const targetCol = cols[col];
        if (!targetCol) { return; }
        targetCol.style.width = '';
        const widths = cols.map(c => Math.round(parseFloat(c.style.width) || 0));
        view.dispatch({ effects: setColumnWidthsEffect.of({ tableIndex, widths }) });
    });
}

/**
 * Wires one <td>/<th> as the live, directly-editable surface for `active`.
 * Every input event does a full replace of the cell's current doc range with
 * the editable element's current text — simpler and drift-proof compared to
 * incremental diffing, and cells are short so the cost is negligible. `live`
 * tracks the cell's current range across a typing session (its `to` shifts as
 * text is inserted/removed); it starts from `active` and is updated after
 * each dispatch — this instance's `TableWidget` gets rebuilt with a fresh,
 * correct `active` on every state update, but `live` lets this SAME DOM
 * element (kept alive across keystrokes by `updateDOM` below) keep dispatching
 * correctly without needing a rebuild on every character.
 */
function wireActiveCell(td: HTMLElement, view: EditorView, active: ActiveCell, grid: readonly CellRange[][]): void {
    td.contentEditable = 'true';
    td.spellcheck = false;
    td.classList.add('cm-md-table-cell-editing');
    td.textContent = view.state.sliceDoc(active.from, active.to);

    let live: CellRange = { from: active.from, to: active.to };
    let composing = false;

    const commit = () => {
        if (composing) { return; }
        const text = sanitizeCellInput(td.textContent ?? '');
        const { from, to } = live;
        live = { from, to: from + text.length };
        view.dispatch({ changes: { from, to, insert: text } });
    };

    td.addEventListener('compositionstart', () => { composing = true; });
    td.addEventListener('compositionend', () => { composing = false; commit(); });
    td.addEventListener('input', commit);
    td.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') {
            event.preventDefault();
            const target = event.shiftKey ? prevCell(grid, active) : nextCell(grid, active);
            if (target) { selectRange(view, target); }
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const target = cellBelow(grid, active);
            if (target) { selectRange(view, target); }
        } else if (event.key === 'ArrowRight' && caretOffsetIn(td) === (td.textContent?.length ?? 0)) {
            const target = nextCell(grid, active);
            if (target) { event.preventDefault(); placeCollapsed(view, target.from); }
        } else if (event.key === 'ArrowLeft' && caretOffsetIn(td) === 0) {
            const target = prevCell(grid, active);
            if (target) { event.preventDefault(); placeCollapsed(view, target.to); }
        } else if (event.key === 'ArrowDown' && caretOffsetIn(td) === (td.textContent?.length ?? 0)) {
            const target = cellBelow(grid, active);
            if (target) { event.preventDefault(); placeCollapsed(view, target.from); }
        } else if (event.key === 'ArrowUp' && caretOffsetIn(td) === 0) {
            const target = cellAbove(grid, active);
            if (target) { event.preventDefault(); placeCollapsed(view, target.to); }
        }
    });

    // Land the caret/selection to match how this cell became active: a range
    // selection (Tab/Enter nav landed here) selects the whole cell, ready to
    // overwrite; a collapsed selection (click, or Arrow nav) places the caret
    // at that exact character offset. Click doesn't map pixel->offset (v1
    // scope cut, see file header) so mousedown below always lands collapsed
    // at the cell's end.
    const sel = view.state.selection.main;
    queueMicrotask(() => {
        td.focus();
        if (sel.from !== sel.to) {
            selectAllTextIn(td);
        } else {
            placeCaretAtOffset(td, sel.from - active.from);
        }
    });
}

// A single menu element shared across every table on the page (like the
// spreadsheet webview's own `headerContextMenu` singleton) — only one can
// ever be open at a time, and keeping it outside any TableWidget's own `wrap`
// means it survives that widget's DOM being torn down/rebuilt mid-session.
let tableContextMenuEl: HTMLElement | null = null;

function hideTableContextMenu(): void {
    if (!tableContextMenuEl) { return; }
    tableContextMenuEl.classList.add('hidden');
    tableContextMenuEl.innerHTML = '';
}

function ensureTableContextMenu(): HTMLElement {
    if (tableContextMenuEl) { return tableContextMenuEl; }
    const menu = document.createElement('div');
    menu.className = 'cm-md-table-context-menu hidden';
    document.body.appendChild(menu);
    tableContextMenuEl = menu;
    document.addEventListener('mousedown', (event) => {
        if (!tableContextMenuEl || tableContextMenuEl.classList.contains('hidden')) { return; }
        if (event.target instanceof Node && !tableContextMenuEl.contains(event.target)) { hideTableContextMenu(); }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { hideTableContextMenu(); }
    });
    return menu;
}

/**
 * Builds and positions the menu, and wires each item's click to recompute the
 * table's CURRENT node/grid from `view.state` at click time (not the `grid`
 * captured when the menu opened) — the doc may have changed while the user
 * was deciding, so this re-resolves by `tableIndex` rather than trusting a
 * stale reference. `row`/`col` stay valid identifiers either way since a
 * structural edit elsewhere in the table doesn't renumber the clicked cell.
 */
function showTableContextMenu(event: MouseEvent, view: EditorView, tableIndex: number, row: number, col: number, groups: readonly TableMenuItem[][]): void {
    const menu = ensureTableContextMenu();
    menu.innerHTML = '';

    groups.forEach((group, groupIndex) => {
        if (groupIndex > 0) {
            const separator = document.createElement('div');
            separator.className = 'cm-md-table-context-separator';
            menu.appendChild(separator);
        }
        group.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cm-md-table-context-item';
            btn.textContent = item.label;
            btn.disabled = !item.enabled;
            if (item.disabledReason) { btn.title = item.disabledReason; }
            btn.addEventListener('click', () => {
                hideTableContextMenu();
                const tableNode = findTableNodeByIndex(view.state, tableIndex);
                if (!tableNode) { return; }
                const spec = computeTableMenuTransaction(view.state, tableNode, buildCellGrid(tableNode), row, col, item.id);
                if (spec) { view.dispatch(spec); }
            });
            menu.appendChild(btn);
        });
    });

    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(Math.max(8, event.clientX), window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(Math.max(8, event.clientY), window.innerHeight - rect.height - 8) + 'px';
}

export class TableWidget extends WidgetType {
    readonly source: string;
    readonly grid: readonly CellRange[][];
    readonly activeCell: ActiveCell | null;
    readonly tableIndex: number;
    readonly widths: readonly number[] | null;

    constructor(source: string, grid: readonly CellRange[][], activeCell: ActiveCell | null, tableIndex: number, widths: readonly number[] | null) {
        super();
        this.source = source;
        this.grid = grid;
        this.activeCell = activeCell;
        this.tableIndex = tableIndex;
        this.widths = widths;
    }

    eq(other: TableWidget): boolean {
        return other.source === this.source &&
            other.activeCell?.row === this.activeCell?.row &&
            other.activeCell?.col === this.activeCell?.col &&
            widthsEqual(other.widths, this.widths);
    }

    toDOM(view: EditorView): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'cm-md-table-widget';
        const colCount = this.grid[0]?.length ?? 0;
        wrap.innerHTML = md.render(this.source, { colCount, widths: this.widths });

        const table = wrap.querySelector('table.md-table') as HTMLTableElement | null;
        if (table && this.widths?.some(w => w > 0)) { table.classList.add('cm-md-table-resized'); }

        wrap.querySelectorAll('th, td').forEach((cellEl) => {
            cellEl.addEventListener('mousedown', (event) => {
                // The active cell IS a real contentEditable — let the browser
                // place its own caret at the clicked pixel natively. Only
                // clicks on an INACTIVE cell need to be intercepted, to
                // activate it via a CM6 selection dispatch (checked at click
                // time via the class `wireActiveCell` sets below, not at
                // listener-attachment time, so this is correct regardless of
                // which cell was active when toDOM ran).
                if (cellEl.classList.contains('cm-md-table-cell-editing')) { return; }
                const pos = resolveCellPosition(wrap, cellEl as HTMLElement);
                const target = pos ? this.grid[pos.row]?.[pos.col] : undefined;
                if (!target) { return; }
                event.preventDefault();
                placeCollapsed(view, target.to);
            });
        });

        wrap.addEventListener('contextmenu', (event) => {
            const cellEl = (event.target as HTMLElement).closest('th, td') as HTMLElement | null;
            if (!cellEl) { return; }
            const pos = resolveCellPosition(wrap, cellEl);
            if (!pos || !this.grid[pos.row]?.[pos.col]) { return; }
            event.preventDefault();
            showTableContextMenu(event, view, this.tableIndex, pos.row, pos.col, computeTableContextMenu(this.grid, pos.row, pos.col));
        });

        if (this.activeCell) {
            const td = domCellFor(wrap, this.activeCell.row, this.activeCell.col);
            if (td) { wireActiveCell(td, view, this.activeCell, this.grid); }
        }

        // Wired LAST, after wireActiveCell above: wireActiveCell sets
        // `td.textContent = ...` on whichever cell is active, which wipes
        // any children already appended to that element — if a resize
        // handle had been added to a header cell BEFORE that assignment (and
        // that header cell turned out to be the active one), it would be
        // silently removed the instant that header cell is being edited.
        if (table) {
            wrap.querySelectorAll('thead th').forEach((th, col) => {
                wireResizeHandle(th as HTMLElement, table, view, col, this.tableIndex);
            });
        }

        return wrap;
    }

    /**
     * Keeps the active cell's DOM (and its live caret/focus/IME state) alive
     * across every keystroke instead of `toDOM` tearing it down each time.
     * `source` changes on every keystroke inside the table, so `eq` is false
     * almost continuously while typing — without this, CM6 would rebuild the
     * whole widget and steal focus on every character. Every real bug in this
     * feature so far was a widget-lifecycle surprise only caught by manual
     * testing (see file header + .docs/PLAN-obsidian-live-preview.md) — this
     * is exactly that bug class, addressed up front rather than discovered.
     * Only continues the no-op path when the active cell's own input handler
     * is the thing that produced this update (still focused, same row/col);
     * anything else (nav to a different cell, undo, external edit) forces a
     * real re-render via the `false` fallthrough.
     */
    updateDOM(dom: HTMLElement, _view: EditorView, from: TableWidget): boolean {
        const sameActiveCell = this.activeCell !== null && from.activeCell !== null &&
            this.activeCell.row === from.activeCell.row && this.activeCell.col === from.activeCell.col;
        const editing = dom.querySelector<HTMLElement>('.cm-md-table-cell-editing');
        return sameActiveCell && editing !== null && document.activeElement === editing;
    }

    /**
     * The widget fully owns its own DOM events now (clicks resolve a doc
     * position itself via `grid` rather than CM6's own coordinate-to-position
     * guessing, which has no per-cell granularity against an opaque widget;
     * keystrokes are handled by the active cell's own listeners in
     * `wireActiveCell`) — so CM6 should never additionally act on anything
     * that happens inside this widget.
     */
    ignoreEvent(): boolean {
        return true;
    }
}

/**
 * Pure, headless-testable core — see computeRevealDecorations for the same
 * shape. `widthsByTable` defaults to `{}` so existing callers/tests that
 * don't care about column widths are unaffected. Table index = order of
 * appearance while scanning `visibleRanges` — only meaningful when the whole
 * document is scanned in one range (as `buildFromState` always does below);
 * a table split across two ranges would double-count, but that never happens
 * in practice today.
 */
export function computeTableDecorations(
    state: EditorState,
    selFrom: number,
    selTo: number,
    visibleRanges: readonly VisibleRange[],
    widthsByTable: Record<number, readonly number[]> = {},
): DecorationSet {
    const specs: { from: number; to: number; value: ReturnType<typeof Decoration.replace> }[] = [];
    let tableIndex = 0;

    for (const { from, to } of visibleRanges) {
        syntaxTree(state).iterate({
            from,
            to,
            enter(node) {
                if (node.name !== 'Table') { return; }
                const grid = buildCellGrid(node.node);
                const activeCell = findActiveCell(state, grid, selFrom, selTo);
                const source = state.sliceDoc(node.from, node.to);
                const index = tableIndex++;
                specs.push({
                    from: node.from,
                    to: node.to,
                    value: Decoration.replace({
                        widget: new TableWidget(source, grid, activeCell, index, widthsByTable[index] ?? null),
                        block: true,
                    }),
                });
            },
        });
    }

    return Decoration.set(specs.map(s => s.value.range(s.from, s.to)), true);
}

export const setColumnWidthsEffect = StateEffect.define<{ tableIndex: number; widths: readonly number[] }>();

/**
 * Committed column widths, table-order-index -> px per column. Seeded
 * per-mount by `columnWidthsField.init(...)` in livePreviewEditor.ts (from
 * persisted extension-host storage); this module's own `create` is only the
 * fallback for contexts that never seed it (e.g. this file's own headless
 * tests). Updated only by `setColumnWidthsEffect`, dispatched on drag-end —
 * never per-pixel (see wireResizeHandle).
 */
export const columnWidthsField = StateField.define<Record<number, readonly number[]>>({
    create: () => ({}),
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setColumnWidthsEffect)) {
                value = { ...value, [effect.value.tableIndex]: effect.value.widths };
            }
        }
        return value;
    },
});

function buildFromState(state: EditorState): DecorationSet {
    const sel = state.selection.main;
    const widthsByTable = state.field(columnWidthsField, false) ?? {};
    // No `view.visibleRanges` here — see the StateField note below — so this
    // always scans the whole document. Acceptable: it's filtered to just
    // `Table` nodes, and tables are comparatively rare compared to the marks
    // revealDecorations.ts scans for on every keystroke.
    return computeTableDecorations(state, sel.from, sel.to, [{ from: 0, to: state.doc.length }], widthsByTable);
}

// A StateField, not a ViewPlugin — CM6 requires it: a block-level
// `Decoration.replace({block: true, widget})` (what a table needs — there's
// no inline way to render an actual <table> grid) throws
// "Block decorations may not be specified via plugins" if it comes from a
// ViewPlugin's `decorations` facet provider (that provider is a *function*,
// which CM6 flags as a "dynamic" source and disallows block effects from).
// A StateField's `provide: f => EditorView.decorations.from(f)` registers the
// field's plain VALUE instead, which CM6 does not flag — confirmed against
// this repo's installed @codemirror/view by grepping `dynamicDecorationMap`
// and `disallowBlockEffectsFor` in its source, not assumed. Every other
// decoration in this engine (mark/replace without `block`, and `Decoration.line`
// for blockquote/fenced-code) is a different, unrestricted decoration class —
// this restriction is specific to block widget/replace decorations, which only
// the table widget uses.
export const tableWidgetField = StateField.define<DecorationSet>({
    create: buildFromState,
    update(_value, tr) {
        return buildFromState(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
});
