// Headless tests for the block model behind Notion-style block drag (no DOM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { fullyParsed } from './testState.ts';
import { findDetailsBlocks } from './detailsTypes.ts';
import { findCalloutBlocks } from './calloutTypes.ts';
import {
    buildBlockTree, visibleBlocks, blockAtLine, blocksForRange, dropTargetsAtGap, computeMoveBlocks,
    remapTableIndexMap, remapToggleState, isContainer, computeInsertAfter,
} from './blockModel.ts';
import type { BlockNode, DropTarget } from './blockModel.ts';

const st = (doc: string) => fullyParsed(EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] }));

/** The deepest visible block whose first line (without `>` and indent) is `needle`, else starts with it. */
function find(state: EditorState, tree: BlockNode[], needle: string, containerOnly = false): BlockNode {
    const norm = (b: BlockNode) => state.doc.line(b.firstLine).text.replace(/^[\s>]*/, '');
    const pool = visibleBlocks(tree).filter(b => !containerOnly || isContainer(b));
    let hits = pool.filter(b => norm(b) === needle);
    if (!hits.length) { hits = pool.filter(b => norm(b).startsWith(needle)); }
    assert.ok(hits.length, `no block "${needle}"`);
    return hits.sort((a, b) => b.depth - a.depth)[0];
}

type Where = { after: string } | { before: string } | { into: string; index?: number } | { top: number };

function targetFor(state: EditorState, tree: BlockNode[], where: Where): DropTarget {
    if ('top' in where) { return { parent: null, index: where.top, depth: 0 }; }
    if ('into' in where) {
        const p = find(state, tree, where.into, true);
        return { parent: p, index: where.index ?? p.children.length, depth: p.depth + 1 };
    }
    const b = find(state, tree, 'after' in where ? where.after : where.before);
    const siblings = b.parent ? b.parent.children : tree;
    return { parent: b.parent, index: siblings.indexOf(b) + ('after' in where ? 1 : 0), depth: b.depth };
}

function move(doc: string, sources: string | string[], where: Where): string | null {
    const state = st(doc);
    const tree = buildBlockTree(state);
    const blocks = (Array.isArray(sources) ? sources : [sources]).map(s => find(state, tree, s));
    const result = computeMoveBlocks(state, tree, blocks, targetFor(state, tree, where));
    return result ? state.update(result.spec).state.doc.toString() : null;
}

const shape = (tree: BlockNode[]): unknown => tree.map(b => b.children.length ? [b.kind, shape(b.children)] : b.kind);

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

test('tree: top-level kinds', () => {
    const state = st('# H\n\nPara.\n\n```js\nx\n```\n\n---\n\n| a |\n|---|\n| 1 |\n\n<div>x</div>');
    assert.deepEqual(shape(buildBlockTree(state)), ['heading', 'paragraph', 'code', 'hr', 'table', 'html']);
});

test('tree: a list item carries its nested items and continuation paragraphs', () => {
    const state = st('- a\n  - a1\n\n  more a\n- b');
    const tree = buildBlockTree(state);
    assert.deepEqual(shape(tree), [['listItem', ['listItem', 'paragraph']], 'listItem']);
    assert.equal(tree[0].firstLine, 1);
    assert.equal(tree[0].lastLine, 4);
    assert.equal(tree[0].headLastLine, 1);
    assert.equal(tree[0].list?.contentWidth, 2);
});

test('tree: list info (ordered, start, tight)', () => {
    const tree = buildBlockTree(st('3. x\n\n4. y'));
    assert.equal(tree[0].list?.ordered, true);
    assert.equal(tree[0].list?.start, 3);
    assert.equal(tree[0].list?.tight, false);
    assert.equal(tree[1].list?.index, 1);
});

test('tree: quotes hold their blocks', () => {
    assert.deepEqual(shape(buildBlockTree(st('> one\n>\n> - item\n\nout'))), [['quote', ['paragraph', 'listItem']], 'paragraph']);
});

test('tree: callout bodies hold blocks, with or without blank lines around the fences', () => {
    assert.deepEqual(shape(buildBlockTree(st(':::info\nInside.\n\nTwo.\n:::\n\nOut.'))), [['callout', ['paragraph', 'paragraph']], 'paragraph']);
    const glued = st('Before.\n:::info\nglued\n:::\nAfter.');
    const tree = buildBlockTree(glued);
    assert.deepEqual(shape(tree), ['paragraph', ['callout', ['paragraph']], 'paragraph']);
    assert.equal(glued.doc.line(tree[1].children[0].firstLine).text, 'glued');
});

test('tree: nested toggles; a closed toggle hides its children from the visible list', () => {
    const doc = '<details open>\n<summary>\n\nOuter\n\n</summary>\n\n<details>\n<summary>\n\nInner\n\n</summary>\n\nInner body.\n\n</details>\n\n</details>';
    const tree = buildBlockTree(st(doc));
    assert.deepEqual(shape(tree), [['toggle', [['toggle', ['paragraph']]]]]);
    const inner = tree[0].children[0];
    assert.equal(inner.collapsed, true);
    assert.equal(visibleBlocks(tree).length, 2);
    assert.equal(tree[0].headLastLine, 6);
});

test('tree: frontmatter is not a block', () => {
    const tree = buildBlockTree(st('---\ntitle: x\n---\n\nA.'));
    assert.deepEqual(shape(tree), ['paragraph']);
    assert.equal(tree[0].firstLine, 5);
});

test('blockAtLine: innermost block; a list item head returns the item', () => {
    const state = st('- a\n  - a1\n- b');
    const tree = buildBlockTree(state);
    assert.equal(blockAtLine(tree, 1), tree[0]);
    assert.equal(blockAtLine(tree, 2), tree[0].children[0]);
    assert.equal(blockAtLine(tree, 3), tree[1]);
});

test('blocksForRange: partial selections widen to whole sibling blocks under the common parent', () => {
    const state = st('P1.\n\n- a\n  - a1\n\nP2.');
    const tree = buildBlockTree(state);
    const inA1 = state.doc.line(4).from + 3;
    assert.deepEqual(blocksForRange(state, tree, 1, inA1), [tree[0], tree[1]]);
    assert.deepEqual(blocksForRange(state, tree, inA1, inA1 + 1), [tree[1].children[0]]);
    assert.deepEqual(blocksForRange(state, tree, 0, state.doc.length), tree);
});

// ---------------------------------------------------------------------------
// Drop targets
// ---------------------------------------------------------------------------

test('drop targets: below a list item you can nest under it, stay beside it, or leave the list', () => {
    const state = st('- a\n  - a1\n\nP.');
    const tree = buildBlockTree(state);
    const visible = visibleBlocks(tree); // a, a1, P
    const source = tree[1];
    const targets = dropTargetsAtGap(tree, visible, 2, [source]);
    assert.deepEqual(targets.map(t => [t.parent ? state.doc.line(t.parent.firstLine).text.trim() : null, t.index]), [
        [null, 1], ['- a', 1], ['- a1', 0],
    ]);
});

test('drop targets: nothing inside the dragged block, closed toggles or a callout inside a callout', () => {
    const state = st('- a\n  - a1\n\n:::info\nx\n:::\n\n:::warn\ny\n:::');
    const tree = buildBlockTree(state);
    const visible = visibleBlocks(tree);
    const a = tree[0];
    assert.ok(dropTargetsAtGap(tree, visible, 2, [a]).every(t => t.parent !== a && t.parent !== a.children[0]));
    const warn = tree[2];
    const intoInfo = dropTargetsAtGap(tree, visible, visible.indexOf(warn), [warn]);
    assert.ok(intoInfo.every(t => t.parent?.kind !== 'callout'));
    const closed = buildBlockTree(st('<details>\n<summary>\n\nT\n\n</summary>\n\nbody\n\n</details>\n\nP.'));
    const cv = visibleBlocks(closed);
    assert.ok(dropTargetsAtGap(closed, cv, 1, [closed[1]]).every(t => t.parent === null));
});

test('drop targets: toggles and callouts cannot go under a list item', () => {
    const state = st('- a\n\n:::info\nx\n:::');
    const tree = buildBlockTree(state);
    const targets = dropTargetsAtGap(tree, visibleBlocks(tree), 1, [tree[1]]);
    assert.ok(targets.every(t => t.parent === null));
});

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

const DOC = '# Title\n\nFirst para.\n\nSecond para.\n\n## Sub\n\nThird.';

test('move: a paragraph below a heading, keeping one blank line between blocks', () => {
    assert.equal(move(DOC, 'First para.', { after: '## Sub' }), '# Title\n\nSecond para.\n\n## Sub\n\nFirst para.\n\nThird.');
});

test('move: a heading moves alone, not with its section', () => {
    assert.equal(move(DOC, '## Sub', { top: 0 }), '## Sub\n\n# Title\n\nFirst para.\n\nSecond para.\n\nThird.');
});

test('move: dropping a block on its own place is a no-op', () => {
    assert.equal(move(DOC, 'Second para.', { after: 'First para.' }), null);
    assert.equal(move(DOC, 'Second para.', { before: '## Sub' }), null);
});

test('move: list items stay tight in a tight list', () => {
    const L = '- a\n- b\n- c\n\nAfter.';
    assert.equal(move(L, '- c', { before: '- a' }), '- c\n- a\n- b\n\nAfter.');
    assert.equal(move(L, '- a', { after: '- c' }), '- b\n- c\n- a\n\nAfter.');
});

test('move: nesting a list item deeper and back out', () => {
    assert.equal(move('- a\n- b\n- c', '- b', { into: '- a' }), '- a\n  - b\n- c');
    assert.equal(move('- a\n  - a1\n  - a2\n- b', '- a2', { after: '- a' }), '- a\n  - a1\n- a2\n- b');
    assert.equal(move('- a\n  - a1\n  - a2\n- b', '- a2', { into: '- a1' }), '- a\n  - a1\n    - a2\n- b');
});

test('move: a list item takes its children with it', () => {
    assert.equal(move('- a\n  - a1\n  - a2\n- b', '- a', { after: '- b' }), '- b\n- a\n  - a1\n  - a2');
});

test('move: a paragraph under a list item is indented to the item text', () => {
    assert.equal(move('- a\n- b\n\nAfter.', 'After.', { into: '- b' }), '- a\n- b\n\n  After.');
});

test('move: task items keep their checkbox', () => {
    assert.equal(move('- [ ] one\n- [x] two', '- [x] two', { before: '- [ ] one' }), '- [x] two\n- [ ] one');
});

test('move: a list item takes the bullet of the list it joins', () => {
    assert.equal(move('* a\n* b\n\n- c', '- c', { after: '* b' }), '* a\n* b\n* c');
});

test('move: numbered lists renumber at both ends', () => {
    const O = '1. one\n2. two\n3. three\n\nText.';
    assert.equal(move(O, '3. three', { before: '1. one' }), '1. three\n2. one\n3. two\n\nText.');
    assert.equal(move(O, '2. two', { after: 'Text.' }), '1. one\n2. three\n\nText.\n\n1. two');
    assert.equal(move('1. one\n\n2. two\n\n3. three', '3. three', { before: '1. one' }), '1. three\n\n2. one\n\n3. two');
});

test('move: a list keeps its start number', () => {
    assert.equal(move('5. a\n6. b', '6. b', { before: '5. a' }), '5. b\n6. a');
});

test('move: into and out of a quote', () => {
    const Q = '> quoted one\n>\n> quoted two\n\nOutside.';
    assert.equal(move(Q, 'quoted two', { after: 'Outside.' }), '> quoted one\n\nOutside.\n\nquoted two');
    assert.equal(move(Q, 'Outside.', { into: 'quoted one' }), '> quoted one\n>\n> quoted two\n>\n> Outside.');
    assert.equal(move('> - qa\n> - qb\n\nOut.', 'Out.', { after: '- qb' }), '> - qa\n> - qb\n>\n> Out.');
    assert.equal(move('> - qa\n> - qb\n\nOut.', '- qb', { after: 'Out.' }), '> - qa\n\nOut.\n\n- qb');
});

test('move: into and out of a callout', () => {
    const C = ':::info\nInside callout.\n:::\n\nOutside.\n\nMore.';
    assert.equal(move(C, 'Outside.', { into: ':::info' }), ':::info\nInside callout.\n\nOutside.\n:::\n\nMore.');
    const out = move(C, 'Inside callout.', { after: 'More.' })!;
    assert.equal(out, ':::info\n:::\n\nOutside.\n\nMore.\n\nInside callout.');
    assert.equal(findCalloutBlocks(st(out).doc).length, 1);
});

const TOGGLE = 'Intro.\n\n<details open>\n<summary>\n\nToggle title\n\n</summary>\n\nBody para.\n\n</details>\n\nOutro.';

test('move: into and out of a toggle keeps the toggle markup intact', () => {
    const into = move(TOGGLE, 'Outro.', { into: '<details open>' })!;
    assert.equal(into, 'Intro.\n\n<details open>\n<summary>\n\nToggle title\n\n</summary>\n\nBody para.\n\nOutro.\n\n</details>');
    const out = move(TOGGLE, 'Body para.', { after: 'Outro.' })!;
    assert.equal(out, 'Intro.\n\n<details open>\n<summary>\n\nToggle title\n\n</summary>\n\n</details>\n\nOutro.\n\nBody para.');
    for (const doc of [into, out]) { assert.equal(findDetailsBlocks(st(doc).doc).length, 1, doc); }
    const empty = 'Intro.\n\n<details open>\n<summary>\n\nT\n\n</summary>\n\n\n</details>\n\nOutro.';
    assert.equal(move(empty, 'Outro.', { into: '<details open>' }), 'Intro.\n\n<details open>\n<summary>\n\nT\n\n</summary>\n\nOutro.\n\n</details>');
});

test('move: a whole toggle moves as one block', () => {
    assert.equal(move(TOGGLE, '<details open>', { after: 'Outro.' }), 'Intro.\n\nOutro.\n\n<details open>\n<summary>\n\nToggle title\n\n</summary>\n\nBody para.\n\n</details>');
});

test('move: tables and code fences nest under list items by indentation', () => {
    assert.equal(move('- item\n\n| a | b |\n|---|---|\n| 1 | 2 |', '| a | b |', { into: '- item' }), '- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |');
    assert.equal(move('- item\n\n```js\nx\n\ny\n```', '```js', { into: '- item' }), '- item\n\n  ```js\n  x\n\n  y\n  ```');
});

test('move: never drops above frontmatter', () => {
    assert.equal(move('---\ntitle: x\n---\n\nA.\n\nB.', 'B.', { top: 0 }), '---\ntitle: x\n---\n\nB.\n\nA.');
});

test('move: several sibling blocks move together in order', () => {
    const state = st('- a\n- b\n- c\n- d');
    const tree = buildBlockTree(state);
    const r = computeMoveBlocks(state, tree, [tree[0], tree[1]], { parent: null, index: 3, depth: 0 })!;
    assert.equal(state.update(r.spec).state.doc.toString(), '- c\n- a\n- b\n- d');
    assert.equal(move('P1.\n\nP2.\n\nP3.', ['P1.', 'P2.'], { after: 'P3.' }), 'P3.\n\nP1.\n\nP2.');
});

test('move: the moved blocks end up selected, as one undoable change', () => {
    const state = st(DOC);
    const tree = buildBlockTree(state);
    const r = computeMoveBlocks(state, tree, [find(state, tree, 'First para.')], targetFor(state, tree, { after: '## Sub' }))!;
    const next = state.update(r.spec).state;
    assert.equal(next.sliceDoc(r.movedFrom, r.movedTo), 'First para.');
    assert.equal(next.selection.main.from, r.movedFrom);
    assert.equal(next.selection.main.to, r.movedTo);
});

test('move: reports the new order of tables and toggles', () => {
    const doc = '| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |';
    const state = st(doc);
    const tree = buildBlockTree(state);
    const r = computeMoveBlocks(state, tree, [tree[0]], { parent: null, index: 2, depth: 0 })!;
    assert.deepEqual(r.tableOrder, [1, 0]);
});

// ---------------------------------------------------------------------------
// Remaps
// ---------------------------------------------------------------------------

test('remapTableIndexMap: widths follow their table', () => {
    assert.deepEqual(remapTableIndexMap({ 0: [100], 2: [50] }, [1, 2, 0]), { 1: [50], 2: [100] });
});

test('remapToggleState: open state follows the toggle when ids shift', () => {
    assert.deepEqual(remapToggleState({ 'A#0': true, 'A#1': false, 'B#0': true }, ['A#1', 'A#0'], ['A#0', 'A#1']), { 'B#0': true, 'A#0': false, 'A#1': true });
});

// ---------------------------------------------------------------------------
// The + button
// ---------------------------------------------------------------------------

function plus(doc: string, needle: string): { doc: string; cursorLine: string; slash: boolean } {
    const state = st(doc);
    const tree = buildBlockTree(state);
    const r = computeInsertAfter(state, find(state, tree, needle));
    const next = state.update(r.spec).state;
    const head = next.selection.main.head;
    return { doc: next.doc.toString(), cursorLine: next.doc.lineAt(head).text.slice(0, head - next.doc.lineAt(head).from), slash: r.openSlashMenu };
}

test('plus: a paragraph gets a slash line below it', () => {
    assert.deepEqual(plus('A.\n\nB.', 'A.'), { doc: 'A.\n\n/\n\nB.', cursorLine: '/', slash: true });
    assert.deepEqual(plus('# H\nB.', '# H'), { doc: '# H\n\n/\n\nB.', cursorLine: '/', slash: true });
    assert.deepEqual(plus('A.', 'A.'), { doc: 'A.\n\n/', cursorLine: '/', slash: true });
});

test('plus: a list item gets an empty sibling item, numbered lists renumber', () => {
    assert.deepEqual(plus('- a\n- b', '- a'), { doc: '- a\n- \n- b', cursorLine: '- ', slash: false });
    assert.deepEqual(plus('1. a\n2. b', '1. a'), { doc: '1. a\n2. \n3. b', cursorLine: '2. ', slash: false });
    assert.deepEqual(plus('- [x] a', '- [x] a'), { doc: '- [x] a\n- [ ] ', cursorLine: '- [ ] ', slash: false });
    assert.equal(plus('- a\n  - b', '- b').doc, '- a\n  - b\n  - ');
});

test('plus: inside a quote, an empty quote line after a blank one', () => {
    assert.deepEqual(plus('> q\n\nout', 'q'), { doc: '> q\n>\n> \n\nout', cursorLine: '> ', slash: false });
});
