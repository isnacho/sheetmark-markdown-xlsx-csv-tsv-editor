// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.
// One (or a wrap/unwrap or boundary pair of) case per ported command, per the
// plan's Phase 5 exit bar ("Unit tests per command").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import {
    computeWrapSelection,
    computeToggleLinePrefix,
    computeInsertAtCursor,
    computeInsertLink,
    isPasteableUrl,
    isPasteLinkifyBlocked,
    computePasteLink,
    computeInsertImage,
    computeInsertTable,
    computeInsertHorizontalRule,
    computeToggleCodeBlock,
    computeMultiLineIndent,
    computeMultiLineListAwareIndent,
    computeTabIndent,
    enclosingListItem,
    listItemDepth,
    computeDuplicateLine,
    computeDeleteLine,
    computeMoveLineUp,
    computeMoveLineDown,
    computeSelectWord,
    computeTransformCase,
    computeSortSelectedLines,
    computeTrimTrailingWhitespace,
    computeJumpToLine,
} from './formatCommands.ts';

function stateFor(doc: string, anchor: number, head = anchor): EditorState {
    return EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown({ extensions: GFM })] });
}

function apply(state: EditorState, spec: ReturnType<typeof computeWrapSelection> | null) {
    if (!spec) { return { doc: state.doc.toString(), sel: state.selection.main }; }
    const tr = state.update(spec);
    return { doc: tr.state.doc.toString(), sel: tr.state.selection.main };
}

test('wrapSelection: wraps a selection with markers', () => {
    const state = stateFor('plain bold plain', 6, 10);
    const { doc, sel } = apply(state, computeWrapSelection(state, '**', '**'));
    assert.equal(doc, 'plain **bold** plain');
    assert.deepEqual([sel.from, sel.to], [8, 12]);
});

test('wrapSelection: unwraps when selection is already wrapped', () => {
    const state = stateFor('plain **bold** plain', 8, 12);
    const { doc, sel } = apply(state, computeWrapSelection(state, '**', '**'));
    assert.equal(doc, 'plain bold plain');
    assert.deepEqual([sel.from, sel.to], [6, 10]);
});

test('toggleLinePrefix: adds a heading prefix and strips a competing one', () => {
    const state = stateFor('## Title', 3, 3);
    const { doc, sel } = apply(state, computeToggleLinePrefix(state, '# '));
    assert.equal(doc, '# Title');
    assert.deepEqual([sel.from, sel.to], [2, 2]);
});

test('toggleLinePrefix: removes the prefix when already present', () => {
    const state = stateFor('# Title', 2, 2);
    const { doc, sel } = apply(state, computeToggleLinePrefix(state, '# '));
    assert.equal(doc, 'Title');
    assert.deepEqual([sel.from, sel.to], [0, 0]);
});

test('toggleLinePrefix: applies prefix to every line in a multi-line selection', () => {
    const doc = 'one\ntwo\nthree';
    const state = stateFor(doc, 0, doc.length);
    const { doc: next } = apply(state, computeToggleLinePrefix(state, '- '));
    assert.equal(next, '- one\n- two\n- three');
});

test('toggleLinePrefix: removes prefix from every line when all selected lines have it', () => {
    const doc = '> one\n> two';
    const state = stateFor(doc, 0, doc.length);
    const { doc: next } = apply(state, computeToggleLinePrefix(state, '> '));
    assert.equal(next, 'one\ntwo');
});

test('insertAtCursor: inserts text and places cursor at the given offset', () => {
    const state = stateFor('ab', 1, 1);
    const { doc, sel } = apply(state, computeInsertAtCursor(state, 'XY', 1));
    assert.equal(doc, 'aXYb');
    assert.equal(sel.from, 2);
});

test('insertLink: wraps a selection and selects "url"', () => {
    const state = stateFor('see docs here', 4, 8);
    const { doc, sel } = apply(state, computeInsertLink(state));
    assert.equal(doc, 'see [docs](url) here');
    assert.deepEqual([sel.from, sel.to], [11, 14]);
});

test('insertLink: inserts a placeholder snippet and selects "text" when nothing is selected', () => {
    const state = stateFor('', 0, 0);
    const { doc, sel } = apply(state, computeInsertLink(state));
    assert.equal(doc, '[text](url)');
    assert.deepEqual([sel.from, sel.to], [1, 5]);
});

test('isPasteableUrl: accepts http(s) and www. single-line URLs', () => {
    assert.ok(isPasteableUrl('https://example.com'));
    assert.ok(isPasteableUrl('http://foo.bar/baz'));
    assert.ok(isPasteableUrl('www.example.com/path'));
    assert.ok(isPasteableUrl('  https://trim.me  '));
});

test('isPasteableUrl: rejects multi-line and non-URL text', () => {
    assert.equal(isPasteableUrl('https://a.com\nhttps://b.com'), false);
    assert.equal(isPasteableUrl('not a url'), false);
    assert.equal(isPasteableUrl('ftp://files.example.com'), false);
});

test('pasteLink: no selection wraps the URL as label and target', () => {
    const state = stateFor('see ', 4, 4);
    const { doc, sel } = apply(state, computePasteLink(state, 'https://example.com')!);
    assert.equal(doc, 'see [https://example.com](https://example.com)');
    assert.equal(sel.from, sel.to);
    assert.equal(sel.from, doc.length);
});

test('pasteLink: selection becomes the link label', () => {
    const state = stateFor('see docs here', 4, 8);
    const { doc, sel } = apply(state, computePasteLink(state, 'https://example.com')!);
    assert.equal(doc, 'see [docs](https://example.com) here');
    assert.equal(sel.from, doc.indexOf(' here'));
    assert.equal(sel.to, sel.from);
});

test('pasteLink: skipped inside inline code', () => {
    const doc = 'use `code` here';
    const pos = doc.indexOf('code');
    const state = stateFor(doc, pos, pos + 4);
    assert.equal(computePasteLink(state, 'https://example.com'), null);
});

test('pasteLink: skipped inside an existing link', () => {
    const doc = '[label](https://old.com)';
    const pos = doc.indexOf('label');
    const state = stateFor(doc, pos, pos + 5);
    assert.equal(computePasteLink(state, 'https://new.com'), null);
});

test('pasteLink: skipped for multi-line clipboard', () => {
    const state = stateFor('', 0, 0);
    assert.equal(computePasteLink(state, 'https://a.com\nline two'), null);
});

test('isPasteLinkifyBlocked: false for plain text, true inside fenced code', () => {
    const plain = stateFor('hello', 2, 2);
    assert.equal(isPasteLinkifyBlocked(plain, 2, 2), false);
    const doc = '```\ncode\n```';
    const pos = doc.indexOf('code');
    const fenced = stateFor(doc, pos, pos);
    assert.equal(isPasteLinkifyBlocked(fenced, pos, pos), true);
});

test('insertImage: uses the selection as alt text and selects "image-url"', () => {
    const state = stateFor('a logo b', 2, 6);
    const { doc, sel } = apply(state, computeInsertImage(state));
    assert.equal(doc, 'a ![logo](image-url) b');
    assert.deepEqual([sel.from, sel.to], [10, 19]);
});

test('insertTable: inserts an empty 3x2 table snippet at cursor', () => {
    const state = stateFor('', 0, 0);
    const { doc } = apply(state, computeInsertTable(state));
    assert.ok(doc.includes('|  |  |  |\n| --- | --- | --- |\n|  |  |  |'));
});

test('insertHorizontalRule: no leading newline at doc start', () => {
    const state = stateFor('', 0, 0);
    const { doc } = apply(state, computeInsertHorizontalRule(state));
    assert.equal(doc, '---\n');
});

test('insertHorizontalRule: leading newline mid-document', () => {
    const state = stateFor('text', 4, 4);
    const { doc } = apply(state, computeInsertHorizontalRule(state));
    assert.equal(doc, 'text\n---\n');
});

test('toggleCodeBlock: wraps selection in a fence', () => {
    const state = stateFor('x = 1', 0, 5);
    const { doc, sel } = apply(state, computeToggleCodeBlock(state));
    assert.equal(doc, '```\nx = 1\n```');
    assert.deepEqual([sel.from, sel.to], [4, 9]);
});

test('toggleCodeBlock: unwraps an already-fenced selection', () => {
    const state = stateFor('```\ncode\n```', 0, 12);
    const { doc, sel } = apply(state, computeToggleCodeBlock(state));
    assert.equal(doc, 'code');
    assert.deepEqual([sel.from, sel.to], [0, 4]);
});

test('multiLineIndent: indents every selected line by 4 spaces', () => {
    const state = stateFor('one\ntwo', 0, 7);
    const { doc, sel } = apply(state, computeMultiLineIndent(state, false));
    assert.equal(doc, '    one\n    two');
    assert.deepEqual([sel.from, sel.to], [4, 15]);
});

test('multiLineIndent: outdents lines that have leading spaces, skips ones that do not', () => {
    const state = stateFor('    one\ntwo', 0, 11);
    const { doc, sel } = apply(state, computeMultiLineIndent(state, true));
    assert.equal(doc, 'one\ntwo');
    assert.deepEqual([sel.from, sel.to], [0, 7]);
});

test('tabIndent: collapsed cursor inserts 4 spaces', () => {
    const state = stateFor('ab', 1, 1);
    const { doc, sel } = apply(state, computeTabIndent(state, false));
    assert.equal(doc, 'a    b');
    assert.equal(sel.from, 5);
});

test('tabIndent: shift-tab on an unindented line is a no-op', () => {
    const state = stateFor('ab', 1, 1);
    assert.equal(computeTabIndent(state, true), null);
});

test('tabIndent: multi-line selection delegates to multiLineIndent', () => {
    const state = stateFor('one\ntwo', 0, 7);
    const { doc } = apply(state, computeTabIndent(state, false));
    assert.equal(doc, '    one\n    two');
});

test('enclosingListItem: finds the ancestor from the marker line', () => {
    const doc = '- one\n- two\n';
    const state = stateFor(doc, 0);
    assert.ok(enclosingListItem(state, 0));
    assert.ok(enclosingListItem(state, doc.indexOf('- two')));
});

test('enclosingListItem: finds the ancestor from a wrapped continuation line', () => {
    const doc = '- one\n  continued\n';
    const state = stateFor(doc, 0);
    assert.ok(enclosingListItem(state, doc.indexOf('  continued')));
});

test('enclosingListItem: null for a plain paragraph', () => {
    const state = stateFor('just text', 0);
    assert.equal(enclosingListItem(state, 0), null);
});

test('enclosingListItem: null for a blank line between loose-list items', () => {
    const doc = '- one\n\n- two\n';
    const state = stateFor(doc, 0);
    assert.equal(enclosingListItem(state, 6), null); // the blank line itself
});

test('listItemDepth: 0 for plain text, increases one level per nesting', () => {
    assert.equal(listItemDepth(stateFor('plain', 0), 0), 0);
    const flat = '- one\n';
    assert.equal(listItemDepth(stateFor(flat, 0), 0), 1);
    const nested = '- one\n    - two\n';
    assert.equal(listItemDepth(stateFor(nested, 0), nested.indexOf('two')), 2);
});

test('tabIndent: list-aware — mid-line Tab nests the item under its preceding sibling by exactly the marker width (2 for "- "), preserving cursor offset', () => {
    const doc = '- one\n- two three\n';
    const pos = doc.indexOf('ree'); // mid-word, inside "three"
    const state = stateFor(doc, pos);
    const { doc: newDoc, sel } = apply(state, computeTabIndent(state, false));
    assert.equal(newDoc, '- one\n  - two three\n');
    assert.equal(sel.from, pos + 2);
});

test('tabIndent: list-aware — Shift-Tab outdents a nested item back to a sibling, symmetrically', () => {
    const doc = '- one\n  - two three\n';
    const pos = doc.indexOf('ree');
    const state = stateFor(doc, pos);
    const { doc: newDoc, sel } = apply(state, computeTabIndent(state, true));
    assert.equal(newDoc, '- one\n- two three\n');
    assert.equal(sel.from, pos - 2);
});

test('tabIndent: list-aware — Shift-Tab on an already-flush list line is a true no-op', () => {
    const doc = '- one two\n';
    const state = stateFor(doc, doc.indexOf('wo'));
    assert.equal(computeTabIndent(state, true), null);
});

test('tabIndent: list-aware — Tab is disabled (no-op) when there is no preceding sibling to nest under', () => {
    // Regression: the very first/only item in a list has nothing to nest
    // under — naively adding 4 spaces turns it into an indented CodeBlock,
    // silently destroying the list item. Must be a true no-op instead.
    const doc = '- one two\n';
    const state = stateFor(doc, doc.indexOf('wo'));
    assert.equal(computeTabIndent(state, false), null);
});

test('tabIndent: list-aware — an ordered-list item nests correctly under its preceding sibling by exactly the marker width (3 for "1. "), and its own digit resets to 1 since it becomes the first child of a brand-new nested list', () => {
    const doc = '1. one\n2. two three\n';
    const pos = doc.indexOf('ree');
    const state = stateFor(doc, pos);
    const { doc: newDoc, sel } = apply(state, computeTabIndent(state, false));
    assert.equal(newDoc, '1. one\n   1. two three\n');
    assert.equal(sel.from, pos + 3);
});

test('tabIndent: list-aware — nesting under a sibling that already has its own nested list appends without touching the moved item\'s digit (only the first child\'s digit seeds numbering)', () => {
    const doc = '1. one\n2. two\n   1. sub-a\n3. three\n';
    const pos = doc.indexOf('ree');
    const state = stateFor(doc, pos);
    const { doc: newDoc, sel } = apply(state, computeTabIndent(state, false));
    assert.equal(newDoc, '1. one\n2. two\n   1. sub-a\n   3. three\n');
    assert.equal(sel.from, pos + 3);
});

test('tabIndent: list-aware — a second consecutive Tab press on an ordered-list item is disabled: it is already the only item at its depth, nothing to nest under', () => {
    const doc = '1. one\n   1. two three\n';
    const pos = doc.indexOf('ree');
    const state = stateFor(doc, pos);
    assert.equal(computeTabIndent(state, false), null);
});

test('tabIndent: list-aware — a second consecutive Tab press on the same line is disabled: it is already the only item at its depth, nothing to nest under', () => {
    // Regression: this used to be framed as "overshoots CommonMark's relative-
    // indent tolerance" back when Tab added a flat 4 spaces regardless of marker
    // width; now that the step is exactly the marker width, a second Tab is
    // still disabled, but for the ordinary reason — the once-nested item is an
    // only child, with no sibling at its new depth to nest under.
    const doc = '- one\n  - two three\n';
    const pos = doc.indexOf('ree');
    const state = stateFor(doc, pos);
    assert.equal(computeTabIndent(state, false), null);
});

test('tabIndent: list-aware — a wrapped continuation line indents too, by its own item\'s marker width', () => {
    const doc = '- one\n  continued line\n';
    const pos = doc.indexOf('nued'); // mid-word, inside "continued"
    const state = stateFor(doc, pos);
    const { doc: newDoc, sel } = apply(state, computeTabIndent(state, false));
    assert.equal(newDoc, '- one\n    continued line\n');
    assert.equal(sel.from, pos + 2);
});

test('tabIndent: non-list line is unaffected by the list-aware path', () => {
    const state = stateFor('plain text', 5);
    const { doc, sel } = apply(state, computeTabIndent(state, false));
    assert.equal(doc, 'plain     text');
    assert.equal(sel.from, 9);
});

test('multiLineListAwareIndent: selecting two sibling items nests both under the preceding item, together', () => {
    const doc = '- top\n- one\n- two';
    const state = stateFor(doc, doc.indexOf('- one'), doc.length);
    const { doc: newDoc, sel } = apply(state, computeMultiLineListAwareIndent(state, false));
    assert.equal(newDoc, '- top\n  - one\n  - two');
    assert.deepEqual([sel.from, sel.to], [doc.indexOf('- one') + 2, newDoc.length]);
});

test('multiLineListAwareIndent: outdents multiple nested siblings back to top-level, symmetrically', () => {
    const doc = '- top\n  - one\n  - two';
    const state = stateFor(doc, doc.indexOf('- one'), doc.length);
    const { doc: newDoc, sel } = apply(state, computeMultiLineListAwareIndent(state, true));
    assert.equal(newDoc, '- top\n- one\n- two');
});

test('multiLineListAwareIndent: best-effort — an item with no sibling to nest under is left in place, the rest still move', () => {
    // "only" is the first (and only) item in the whole list: nothing to nest it under,
    // ever. It must not block "two", which has a real neighbor ("only") to nest under.
    const doc = '- only\n- two';
    const state = stateFor(doc, 0, doc.length);
    const { doc: newDoc } = apply(state, computeMultiLineListAwareIndent(state, false));
    assert.equal(newDoc, '- only\n  - two');
});

test('multiLineListAwareIndent: selecting an ENTIRE flat list nests every item but the first one under it', () => {
    const doc = '- one\n- two\n- three\n- four';
    const state = stateFor(doc, 0, doc.length);
    const { doc: newDoc } = apply(state, computeMultiLineListAwareIndent(state, false));
    assert.equal(newDoc, '- one\n  - two\n  - three\n  - four');
});

test('multiLineListAwareIndent: sibling ordered items across the single/double-digit boundary shift by the SAME width, no jagged misalignment', () => {
    const items = [];
    for (let i = 1; i <= 12; i++) { items.push(`${i}. item${i}`); }
    const doc = items.join('\n');
    const state = stateFor(doc, doc.indexOf('item10'), doc.indexOf('item11') + 'item11'.length);
    const { doc: newDoc } = apply(state, computeMultiLineListAwareIndent(state, false));
    const newLines = newDoc.split('\n');
    assert.equal(newLines[9], '   1. item10'); // first nested under item9 seeds at 1
    assert.equal(newLines[10], '   11. item11'); // same step width, digit untouched as non-first child
});

test('multiLineListAwareIndent: mixed selection — list marker lines get list-aware shift, plain lines keep the flat shift', () => {
    const doc = '- zero\n- top\n- one\n\npara';
    const state = stateFor(doc, doc.indexOf('- top'), doc.length);
    const { doc: newDoc } = apply(state, computeMultiLineListAwareIndent(state, false));
    assert.equal(newDoc, '- zero\n  - top\n  - one\n    \n    para');
});

test('multiLineListAwareIndent: a wrapped continuation line inside the selection rides along at its own item\'s marker width', () => {
    const doc = '- top\n- one\n  continued line';
    const state = stateFor(doc, doc.indexOf('- one'), doc.length);
    const { doc: newDoc } = apply(state, computeMultiLineListAwareIndent(state, false));
    assert.equal(newDoc, '- top\n  - one\n    continued line');
});

test('multiLineListAwareIndent: selection with no list items at all behaves exactly like the flat multi-line indent', () => {
    const state = stateFor('one\ntwo', 0, 7);
    const { doc, sel } = apply(state, computeMultiLineListAwareIndent(state, false));
    assert.equal(doc, '    one\n    two');
    assert.deepEqual([sel.from, sel.to], [4, 15]);
});

test('multiLineListAwareIndent: nesting two sibling ordered items under a parent resets only the first mover\'s digit to 1', () => {
    const doc = '1. one\n2. two\n3. three';
    const state = stateFor(doc, doc.indexOf('2. two'), doc.length);
    const { doc: newDoc } = apply(state, computeMultiLineListAwareIndent(state, false));
    assert.equal(newDoc, '1. one\n   1. two\n   3. three');
});

test('multiLineListAwareIndent: mixed-depth selection moves as one rigid unit, preserving the gap between levels', () => {
    // "two" and "three" are depth-1 siblings; "three-a" is already one level deeper
    // than "three". All three selected together: "three-a" must keep its +1 relative
    // depth versus "three", not get left behind at its old absolute depth.
    const doc = '- one\n- two\n- three\n  - three-a';
    const state = stateFor(doc, doc.indexOf('- two'), doc.length);
    const { doc: newDoc } = apply(state, computeMultiLineListAwareIndent(state, false));
    assert.equal(newDoc, '- one\n  - two\n  - three\n    - three-a');
});

test('multiLineListAwareIndent: a 3-level ancestor chain selected together shifts uniformly, gaps intact', () => {
    const doc = '- a\n- b\n  - b1\n    - b1a';
    const state = stateFor(doc, doc.indexOf('- b'), doc.length);
    const { doc: newDoc } = apply(state, computeMultiLineListAwareIndent(state, false));
    assert.equal(newDoc, '- a\n  - b\n    - b1\n      - b1a');
});

test('multiLineListAwareIndent: outdenting a mixed-depth selection is symmetric', () => {
    const doc = '- one\n  - two\n  - three\n    - three-a';
    const state = stateFor(doc, doc.indexOf('two'), doc.length);
    const { doc: newDoc } = apply(state, computeMultiLineListAwareIndent(state, true));
    assert.equal(newDoc, '- one\n- two\n- three\n  - three-a');
});

test('multiLineListAwareIndent: a child rides along with its parent — if the parent can\'t move, neither does the child', () => {
    // "three" is the very first item overall: it can never have a sibling above it.
    // "three-a" (its only child) must not independently nest deeper on its own.
    const doc = '- three\n  - three-a';
    const state = stateFor(doc, 0, doc.length);
    assert.equal(computeMultiLineListAwareIndent(state, false), null);
});

test('duplicateLine: duplicates the current line below, keeping cursor offset', () => {
    const state = stateFor('hello\nworld', 2, 2);
    const { doc, sel } = apply(state, computeDuplicateLine(state));
    assert.equal(doc, 'hello\nhello\nworld');
    assert.equal(sel.from, 8);
});

test('deleteLine: removes the line and its newline', () => {
    const state = stateFor('one\ntwo\nthree', 5, 5);
    const { doc, sel } = apply(state, computeDeleteLine(state));
    assert.equal(doc, 'one\nthree');
    assert.equal(sel.from, 4);
});

test('deleteLine: removing the last line drops the preceding newline instead', () => {
    const state = stateFor('one\ntwo', 5, 5);
    const { doc, sel } = apply(state, computeDeleteLine(state));
    assert.equal(doc, 'one');
    assert.equal(sel.from, 3);
});

test('moveLineUp: swaps the current line with the previous one', () => {
    const state = stateFor('one\ntwo', 5, 5);
    const { doc, sel } = apply(state, computeMoveLineUp(state)!);
    assert.equal(doc, 'two\none');
    assert.equal(sel.from, 1);
});

test('moveLineUp: no-op at the top of the document', () => {
    const state = stateFor('one\ntwo', 1, 1);
    assert.equal(computeMoveLineUp(state), null);
});

test('moveLineDown: swaps the current line with the next one', () => {
    const state = stateFor('one\ntwo', 1, 1);
    const { doc, sel } = apply(state, computeMoveLineDown(state)!);
    assert.equal(doc, 'two\none');
    assert.equal(sel.from, 5);
});

test('moveLineDown: no-op at the bottom of the document', () => {
    const state = stateFor('one\ntwo', 5, 5);
    assert.equal(computeMoveLineDown(state), null);
});

test('selectWord: expands a collapsed cursor to the surrounding word', () => {
    const state = stateFor('foo bar-baz qux', 6, 6);
    const spec = computeSelectWord(state);
    const sel = apply(state, spec).sel;
    assert.deepEqual([sel.from, sel.to], [4, 11]);
});

test('transformCase: upper/lower/title', () => {
    const state = stateFor('hello world', 0, 11);
    assert.equal(apply(state, computeTransformCase(state, 'upper')).doc, 'HELLO WORLD');
    assert.equal(apply(state, computeTransformCase(state, 'lower')).doc, 'hello world');
    assert.equal(apply(state, computeTransformCase(state, 'title')).doc, 'Hello World');
});

test('sortSelectedLines: ascending and descending', () => {
    const state = stateFor('banana\napple\ncherry', 0, 19);
    assert.equal(apply(state, computeSortSelectedLines(state, false)).doc, 'apple\nbanana\ncherry');
    assert.equal(apply(state, computeSortSelectedLines(state, true)).doc, 'cherry\nbanana\napple');
});

test('trimTrailingWhitespace: strips trailing spaces/tabs on every line', () => {
    const state = stateFor('one  \ntwo\t\nthree', 0, 0);
    const { doc } = apply(state, computeTrimTrailingWhitespace(state));
    assert.equal(doc, 'one\ntwo\nthree');
});

test('trimTrailingWhitespace: no-op when nothing to trim', () => {
    const state = stateFor('one\ntwo', 0, 0);
    assert.equal(computeTrimTrailingWhitespace(state), null);
});

test('computeJumpToLine: moves cursor to the requested line', () => {
    const state = stateFor('one\ntwo\nthree', 0, 0);
    const { sel } = apply(state, computeJumpToLine(state, 3));
    assert.equal(sel.from, state.doc.line(3).from);
});
