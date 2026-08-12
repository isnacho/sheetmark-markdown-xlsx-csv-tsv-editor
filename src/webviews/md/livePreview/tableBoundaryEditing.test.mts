// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import {
    computeTableBoundaryBackspace,
    computeTableBoundaryArrowDown,
    computeTableBoundaryArrowUp,
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

function applyArrow(state: EditorState, spec: ReturnType<typeof computeTableBoundaryArrowDown>) {
    assert.ok(spec);
    const tr = state.update(spec);
    return { line: tr.state.doc.lineAt(tr.state.selection.main.head).number };
}

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

test('arrow down within table moves to the next body row', () => {
    const doc = `Above\n${TABLE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, '| a'));
    const { line } = applyArrow(state, computeTableBoundaryArrowDown(state));
    assert.equal(line, 4);
});

test('arrow down from last table row exits to the line below', () => {
    const doc = `Above\n${TABLE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, '| 2'));
    const { line } = applyArrow(state, computeTableBoundaryArrowDown(state));
    assert.equal(line, 5);
});
