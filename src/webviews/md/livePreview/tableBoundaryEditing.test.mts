// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
    computeTableBoundaryBackspace,
    computeTableBoundaryArrowDown,
    computeTableBoundaryArrowUp,
    computeTableArrow,
    buildCellGrid,
    tableDeleteArmedField,
    isTableDeleteBoundary,
    isTableRowLine,
    tableBlockRangeForLine,
} from './tableBoundaryEditing.ts';

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |';

function stateFor(doc: string, pos: number): EditorState {
    return EditorState.create({
        doc,
        selection: { anchor: pos, head: pos },
        extensions: [markdown({ extensions: GFM }), tableDeleteArmedField],
    });
}

function apply(state: EditorState, spec: ReturnType<typeof computeTableBoundaryBackspace>) {
    if (!spec) { return { doc: state.doc.toString(), sel: state.selection.main, armed: state.field(tableDeleteArmedField) }; }
    const tr = state.update(spec);
    return {
        doc: tr.state.doc.toString(),
        sel: tr.state.selection.main,
        armed: tr.state.field(tableDeleteArmedField),
    };
}

function posAfter(doc: string, prefix: string): number {
    const idx = doc.indexOf(prefix);
    assert.notEqual(idx, -1, `prefix not found: ${prefix}`);
    return idx;
}

test('backspace after table+blank+paragraph removes only the blank line', () => {
    const doc = `${TABLE}\n\nParagraph text`;
    const pos = posAfter(doc, 'Paragraph');
    const { doc: next, sel } = apply(stateFor(doc, pos), computeTableBoundaryBackspace(stateFor(doc, pos)));
    assert.equal(next, `${TABLE}\nParagraph text`);
    assert.equal(sel.head, posAfter(next, 'Paragraph'));
    assert.doesNotMatch(next, /\| 2 \|\|Paragraph/);
});

test('backspace directly after table arms the table instead of merging text', () => {
    const doc = `${TABLE}\nParagraph text`;
    const pos = posAfter(doc, 'Paragraph');
    const state = stateFor(doc, pos);
    const { doc: next, sel, armed } = apply(state, computeTableBoundaryBackspace(state));
    assert.equal(next, doc);
    assert.equal(sel.head, pos);
    assert.ok(armed);
    assert.equal(armed?.from, 0);
    assert.equal(armed?.to, TABLE.length);
});

test('second backspace after arming deletes the whole table but keeps the paragraph', () => {
    const doc = `${TABLE}\nParagraph text`;
    const pos = posAfter(doc, 'Paragraph');
    let state = stateFor(doc, pos);
    state = state.update(computeTableBoundaryBackspace(state)!).state;
    assert.ok(state.field(tableDeleteArmedField));

    const { doc: next, armed } = apply(state, computeTableBoundaryBackspace(state));
    assert.equal(next, 'Paragraph text');
    assert.equal(armed, null);
});

test('tableBlockRangeForLine returns only pipe rows', () => {
    const doc = `${TABLE}\nParagraph\n\nOther`;
    const state = stateFor(doc, 0);
    const range = tableBlockRangeForLine(state, 3);
    assert.ok(range);
    assert.equal(state.sliceDoc(range!.from, range!.to), TABLE);
    assert.equal(tableBlockRangeForLine(state, 4), null);
    assert.ok(isTableRowLine('| x |'));
    assert.equal(isTableRowLine('Paragraph'), false);
});

test('isTableDeleteBoundary is true on a paragraph line below a table', () => {
    const doc = `${TABLE}\nParagraph`;
    const pos = posAfter(doc, 'Paragraph');
    assert.ok(isTableDeleteBoundary(stateFor(doc, pos)));
});

test('isTableDeleteBoundary is true on a paragraph line below table+blank', () => {
    const doc = `${TABLE}\n\nParagraph`;
    const pos = posAfter(doc, 'Paragraph');
    assert.ok(isTableDeleteBoundary(stateFor(doc, pos)));
});

test('armed table clears when the cursor leaves the boundary', () => {
    const doc = `${TABLE}\nParagraph\n\nOther`;
    let state = stateFor(doc, posAfter(doc, 'Paragraph'));
    state = state.update(computeTableBoundaryBackspace(state)!).state;
    assert.ok(state.field(tableDeleteArmedField));

    state = state.update({
        selection: { anchor: posAfter(doc, 'Other'), head: posAfter(doc, 'Other') },
    }).state;
    assert.equal(state.field(tableDeleteArmedField), null);
});

function tableNode(state: EditorState): SyntaxNode {
    let found: SyntaxNode | null = null;
    syntaxTree(state).iterate({ enter(node) { if (node.name === 'Table') { found = node.node; } } });
    if (!found) { throw new Error('no Table node found'); }
    return found;
}

function applyArrow(state: EditorState, spec: ReturnType<typeof computeTableBoundaryArrowDown>) {
    assert.ok(spec);
    const tr = state.update(spec);
    return { line: tr.state.doc.lineAt(tr.state.selection.main.head).number };
}

test('buildCellGrid includes every body row from pipe lines', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |';
    const state = stateFor(doc, 0);
    const grid = buildCellGrid(state, tableNode(state));
    assert.equal(grid.length, 3);
    assert.equal(state.sliceDoc(grid[2][0].from, grid[2][0].to), '3');
});

test('arrow down from line above table enters header row instead of skipping', () => {
    const doc = `Above\n${TABLE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, 'Above'));
    const { line } = applyArrow(state, computeTableBoundaryArrowDown(state));
    assert.equal(line, 2);
});

test('arrow up from line below table enters last row instead of skipping', () => {
    const doc = `Above\n${TABLE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, 'Below'));
    const { line } = applyArrow(state, computeTableBoundaryArrowUp(state));
    assert.equal(line, 4);
});

test('arrow down within table skips delimiter and enters first body row', () => {
    const doc = `Above\n${TABLE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, '| a'));
    const tr = state.update(computeTableArrow(state, 'down')!);
    assert.equal(tr.state.doc.lineAt(tr.state.selection.main.head).number, 4);
    assert.ok(tr.state.doc.lineAt(tr.state.selection.main.head).text.includes('| 1'));
});

test('arrow up from below enters last body row then header', () => {
    const doc = `Above\n${TABLE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, 'Below'));
    const tr1 = state.update(computeTableArrow(state, 'up')!);
    assert.equal(tr1.state.doc.lineAt(tr1.state.selection.main.head).number, 4);
    const tr2 = tr1.state.update(computeTableArrow(tr1.state, 'up')!);
    assert.equal(tr2.state.doc.lineAt(tr2.state.selection.main.head).number, 2);
});

test('arrow down through multi-row table skips delimiter and stays inside until last body row', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |';
    const doc = `Above\n${table}\nBelow`;
    let state = stateFor(doc, posAfter(doc, '| a'));
    for (const expectedLine of [4, 5]) {
        const tr = state.update(computeTableArrow(state, 'down')!);
        assert.equal(tr.state.doc.lineAt(tr.state.selection.main.head).number, expectedLine);
        state = tr.state;
    }
    const exit = state.update(computeTableArrow(state, 'down')!);
    assert.equal(exit.state.doc.lineAt(exit.state.selection.main.head).number, 6);
});

test('arrow right within table moves to next column', () => {
    const doc = `Above\n${TABLE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, '| a'));
    const tr = state.update(computeTableArrow(state, 'right')!);
    const headLine = tr.state.doc.lineAt(tr.state.selection.main.head);
    assert.ok(headLine.text.includes('b'));
    assert.ok(tr.state.selection.main.head > posAfter(doc, '| a'));
});

test('arrow down on delimiter row skips to first body row', () => {
    const doc = `Above\n${TABLE}\nBelow`;
    const delimPos = posAfter(doc, '| -');
    const state = stateFor(doc, delimPos);
    const tr = state.update(computeTableArrow(state, 'down')!);
    assert.equal(tr.state.doc.lineAt(tr.state.selection.main.head).number, 4);
});

test('arrow up on delimiter row skips to header row', () => {
    const doc = `Above\n${TABLE}\nBelow`;
    const delimPos = posAfter(doc, '| -');
    const state = stateFor(doc, delimPos);
    const tr = state.update(computeTableArrow(state, 'up')!);
    assert.equal(tr.state.doc.lineAt(tr.state.selection.main.head).number, 2);
});

test('arrow up through multi-row body rows does not exit early', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |';
    const doc = `Above\n${table}\nBelow`;
    const state = stateFor(doc, posAfter(doc, 'Below'));
    const tr1 = state.update(computeTableArrow(state, 'up')!);
    assert.equal(tr1.state.doc.lineAt(tr1.state.selection.main.head).number, 5);
    const tr2 = tr1.state.update(computeTableArrow(tr1.state, 'up')!);
    assert.equal(tr2.state.doc.lineAt(tr2.state.selection.main.head).number, 4);
});

test('arrow down from last table row exits to the line below', () => {
    const doc = `Above\n${TABLE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, '| 2'));
    const tr = state.update(computeTableArrow(state, 'down')!);
    assert.equal(tr.state.doc.lineAt(tr.state.selection.main.head).number, 5);
});

test('arrow up from paragraph below table visits blank line before entering table', () => {
    const doc = `Above\n${TABLE}\n\nParagraph`;
    const state = stateFor(doc, posAfter(doc, 'Paragraph'));
    assert.equal(computeTableArrow(state, 'up'), null);
});

test('arrow up from blank line below table enters last body row', () => {
    const doc = `Above\n${TABLE}\n\nParagraph`;
    const blankPos = doc.indexOf('\n\nParagraph') + 1;
    const state = stateFor(doc, blankPos);
    const tr = state.update(computeTableArrow(state, 'up')!);
    assert.equal(tr.state.doc.lineAt(tr.state.selection.main.head).number, 4);
});

test('arrow down from paragraph above table visits blank line before entering table', () => {
    const doc = `Paragraph\n\n${TABLE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, 'Paragraph'));
    assert.equal(computeTableArrow(state, 'down'), null);
});

test('arrow down from blank line above table enters header row', () => {
    const doc = `Paragraph\n\n${TABLE}\nBelow`;
    const blankPos = doc.indexOf('\n\n| a') + 1;
    const state = stateFor(doc, blankPos);
    const tr = state.update(computeTableArrow(state, 'down')!);
    assert.equal(tr.state.doc.lineAt(tr.state.selection.main.head).number, 3);
});
