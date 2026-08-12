// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import {
    collectSpellcheckExclusionRanges,
    isSpellcheckExcluded,
} from './spellcheckExclusions.ts';
import { extractFrontmatter } from '../frontmatter.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown()] });
}

function exclusions(doc: string, frontmatterRange?: { from: number; to: number } | null) {
    const state = stateFor(doc);
    return collectSpellcheckExclusionRanges(state, [{ from: 0, to: doc.length }], frontmatterRange);
}

test('inline code is excluded from spell check', () => {
    const doc = 'see `const x = 1` here';
    const ranges = exclusions(doc);
    assert.deepEqual(ranges, [{ from: 4, to: 17 }]);
});

test('fenced code block is excluded from spell check', () => {
    const doc = 'before\n\n```js\nconst a = 1;\n```\n\nafter';
    const ranges = exclusions(doc);
    assert.equal(ranges.length, 1);
    assert.ok(doc.slice(ranges[0].from, ranges[0].to).includes('```'));
});

test('YAML frontmatter block is excluded from spell check', () => {
    const doc = '---\ntitle: My Doc\ntags:\n  - foo\n---\n\n# Body';
    const fm = extractFrontmatter(doc);
    assert.ok(fm);
    const ranges = exclusions(doc, fm.range);
    assert.deepEqual(ranges, [{ from: 0, to: fm.range.to }]);
});

test('plain prose has no spell-check exclusions', () => {
    const doc = 'just a plain sentence with no code';
    assert.deepEqual(exclusions(doc), []);
});

test('isSpellcheckExcluded returns true inside inline code', () => {
    const doc = 'see `mispelled` here';
    const state = stateFor(doc);
    assert.equal(isSpellcheckExcluded(5, 14, state, null), true);
    assert.equal(isSpellcheckExcluded(0, 3, state, null), false);
});
