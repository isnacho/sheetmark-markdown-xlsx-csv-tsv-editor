// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.
// TableWidget is constructed but its DOM-only toDOM() is never called here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
    computeTableDecorations, TableWidget, buildCellGrid, findActiveCell,
    nextCell, prevCell, cellBelow, cellAbove, columnWidthsField, setColumnWidthsEffect,
    computeTableContextMenu, computeTableMenuTransaction, findTableNodeByIndex,
    computeClearCell, computeClearRow, computeClearColumn,
    computeMoveRowUp, computeMoveRowDown, computeMoveRowTo, computeDeleteRow, computeInsertRow,
    computeMoveColumn, computeMoveColumnTo, computeDeleteColumn, computeInsertColumn,
    sanitizeTableCellInput, wrapTableCellTextSelection, insertTableCellLink,
    collapsedClickPosForCell, selectionPosAfterTableInsert,
} from './tableWidget.ts';
import type { CellRange, TableMenuItem } from './tableWidget.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
}

function tableNode(state: EditorState): SyntaxNode {
    let found: SyntaxNode | null = null;
    syntaxTree(state).iterate({ enter(node) { if (node.name === 'Table') { found = node.node; } } });
    if (!found) { throw new Error('no Table node found'); }
    return found;
}

test('cursor away from the table replaces it with a TableWidget over its exact source range', () => {
    const doc = 'before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter';
    const state = stateFor(doc);
    const set = computeTableDecorations(state, 0, 0, [{ from: 0, to: doc.length }]);
    const found: { from: number; to: number; widget: TableWidget }[] = [];
    set.between(0, doc.length, (from, to, value) => {
        found.push({ from, to, widget: (value.spec as { widget: TableWidget }).widget });
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].from, 8);
    assert.equal(found[0].to, 37);
    assert.equal(found[0].widget.source, '| a | b |\n| - | - |\n| 1 | 2 |');
});

test('cursor inside the table still produces a widget, with the cell under the cursor marked active', () => {
    const doc = 'before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter';
    const state = stateFor(doc);
    const cursor = doc.indexOf('1');
    const found: TableWidget[] = [];
    computeTableDecorations(state, cursor, cursor, [{ from: 0, to: doc.length }])
        .between(0, doc.length, (from, to, value) => found.push((value.spec as { widget: TableWidget }).widget));
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].activeCell, { row: 1, col: 0, from: cursor, to: cursor + 1 });
});

test('collapsed cursor resolves to the nearer cell across a pipe/delimiter, never to none', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const state = stateFor(doc);
    const pipePos = doc.indexOf('|', doc.indexOf('1')); // the pipe between "1" and "2"
    const found: TableWidget[] = [];
    computeTableDecorations(state, pipePos, pipePos, [{ from: 0, to: doc.length }])
        .between(0, doc.length, (from, to, value) => found.push((value.spec as { widget: TableWidget }).widget));
    assert.equal(found.length, 1);
    assert.notEqual(found[0].activeCell, null); // never lands "outside every cell" on a real line
});

test('regression: a trailing space typed at the end of a cell keeps that SAME cell active', () => {
    // `TableCell.from`/`.to` excludes trailing padding (verified against the
    // real parser) — a strict containment check would report "no active
    // cell" the instant the cursor moves one character past the trimmed
    // content into that padding, which is exactly what happens when the user
    // presses space while editing. That dropped the active cell and, via
    // `TableWidget.updateDOM`, forced a full rebuild that stole focus. This
    // pins the fix: the cursor sitting in a cell's OWN trailing padding must
    // still resolve to that cell.
    const doc = '| Cell 1  | Cell 2 |\n| ------- | ------- |\n| a       | b       |';
    const state = stateFor(doc);
    const grid = buildCellGrid(state, tableNode(state));
    const cell1 = grid[0][0]; // "Cell 1", with two trailing padding spaces before the next "|"
    const oneSpacePastEnd = cell1.to + 1;
    assert.deepEqual(findActiveCell(state, grid, oneSpacePastEnd, oneSpacePastEnd), { row: 0, col: 0, ...cell1 });
});

test('buildCellGrid maps header + body rows to trimmed cell ranges', () => {
    const doc = '| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |\n';
    const state = stateFor(doc);
    const grid = buildCellGrid(state, tableNode(state));
    assert.equal(grid.length, 2);
    assert.equal(state.sliceDoc(grid[0][0].from, grid[0][0].to), 'Header 1');
    assert.equal(state.sliceDoc(grid[0][1].from, grid[0][1].to), 'Header 2');
    assert.equal(state.sliceDoc(grid[1][0].from, grid[1][0].to), 'Cell 1');
    assert.equal(state.sliceDoc(grid[1][1].from, grid[1][1].to), 'Cell 2');
});

test('findActiveCell resolves the cell containing the selection', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const state = stateFor(doc);
    const grid = buildCellGrid(state, tableNode(state));
    const pos = doc.indexOf('2');
    assert.deepEqual(findActiveCell(state, grid, pos, pos), { row: 1, col: 1, from: pos, to: pos + 1 });
    // Position 0 is the row's opening pipe, before any cell's trimmed range —
    // still resolves to the first cell (its lower bound is unbounded within
    // the row), not null. See the delimiter-crossing and trailing-space
    // regression tests above for why unbounded-at-the-edges is intentional.
    assert.deepEqual(findActiveCell(state, grid, 0, 0), { row: 0, col: 0, from: 2, to: 3 });
    const alignmentRowPos = doc.indexOf('-'); // the "| - | - |" line isn't a TableHeader/TableRow at all
    assert.equal(findActiveCell(state, grid, alignmentRowPos, alignmentRowPos), null);
});

test('neighbor lookups wrap across row/column boundaries', () => {
    const grid: CellRange[][] = [
        [{ from: 0, to: 1 }, { from: 2, to: 3 }],
        [{ from: 4, to: 5 }, { from: 6, to: 7 }],
    ];
    const topLeft = { row: 0, col: 0, ...grid[0][0] };
    const topRight = { row: 0, col: 1, ...grid[0][1] };
    const bottomLeft = { row: 1, col: 0, ...grid[1][0] };
    const bottomRight = { row: 1, col: 1, ...grid[1][1] };

    assert.deepEqual(nextCell(grid, topLeft), topRight);
    assert.deepEqual(nextCell(grid, topRight), bottomLeft); // wraps to next row
    assert.equal(nextCell(grid, bottomRight), null); // no cell past the last one

    assert.deepEqual(prevCell(grid, topRight), topLeft);
    assert.deepEqual(prevCell(grid, bottomLeft), topRight); // wraps to previous row
    assert.equal(prevCell(grid, topLeft), null);

    assert.deepEqual(cellBelow(grid, topLeft), bottomLeft);
    assert.equal(cellBelow(grid, bottomLeft), null);
    assert.deepEqual(cellAbove(grid, bottomRight), topRight);
    assert.equal(cellAbove(grid, topRight), null);
});

test('no decorations when there is no table', () => {
    const doc = 'just a plain paragraph with no pipes at all';
    const state = stateFor(doc);
    const decos: unknown[] = [];
    computeTableDecorations(state, 0, 0, [{ from: 0, to: doc.length }])
        .between(0, doc.length, (from, to, value) => decos.push(value));
    assert.deepEqual(decos, []);
});

test('TableWidget.eq treats identical source as equal, different source as not', () => {
    const a = new TableWidget('| a |\n| - |\n| 1 |', [], null, 0, null);
    const b = new TableWidget('| a |\n| - |\n| 1 |', [], null, 0, null);
    const c = new TableWidget('| a |\n| - |\n| 2 |', [], null, 0, null);
    assert.equal(a.eq(b), true);
    assert.equal(a.eq(c), false);
});

test('TableWidget.eq also compares widths — a resize must trigger a re-render', () => {
    const a = new TableWidget('src', [], null, 0, [100, 200]);
    const b = new TableWidget('src', [], null, 0, [100, 200]);
    const c = new TableWidget('src', [], null, 0, [100, 999]);
    const d = new TableWidget('src', [], null, 0, null);
    assert.equal(a.eq(b), true);
    assert.equal(a.eq(c), false);
    assert.equal(a.eq(d), false);
});

test('computeTableDecorations assigns table index by order of appearance and looks up widthsByTable', () => {
    const doc = '| a |\n| - |\n| 1 |\n\ntext between\n\n| b |\n| - |\n| 2 |';
    const state = stateFor(doc);
    const widgets: TableWidget[] = [];
    computeTableDecorations(state, 0, 0, [{ from: 0, to: doc.length }], { 0: [111], 1: [222] })
        .between(0, doc.length, (from, to, value) => widgets.push((value.spec as { widget: TableWidget }).widget));
    assert.equal(widgets.length, 2);
    assert.equal(widgets[0].tableIndex, 0);
    assert.deepEqual(widgets[0].widths, [111]);
    assert.equal(widgets[1].tableIndex, 1);
    assert.deepEqual(widgets[1].widths, [222]);
});

test('computeTableDecorations defaults widthsByTable to {} when omitted, and a table missing from it gets null widths', () => {
    const doc = '| a |\n| - |\n| 1 |';
    const state = stateFor(doc);
    const widgets: TableWidget[] = [];
    computeTableDecorations(state, 0, 0, [{ from: 0, to: doc.length }])
        .between(0, doc.length, (from, to, value) => widgets.push((value.spec as { widget: TableWidget }).widget));
    assert.equal(widgets[0].widths, null);
});

test('columnWidthsField applies setColumnWidthsEffect per table index without clobbering other tables', () => {
    const state = EditorState.create({ extensions: [columnWidthsField] });
    assert.deepEqual(state.field(columnWidthsField), {});
    const tr1 = state.update({ effects: setColumnWidthsEffect.of({ tableIndex: 1, widths: [50, 60] }) });
    assert.deepEqual(tr1.state.field(columnWidthsField), { 1: [50, 60] });
    const tr2 = tr1.state.update({ effects: setColumnWidthsEffect.of({ tableIndex: 0, widths: [10] }) });
    assert.deepEqual(tr2.state.field(columnWidthsField), { 0: [10], 1: [50, 60] });
});

test('columnWidthsField drops a table entry when all committed widths are cleared', () => {
    const state = EditorState.create({ extensions: [columnWidthsField] });
    const seeded = state.update({ effects: setColumnWidthsEffect.of({ tableIndex: 1, widths: [50, 60] }) });
    const cleared = seeded.state.update({ effects: setColumnWidthsEffect.of({ tableIndex: 1, widths: [0, 0] }) });
    assert.deepEqual(cleared.state.field(columnWidthsField), {});
});

// ===== Right-click table menu: item availability =====

function findItem(groups: readonly TableMenuItem[][], id: TableMenuItem['id']): TableMenuItem {
    const item = groups.flat().find(i => i.id === id);
    if (!item) { throw new Error(`no menu item ${id}`); }
    return item;
}

test('computeTableContextMenu: header cell in a 2-col table with one body row', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const grid = buildCellGrid(stateFor(doc), tableNode(stateFor(doc)));
    const groups = computeTableContextMenu(grid, 0, 0);

    assert.equal(findItem(groups, 'clearCell').enabled, true);
    assert.equal(findItem(groups, 'clearRow').enabled, true);
    assert.equal(findItem(groups, 'moveRowUp').enabled, false);
    assert.equal(findItem(groups, 'moveRowUp').disabledReason, "Header row can't be moved");
    assert.equal(findItem(groups, 'moveRowDown').enabled, false);
    assert.equal(findItem(groups, 'moveRowDown').disabledReason, "Header row can't be moved");
    assert.equal(findItem(groups, 'insertRowAbove').enabled, false);
    assert.equal(findItem(groups, 'insertRowBelow').enabled, true);
    assert.equal(findItem(groups, 'deleteRow').enabled, true); // one body row exists to promote

    assert.equal(findItem(groups, 'moveColumnLeft').enabled, false);
    assert.equal(findItem(groups, 'moveColumnLeft').disabledReason, 'Already the first column');
    assert.equal(findItem(groups, 'moveColumnRight').enabled, true);
    assert.equal(findItem(groups, 'deleteColumn').enabled, true);
});

test('computeTableContextMenu: deleting the header is disabled when there is no body row to promote', () => {
    const doc = '| a | b |\n| - | - |';
    const grid = buildCellGrid(stateFor(doc), tableNode(stateFor(doc)));
    const item = findItem(computeTableContextMenu(grid, 0, 0), 'deleteRow');
    assert.equal(item.enabled, false);
    assert.equal(item.disabledReason, 'Table needs a header row');
});

test('computeTableContextMenu: first body row can\'t move up (would cross the header), but can move down', () => {
    const doc = '| a |\n| - |\n| 1 |\n| 2 |\n| 3 |';
    const grid = buildCellGrid(stateFor(doc), tableNode(stateFor(doc)));
    const groups = computeTableContextMenu(grid, 1, 0);
    assert.equal(findItem(groups, 'moveRowUp').enabled, false);
    assert.equal(findItem(groups, 'moveRowUp').disabledReason, "Can't move above the header row");
    assert.equal(findItem(groups, 'moveRowDown').enabled, true);
    assert.equal(findItem(groups, 'insertRowAbove').enabled, true);
});

test('computeTableContextMenu: last body row can move up but not down', () => {
    const doc = '| a |\n| - |\n| 1 |\n| 2 |\n| 3 |';
    const grid = buildCellGrid(stateFor(doc), tableNode(stateFor(doc)));
    const groups = computeTableContextMenu(grid, 3, 0);
    assert.equal(findItem(groups, 'moveRowUp').enabled, true);
    assert.equal(findItem(groups, 'moveRowDown').enabled, false);
    assert.equal(findItem(groups, 'moveRowDown').disabledReason, 'Already the last row');
});

test('computeTableContextMenu: middle row/column have both move directions enabled', () => {
    const doc = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |';
    const grid = buildCellGrid(stateFor(doc), tableNode(stateFor(doc)));
    const groups = computeTableContextMenu(grid, 2, 1);
    assert.equal(findItem(groups, 'moveRowUp').enabled, true);
    assert.equal(findItem(groups, 'moveRowDown').enabled, true);
    assert.equal(findItem(groups, 'moveColumnLeft').enabled, true);
    assert.equal(findItem(groups, 'moveColumnRight').enabled, true);
});

test('computeTableContextMenu: a single-column table disables delete column on both edges', () => {
    const doc = '| a |\n| - |\n| 1 |';
    const grid = buildCellGrid(stateFor(doc), tableNode(stateFor(doc)));
    const item = findItem(computeTableContextMenu(grid, 1, 0), 'deleteColumn');
    assert.equal(item.enabled, false);
    assert.equal(item.disabledReason, 'Table needs at least one column');
});

// ===== Clear cell / row / column =====

test('computeClearCell empties only the targeted cell', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const state = stateFor(doc);
    const grid = buildCellGrid(state, tableNode(state));
    const spec = computeClearCell(grid, 1, 0);
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| a | b |\n| - | - |\n|  | 2 |');
});

test('computeClearRow empties every cell in that row, header included', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const state = stateFor(doc);
    const grid = buildCellGrid(state, tableNode(state));
    const spec = computeClearRow(grid, 0);
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '|  |  |\n| - | - |\n| 1 | 2 |');
});

test('computeClearColumn empties every cell in that column, header included', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |';
    const state = stateFor(doc);
    const grid = buildCellGrid(state, tableNode(state));
    const spec = computeClearColumn(grid, 1);
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| a |  |\n| - | - |\n| 1 |  |\n| 3 |  |');
});

// ===== Row structural ops =====

test('computeMoveRowUp swaps a body row with its predecessor', () => {
    const doc = '| a |\n| - |\n| 1 |\n| 2 |\n| 3 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeMoveRowUp(state, node, grid, 2); // "2" moves above "1"
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| a |\n| - |\n| 2 |\n| 1 |\n| 3 |');
});

test('computeMoveRowUp refuses to move the header or the first body row', () => {
    const doc = '| a |\n| - |\n| 1 |\n| 2 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    assert.equal(computeMoveRowUp(state, node, grid, 0), null);
    assert.equal(computeMoveRowUp(state, node, grid, 1), null);
});

test('computeMoveRowDown swaps a body row with its successor and refuses past the last row', () => {
    const doc = '| a |\n| - |\n| 1 |\n| 2 |\n| 3 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeMoveRowDown(state, node, grid, 1); // "1" moves below "2"
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| a |\n| - |\n| 2 |\n| 1 |\n| 3 |');
    assert.equal(computeMoveRowDown(state, node, grid, 3), null);
    assert.equal(computeMoveRowDown(state, node, grid, 0), null); // header
});

test('computeDeleteRow on the header promotes the first body row', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeDeleteRow(state, node, grid, 0);
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| 1 | 2 |\n| - | - |\n| 3 | 4 |');
});

test('computeDeleteRow on the header with no body rows is refused', () => {
    const doc = '| a | b |\n| - | - |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    assert.equal(computeDeleteRow(state, node, grid, 0), null);
});

test('computeDeleteRow on a body row removes just that line', () => {
    const doc = '| a |\n| - |\n| 1 |\n| 2 |\n| 3 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeDeleteRow(state, node, grid, 2); // delete "2"
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| a |\n| - |\n| 1 |\n| 3 |');
});

test('computeInsertRow above/below a body row, and below the header (can\'t insert above it)', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);

    assert.equal(computeInsertRow(state, node, grid, 0, 'above'), null);

    const belowHeader = computeInsertRow(state, node, grid, 0, 'below');
    assert.ok(belowHeader);
    assert.equal(state.update(belowHeader!).state.doc.toString(), '| a | b |\n| - | - |\n|  |  |\n| 1 | 2 |');

    const aboveBody = computeInsertRow(state, node, grid, 1, 'above');
    assert.ok(aboveBody);
    assert.equal(state.update(aboveBody!).state.doc.toString(), '| a | b |\n| - | - |\n|  |  |\n| 1 | 2 |');

    const belowBody = computeInsertRow(state, node, grid, 1, 'below');
    assert.ok(belowBody);
    assert.equal(state.update(belowBody!).state.doc.toString(), '| a | b |\n| - | - |\n| 1 | 2 |\n|  |  |');
});

// ===== Column structural ops =====

test('computeMoveColumn reorders header, delimiter, and every body row together', () => {
    const doc = '| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeMoveColumn(state, node, grid, 0, 'right'); // "a" swaps with "b"
    assert.ok(spec);
    assert.equal(
        state.update(spec!).state.doc.toString(),
        '| b | a | c |\n| :-: | :-- | --: |\n| 2 | 1 | 3 |\n| 5 | 4 | 6 |',
    );
});

test('computeMoveColumn refuses past either edge', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    assert.equal(computeMoveColumn(state, node, grid, 0, 'left'), null);
    assert.equal(computeMoveColumn(state, node, grid, 1, 'right'), null);
});

test('computeDeleteColumn removes a column from every row and refuses on the last one', () => {
    const doc = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeDeleteColumn(state, node, grid, 1);
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| a | c |\n| - | - |\n| 1 | 3 |');

    const oneColState = stateFor('| a |\n| - |\n| 1 |');
    const oneColNode = tableNode(oneColState);
    assert.equal(computeDeleteColumn(oneColState, oneColNode, buildCellGrid(oneColState, oneColNode), 0), null);
});

test('computeInsertColumn adds an empty cell and a default-aligned delimiter token on either side', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);

    const left = computeInsertColumn(state, node, grid, 1, 'left');
    assert.equal(state.update(left).state.doc.toString(), '| a |  | b |\n| - | --- | - |\n| 1 |  | 2 |');

    const right = computeInsertColumn(state, node, grid, 0, 'right');
    assert.equal(state.update(right).state.doc.toString(), '| a |  | b |\n| - | --- | - |\n| 1 |  | 2 |');
});

test('computeInsertColumn pads a ragged body row to the header\'s column count before inserting', () => {
    const doc = '| a | b |\n| - | - |\n| 1 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeInsertColumn(state, node, grid, 1, 'right');
    assert.equal(state.update(spec).state.doc.toString(), '| a | b |  |\n| - | - | --- |\n| 1 |  |  |');
});

test('findActiveCell keeps an empty inserted column cell active at its boundary (not the neighbor)', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const spec = computeInsertColumn(state, node, buildCellGrid(state, node), 0, 'right');
    const inserted = state.update(spec).state;
    const insertedDoc = inserted.doc.toString();
    const insertedNode = tableNode(inserted);
    const grid = buildCellGrid(inserted, insertedNode);
    const emptyBodyCell = grid[1].find(c => insertedDoc.slice(c.from, c.to).trim() === '');
    assert.ok(emptyBodyCell, 'expected an empty body cell after insert column right');
    const clickPos = collapsedClickPosForCell(inserted, emptyBodyCell);
    assert.equal(clickPos, emptyBodyCell.from);
    const active = findActiveCell(inserted, grid, clickPos, clickPos);
    assert.deepEqual(active, { row: 1, col: grid[1].indexOf(emptyBodyCell), ...emptyBodyCell });
    assert.equal(insertedDoc.slice(active!.from, active!.to).trim(), '');
});

test('selectionPosAfterTableInsert lands in the new row or column', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);

    const colSpec = computeInsertColumn(state, node, grid, 0, 'right');
    const afterCol = state.update(colSpec).state;
    const colNode = tableNode(afterCol);
    const colGrid = buildCellGrid(afterCol, colNode);
    const newCol = selectionPosAfterTableInsert(afterCol, colNode, 'insertColumnRight', 1, 0);
    assert.ok(newCol !== null);
    const emptyAfterCol = colGrid[1].find(c => afterCol.sliceDoc(c.from, c.to).trim() === '');
    assert.ok(emptyAfterCol);
    assert.equal(newCol, emptyAfterCol.from);

    const rowSpec = computeInsertRow(state, node, grid, 1, 'below');
    const afterRow = state.update(rowSpec).state;
    const rowNode = tableNode(afterRow);
    const rowGrid = buildCellGrid(afterRow, rowNode);
    assert.equal(rowGrid.length, 3);
    const newRowPos = selectionPosAfterTableInsert(afterRow, rowNode, 'insertRowBelow', 1, 1);
    assert.equal(newRowPos, rowGrid[2][1].from);
});

// ===== Dispatch table + table-node lookup by index =====

test('computeTableMenuTransaction routes every action id to its compute function', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeTableMenuTransaction(state, node, grid, 1, 0, 'clearCell');
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| a | b |\n| - | - |\n|  | 2 |');
});

test('findTableNodeByIndex resolves tables in order of appearance', () => {
    const doc = '| a |\n| - |\n| 1 |\n\ntext between\n\n| b |\n| - |\n| 2 |';
    const state = stateFor(doc);
    const first = findTableNodeByIndex(state, 0);
    const second = findTableNodeByIndex(state, 1);
    assert.ok(first && second);
    assert.equal(state.sliceDoc(first!.from, first!.to), '| a |\n| - |\n| 1 |');
    assert.equal(state.sliceDoc(second!.from, second!.to), '| b |\n| - |\n| 2 |');
    assert.equal(findTableNodeByIndex(state, 2), null);
});

test('computeMoveRowTo moves a body row to an arbitrary index', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeMoveRowTo(state, node, grid, 1, 1); // row "1|2" after row "3|4"
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| a | b |\n| - | - |\n| 3 | 4 |\n| 1 | 2 |');
});

test('computeMoveRowTo clamps a drop-past-end target to the last row', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeMoveRowTo(state, node, grid, 1, 99);
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| a | b |\n| - | - |\n| 3 | 4 |\n| 1 | 2 |');
});

test('computeMoveColumnTo moves a column to an arbitrary index', () => {
    const doc = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |';
    const state = stateFor(doc);
    const node = tableNode(state);
    const grid = buildCellGrid(state, node);
    const spec = computeMoveColumnTo(state, node, grid, 0, 2); // "a" after "b" and "c"
    assert.ok(spec);
    assert.equal(state.update(spec!).state.doc.toString(), '| b | c | a |\n| - | - | - |\n| 2 | 3 | 1 |');
});

test('sanitizeTableCellInput converts pasted newlines to <br>', () => {
    assert.equal(sanitizeTableCellInput('one\ntwo'), 'one<br>two');
    assert.equal(sanitizeTableCellInput('one\r\ntwo\rthree'), 'one<br>two<br>three');
});

test('wrapTableCellTextSelection toggles markdown wrappers', () => {
    const wrapped = wrapTableCellTextSelection('hello', 0, 5, '**', '**');
    assert.equal(wrapped.text, '**hello**');
    const unwrapped = wrapTableCellTextSelection(wrapped.text, 2, 7, '**', '**');
    assert.equal(unwrapped.text, 'hello');
});

test('insertTableCellLink wraps the selection or inserts a placeholder', () => {
    const empty = insertTableCellLink('cell', 2, 2);
    assert.equal(empty.text, 'ce[text](url)ll');
    assert.equal(empty.selectFrom, 3);
    assert.equal(empty.selectTo, 7);
    const selected = insertTableCellLink('cell', 0, 4);
    assert.equal(selected.text, '[cell](url)');
    assert.equal(selected.selectFrom, 7);
    assert.equal(selected.selectTo, 10);
});

test('second table cell positions stay valid after editing the first table', () => {
    const doc1 = '| a |\n| - |\n| 1 |\n\n| b |\n| - |\n| 2 |';
    const state1 = stateFor(doc1);
    const node2a = findTableNodeByIndex(state1, 1);
    assert.ok(node2a);
    const grid1 = buildCellGrid(state1, node2a!);
    const stalePos = grid1[1][0].from;

    const doc2 = '| a |\n| - |\n| LONG |\n\n| b |\n| - |\n| 2 |';
    const state2 = stateFor(doc2);
    const node2b = findTableNodeByIndex(state2, 1);
    assert.ok(node2b);
    const grid2 = buildCellGrid(state2, node2b!);
    const freshPos = grid2[1][0].from;

    assert.notEqual(stalePos, freshPos);
    assert.equal(state2.sliceDoc(freshPos, grid2[1][0].to), '2');
    assert.notEqual(state2.sliceDoc(stalePos, stalePos + 1), '2');
});
