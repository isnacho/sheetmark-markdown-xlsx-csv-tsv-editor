// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.
// TableWidget is constructed but its DOM-only toDOM() is never called here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { computeTableDecorations, TableWidget } from './tableWidget.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
}

test('cursor away from the table replaces it with a TableWidget over its exact source range', () => {
    const doc = 'before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter';
    const state = stateFor(doc);
    const set = computeTableDecorations(state, 0, 0, [{ from: 0, to: doc.length }]);
    const found: { from: number; to: number; widget: TableWidget }[] = [];
    set.between(0, doc.length, (from, to, value) => {
        found.push({ from, to, widget: (value.spec as { widget: TableWidget }).widget });
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].from, 8);
    assert.equal(found[0].to, 37);
    assert.equal(found[0].widget.source, '| a | b |\n| - | - |\n| 1 | 2 |');
});

test('cursor inside the table produces no widget decoration', () => {
    const doc = 'before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter';
    const decos: unknown[] = [];
    const state = stateFor(doc);
    const cursor = doc.indexOf('| 1 | 2 |');
    computeTableDecorations(state, cursor, cursor, [{ from: 0, to: doc.length }])
        .between(0, doc.length, (from, to, value) => decos.push(value));
    assert.deepEqual(decos, []);
});

test('no decorations when there is no table', () => {
    const doc = 'just a plain paragraph with no pipes at all';
    const state = stateFor(doc);
    const decos: unknown[] = [];
    computeTableDecorations(state, 0, 0, [{ from: 0, to: doc.length }])
        .between(0, doc.length, (from, to, value) => decos.push(value));
    assert.deepEqual(decos, []);
});

test('TableWidget.eq treats identical source as equal, different source as not', () => {
    const a = new TableWidget('| a |\n| - |\n| 1 |');
    const b = new TableWidget('| a |\n| - |\n| 1 |');
    const c = new TableWidget('| a |\n| - |\n| 2 |');
    assert.equal(a.eq(b), true);
    assert.equal(a.eq(c), false);
});
