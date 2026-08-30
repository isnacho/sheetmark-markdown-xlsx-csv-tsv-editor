import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { lineSelectionEnd, computeLineClickSelection } from './pointerLineResolution.ts';

test('lineSelectionEnd includes the line break for non-final lines', () => {
    const state = EditorState.create({ doc: 'aaa\nbbb\nccc' });
    const line2 = state.doc.line(2);
    assert.equal(lineSelectionEnd(line2, state.doc.length), line2.to + 1);
});

test('lineSelectionEnd does not run past doc.length on the last line', () => {
    const state = EditorState.create({ doc: 'aaa\nbbb\nccc' });
    const lastLine = state.doc.line(3);
    assert.equal(lineSelectionEnd(lastLine, state.doc.length), lastLine.to);
});

test('lineSelectionEnd includes a trailing document newline on the last line', () => {
    const state = EditorState.create({ doc: 'aaa\nbbb\n' });
    const lastLine = state.doc.line(2);
    assert.equal(lineSelectionEnd(lastLine, state.doc.length), lastLine.to + 1);
});

test('pasting a line with a trailing newline does not leave a blank line when the selection includes the break', () => {
    const state = EditorState.create({ doc: 'aaa\nbbb\nccc' });
    const line2 = state.doc.line(2);
    const from = line2.from;
    const to = lineSelectionEnd(line2, state.doc.length);
    const next = state.update({
        changes: { from, to, insert: 'xxx\n' },
    }).state;
    assert.equal(next.doc.toString(), 'aaa\nxxx\nccc');
});

test('pasting a line with a trailing newline leaves a blank line when the selection excludes the break', () => {
    const state = EditorState.create({ doc: 'aaa\nbbb\nccc' });
    const line2 = state.doc.line(2);
    const from = line2.from;
    const to = line2.to;
    const next = state.update({
        changes: { from, to, insert: 'xxx\n' },
    }).state;
    assert.equal(next.doc.toString(), 'aaa\nxxx\n\nccc');
});

test('computeLineClickSelection: double-click selects the whole line text', () => {
    const state = EditorState.create({ doc: 'aaa\nbbb\nccc' });
    const line2 = state.doc.line(2);
    const next = state.update(computeLineClickSelection(state, line2.from + 1, false)).state;
    assert.equal(next.sliceDoc(next.selection.main.from, next.selection.main.to), 'bbb');
});

test('computeLineClickSelection: shift double-click extends to include the clicked line', () => {
    const state = EditorState.create({
        doc: 'aaa\nbbb\nccc',
        selection: EditorSelection.cursor(0),
    });
    const line2 = state.doc.line(2);
    const next = state.update(computeLineClickSelection(state, line2.from + 1, true)).state;
    assert.equal(next.sliceDoc(next.selection.main.from, next.selection.main.to), 'aaa\nbbb');
});
