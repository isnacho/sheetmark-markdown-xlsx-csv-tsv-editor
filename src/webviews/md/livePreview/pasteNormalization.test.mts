import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { normalizeClipboardPasteText, selectionIncludesTrailingLineBreak } from './pasteNormalization.ts';

function stateWithSelection(doc: string, from: number, to: number): EditorState {
    return EditorState.create({
        doc,
        selection: EditorSelection.range(from, to),
    });
}

test('selectionIncludesTrailingLineBreak: false for line text only', () => {
    const state = EditorState.create({ doc: 'aaa\nbbb\nccc' });
    const line2 = state.doc.line(2);
    assert.equal(selectionIncludesTrailingLineBreak(state, line2.from, line2.to), false);
});

test('selectionIncludesTrailingLineBreak: true when the line break is selected', () => {
    const state = EditorState.create({ doc: 'aaa\nbbb\nccc' });
    const line2 = state.doc.line(2);
    assert.equal(selectionIncludesTrailingLineBreak(state, line2.from, line2.to + 1), true);
});

test('normalizeClipboardPasteText: strips one trailing newline when selection excludes the break', () => {
    const state = stateWithSelection('aaa\nbbb\nccc', 4, 7);
    assert.equal(normalizeClipboardPasteText(state, 'xxx\n'), 'xxx');
});

test('normalizeClipboardPasteText: keeps trailing newline when selection already includes the break', () => {
    const state = stateWithSelection('aaa\nbbb\nccc', 4, 8);
    assert.equal(normalizeClipboardPasteText(state, 'xxx\n'), 'xxx\n');
});

test('normalizeClipboardPasteText: drops duplicate trailing newline when selection includes the break', () => {
    const state = stateWithSelection('aaa\nbbb\nccc', 4, 8);
    assert.equal(normalizeClipboardPasteText(state, 'xxx\n\n'), 'xxx\n');
});

test('paste simulation: line text selection + clipboard newline no longer leaves a blank line', () => {
    const state = stateWithSelection('aaa\nbbb\nccc', 4, 7);
    const insert = normalizeClipboardPasteText(state, 'xxx\n');
    const next = state.update({ changes: { from: 4, to: 7, insert } }).state;
    assert.equal(next.doc.toString(), 'aaa\nxxx\nccc');
});
