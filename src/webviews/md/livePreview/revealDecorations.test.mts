// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.
// One case per mark type x cursor-in/out (per the plan's Phase 4 exit bar), plus
// the nested ***bold-italic*** overlap hazard called out in the plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { computeRevealDecorations } from './revealDecorations.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown()] });
}

interface FlatDeco { from: number; to: number; class: string | undefined; }

function decorate(doc: string, selFrom: number, selTo = selFrom): FlatDeco[] {
    const state = stateFor(doc);
    const set = computeRevealDecorations(state, selFrom, selTo, [{ from: 0, to: doc.length }]);
    const out: FlatDeco[] = [];
    set.between(0, doc.length, (from, to, value) => {
        out.push({ from, to, class: (value.spec as { class?: string }).class });
    });
    return out;
}

test('heading: cursor away hides "#" and its gap space, applies heading-size class to the text', () => {
    const doc = '# Title\n\nbody';
    const decos = decorate(doc, doc.indexOf('body'));
    assert.deepEqual(decos, [
        { from: 0, to: 1, class: undefined }, // "#" marker
        { from: 1, to: 2, class: undefined }, // the grammar's implicit one-space gap
        { from: 2, to: 7, class: 'cm-md-heading-content cm-md-h1' },
    ]);
});

test('heading: cursor on the heading line shows "#" dimmed but KEEPS the size styling', () => {
    const doc = '# Title\n\nbody';
    const decos = decorate(doc, doc.indexOf('Title'));
    assert.deepEqual(decos, [
        { from: 0, to: 1, class: 'cm-md-reveal-mark' },
        { from: 2, to: 7, class: 'cm-md-heading-content cm-md-h1' },
    ]);
});

test('bold: cursor away hides both ** and bolds the content', () => {
    const doc = 'plain **bold** plain';
    const decos = decorate(doc, 0);
    assert.deepEqual(decos, [
        { from: 6, to: 8, class: undefined },
        { from: 8, to: 12, class: 'cm-md-strong-content' },
        { from: 12, to: 14, class: undefined },
    ]);
});

test('bold: cursor inside shows both ** dimmed but KEEPS the bold styling', () => {
    const doc = 'plain **bold** plain';
    const decos = decorate(doc, doc.indexOf('bold'));
    assert.deepEqual(decos, [
        { from: 6, to: 8, class: 'cm-md-reveal-mark' },
        { from: 8, to: 12, class: 'cm-md-strong-content' },
        { from: 12, to: 14, class: 'cm-md-reveal-mark' },
    ]);
});

test('italic: cursor away hides both * and italicizes the content', () => {
    const doc = 'plain *italic* plain';
    const decos = decorate(doc, 0);
    assert.deepEqual(decos, [
        { from: 6, to: 7, class: undefined },
        { from: 7, to: 13, class: 'cm-md-em-content' },
        { from: 13, to: 14, class: undefined },
    ]);
});

test('italic: cursor inside shows both * dimmed but KEEPS the italic styling', () => {
    const doc = 'plain *italic* plain';
    const decos = decorate(doc, doc.indexOf('italic'));
    assert.deepEqual(decos, [
        { from: 6, to: 7, class: 'cm-md-reveal-mark' },
        { from: 7, to: 13, class: 'cm-md-em-content' },
        { from: 13, to: 14, class: 'cm-md-reveal-mark' },
    ]);
});

test('nested ***bold-italic***: outer emphasis and inner strong both reveal independently', () => {
    // lezer resolves *** as an outer 1-char-marked Emphasis wrapping a 2-char-marked
    // StrongEmphasis (confirmed by walking the tree), not the other way around —
    // either nesting order exercises the same "handle overlap" hazard from the plan.
    const doc = 'xx ***wow*** xx';
    const decos = decorate(doc, 0); // cursor in the leading "xx", away from *** entirely
    const classes = decos.map(d => d.class);
    assert.ok(classes.includes('cm-md-em-content'), 'expected the outer emphasis content styling');
    assert.ok(classes.includes('cm-md-strong-content'), 'expected the inner strong content styling');
    const hidden = decos.filter(d => d.class === undefined);
    assert.ok(hidden.some(d => d.to - d.from === 1), 'expected the outer 1-char * to be hidden');
    assert.ok(hidden.some(d => d.to - d.from === 2), 'expected the inner 2-char ** to be hidden');
});

test('nested ***bold-italic***: cursor inside dims all four marks but keeps both content styles', () => {
    const doc = 'xx ***wow*** xx';
    const decos = decorate(doc, doc.indexOf('wow'));
    const marks = decos.filter(d => d.class === 'cm-md-reveal-mark');
    assert.equal(marks.length, 4); // 2 outer marks + 2 inner marks, all dimmed
    const classes = decos.map(d => d.class);
    assert.ok(classes.includes('cm-md-em-content'), 'expected the outer emphasis content styling to persist');
    assert.ok(classes.includes('cm-md-strong-content'), 'expected the inner strong content styling to persist');
});
