// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import {
    computeParagraphBounds,
    computeParagraphBoundarySelection,
} from './paragraphNavigation.ts';

function stateFor(doc: string, pos: number): EditorState {
    return EditorState.create({
        doc,
        selection: { anchor: pos, head: pos },
        extensions: [markdown({ extensions: GFM })],
    });
}

function posAfter(doc: string, prefix: string): number {
    const idx = doc.indexOf(prefix);
    assert.notEqual(idx, -1, `prefix not found: ${prefix}`);
    return idx;
}

test('computeParagraphBounds: soft-break lines share one paragraph span', () => {
    const doc = 'Line one of para\nline two of para\n\nNext block';
    const state = stateFor(doc, 0);
    const bounds = computeParagraphBounds(state, posAfter(doc, 'one'));
    assert.equal(bounds.from, 0);
    assert.equal(bounds.to, doc.indexOf('\n\n'));
    assert.equal(state.sliceDoc(bounds.from, bounds.to), 'Line one of para\nline two of para');
});

test('computeParagraphBoundarySelection: end jumps past soft-break to paragraph end', () => {
    const doc = 'Line one of para\nline two of para\n\nNext block';
    const pos = posAfter(doc, 'one');
    const state = stateFor(doc, pos);
    const tr = state.update(computeParagraphBoundarySelection(state, false));
    const expectedEnd = doc.indexOf('\n\n');
    assert.equal(tr.state.selection.main.head, expectedEnd);
    assert.equal(tr.state.selection.main.empty, true);
});

test('computeParagraphBoundarySelection: start jumps to paragraph start from second soft-break line', () => {
    const doc = 'Line one of para\nline two of para\n\nNext block';
    const pos = posAfter(doc, 'two');
    const state = stateFor(doc, pos);
    const tr = state.update(computeParagraphBoundarySelection(state, true));
    assert.equal(tr.state.selection.main.head, 0);
});

test('computeParagraphBounds: blank-line-separated blocks are independent', () => {
    const doc = 'First para\n\nSecond para';
    const state = stateFor(doc, posAfter(doc, 'Second'));
    const bounds = computeParagraphBounds(state, state.selection.main.head);
    assert.equal(state.sliceDoc(bounds.from, bounds.to), 'Second para');
});
