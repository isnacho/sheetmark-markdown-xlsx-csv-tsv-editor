// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.
// Repo's first automated test seed (Phase 3) — every subsequent phase adds cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { detectInteractionAtPos, detectCollapsedLinkAtPos } from './livePreviewInteractions.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown()] });
}

test('detects a link and extracts its URL', () => {
    const doc = '[hello](https://example.com/path)';
    const state = stateFor(doc);
    const result = detectInteractionAtPos(state, doc.indexOf('hello'));
    assert.deepEqual(result, { kind: 'link', href: 'https://example.com/path' });
});

test('detects an image and extracts its src', () => {
    const doc = '![alt text](./assets/pic.png)';
    const state = stateFor(doc);
    const result = detectInteractionAtPos(state, doc.indexOf('alt'));
    assert.deepEqual(result, { kind: 'image', src: './assets/pic.png' });
});

test('detects an ATX heading and returns its 1-indexed line', () => {
    const doc = 'intro\n\n## Section Two\n\nbody text';
    const state = stateFor(doc);
    const line3Pos = doc.indexOf('Section');
    const result = detectInteractionAtPos(state, line3Pos);
    assert.deepEqual(result, { kind: 'heading', line: 3 });
});

test('detects a fenced code block and extracts its body excluding fence delimiters', () => {
    const doc = 'before\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nafter';
    const state = stateFor(doc);
    const result = detectInteractionAtPos(state, doc.indexOf('const a'));
    assert.deepEqual(result, { kind: 'code', text: 'const a = 1;\nconst b = 2;' });
});

test('returns null for plain paragraph text', () => {
    const doc = 'just a plain sentence with no markup';
    const state = stateFor(doc);
    const result = detectInteractionAtPos(state, doc.indexOf('plain'));
    assert.equal(result, null);
});

test('detectCollapsedLinkAtPos: returns href when caret is outside the link', () => {
    const doc = 'before [hello](./other.md) after';
    const state = stateFor(doc);
    const pos = doc.indexOf('hello');
    const result = detectCollapsedLinkAtPos(state, pos);
    assert.deepEqual(result, { href: './other.md' });
});

test('detectCollapsedLinkAtPos: returns null when caret is inside the link', () => {
    const doc = 'before [hello](./other.md) after';
    const labelStart = doc.indexOf('hello');
    const state = EditorState.create({
        doc,
        selection: EditorSelection.cursor(labelStart + 2),
        extensions: [markdown()],
    });
    assert.equal(detectCollapsedLinkAtPos(state, labelStart + 2), null);
});

test('detectCollapsedLinkAtPos: caret immediately after closing paren stays navigable', () => {
    const doc = '[hello](./other.md)';
    const afterLink = doc.length;
    const state = EditorState.create({
        doc,
        selection: EditorSelection.cursor(afterLink),
        extensions: [markdown()],
    });
    const pos = doc.indexOf('hello');
    assert.deepEqual(detectCollapsedLinkAtPos(state, pos), { href: './other.md' });
});

test('detectCollapsedLinkAtPos: skips image alt text', () => {
    const doc = '![alt text](./assets/pic.png)';
    const state = stateFor(doc);
    const pos = doc.indexOf('alt');
    assert.equal(detectCollapsedLinkAtPos(state, pos), null);
});

test('detectCollapsedLinkAtPos: returns null for empty label link with no URL child', () => {
    const doc = '[broken';
    const state = stateFor(doc);
    assert.equal(detectCollapsedLinkAtPos(state, 1), null);
});

test('detectCollapsedLinkAtPos: ignores hidden url syntax to the right of the label', () => {
    const doc = 'See [example](https://example.com)';
    const state = stateFor(doc);
    const urlPos = doc.indexOf('https');
    const closeParenPos = doc.indexOf(')');
    assert.equal(detectCollapsedLinkAtPos(state, urlPos), null);
    assert.equal(detectCollapsedLinkAtPos(state, closeParenPos), null);
});

test('detectCollapsedLinkAtPos: ignores bracket marks outside the label text', () => {
    const doc = '[hello](https://example.com)';
    const state = stateFor(doc);
    assert.equal(detectCollapsedLinkAtPos(state, doc.indexOf('[')), null);
    assert.equal(detectCollapsedLinkAtPos(state, doc.indexOf(']')), null);
});
