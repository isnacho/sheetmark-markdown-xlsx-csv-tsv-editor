// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.
// Verifies the state-layer (StateField + gutterLineClass compute) in isolation
// from the mouse-event plumbing, which needs a real browser to exercise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { gutterLineClass } from '@codemirror/view';
import { hoverLineGutter, setHoveredLine } from './hoverLineGutter.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [hoverLineGutter()] });
}

function hoverMarkerPositions(state: EditorState): number[] {
    const out: number[] = [];
    for (const set of state.facet(gutterLineClass)) {
        set.between(0, state.doc.length, (from) => { out.push(from); });
    }
    return out;
}

test('hover marker appears at the hovered line after dispatching setHoveredLine', () => {
    let state = stateFor('line one\nline two\nline three');
    const line2 = state.doc.line(2);
    state = state.update({ effects: setHoveredLine.of(line2.from) }).state;
    assert.deepEqual(hoverMarkerPositions(state), [line2.from]);
});

test('hover marker is absent when nothing is hovered', () => {
    const state = stateFor('line one\nline two\nline three');
    assert.deepEqual(hoverMarkerPositions(state), []);
});

test('hover marker is suppressed when the hovered line is also the active (cursor) line', () => {
    let state = stateFor('line one\nline two\nline three');
    const line2 = state.doc.line(2);
    state = state.update({ selection: { anchor: line2.from } }).state;
    state = state.update({ effects: setHoveredLine.of(line2.from) }).state;
    assert.deepEqual(hoverMarkerPositions(state), []);
});

test('hover marker reappears once the cursor moves off the hovered line', () => {
    let state = stateFor('line one\nline two\nline three');
    const line1 = state.doc.line(1);
    const line2 = state.doc.line(2);
    state = state.update({ selection: { anchor: line2.from } }).state;
    state = state.update({ effects: setHoveredLine.of(line2.from) }).state;
    assert.deepEqual(hoverMarkerPositions(state), []);
    state = state.update({ selection: { anchor: line1.from } }).state;
    assert.deepEqual(hoverMarkerPositions(state), [line2.from]);
});

test('hover resets to null (no marker) on any doc change', () => {
    let state = stateFor('line one\nline two\nline three');
    const line2 = state.doc.line(2);
    state = state.update({ effects: setHoveredLine.of(line2.from) }).state;
    assert.deepEqual(hoverMarkerPositions(state), [line2.from]);
    state = state.update({ changes: { from: 0, insert: 'x' } }).state;
    assert.deepEqual(hoverMarkerPositions(state), []);
});

test('setHoveredLine.of(null) clears an existing hover', () => {
    let state = stateFor('line one\nline two\nline three');
    const line2 = state.doc.line(2);
    state = state.update({ effects: setHoveredLine.of(line2.from) }).state;
    assert.deepEqual(hoverMarkerPositions(state), [line2.from]);
    state = state.update({ effects: setHoveredLine.of(null) }).state;
    assert.deepEqual(hoverMarkerPositions(state), []);
});
