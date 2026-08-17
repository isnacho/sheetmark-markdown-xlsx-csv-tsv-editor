// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { computeFencedCodeArrow } from './codeBlockBoundaryEditing.ts';

const FENCE = '```js\nline1\nline2\nline3\n```';

function stateFor(doc: string, pos: number): EditorState {
    return EditorState.create({
        doc,
        selection: { anchor: pos, head: pos },
        extensions: [markdown()],
    });
}

function posAfter(doc: string, prefix: string, startAt = 0): number {
    const idx = doc.indexOf(prefix, startAt);
    assert.notEqual(idx, -1, `prefix not found: ${prefix}`);
    return idx;
}

function applyArrow(state: EditorState, direction: 'up' | 'down') {
    const spec = computeFencedCodeArrow(state, direction);
    assert.ok(spec, `expected arrow ${direction} spec`);
    const tr = state.update(spec);
    const head = tr.state.selection.main.head;
    const line = tr.state.doc.lineAt(head);
    return { line: line.number, col: head - line.from + 1, head };
}

test('arrow down inside fenced code moves one line at a time', () => {
    const doc = `Above\n${FENCE}\nBelow`;
    let state = stateFor(doc, posAfter(doc, 'line1'));
    const step1 = applyArrow(state, 'down');
    assert.equal(step1.line, state.doc.lineAt(posAfter(doc, 'line2')).number);
    state = state.update(computeFencedCodeArrow(state, 'down')!).state;
    const step2 = applyArrow(state, 'down');
    assert.equal(step2.line, state.doc.lineAt(posAfter(doc, 'line3')).number);
});

test('arrow up inside fenced code does not exit early from the bottom', () => {
    const doc = `Above\n${FENCE}\nBelow`;
    let state = stateFor(doc, posAfter(doc, 'line3'));
    const step1 = applyArrow(state, 'up');
    assert.equal(step1.line, state.doc.lineAt(posAfter(doc, 'line2')).number);
    state = state.update(computeFencedCodeArrow(state, 'up')!).state;
    const step2 = applyArrow(state, 'up');
    assert.equal(step2.line, state.doc.lineAt(posAfter(doc, 'line1')).number);
});

test('arrow down from closing fence line exits to the line below', () => {
    const doc = `Above\n${FENCE}\nBelow`;
    const closingFence = posAfter(doc, '```', posAfter(doc, 'line3'));
    const state = stateFor(doc, closingFence);
    const { line } = applyArrow(state, 'down');
    assert.equal(line, state.doc.lineAt(posAfter(doc, 'Below')).number);
});

test('arrow up from opening fence line exits to the line above', () => {
    const doc = `Above\n${FENCE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, '```js'));
    const { line } = applyArrow(state, 'up');
    assert.equal(line, state.doc.lineAt(posAfter(doc, 'Above')).number);
});

test('arrow down from line above enters opening fence line', () => {
    const doc = `Above\n${FENCE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, 'Above'));
    const { line } = applyArrow(state, 'down');
    assert.equal(line, state.doc.lineAt(posAfter(doc, '```js')).number);
});

test('arrow up from line below enters closing fence line', () => {
    const doc = `Above\n${FENCE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, 'Below'));
    const { line } = applyArrow(state, 'up');
    const closingFence = posAfter(doc, '```', posAfter(doc, 'line3'));
    assert.equal(line, state.doc.lineAt(closingFence).number);
});

test('vertical moves preserve column offset within the block', () => {
    const doc = `Above\n${FENCE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, 'line1') + 2);
    const { col } = applyArrow(state, 'down');
    assert.equal(col, 3);
});

test('entering from above preserves column offset', () => {
    const doc = `Above\n${FENCE}\nBelow`;
    const state = stateFor(doc, posAfter(doc, 'Above') + 2);
    const { col } = applyArrow(state, 'down');
    assert.equal(col, 3);
});
