// Headless tests for the block selection field (no DOM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorSelection, EditorState } from '@codemirror/state';
import { blockSelectionField, dragSourceField, selectBlocksSpec, setDragSourceEffect, activeBlockSelection } from './blockSelection.ts';

const DOC = 'First.\n\nSecond.\n\nThird.';
const base = () => EditorState.create({ doc: DOC, extensions: [blockSelectionField, dragSourceField] });

test('selecting a block sets the text selection over it and remembers the block range', () => {
    const state = base().update(selectBlocksSpec({ from: 8, to: 15 })).state;
    assert.deepEqual(activeBlockSelection(state), { from: 8, to: 15 });
    assert.equal(state.sliceDoc(state.selection.main.from, state.selection.main.to), 'Second.');
});

test('the block selection clears when the selection moves', () => {
    const selected = base().update(selectBlocksSpec({ from: 8, to: 15 })).state;
    const moved = selected.update({ selection: EditorSelection.cursor(2) }).state;
    assert.equal(activeBlockSelection(moved), null);
});

test('typing over a block selection replaces the text and clears it', () => {
    const selected = base().update(selectBlocksSpec({ from: 8, to: 15 })).state;
    const typed = selected.update(selected.replaceSelection('x')).state;
    assert.equal(typed.doc.toString(), 'First.\n\nx\n\nThird.');
    assert.equal(activeBlockSelection(typed), null);
});

test('an edit elsewhere maps the block selection along', () => {
    const selected = base().update(selectBlocksSpec({ from: 8, to: 15 })).state;
    const edited = selected.update({ changes: { from: 0, insert: 'Intro.\n\n' } }).state;
    assert.deepEqual(activeBlockSelection(edited), { from: 16, to: 23 });
});

test('the drag source clears on any document change', () => {
    const dragging = base().update({ effects: setDragSourceEffect.of({ from: 0, to: 6 }) }).state;
    assert.deepEqual(dragging.field(dragSourceField), { from: 0, to: 6 });
    assert.equal(dragging.update({ changes: { from: 0, insert: 'x' } }).state.field(dragSourceField), null);
});
