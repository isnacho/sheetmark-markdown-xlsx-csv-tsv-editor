// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import {
    collectSpellcheckExclusionRanges,
    isKnownTechWord,
    isSpellcheckExcluded,
} from './spellcheckExclusions.ts';
import { extractFrontmatter } from '../frontmatter.ts';
import { fullyParsed } from './testState.ts';

function stateFor(doc: string): EditorState {
    return fullyParsed(EditorState.create({ doc, extensions: [markdown()] }));
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

test('web and email addresses written in prose are excluded from spell check', () => {
    const doc = 'Open https://example.com/some/pathz or www.exampel.org, mail me@exampel.org now.';
    const state = stateFor(doc);
    for (const word of ['https', 'pathz', 'www', 'exampel']) {
        const from = doc.indexOf(word);
        assert.equal(isSpellcheckExcluded(from, from + word.length, state, null), true, word);
    }
    const now = doc.indexOf('now');
    assert.equal(isSpellcheckExcluded(now, now + 3, state, null), false);
});

test('link targets and HTML tags are excluded from spell check, link text is not', () => {
    // A relative target, so only the syntax tree (not the web-address rule) can exclude it.
    const doc = 'A [linkk text](docs/setupp-guide.md) here,<br>then more.';
    const state = stateFor(doc);
    const target = doc.indexOf('setupp');
    assert.equal(isSpellcheckExcluded(target, target + 6, state, null), true);
    const tag = doc.indexOf('br>');
    assert.equal(isSpellcheckExcluded(tag, tag + 2, state, null), true);
    const text = doc.indexOf('linkk');
    assert.equal(isSpellcheckExcluded(text, text + 5, state, null), false);
});

test('common technical words count as spelled correctly in any case', () => {
    for (const word of ['callout', 'blockquote', 'GFM', 'url', 'URLs', 'Markdown', 'frontmatter']) {
        assert.equal(isKnownTechWord(word), true, word);
    }
    assert.equal(isKnownTechWord('mispelled'), false);
});
