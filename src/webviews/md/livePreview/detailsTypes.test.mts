import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, Text } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { findDetailsBlocks, isDetailsOpen, plainTitle, stripToggleTags, toggleTagRanges } from './detailsTypes.ts';
import { fullyParsed } from './testState.ts';

const doc = (text: string) => Text.of(text.split('\n'));
const NEW = (title: string, body = 'body', attrs = ' open') =>
    `<details${attrs}>\n<summary>\n\n${title}\n\n</summary>\n\n${body}\n\n</details>`;

test('new shape: finds title, body range and the hidden runs', () => {
    const d = doc(NEW('### Guide **bold**'));
    const [b] = findDetailsBlocks(d);
    assert.equal(b.legacy, false);
    assert.equal(b.title, 'Guide bold');
    assert.equal(b.id, 'Guide bold#0');
    assert.equal(b.initiallyOpen, true);
    assert.equal(d.sliceString(b.titleFrom, b.titleTo), '### Guide **bold**');
    assert.equal(d.sliceString(b.headRun.from, b.headRun.to), '<details open>\n<summary>\n\n');
    assert.equal(d.sliceString(b.tailRun!.from, b.tailRun!.to), '\n</summary>\n\n');
    assert.equal(d.sliceString(b.closerRun.from, b.closerRun.to), '\n</details>', 'the body\'s trailing blank line hides with the closer');
    assert.equal(b.bodyLineCount, 1);
    assert.equal(d.sliceString(b.bodyFrom!, b.bodyTo!), 'body');
});

test('a body without a trailing blank line keeps the closer run to the tag alone', () => {
    const d = doc('<details open>\n<summary>\n\nT\n\n</summary>\n\nline one\nline two\n</details>');
    const [b] = findDetailsBlocks(d);
    assert.equal(d.sliceString(b.closerRun.from, b.closerRun.to), '</details>');
    assert.equal(d.sliceString(b.bodyFrom!, b.bodyTo!), 'line one\nline two');
});

test('only one trailing blank line hides; a second one stays in the body', () => {
    const d = doc('<details open>\n<summary>\n\nT\n\n</summary>\n\nx\n\n\n</details>');
    const [b] = findDetailsBlocks(d);
    assert.equal(d.sliceString(b.closerRun.from, b.closerRun.to), '\n</details>');
    assert.equal(d.sliceString(b.bodyFrom!, b.bodyTo!), 'x\n');
});

test('empty body: one typing line between the blank and the closer', () => {
    const d = doc('<details open>\n<summary>\n\nT\n\n</summary>\n\n\n</details>');
    const [b] = findDetailsBlocks(d);
    assert.equal(b.bodyLineCount, 1);
    assert.equal(d.sliceString(b.bodyFrom!, b.bodyTo!), '');
});

test('no body lines at all is allowed', () => {
    const [b] = findDetailsBlocks(doc('<details>\n<summary>\n\nT\n\n</summary>\n\n</details>'));
    assert.equal(b.bodyLineCount, 0);
    assert.equal(b.bodyFrom, null);
});

test('an empty title line is a valid title', () => {
    const d = doc('<details open>\n<summary>\n\n\n\n</summary>\n\n\n</details>');
    const [b] = findDetailsBlocks(d);
    assert.equal(b.title, '');
    assert.equal(b.titleFrom, b.titleTo);
});

test('multi-line title is one title span', () => {
    const d = doc(NEW('line one\nline two'));
    const [b] = findDetailsBlocks(d);
    assert.equal(d.sliceString(b.titleFrom, b.titleTo), 'line one\nline two');
});

test('legacy one-line summary is read, tags hidden inline, no tail run', () => {
    const d = doc('<details open>\n<summary><h3>Big <b>one</b></h3></summary>\n\nbody\n\n</details>');
    const [b] = findDetailsBlocks(d);
    assert.equal(b.legacy, true);
    assert.equal(b.title, 'Big one');
    assert.equal(b.tailRun, null);
    assert.deepEqual(b.inlineHidden.map(r => d.sliceString(r.from, r.to)), ['<summary>', '<h3>', '<b>', '</b>', '</h3>', '</summary>']);
    assert.equal(b.bodyLineCount, 2);
});

test('no open attribute means closed by default; tags are case-insensitive', () => {
    const [b] = findDetailsBlocks(doc('<DETAILS>\n<SUMMARY>T</SUMMARY>\nx\n</DETAILS>'));
    assert.equal(b.initiallyOpen, false);
    assert.equal(isDetailsOpen(b, {}), false);
    assert.equal(isDetailsOpen(b, { 'T#0': true }), true);
});

test('malformed shapes are plain text: unclosed, no summary, missing blanks', () => {
    assert.deepEqual(findDetailsBlocks(doc('<details open>\n<summary>\n\nT\n\n</summary>\n\nbody')), []);
    assert.deepEqual(findDetailsBlocks(doc('<details>\nbody\n</details>')), []);
    assert.deepEqual(findDetailsBlocks(doc('<details>\n<summary>\nT\n</summary>\nbody\n</details>')), []);
    assert.deepEqual(findDetailsBlocks(doc('<details>\n<summary>\n\nT\n</summary>\n\nbody\n</details>')), []);
});

test('nested toggles are both found, outer first, with depth', () => {
    const inner = NEW('Inner', 'x', '');
    const blocks = findDetailsBlocks(doc(NEW('Outer', inner)));
    assert.deepEqual(blocks.map(b => [b.title, b.depth]), [['Outer', 0], ['Inner', 1]]);
});

test('same-titled toggles get distinct ids', () => {
    const blocks = findDetailsBlocks(doc(`${NEW('A')}\n\n${NEW('A')}`));
    assert.deepEqual(blocks.map(b => b.id), ['A#0', 'A#1']);
});

test('toggles inside fenced code are ignored', () => {
    const text = '```html\n' + NEW('T') + '\n```';
    const state = fullyParsed(EditorState.create({ doc: text, extensions: [markdown({ extensions: GFM })] }));
    assert.deepEqual(findDetailsBlocks(state.doc, state), []);
});

test('plainTitle strips Markdown and HTML', () => {
    assert.equal(plainTitle('## A **b** [link](http://x) `c`'), 'A b link c');
    assert.equal(plainTitle('<h3>Hi</h3>'), 'Hi');
});

test('stripToggleTags removes hidden lines but keeps title and body words', () => {
    const out = stripToggleTags(`before\n\n${NEW('My title', 'the body')}\n\nafter`);
    assert.ok(!/details|summary/.test(out));
    assert.ok(out.includes('My title') && out.includes('the body') && out.includes('before') && out.includes('after'));
    assert.equal(stripToggleTags('no tags here'), 'no tags here');
});

test('toggleTagRanges are sorted and cover head, tail and closer', () => {
    const blocks = findDetailsBlocks(doc(NEW('T')));
    const ranges = toggleTagRanges(blocks);
    assert.equal(ranges.length, 3);
    assert.ok(ranges[0].from < ranges[1].from && ranges[1].from < ranges[2].from);
});
