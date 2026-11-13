import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { computeUnwrapToggle, computeDeleteToggle, computeSetStartOpen, toggleText, toggleSlashSnippet, sectionEndLine } from './detailsEditing.ts';
import { findDetailsBlocks } from './detailsTypes.ts';

function run(doc: string, fn: (s: EditorState, b: ReturnType<typeof findDetailsBlocks>[number]) => any): string {
    const state = EditorState.create({ doc });
    const [block] = findDetailsBlocks(state.doc);
    return state.update(fn(state, block)).state.doc.toString();
}

const BLOCK = '<details open>\n<summary>\n\n## Title\n\n</summary>\n\nbody one\n\nbody two\n\n</details>';

test('toggleText builds a detectable block, with or without a body', () => {
    for (const body of ['', 'hello']) {
        const { text, titleOffset, bodyOffset } = toggleText('T', body);
        const state = EditorState.create({ doc: text });
        const [b] = findDetailsBlocks(state.doc);
        assert.equal(b.title, 'T');
        assert.equal(b.titleFrom, titleOffset);
        assert.equal(b.bodyFrom, bodyOffset);
        assert.equal(state.sliceDoc(b.bodyFrom!, b.bodyTo!).trim(), body);
    }
});

test('slash snippet puts the cursor after the title prefix', () => {
    const { insert, cursorOffset } = toggleSlashSnippet('## ');
    assert.equal(insert.slice(0, cursorOffset).endsWith('\n\n## '), true);
    assert.equal(findDetailsBlocks(EditorState.create({ doc: insert }).doc).length, 1);
});

test('unwrap keeps the title block and the body, drops all markup', () => {
    assert.equal(run(`before\n\n${BLOCK}\n\nafter`, computeUnwrapToggle), 'before\n\n## Title\n\nbody one\n\nbody two\n\nafter');
});

test('unwrap with an empty body leaves just the title', () => {
    const { text } = toggleText('Just a title', '');
    assert.equal(run(text, computeUnwrapToggle), 'Just a title');
});

test('unwrap works on the legacy shape', () => {
    assert.equal(run('<details>\n<summary>Plain</summary>\n\nbody\n\n</details>', computeUnwrapToggle), 'Plain\n\nbody');
});

test('delete removes the whole block including its line break', () => {
    assert.equal(run(`before\n\n${BLOCK}\nafter`, computeDeleteToggle), 'before\n\nafter');
    assert.equal(run(`before\n${BLOCK}`, computeDeleteToggle), 'before');
});

test('set start open writes and removes the open attribute, keeping other attributes', () => {
    assert.ok(run(BLOCK, (s, b) => computeSetStartOpen(s, b, false)).startsWith('<details>\n'));
    assert.ok(run(BLOCK.replace('<details open>', '<details>'), (s, b) => computeSetStartOpen(s, b, true)).startsWith('<details open>\n'));
    assert.ok(run(BLOCK.replace('<details open>', '<details class="x">'), (s, b) => computeSetStartOpen(s, b, true)).startsWith('<details class="x" open>\n'));
});

test('sectionEndLine runs to the next heading of the same or higher level and ignores fences', () => {
    const state = EditorState.create({ doc: '## A\n\nx\n\n### Sub\n\ny\n\n```\n## fake\n```\n\n## B\n' });
    assert.equal(sectionEndLine(state.doc, 1, 2), 11);
    assert.equal(sectionEndLine(state.doc, 5, 3), 11);
});
