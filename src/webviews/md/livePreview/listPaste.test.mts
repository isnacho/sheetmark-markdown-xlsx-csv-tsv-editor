import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import {
    clipboardLooksLikeList,
    computePasteList,
    mergeListPasteIntoEmptyItem,
    parseListMarkerLine,
} from './listPaste.ts';

function stateFor(doc: string, anchor: number, head = anchor): EditorState {
    return EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown({ extensions: GFM })] });
}

function apply(state: EditorState, spec: ReturnType<typeof computePasteList>) {
    if (!spec) { return { doc: state.doc.toString(), sel: state.selection.main }; }
    const tr = state.update(spec);
    return { doc: tr.state.doc.toString(), sel: tr.state.selection.main };
}

test('parseListMarkerLine: bullet, task, ordered', () => {
    assert.deepEqual(parseListMarkerLine('- alpha'), { indent: '', marker: '- ', content: 'alpha' });
    assert.deepEqual(parseListMarkerLine('- [ ] todo'), { indent: '', marker: '- [ ] ', content: 'todo' });
    assert.deepEqual(parseListMarkerLine('- [x] done'), { indent: '', marker: '- [x] ', content: 'done' });
    assert.deepEqual(parseListMarkerLine('1. one'), { indent: '', marker: '1. ', content: 'one' });
    assert.deepEqual(parseListMarkerLine('  2) two'), { indent: '  ', marker: '2) ', content: 'two' });
});

test('clipboardLooksLikeList: accepts lists with continuations, rejects plain text', () => {
    assert.equal(clipboardLooksLikeList('- one\n- two'), true);
    assert.equal(clipboardLooksLikeList('- one\n  wrapped'), true);
    assert.equal(clipboardLooksLikeList('plain paragraph'), false);
    assert.equal(clipboardLooksLikeList('- one\nplain'), false);
});

test('mergeListPasteIntoEmptyItem: bullet list into empty bullet', () => {
    const merged = mergeListPasteIntoEmptyItem('', '- ', '- First\n- Second');
    assert.equal(merged, '- First\n- Second');
});

test('mergeListPasteIntoEmptyItem: preserves nested structure', () => {
    const merged = mergeListPasteIntoEmptyItem('', '- ', '- Parent\n  - Child');
    assert.equal(merged, '- Parent\n  - Child');
});

test('mergeListPasteIntoEmptyItem: nested empty target indents flat paste', () => {
    const merged = mergeListPasteIntoEmptyItem('  ', '- ', '- First\n- Second');
    assert.equal(merged, '  - First\n  - Second');
});

test('mergeListPasteIntoEmptyItem: checklist and ordered', () => {
    assert.equal(
        mergeListPasteIntoEmptyItem('', '- [ ] ', '- [ ] Task1\n- [x] Task2'),
        '- [ ] Task1\n- [x] Task2',
    );
    assert.equal(
        mergeListPasteIntoEmptyItem('', '1. ', '1. First\n2. Second'),
        '1. First\n2. Second',
    );
});

test('computePasteList: replaces empty bullet line instead of doubling markers', () => {
    const doc = 'before\n- \nafter';
    const pos = doc.indexOf('- ') + 2;
    const state = stateFor(doc, pos, pos);
    const { doc: next } = apply(state, computePasteList(state, '- First\n- Second'));
    assert.equal(next, 'before\n- First\n- Second\nafter');
});

test('computePasteList: null for non-empty list line', () => {
    const doc = '- existing';
    const state = stateFor(doc, doc.length, doc.length);
    assert.equal(computePasteList(state, '- First\n- Second'), null);
});

test('computePasteList: null for plain clipboard text', () => {
    const doc = '- ';
    const state = stateFor(doc, doc.length, doc.length);
    assert.equal(computePasteList(state, 'plain text'), null);
});

test('computePasteList: single-item bullet paste', () => {
    const doc = '- ';
    const state = stateFor(doc, doc.length, doc.length);
    const { doc: next } = apply(state, computePasteList(state, '- Only'));
    assert.equal(next, '- Only');
});
