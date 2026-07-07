// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.
// Decoration rendering (setCm6SearchHighlights et al.) needs a real EditorView,
// which needs a DOM — out of scope for this headless harness per the plan; only
// the pure EditorState-level matching logic is covered here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { findCm6Matches } from './livePreviewSearch.ts';

test('finds a single match', () => {
    const state = EditorState.create({ doc: 'the quick brown fox' });
    const matches = findCm6Matches(state, 'quick');
    assert.deepEqual(matches, [{ from: 4, to: 9 }]);
});

test('is case-insensitive, mirroring the legacy TreeWalker compare', () => {
    const state = EditorState.create({ doc: 'The Quick Brown FOX' });
    const matches = findCm6Matches(state, 'quick');
    assert.deepEqual(matches, [{ from: 4, to: 9 }]);
});

test('finds all occurrences in document order', () => {
    const state = EditorState.create({ doc: 'cat sat on the cat mat' });
    const matches = findCm6Matches(state, 'cat');
    assert.deepEqual(matches, [{ from: 0, to: 3 }, { from: 15, to: 18 }]);
});

test('returns no matches for an empty query', () => {
    const state = EditorState.create({ doc: 'anything at all' });
    assert.deepEqual(findCm6Matches(state, ''), []);
});

test('returns no matches when the query is absent from the doc', () => {
    const state = EditorState.create({ doc: 'anything at all' });
    assert.deepEqual(findCm6Matches(state, 'zzz'), []);
});
