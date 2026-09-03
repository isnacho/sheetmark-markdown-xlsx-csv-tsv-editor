import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { selectionRangeForListLineClick } from './contentClickPositioning.ts';

test('selectionRangeForListLineClick: single click collapses to a cursor', () => {
    const state = EditorState.create({ doc: '- item one' });
    const pos = state.doc.line(1).from + 2;
    const range = selectionRangeForListLineClick(state, pos, 1);
    assert.equal(range.from, pos);
    assert.equal(range.to, pos);
});

test('selectionRangeForListLineClick: double click selects the word', () => {
    const state = EditorState.create({ doc: '- item one' });
    const pos = state.doc.toString().indexOf('item') + 2;
    const range = selectionRangeForListLineClick(state, pos, 2);
    assert.equal(state.sliceDoc(range.from, range.to), 'item');
});

test('selectionRangeForListLineClick: triple click selects line text without the break', () => {
    const state = EditorState.create({ doc: '- item one\nnext' });
    const line = state.doc.line(1);
    const range = selectionRangeForListLineClick(state, line.from + 3, 3);
    assert.equal(state.sliceDoc(range.from, range.to), line.text);
    assert.equal(range.to, line.to);
});
