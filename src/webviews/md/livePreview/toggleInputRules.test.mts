import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { computeToggleFromMarker, computeQuoteFromMarker } from './toggleInputRules.ts';
import { findDetailsBlocks } from './detailsTypes.ts';
import { fullyParsed } from './testState.ts';

/** `doc` is the text AFTER the space was typed; `cursor` is where the cursor sits. */
function convert(doc: string, cursor: number, fn = computeToggleFromMarker) {
    const state = fullyParsed(EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ extensions: GFM })] }));
    const spec = fn(state, cursor);
    if (!spec) { return null; }
    const next = state.update(spec).state;
    return { doc: next.doc.toString(), cursor: next.selection.main.head, state: next };
}

test('paragraph: becomes an open toggle titled with its text, cursor in the empty body', () => {
    const r = convert('> hello world\n\nnext paragraph', 2)!;
    assert.equal(r.doc, '<details open>\n<summary>\n\nhello world\n\n</summary>\n\n\n</details>\n\nnext paragraph');
    assert.equal(r.doc.slice(0, r.cursor).endsWith('</summary>\n\n'), true);
    assert.equal(findDetailsBlocks(r.state.doc).length, 1);
});

test('paragraph: all lines of the paragraph are the title', () => {
    const r = convert('> line one\nline two\n\nafter', 2)!;
    assert.ok(r.doc.includes('\n\nline one\nline two\n\n</summary>'));
});

test('empty paragraph: cursor lands in the empty title', () => {
    const r = convert('> ', 2)!;
    assert.equal(findDetailsBlocks(r.state.doc)[0].title, '');
    assert.equal(r.cursor, '<details open>\n<summary>\n\n'.length);
});

test('heading with > before the # signs: keeps the level and swallows its section', () => {
    const doc = '> ## Guide\n\nbody\n\n### Sub\n\nsub body\n\n## Next\n\nother';
    const r = convert(doc, 2)!;
    assert.equal(r.doc, '<details open>\n<summary>\n\n## Guide\n\n</summary>\n\nbody\n\n### Sub\n\nsub body\n\n</details>\n\n## Next\n\nother');
    assert.equal(r.doc.slice(0, r.cursor).endsWith('## Guide'), true);
});

test('heading with > after the # signs gives the same result', () => {
    const before = convert('> ## Guide\n\nbody\n\n## Next', 2)!;
    const after = convert('## > Guide\n\nbody\n\n## Next', 5)!;
    assert.equal(after.doc, before.doc);
});

test('heading with no body, last in the file', () => {
    const r = convert('> # Only', 2)!;
    assert.equal(findDetailsBlocks(r.state.doc)[0].title, 'Only');
});

test('does not convert lists, tables, quotes, rules, code or fenced content', () => {
    assert.equal(convert('> - item', 2), null);
    assert.equal(convert('> 1. item', 2), null);
    assert.equal(convert('> | a |', 2), null);
    assert.equal(convert('> > nested', 2), null);
    assert.equal(convert('> ---', 2), null);
    assert.equal(convert('> ```js', 2), null);
    assert.equal(convert('```\n> inside fence\n```', 6), null);
    assert.equal(convert('---\ntitle: x\n> y\n---\n', 11), null);
});

test('does not convert when the cursor is not right after the marker', () => {
    assert.equal(convert('> hello', 5), null);
    assert.equal(convert('x > y', 4), null);
});

test('quote: " then space becomes a Markdown quote and keeps the text', () => {
    const r = convert('" wise words', 2, computeQuoteFromMarker)!;
    assert.equal(r.doc, '> wise words');
    assert.equal(convert('```\n" in code\n```', 6, computeQuoteFromMarker), null);
    assert.equal(convert('say " hi', 6, computeQuoteFromMarker), null);
});
