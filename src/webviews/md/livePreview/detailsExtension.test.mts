import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { detailsExtensions, computeDetailsDecorations } from './detailsExtension.ts';
import { structureEdit } from './detailsEditing.ts';

const DOC = 'before\n\n<details open>\n<summary>\n\nTitle\n\n</summary>\n\nbody\n\n</details>\n\nafter';
const stateFor = (doc = DOC) => EditorState.create({ doc, extensions: detailsExtensions({}) });
const at = (needle: string, doc = DOC) => doc.indexOf(needle);

function tryChange(spec: { from: number; to?: number; insert?: string }, annotate = false) {
    const state = stateFor();
    const tr = state.update({ changes: spec, annotations: annotate ? [structureEdit.of(true)] : [] });
    return tr.state.doc.toString();
}

test('guard: typing in the title and body is allowed', () => {
    const titleEnd = at('Title') + 5;
    assert.equal(tryChange({ from: titleEnd, insert: '!' }), DOC.slice(0, titleEnd) + '!' + DOC.slice(titleEnd));
    const bodyStart = at('body');
    assert.equal(tryChange({ from: bodyStart, insert: 'x' }), DOC.slice(0, bodyStart) + 'x' + DOC.slice(bodyStart));
});

test('guard: deleting part of a hidden tag, or the break in front of one, is refused', () => {
    assert.equal(tryChange({ from: at('</summary>'), to: at('</summary>') + 3 }), DOC);
    assert.equal(tryChange({ from: at('Title') + 5, to: at('Title') + 6 }), DOC);          // the newline after the title
    assert.equal(tryChange({ from: at('<details open>'), to: at('<details open>') + 4 }), DOC);
    assert.equal(tryChange({ from: at('body') - 1, to: at('body') }), DOC);               // the break before the body
});

test('guard: inserting inside a hidden tag is refused', () => {
    assert.equal(tryChange({ from: at('summary') + 2, insert: 'zz' }), DOC);
});

test('guard: deleting the whole block is allowed, and so are our own structure edits', () => {
    const from = at('<details open>');
    const to = at('</details>') + '</details>'.length;
    assert.equal(tryChange({ from, to }), DOC.slice(0, from) + DOC.slice(to));
    assert.equal(tryChange({ from: at('</summary>'), to: at('</summary>') + 3 }, true), DOC.slice(0, at('</summary>')) + DOC.slice(at('</summary>') + 3));
});

test('decorations: an open toggle hides head, tail and closer; no body placeholder', () => {
    const { decos, atomic } = computeDetailsDecorations(stateFor(), {});
    let blocks = 0; let atomics = 0;
    decos.between(0, DOC.length, (_f, _t, v) => { if (v.spec.block) { blocks++; } });
    atomic.between(0, DOC.length, () => { atomics++; });
    assert.equal(blocks, 3);
    assert.equal(atomics, 3);
});

test('decorations: a closed toggle also hides the body behind one placeholder', () => {
    const { decos } = computeDetailsDecorations(stateFor(), { 'Title#0': false });
    let blocks = 0;
    decos.between(0, DOC.length, (_f, _t, v) => { if (v.spec.block) { blocks++; } });
    assert.equal(blocks, 4);
});

test('decorations: the cursor inside a closed body keeps it shown', () => {
    const state = EditorState.create({ doc: DOC, selection: { anchor: at('body') + 1 }, extensions: detailsExtensions({ 'Title#0': false }) });
    const { decos } = computeDetailsDecorations(state, { 'Title#0': false });
    let blocks = 0;
    decos.between(0, DOC.length, (_f, _t, v) => { if (v.spec.block) { blocks++; } });
    assert.equal(blocks, 3);
});

test('decorations: a document with no toggles produces nothing', () => {
    const { decos } = computeDetailsDecorations(stateFor('just text'), {});
    let n = 0;
    decos.between(0, 9, () => { n++; });
    assert.equal(n, 0);
});
