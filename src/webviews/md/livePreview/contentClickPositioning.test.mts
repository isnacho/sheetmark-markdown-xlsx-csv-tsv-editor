import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import {
    headingLineContentRange,
    isTableWidgetPointerTarget,
    selectionRangeForHeadingLineClick,
    selectionRangeForListLineClick,
    selectionRangeForWordAt,
} from './contentClickPositioning.ts';
import { fullyParsed } from './testState.ts';

test('isTableWidgetPointerTarget: true inside table widget DOM', () => {
    const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table-widget';
    const td = document.createElement('td');
    wrap.appendChild(td);
    assert.equal(isTableWidgetPointerTarget(td), true);
    assert.equal(isTableWidgetPointerTarget(wrap), true);
    assert.equal(isTableWidgetPointerTarget(document.createElement('p')), false);
});

function mdState(doc: string): EditorState {
    return fullyParsed(EditorState.create({
        doc,
        extensions: [markdown({ extensions: GFM, addKeymap: false })],
    }));
}

test('selectionRangeForListLineClick: single click collapses to a cursor', () => {
    const state = mdState('- item one');
    const pos = state.doc.line(1).from + 2;
    const range = selectionRangeForListLineClick(state, pos, 1);
    assert.equal(range.from, pos);
    assert.equal(range.to, pos);
});

test('selectionRangeForListLineClick: double click selects item text without the marker', () => {
    const state = mdState('- item one');
    const pos = state.doc.toString().indexOf('item') + 2;
    const range = selectionRangeForListLineClick(state, pos, 2);
    assert.equal(state.sliceDoc(range.from, range.to), 'item one');
});

test('selectionRangeForListLineClick: triple click selects item text without marker or trailing break', () => {
    const state = mdState('- item one\nnext');
    const line = state.doc.line(1);
    const range = selectionRangeForListLineClick(state, line.from + 3, 3);
    assert.equal(state.sliceDoc(range.from, range.to), 'item one');
    assert.equal(range.to, line.to);
});

test('selectionRangeForListLineClick: task list excludes checkbox marker', () => {
    const state = mdState('- [ ] todo here');
    const pos = state.doc.toString().indexOf('todo');
    const range = selectionRangeForListLineClick(state, pos, 2);
    assert.equal(state.sliceDoc(range.from, range.to), 'todo here');
});

test('headingLineContentRange: excludes ATX marker and gap space', () => {
    const state = mdState('## Hello world');
    const pos = state.doc.toString().indexOf('Hello');
    const { from, to } = headingLineContentRange(state, pos);
    assert.equal(state.sliceDoc(from, to), 'Hello world');
});

test('selectionRangeForWordAt: selects the word under the cursor', () => {
    const state = mdState('## Hello world');
    const pos = state.doc.toString().indexOf('world');
    const range = selectionRangeForWordAt(state, pos);
    assert.equal(state.sliceDoc(range.from, range.to), 'world');
});

test('selectionRangeForHeadingLineClick: triple click selects title without ATX marker', () => {
    const state = mdState('### Section title');
    const pos = state.doc.toString().indexOf('Section') + 2;
    const range = selectionRangeForHeadingLineClick(state, pos, 3);
    assert.equal(state.sliceDoc(range.from, range.to), 'Section title');
});

test('selectionRangeForHeadingLineClick: double click selects one word', () => {
    const state = mdState('## Hello world');
    const pos = state.doc.toString().indexOf('Hello') + 1;
    const range = selectionRangeForHeadingLineClick(state, pos, 2);
    assert.equal(state.sliceDoc(range.from, range.to), 'Hello');
});
