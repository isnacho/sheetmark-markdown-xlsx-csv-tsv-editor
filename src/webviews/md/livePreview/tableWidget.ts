// Table rendering for the Markdown "Preview Edit" mode.
//
// Runtime: WEBVIEW (browser) for the StateField/WidgetType; the pure grid/
// active-cell helpers below have no DOM dependency, so they're exercised
// headlessly in tableWidget.test.mts. Only TableWidget's DOM wiring
// (toDOM/updateDOM and the editable-cell event handlers) needs a real
// browser and is verified by manual F5 testing, per this project's test
// infrastructure (see AGENTS.md and .docs/product/completed/PLAN-obsidian-live-preview.md).
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
import { EditorState, StateField, StateEffect, EditorSelection } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
    tableDeleteArmedField,
    effectiveTableRange,
    buildCellGrid,
    findActiveCell,
    nextCell,
    prevCell,
    cellBelow,
    cellAbove,
    collapsedClickPosForCell,
    splitTableRowCells,
    type TableRange,
    type CellRange,
    type ActiveCell,
} from './tableBoundaryEditing';

export type { CellRange, ActiveCell } from './tableBoundaryEditing';
export {
    buildCellGrid,
    findActiveCell,
    nextCell,
    prevCell,
    cellBelow,
    cellAbove,
    collapsedClickPosForCell,
    splitTableRowCells,
} from './tableBoundaryEditing';

import type { VisibleRange } from './revealDecorations';
import { Icons } from '../../shared/icons';

function remapColumnWidths(widths: readonly number[], fromCol: number, toCol: number): readonly number[] {
    if (fromCol === toCol || fromCol < 0 || toCol < 0 || fromCol >= widths.length) { return widths; }
    const arr = widths.slice();
    const [item] = arr.splice(fromCol, 1);
    const target = Math.min(toCol, arr.length);
    arr.splice(target, 0, item);
    return arr;
}

/** Below this, a column stops shrinking under drag. */
const MIN_COL_WIDTH_PX = 40;

// Match mdWebview.ts's core options so inline HTML in cells (e.g. <br> line
// breaks) renders instead of showing escaped literal tags when the cell is
// inactive. linkify keeps bare URLs consistent with the main editor.
const md = new MarkdownIt({ html: true, linkify: true });
const defaultTableOpen = md.renderer.rules.table_open || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrJoin('class', 'md-table');
    const openTag = defaultTableOpen(tokens, idx, options, env, self);
    // Always emit a <colgroup> (even with no explicit widths) so drag code
    // never has to special-case "no colgroup yet" on a table's first-ever
    // resize — a <col> with no width style defers to equal column split under
    // the default page-width `table-layout: fixed` CSS. `colCount`/`widths`
    // are threaded through markdown-it's own per-render `env` param (not
    // widget state — this rule is a shared singleton across every TableWidget
    // instance).
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

/** Move a body row to a new body-row index (0 = first body row). */
export function computeMoveRowTo(
    state: EditorState,
    tableNode: SyntaxNode,
    grid: readonly CellRange[][],
    fromRow: number,
    toBodyIndex: number,
): TransactionSpec | null {
    if (fromRow < 1 || fromRow >= grid.length) { return null; }
    const { body } = tableRowNodes(tableNode);
    const fromBodyIdx = fromRow - 1;
    if (fromBodyIdx < 0 || fromBodyIdx >= body.length) { return null; }
    if (toBodyIndex < 0 || toBodyIndex > body.length) { return null; }
    const to = Math.min(toBodyIndex, body.length - 1);
    if (fromBodyIdx === to) { return null; }

    const texts = body.map(r => state.sliceDoc(r.from, r.to));
    const [moved] = texts.splice(fromBodyIdx, 1);
    texts.splice(to, 0, moved);

    const bodyFrom = body[0].from;
    const bodyTo = body[body.length - 1].to;
    return { changes: { from: bodyFrom, to: bodyTo, insert: texts.join('\n') } };
}

/** Move a column to a new column index. */
export function computeMoveColumnTo(
    state: EditorState,
    tableNode: SyntaxNode,
    grid: readonly CellRange[][],
    fromCol: number,
    toCol: number,
): TransactionSpec | null {
    const { colCount, header, delimiter, body } = readColumnData(state, tableNode, grid);
    if (fromCol < 0 || fromCol >= colCount || toCol < 0 || toCol > colCount) { return null; }
    if (fromCol === toCol || (fromCol + 1 === toCol && toCol === colCount)) { return null; }

    const cols = header.map((_, i) => i);
    const [moved] = cols.splice(fromCol, 1);
    const target = Math.min(toCol, cols.length);
    cols.splice(target, 0, moved);

    const reorder = <T>(arr: readonly T[]): T[] => cols.map(i => arr[i]);
    const insert = buildTableSource(reorder(header), reorder(delimiter), body.map(row => reorder(row)));
    return { changes: { from: tableNode.from, to: tableNode.to, insert } };
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

/** Cursor position inside a newly inserted row/column, after the menu transaction applies. */
export function selectionPosAfterTableInsert(
    state: EditorState,
    tableNode: SyntaxNode,
    actionId: TableMenuActionId,
    row: number,
    col: number,
): number | null {
    const grid = buildCellGrid(state, tableNode);
    switch (actionId) {
        case 'insertRowAbove':
            return row === 0 ? null : (grid[row]?.[col]?.from ?? null);
        case 'insertRowBelow':
            return grid[row + 1]?.[col]?.from ?? null;
        case 'insertColumnLeft':
            return grid[row]?.[col]?.from ?? null;
        case 'insertColumnRight':
            return grid[row]?.[col + 1]?.from ?? null;
        default:
            return null;
    }
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

/** Encode pasted/typed newlines as inline breaks — GFM pipe-table rows stay one physical line. */
export function sanitizeTableCellInput(text: string): string {
    return text.replace(/\r\n?/g, '\n').replace(/\n+/g, '<br>');
}

export function wrapTableCellTextSelection(
    text: string,
    start: number,
    end: number,
    before: string,
    after: string,
): { text: string; cursor: number } {
    const selected = text.slice(start, end);
    const bLen = before.length;
    const aLen = after.length;
    if (start >= bLen && text.slice(start - bLen, start) === before && text.slice(end, end + aLen) === after) {
        const next = text.slice(0, start - bLen) + selected + text.slice(end + aLen);
        return { text: next, cursor: start - bLen + selected.length };
    }
    const next = text.slice(0, start) + before + selected + after + text.slice(end);
    const cursor = start === end ? start + bLen : start + bLen + selected.length;
    return { text: next, cursor };
}

export function insertTableCellLink(text: string, start: number, end: number): { text: string; cursor: number; selectFrom: number; selectTo: number } {
    const selected = text.slice(start, end);
    if (selected) {
        const insert = `[${selected}](url)`;
        const next = text.slice(0, start) + insert + text.slice(end);
        const urlStart = start + selected.length + 3;
        return { text: next, cursor: urlStart, selectFrom: urlStart, selectTo: urlStart + 3 };
    }
    const insert = '[text](url)';
    const next = text.slice(0, start) + insert + text.slice(end);
    return { text: next, cursor: start + 1, selectFrom: start + 1, selectTo: start + 5 };
}

const TABLE_CELL_INLINE_FORMAT_ACTIONS = new Set(['bold', 'italic', 'strikethrough', 'inlineCode', 'link']);
const BR_TAG_RE = /<br\s*\/?>/gi;

let activeTableEditingCell: HTMLElement | null = null;
const tableCellCommitHandlers = new WeakMap<HTMLElement, () => void>();

export function applyTableCellInlineFormatAction(action: string): boolean {
    const cell = activeTableEditingCell;
    if (!cell || !TABLE_CELL_INLINE_FORMAT_ACTIONS.has(action)) { return false; }
    if (!applyCellInlineFormat(cell, action)) { return false; }
    tableCellCommitHandlers.get(cell)?.();
    cell.focus();
    return true;
}

function serializeCellContent(el: HTMLElement): string {
    let out = '';
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            out += node.textContent ?? '';
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) { return; }
        const element = node as HTMLElement;
        if (element.tagName === 'BR') {
            out += '<br>';
            return;
        }
        element.childNodes.forEach(walk);
    };
    Array.from(el.childNodes).forEach(walk);
    return out;
}

function loadCellForEditing(td: HTMLElement, rawText: string): void {
    td.replaceChildren();
    const parts = rawText.split(BR_TAG_RE);
    parts.forEach((part, index) => {
        if (part) { td.appendChild(document.createTextNode(part)); }
        if (index < parts.length - 1) { td.appendChild(document.createElement('br')); }
    });
    if (!td.childNodes.length) { td.appendChild(document.createTextNode('')); }
}

function measureSerializedOffset(root: HTMLElement, endNode: Node, endOffset: number): number {
    let out = '';
    let found = false;

    const walk = (node: Node): boolean => {
        if (found) { return true; }
        if (node === endNode) {
            if (node.nodeType === Node.TEXT_NODE) {
                out += (node.textContent ?? '').slice(0, endOffset);
            }
            found = true;
            return true;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            out += node.textContent ?? '';
            return false;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            if (element.tagName === 'BR') {
                out += '<br>';
                return false;
            }
            Array.from(element.childNodes).forEach((child) => {
                if (walk(child)) { return; }
            });
            if (found) { return true; }
        }
        return false;
    };

    for (const child of Array.from(root.childNodes)) {
        if (walk(child)) { break; }
    }
    return out.length;
}

function getCellSelectionOffsets(el: HTMLElement): { start: number; end: number } {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { return { start: 0, end: 0 }; }
    const range = sel.getRangeAt(0);
    return {
        start: measureSerializedOffset(el, range.startContainer, range.startOffset),
        end: measureSerializedOffset(el, range.endContainer, range.endOffset),
    };
}

function placeCaretAtSerializedOffset(el: HTMLElement, offset: number): void {
    const target = Math.max(0, offset);
    let remaining = target;
    let placedNode: Node = el;
    let placedOffset = 0;
    let placed = false;

    const walk = (node: Node): boolean => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent ?? '';
            if (remaining <= text.length) {
                placedNode = node;
                placedOffset = remaining;
                placed = true;
                return true;
            }
            remaining -= text.length;
            return false;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            if (element.tagName === 'BR') {
                if (remaining === 0) {
                    placedNode = element;
                    placedOffset = 0;
                    placed = true;
                    return true;
                }
                if (remaining < 4) {
                    placedNode = element;
                    placedOffset = 0;
                    placed = true;
                    return true;
                }
                if (remaining === 4) {
                    placedNode = element;
                    placedOffset = 1;
                    placed = true;
                    return true;
                }
                remaining -= 4;
                return false;
            }
            Array.from(element.childNodes).forEach((child) => {
                if (walk(child)) { return; }
            });
            if (placed) { return true; }
        }
        return false;
    };

    Array.from(el.childNodes).forEach((child) => {
        if (walk(child)) { return; }
    });

    const range = document.createRange();
    if (placed) {
        if (placedNode.nodeType === Node.TEXT_NODE) {
            range.setStart(placedNode, placedOffset);
        } else if (placedOffset === 0) {
            range.setStartBefore(placedNode);
        } else {
            range.setStartAfter(placedNode);
        }
    } else {
        range.selectNodeContents(el);
        range.collapse(false);
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
}

function selectSerializedRange(el: HTMLElement, start: number, end: number): void {
    placeCaretAtSerializedOffset(el, start);
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { return; }
    const range = sel.getRangeAt(0).cloneRange();
    placeCaretAtSerializedOffset(el, end);
    const endSel = window.getSelection();
    if (!endSel || endSel.rangeCount === 0) { return; }
    const endPoint = endSel.getRangeAt(0);
    range.setEnd(endPoint.startContainer, endPoint.startOffset);
    sel.removeAllRanges();
    sel.addRange(range);
}

function insertLineBreakAtCaret(el: HTMLElement): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { return; }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) { return; }
    range.deleteContents();
    const br = document.createElement('br');
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
}

function applyCellInlineFormat(el: HTMLElement, action: string): boolean {
    const { start, end } = getCellSelectionOffsets(el);
    const current = serializeCellContent(el);
    let nextText = current;
    let cursor = start;
    let selectFrom: number | null = null;
    let selectTo: number | null = null;

    switch (action) {
        case 'bold': {
            const result = wrapTableCellTextSelection(current, start, end, '**', '**');
            nextText = result.text;
            cursor = result.cursor;
            break;
        }
        case 'italic': {
            const result = wrapTableCellTextSelection(current, start, end, '*', '*');
            nextText = result.text;
            cursor = result.cursor;
            break;
        }
        case 'strikethrough': {
            const result = wrapTableCellTextSelection(current, start, end, '~~', '~~');
            nextText = result.text;
            cursor = result.cursor;
            break;
        }
        case 'inlineCode': {
            const result = wrapTableCellTextSelection(current, start, end, '`', '`');
            nextText = result.text;
            cursor = result.cursor;
            break;
        }
        case 'link': {
            const result = insertTableCellLink(current, start, end);
            nextText = result.text;
            cursor = result.cursor;
            selectFrom = result.selectFrom;
            selectTo = result.selectTo;
            break;
        }
        default:
            return false;
    }

    loadCellForEditing(el, nextText);
    if (selectFrom !== null && selectTo !== null) {
        selectSerializedRange(el, selectFrom, selectTo);
    } else {
        placeCaretAtSerializedOffset(el, cursor);
    }
    return true;
}

function sanitizeCellInput(text: string): string {
    return sanitizeTableCellInput(text);
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
    if (!el.contains(range.commonAncestorContainer)) { return null; }
    return measureSerializedOffset(el, range.startContainer, range.startOffset);
}

/** True when ↑/↓ should move to an adjacent row instead of within the cell. */
function shouldLeaveCellVertically(td: HTMLElement, direction: 'up' | 'down'): boolean {
    const content = serializeCellContent(td);
    if (!content.includes('<br>')) { return true; }
    const offset = caretOffsetIn(td);
    if (offset === null) { return false; }
    return direction === 'down' ? offset === content.length : offset === 0;
}

function placeCaretAtOffset(el: HTMLElement, offset: number): void {
    placeCaretAtSerializedOffset(el, offset);
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

/** True when at least one column has a user-committed pixel width. */
function hasExplicitColumnWidths(widths: readonly number[]): boolean {
    return widths.some(w => w > 0);
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
        if (view.state.readOnly) { return; }
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
            if (!hasExplicitColumnWidths(widths)) {
                table.classList.remove('cm-md-table-resized');
            }
            view.dispatch({ effects: setColumnWidthsEffect.of({ tableIndex, widths }) });
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    // Excel/Sheets/Notion convention: double-click a handle clears that
    // column's manual override. When no explicit widths remain, revert to the
    // default page-width equal-column layout.
    handle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!table.classList.contains('cm-md-table-resized')) { return; }
        const cols = currentCols();
        const targetCol = cols[col];
        if (!targetCol) { return; }
        targetCol.style.width = '';
        const widths = cols.map(c => Math.round(parseFloat(c.style.width) || 0));
        if (!hasExplicitColumnWidths(widths)) {
            table.classList.remove('cm-md-table-resized');
        }
        view.dispatch({ effects: setColumnWidthsEffect.of({ tableIndex, widths }) });
    });
}

function ensureTableInsertionLine(wrap: HTMLElement, orientation: 'row' | 'col'): HTMLElement {
    const rowCls = 'cm-md-table-drag-insertion-line';
    const colCls = 'cm-md-table-drag-insertion-line-col';
    const selector = orientation === 'col' ? `.${rowCls}.${colCls}` : `.${rowCls}:not(.${colCls})`;
    let line = wrap.querySelector<HTMLElement>(selector);
    if (!line) {
        line = document.createElement('div');
        line.className = orientation === 'col' ? `${rowCls} ${colCls}` : rowCls;
        wrap.appendChild(line);
    }
    return line;
}

function syncColInsertionLineHeight(insertionLine: HTMLElement, wrap: HTMLElement): void {
    const table = wrap.querySelector('table');
    if (!table) { return; }
    const wrapRect = wrap.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    insertionLine.style.top = `${tableRect.top - wrapRect.top}px`;
    insertionLine.style.height = `${tableRect.height}px`;
}

/** Map a drop target from the drag UI to a valid body-row index (0..n-1). */
function normalizeRowDropIndex(pendingToBodyIdx: number, bodyLength: number): number {
    return Math.min(Math.max(0, pendingToBodyIdx), bodyLength - 1);
}

function bodyRowAtY(wrap: HTMLElement, clientY: number): { tr: HTMLElement; gridRow: number } | null {
    const rows = wrap.querySelectorAll('tbody tr');
    for (let i = 0; i < rows.length; i++) {
        const tr = rows[i] as HTMLElement;
        const rect = tr.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            return { tr, gridRow: i + 1 };
        }
    }
    return null;
}

function headerColAtX(wrap: HTMLElement, clientX: number): { th: HTMLElement; col: number } | null {
    const ths = wrap.querySelectorAll('thead th');
    for (let i = 0; i < ths.length; i++) {
        const th = ths[i] as HTMLElement;
        const rect = th.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) {
            return { th, col: i };
        }
    }
    return null;
}

/** Header column under the pointer, including the top gutter above `<thead>`. */
function columnTargetAt(wrap: HTMLElement, clientX: number, clientY: number): { th: HTMLElement; col: number } | null {
    const col = headerColAtX(wrap, clientX);
    if (!col) { return null; }
    const wrapRect = wrap.getBoundingClientRect();
    const thRect = col.th.getBoundingClientRect();
    const yInStrip = clientY >= wrapRect.top && clientY <= thRect.bottom + 4;
    const xInCol = clientX >= thRect.left - 4 && clientX <= thRect.right + 4;
    return yInStrip && xInCol ? col : null;
}

/** Pixels between the row grip's right edge and the table's left border. */
const ROW_GRIP_TABLE_GAP_PX = 4;
const ROW_GRIP_WIDTH_PX = 14;
const ROW_GRIP_GUTTER_PX = 20;

/** Enable horizontal scroll on the table wrapper only when the table exceeds it. */
interface TableScrollUIHandles {
    ro: ResizeObserver;
    mo: MutationObserver;
    onScroll: () => void;
}

const tableScrollUIByElement = new WeakMap<HTMLElement, TableScrollUIHandles>();

function disconnectTableScrollUI(scroll: HTMLElement): void {
    const existing = tableScrollUIByElement.get(scroll);
    if (!existing) { return; }
    existing.ro.disconnect();
    existing.mo.disconnect();
    scroll.removeEventListener('scroll', existing.onScroll);
    tableScrollUIByElement.delete(scroll);
}

function wireTableScrollUI(scroll: HTMLElement): void {
    disconnectTableScrollUI(scroll);
    const table = scroll.querySelector('table');
    if (!table) { return; }

    const update = () => {
        const tableWidth = table.getBoundingClientRect().width;
        // Compare against the widget's allotted width, not scroll.clientWidth —
        // when the scroll wrapper hugs content (fit-content), clientWidth tracks
        // the table and would never register overflow.
        const maxScrollWidth = scroll.parentElement?.clientWidth ?? scroll.clientWidth;
        const overflows = tableWidth > maxScrollWidth + 1;
        const isResized = table.classList.contains('cm-md-table-resized');
        scroll.classList.toggle('cm-md-table-overflow-x', overflows);
        scroll.classList.toggle('cm-md-table-hug-content', isResized && !overflows);
    };

    update();
    requestAnimationFrame(update);
    const ro = new ResizeObserver(update);
    ro.observe(scroll);
    ro.observe(table);
    if (scroll.parentElement) { ro.observe(scroll.parentElement); }
    const onScroll = update;
    scroll.addEventListener('scroll', onScroll, { passive: true });
    const mo = new MutationObserver(update);
    mo.observe(table, { attributes: true, attributeFilter: ['class'] });
    tableScrollUIByElement.set(scroll, { ro, mo, onScroll });
}

/** One shared row/column grip pair per table — positioned on wrap mousemove. */
function wireTableDragUI(
    wrap: HTMLElement,
    view: EditorView,
    tableIndex: number,
    grid: readonly CellRange[][],
): void {
    const rowHandle = document.createElement('div');
    rowHandle.className = 'cm-md-row-drag-handle';
    rowHandle.innerHTML = Icons.DragGrip;
    rowHandle.title = 'Drag to move row';

    const colHandle = document.createElement('div');
    colHandle.className = 'cm-md-col-drag-handle';
    colHandle.innerHTML = Icons.DragGrip;
    colHandle.title = 'Drag to move column';

    wrap.appendChild(rowHandle);
    wrap.appendChild(colHandle);

    let rowTarget: { gridRow: number } | null = null;
    let colTarget: { col: number } | null = null;
    let rowDragging = false;
    let colDragging = false;

    const positionRowHandle = (tr: HTMLElement) => {
        const wrapRect = wrap.getBoundingClientRect();
        const trRect = tr.getBoundingClientRect();
        const table = wrap.querySelector('table');
        const tableLeft = table?.getBoundingClientRect().left ?? wrapRect.left + ROW_GRIP_GUTTER_PX;
        const gripLeft = tableLeft - wrapRect.left - ROW_GRIP_WIDTH_PX - ROW_GRIP_TABLE_GAP_PX;
        rowHandle.style.left = `${Math.min(gripLeft, ROW_GRIP_GUTTER_PX - ROW_GRIP_WIDTH_PX - 2)}px`;
        rowHandle.style.top = `${trRect.top - wrapRect.top + trRect.height / 2}px`;
        rowHandle.style.transform = 'translateY(-50%)';
    };

    const positionColHandle = (th: HTMLElement) => {
        const wrapRect = wrap.getBoundingClientRect();
        const thRect = th.getBoundingClientRect();
        const gripHeight = 16;
        colHandle.style.left = `${thRect.left - wrapRect.left + thRect.width / 2}px`;
        // Straddle the header top edge so the grip is reachable without leaving the hit strip.
        colHandle.style.top = `${Math.max(0, thRect.top - wrapRect.top - gripHeight / 2)}px`;
        colHandle.style.transform = 'translateX(-50%) rotate(90deg)';
    };

    const hideRowHandle = () => {
        if (!rowDragging) {
            rowTarget = null;
            rowHandle.classList.remove('cm-md-drag-grip-visible');
        }
    };

    const hideColHandle = () => {
        if (!colDragging) {
            colTarget = null;
            colHandle.classList.remove('cm-md-drag-grip-visible');
        }
    };

    wrap.addEventListener('mousemove', (event) => {
        if (rowDragging || colDragging) { return; }

        const row = bodyRowAtY(wrap, event.clientY);
        if (row) {
            rowTarget = { gridRow: row.gridRow };
            positionRowHandle(row.tr);
            rowHandle.classList.add('cm-md-drag-grip-visible');
        } else {
            hideRowHandle();
        }

        const col = columnTargetAt(wrap, event.clientX, event.clientY);
        if (col) {
            colTarget = { col: col.col };
            positionColHandle(col.th);
            colHandle.classList.add('cm-md-drag-grip-visible');
        } else {
            hideColHandle();
        }
    });

    colHandle.addEventListener('mouseenter', () => {
        if (colTarget) {
            colHandle.classList.add('cm-md-drag-grip-visible');
        }
    });

    rowHandle.addEventListener('mouseenter', () => {
        if (rowTarget) {
            rowHandle.classList.add('cm-md-drag-grip-visible');
        }
    });

    wrap.addEventListener('mouseleave', () => {
        hideRowHandle();
        hideColHandle();
    });

    const scrollEl = wrap.querySelector('.cm-md-table-scroll');
    scrollEl?.addEventListener('scroll', () => {
        if (rowTarget) {
            const row = bodyRowAtY(wrap, rowHandle.getBoundingClientRect().top + 1);
            if (row) { positionRowHandle(row.tr); }
        }
        if (colTarget) {
            const col = headerColAtX(wrap, colHandle.getBoundingClientRect().left + 1);
            if (col) { positionColHandle(col.th); }
        }
    }, { passive: true });

    const startRowDrag = (event: MouseEvent) => {
        if (view.state.readOnly) { return; }
        if (!rowTarget) { return; }
        event.preventDefault();
        event.stopPropagation();
        if (document.activeElement?.classList.contains('cm-md-table-cell-editing')) { return; }

        const tableNode = findTableNodeByIndex(view.state, tableIndex);
        if (!tableNode) { return; }
        const { body } = tableRowNodes(tableNode);
        const gridRow = rowTarget.gridRow;
        const fromBodyIdx = gridRow - 1;
        const insertionLine = ensureTableInsertionLine(wrap, 'row');
        insertionLine.style.display = 'block';
        rowDragging = true;
        wrap.classList.add('cm-md-table-dragging');
        rowHandle.classList.add('cm-md-drag-grip-visible');
        let pendingToBodyIdx = fromBodyIdx;

        const onMove = (moveEvent: MouseEvent) => {
            const row = bodyRowAtY(wrap, moveEvent.clientY);
            if (row) { positionRowHandle(row.tr); }
            const rows = wrap.querySelectorAll('tbody tr');
            const wrapRect = wrap.getBoundingClientRect();
            let targetIdx = fromBodyIdx;
            for (let i = 0; i < rows.length; i++) {
                const rect = (rows[i] as HTMLElement).getBoundingClientRect();
                const mid = (rect.top + rect.bottom) / 2;
                if (moveEvent.clientY < mid) {
                    targetIdx = i;
                    insertionLine.style.top = `${rect.top - wrapRect.top}px`;
                    break;
                }
                targetIdx = i + 1;
                insertionLine.style.top = `${rect.bottom - wrapRect.top}px`;
            }
            pendingToBodyIdx = targetIdx;
        };

        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            insertionLine.style.display = 'none';
            rowDragging = false;
            wrap.classList.remove('cm-md-table-dragging');
            const toBodyIdx = normalizeRowDropIndex(pendingToBodyIdx, body.length);
            const freshNode = findTableNodeByIndex(view.state, tableIndex);
            if (!freshNode) { return; }
            const freshGrid = buildCellGrid(view.state, freshNode);
            const spec = computeMoveRowTo(view.state, freshNode, freshGrid, gridRow, toBodyIdx);
            if (spec) { view.dispatch(spec); }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        onMove(event);
    };

    const startColDrag = (event: MouseEvent) => {
        if (view.state.readOnly) { return; }
        if (!colTarget) { return; }
        event.preventDefault();
        event.stopPropagation();
        if (document.activeElement?.classList.contains('cm-md-table-cell-editing')) { return; }

        const tableNode = findTableNodeByIndex(view.state, tableIndex);
        if (!tableNode) { return; }
        const col = colTarget.col;
        const insertionLine = ensureTableInsertionLine(wrap, 'col');
        insertionLine.style.display = 'block';
        syncColInsertionLineHeight(insertionLine, wrap);
        colDragging = true;
        wrap.classList.add('cm-md-table-dragging');
        colHandle.classList.add('cm-md-drag-grip-visible');
        let pendingToCol = col;

        const onMove = (moveEvent: MouseEvent) => {
            const headerCol = headerColAtX(wrap, moveEvent.clientX);
            if (headerCol) { positionColHandle(headerCol.th); }
            syncColInsertionLineHeight(insertionLine, wrap);
            const ths = wrap.querySelectorAll('thead th');
            const wrapRect = wrap.getBoundingClientRect();
            let targetCol = col;
            for (let i = 0; i < ths.length; i++) {
                const rect = (ths[i] as HTMLElement).getBoundingClientRect();
                const mid = (rect.left + rect.right) / 2;
                if (moveEvent.clientX < mid) {
                    targetCol = i;
                    insertionLine.style.left = `${rect.left - wrapRect.left}px`;
                    break;
                }
                targetCol = i + 1;
                insertionLine.style.left = `${rect.right - wrapRect.left}px`;
            }
            pendingToCol = targetCol;
        };

        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            insertionLine.style.display = 'none';
            colDragging = false;
            wrap.classList.remove('cm-md-table-dragging');
            const freshNode = findTableNodeByIndex(view.state, tableIndex);
            if (!freshNode) { return; }
            const freshGrid = buildCellGrid(view.state, freshNode);
            const spec = computeMoveColumnTo(view.state, freshNode, freshGrid, col, pendingToCol);
            if (!spec) { return; }
            const widthsMap = view.state.field(columnWidthsField);
            const widths = widthsMap[tableIndex];
            if (widths && widths.length > 0) {
                const newWidths = remapColumnWidths(widths, col, pendingToCol);
                view.dispatch({
                    ...spec,
                    effects: setColumnWidthsEffect.of({ tableIndex, widths: newWidths }),
                });
            } else {
                view.dispatch(spec);
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        onMove(event);
    };

    rowHandle.addEventListener('mousedown', startRowDrag);
    colHandle.addEventListener('mousedown', startColDrag);

    // Gutter click starts a drag even if the pointer misses the 14px grip icon.
    wrap.addEventListener('mousedown', (event) => {
        if (rowDragging || colDragging) { return; }
        const wrapRect = wrap.getBoundingClientRect();
        const xFromLeft = event.clientX - wrapRect.left;
        if (xFromLeft <= ROW_GRIP_GUTTER_PX && rowTarget) {
            startRowDrag(event);
            return;
        }
        const col = columnTargetAt(wrap, event.clientX, event.clientY);
        if (col) {
            colTarget = { col: col.col };
            startColDrag(event);
        }
    });
}

const PREVIEW_TABLE_MIN_ROW_HEIGHT_PX = 36;
let editingRowHeightSyncFrame = 0;

function syncRowMinHeight(row: HTMLElement): void {
    row.style.height = 'auto';
    row.querySelectorAll('th, td').forEach((cell) => {
        (cell as HTMLElement).style.height = 'auto';
    });

    const measured = Math.max(PREVIEW_TABLE_MIN_ROW_HEIGHT_PX, Math.ceil(row.getBoundingClientRect().height));
    const heightPx = `${measured}px`;
    row.style.height = heightPx;
    row.querySelectorAll('th, td').forEach((cell) => {
        (cell as HTMLElement).style.height = heightPx;
    });
}

function syncEditingRowHeight(td: HTMLElement): void {
    const row = td.closest('tr') as HTMLElement | null;
    if (!row) { return; }
    syncRowMinHeight(row);
}

function syncAllTableRowMinHeights(table: HTMLTableElement): void {
    table.querySelectorAll('tr').forEach((row) => {
        syncRowMinHeight(row as HTMLElement);
    });
}

function scheduleAllTableRowMinHeightsSync(table: HTMLTableElement): void {
    requestAnimationFrame(() => {
        syncAllTableRowMinHeights(table);
    });
}

function scheduleEditingRowHeightSync(td: HTMLElement): void {
    cancelAnimationFrame(editingRowHeightSyncFrame);
    editingRowHeightSyncFrame = requestAnimationFrame(() => {
        syncEditingRowHeight(td);
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
    td.spellcheck = true;
    td.classList.add('cm-md-table-cell-editing');
    loadCellForEditing(td, view.state.sliceDoc(active.from, active.to));
    activeTableEditingCell = td;

    let live: CellRange = { from: active.from, to: active.to };
    let composing = false;

    const commit = () => {
        if (composing) { return; }
        const text = sanitizeCellInput(serializeCellContent(td));
        const { from, to } = live;
        live = { from, to: from + text.length };
        view.dispatch({ changes: { from, to, insert: text } });
        scheduleEditingRowHeightSync(td);
    };
    tableCellCommitHandlers.set(td, commit);

    td.addEventListener('compositionstart', () => { composing = true; });
    td.addEventListener('compositionend', () => { composing = false; commit(); });
    td.addEventListener('input', commit);
    td.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey) {
            const key = event.key.toLowerCase();
            if (key === 'b') {
                event.preventDefault();
                applyCellInlineFormat(td, 'bold');
                commit();
                return;
            }
            if (key === 'i') {
                event.preventDefault();
                applyCellInlineFormat(td, 'italic');
                commit();
                return;
            }
            if (key === 'e' && !event.shiftKey) {
                event.preventDefault();
                applyCellInlineFormat(td, 'inlineCode');
                commit();
                return;
            }
            if (key === 'k') {
                event.preventDefault();
                applyCellInlineFormat(td, 'link');
                commit();
                return;
            }
            if (key === 'x' && event.shiftKey) {
                event.preventDefault();
                applyCellInlineFormat(td, 'strikethrough');
                commit();
                return;
            }
        }

        if (event.key === 'Tab') {
            event.preventDefault();
            const target = event.shiftKey ? prevCell(grid, active) : nextCell(grid, active);
            if (target) { selectRange(view, target); }
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) {
                insertLineBreakAtCaret(td);
                commit();
            } else {
                const target = cellBelow(grid, active);
                if (target) { selectRange(view, target); }
            }
        } else if (event.key === 'ArrowRight' && caretOffsetIn(td) === serializeCellContent(td).length) {
            const target = nextCell(grid, active);
            if (target) { event.preventDefault(); placeCollapsed(view, target.from); }
        } else if (event.key === 'ArrowLeft' && caretOffsetIn(td) === 0) {
            const target = prevCell(grid, active);
            if (target) { event.preventDefault(); placeCollapsed(view, target.to); }
        } else if (event.key === 'ArrowDown') {
            const target = cellBelow(grid, active);
            if (target && shouldLeaveCellVertically(td, 'down')) {
                event.preventDefault();
                placeCollapsed(view, collapsedClickPosForCell(view.state, target));
            }
        } else if (event.key === 'ArrowUp') {
            const target = cellAbove(grid, active);
            if (target && shouldLeaveCellVertically(td, 'up')) {
                event.preventDefault();
                placeCollapsed(view, collapsedClickPosForCell(view.state, target));
            }
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
        scheduleEditingRowHeightSync(td);
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
                const spec = computeTableMenuTransaction(view.state, tableNode, buildCellGrid(view.state, tableNode), row, col, item.id);
                if (!spec) { return; }
                const nextState = view.state.update(spec).state;
                const tableAfter = findTableNodeByIndex(nextState, tableIndex);
                const selectionPos = tableAfter
                    ? selectionPosAfterTableInsert(nextState, tableAfter, item.id, row, col)
                    : null;
                view.dispatch({
                    ...spec,
                    ...(selectionPos !== null ? { selection: EditorSelection.cursor(selectionPos) } : {}),
                });
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
    readonly deleteArmed: boolean;

    constructor(
        source: string,
        grid: readonly CellRange[][],
        activeCell: ActiveCell | null,
        tableIndex: number,
        widths: readonly number[] | null,
        deleteArmed = false,
    ) {
        super();
        this.source = source;
        this.grid = grid;
        this.activeCell = activeCell;
        this.tableIndex = tableIndex;
        this.widths = widths;
        this.deleteArmed = deleteArmed;
    }

    eq(other: TableWidget): boolean {
        return other.source === this.source &&
            other.activeCell?.row === this.activeCell?.row &&
            other.activeCell?.col === this.activeCell?.col &&
            widthsEqual(other.widths, this.widths) &&
            other.deleteArmed === this.deleteArmed;
    }

    toDOM(view: EditorView): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'cm-md-table-widget' + (this.deleteArmed ? ' cm-md-table-armed' : '');
        const scroll = document.createElement('div');
        scroll.className = 'cm-md-table-scroll';
        const colCount = this.grid[0]?.length ?? 0;
        scroll.innerHTML = md.render(this.source, { colCount, widths: this.widths });
        wrap.appendChild(scroll);

        const table = scroll.querySelector('table.md-table') as HTMLTableElement | null;
        if (table && this.widths && hasExplicitColumnWidths(this.widths)) { table.classList.add('cm-md-table-resized'); }

        const tableNodeAtClick = findTableNodeByIndex(view.state, this.tableIndex);
        const gridAtClick = tableNodeAtClick ? buildCellGrid(view.state, tableNodeAtClick) : null;

        wrap.querySelectorAll('th, td').forEach((cellEl) => {
            cellEl.addEventListener('mousedown', (event) => {
                if (view.state.readOnly) { return; }
                // The active cell IS a real contentEditable — let the browser
                // place its own caret at the clicked pixel natively. Only
                // clicks on an INACTIVE cell need to be intercepted, to
                // activate it via a CM6 selection dispatch (checked at click
                // time via the class `wireActiveCell` sets below, not at
                // listener-attachment time, so this is correct regardless of
                // which cell was active when toDOM ran).
                if (cellEl.classList.contains('cm-md-table-cell-editing')) { return; }
                const pos = resolveCellPosition(wrap, cellEl as HTMLElement);
                const target = pos && gridAtClick ? gridAtClick[pos.row]?.[pos.col] : undefined;
                if (!target) { return; }
                event.preventDefault();
                placeCollapsed(view, collapsedClickPosForCell(view.state, target));
            });
        });

        wrap.addEventListener('contextmenu', (event) => {
            const cellEl = (event.target as HTMLElement).closest('th, td') as HTMLElement | null;
            if (!cellEl) { return; }
            const pos = resolveCellPosition(wrap, cellEl);
            if (!pos || !gridAtClick?.[pos.row]?.[pos.col]) { return; }
            event.preventDefault();
            showTableContextMenu(event, view, this.tableIndex, pos.row, pos.col, computeTableContextMenu(gridAtClick, pos.row, pos.col));
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
            wireTableScrollUI(scroll);
            wireTableDragUI(wrap, view, this.tableIndex, this.grid);
            wrap.querySelectorAll('thead th').forEach((th, col) => {
                wireResizeHandle(th as HTMLElement, table, view, col, this.tableIndex);
            });
            scheduleAllTableRowMinHeightsSync(table);
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
     * testing (see file header + .docs/product/completed/PLAN-obsidian-live-preview.md) — this
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

    destroy(dom: HTMLElement): void {
        const scroll = dom.querySelector('.cm-md-table-scroll');
        if (scroll instanceof HTMLElement) {
            disconnectTableScrollUI(scroll);
        }
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
    deleteArmedRange: TableRange | null = null,
): DecorationSet {
    const specs: { from: number; to: number; value: ReturnType<typeof Decoration.replace> }[] = [];
    let tableIndex = 0;

    for (const { from, to } of visibleRanges) {
        syntaxTree(state).iterate({
            from,
            to,
            enter(node) {
                if (node.name !== 'Table') { return; }
                const range = effectiveTableRange(state, node.node);
                const grid = buildCellGrid(state, node.node);
                const activeCell = findActiveCell(state, grid, selFrom, selTo);
                const source = state.sliceDoc(range.from, range.to);
                const index = tableIndex++;
                const deleteArmed = deleteArmedRange !== null &&
                    deleteArmedRange.from === range.from &&
                    deleteArmedRange.to === range.to;
                specs.push({
                    from: range.from,
                    to: range.to,
                    value: Decoration.replace({
                        widget: new TableWidget(
                            source,
                            grid,
                            activeCell,
                            index,
                            widthsByTable[index] ?? null,
                            deleteArmed,
                        ),
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
                const { tableIndex, widths } = effect.value;
                if (hasExplicitColumnWidths(widths)) {
                    value = { ...value, [tableIndex]: widths };
                } else {
                    const { [tableIndex]: _removed, ...rest } = value;
                    value = rest;
                }
            }
        }
        return value;
    },
});

function buildFromState(state: EditorState): DecorationSet {
    const sel = state.selection.main;
    const widthsByTable = state.field(columnWidthsField, false) ?? {};
    const deleteArmedRange = state.field(tableDeleteArmedField, false) ?? null;
    // No `view.visibleRanges` here — see the StateField note below — so this
    // always scans the whole document. Acceptable: it's filtered to just
    // `Table` nodes, and tables are comparatively rare compared to the marks
    // revealDecorations.ts scans for on every keystroke.
    return computeTableDecorations(
        state,
        sel.from,
        sel.to,
        [{ from: 0, to: state.doc.length }],
        widthsByTable,
        deleteArmedRange,
    );
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
