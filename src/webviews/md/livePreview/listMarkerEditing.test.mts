import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import {
    computeListItemPrefixRange,
    computeListMarkerRanges,
    computeListMarkerBackspace,
    computeListMarkerDelete,
    computeListMarkerArrowLeft,
    computeListMarkerArrowRight,
    listItemMarkerIsActivated,
} from './listMarkerEditing.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
}

function firstListItem(state: EditorState) {
    let item: import('@lezer/common').SyntaxNode | null = null;
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name === 'ListItem' && !item) { item = node.node; }
        },
    });
    return item;
}

function apply(state: EditorState, spec: ReturnType<typeof computeListMarkerBackspace>) {
    if (!spec) { return { doc: state.doc.toString(), sel: state.selection.main.head }; }
    const next = state.update(spec).state;
    return { doc: next.doc.toString(), sel: next.selection.main.head };
}

test('listItemMarkerIsActivated: requires gap space after marker or task checkbox', () => {
    for (const doc of ['1.', '-', '- [ ]', '12.']) {
        const state = stateFor(doc);
        assert.equal(listItemMarkerIsActivated(state, firstListItem(state)!), false, doc);
    }
    for (const doc of ['1. ', '- ', '- [ ] ', '12. item']) {
        const state = stateFor(doc);
        assert.equal(listItemMarkerIsActivated(state, firstListItem(state)!), true, doc);
    }
});

test('computeListItemPrefixRange: bullet marker + gap space', () => {
    const state = stateFor('- plain\n');
    const range = computeListItemPrefixRange(state, firstListItem(state)!);
    assert.deepEqual(range, { from: 0, to: 2 });
});

test('computeListMarkerRanges: bullet, ordered, and checkbox prefixes include gap', () => {
    const doc = '- a\n1. b\n- [ ] c\n';
    const ranges = computeListMarkerRanges(stateFor(doc));
    assert.deepEqual(ranges, [
        { from: 0, to: 2 },
        { from: 4, to: 7 },
        { from: 9, to: 15 },
    ]);
});

test('computeListMarkerRanges: ordered multi-digit marker + gap', () => {
    const doc = '12. item\n';
    assert.deepEqual(computeListMarkerRanges(stateFor(doc)), [{ from: 0, to: 4 }]);
});

test('computeListMarkerRanges: setext-as-bullet underline line', () => {
    const doc = 'paragraph\n- \n';
    const ranges = computeListMarkerRanges(stateFor(doc));
    assert.deepEqual(ranges, [{ from: doc.indexOf('-'), to: doc.indexOf('-') + 2 }]);
});

test('backspace at item content start removes marker + gap in one press', () => {
    const doc = '- plain\n';
    const pos = doc.indexOf('p');
    const state = stateFor(doc).update({ selection: { anchor: pos, head: pos } }).state;
    const result = apply(state, computeListMarkerBackspace(state));
    assert.equal(result.doc, 'plain\n');
    assert.equal(result.sel, 0);
});

test('backspace on checkbox line removes dash, checkbox, and gap', () => {
    const doc = '- [ ] todo\n';
    const pos = doc.indexOf('t');
    const state = stateFor(doc).update({ selection: { anchor: pos, head: pos } }).state;
    const result = apply(state, computeListMarkerBackspace(state));
    assert.equal(result.doc, 'todo\n');
    assert.equal(result.sel, 0);
});

test('delete at marker start removes whole prefix', () => {
    const doc = '- plain\n';
    const state = stateFor(doc).update({ selection: { anchor: 0, head: 0 } }).state;
    const result = apply(state, computeListMarkerDelete(state));
    assert.equal(result.doc, 'plain\n');
    assert.equal(result.sel, 0);
});

test('arrow left from item content start jumps to previous line end', () => {
    const doc = 'above\n- below\n';
    const pos = doc.indexOf('below');
    const state = stateFor(doc).update({ selection: { anchor: pos, head: pos } }).state;
    const spec = computeListMarkerArrowLeft(state);
    assert.ok(spec);
    const next = state.update(spec!).state;
    assert.equal(next.selection.main.head, doc.indexOf('e') + 1);
});

test('arrow left from marker start jumps to previous line end', () => {
    const doc = 'above\n- below\n';
    const pos = doc.indexOf('-');
    const state = stateFor(doc).update({ selection: { anchor: pos, head: pos } }).state;
    const spec = computeListMarkerArrowLeft(state);
    assert.ok(spec);
    const next = state.update(spec!).state;
    assert.equal(next.selection.main.head, doc.indexOf('e') + 1);
});

test('arrow right from line above jumps to item text start, not before marker', () => {
    const doc = 'above\n- below\n';
    const pos = doc.indexOf('e');
    const state = stateFor(doc).update({ selection: { anchor: pos, head: pos } }).state;
    const spec = computeListMarkerArrowRight(state);
    assert.ok(spec);
    const next = state.update(spec!).state;
    assert.equal(next.selection.main.head, doc.indexOf('below'));
});

test('arrow right from marker start jumps to item text start', () => {
    const doc = '- below\n';
    const state = stateFor(doc).update({ selection: { anchor: 0, head: 0 } }).state;
    const spec = computeListMarkerArrowRight(state);
    assert.ok(spec);
    const next = state.update(spec!).state;
    assert.equal(next.selection.main.head, doc.indexOf('below'));
});

test('arrow right from line above ordered list jumps to item text start', () => {
    const doc = 'above\n1. two\n';
    const pos = doc.indexOf('e');
    const state = stateFor(doc).update({ selection: { anchor: pos, head: pos } }).state;
    const spec = computeListMarkerArrowRight(state);
    assert.ok(spec);
    const next = state.update(spec!).state;
    assert.equal(next.selection.main.head, doc.indexOf('two'));
});

test('arrow right from line above checkbox line jumps to item text start', () => {
    const doc = 'above\n- [ ] todo\n';
    const pos = doc.indexOf('e');
    const state = stateFor(doc).update({ selection: { anchor: pos, head: pos } }).state;
    const spec = computeListMarkerArrowRight(state);
    assert.ok(spec);
    const next = state.update(spec!).state;
    assert.equal(next.selection.main.head, doc.indexOf('todo'));
});
