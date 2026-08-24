// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { computeCodeDecorations } from './codeStyling.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown()] });
}

interface FlatDeco { from: number; to: number; class: string | undefined; }

function decorate(doc: string): FlatDeco[] {
    const state = stateFor(doc);
    const set = computeCodeDecorations(state, [{ from: 0, to: doc.length }]);
    const out: FlatDeco[] = [];
    set.between(0, doc.length, (from, to, value) => {
        out.push({ from, to, class: (value.spec as { class?: string }).class });
    });
    return out;
}

test('inline code gets a mark decoration over the whole span including backticks', () => {
    const doc = 'see `const x = 1` here';
    const decos = decorate(doc);
    assert.deepEqual(decos, [
        { from: 4, to: 17, class: 'cm-md-inline-code' },
    ]);
});

test('fenced code gets a line decoration on every line, fences included', () => {
    const doc = 'before\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nafter';
    const decos = decorate(doc);
    // Lines: 1 "before", 2 "", 3 ```js, 4 const a, 5 const b, 6 ```, 7 "", 8 after
    const lines = decos.map(d => d.from);
    assert.deepEqual(lines, [8, 14, 27, 40]); // line starts for lines 3-6
    assert.equal(decos[0]?.class, 'cm-md-fenced-code-line cm-md-fenced-code-line-first cm-md-fenced-code-line-gap-before');
    assert.equal(decos[1]?.class, 'cm-md-fenced-code-line');
    assert.equal(decos[2]?.class, 'cm-md-fenced-code-line');
    assert.equal(decos[3]?.class, 'cm-md-fenced-code-line cm-md-fenced-code-line-last cm-md-fenced-code-line-gap-after');
});

test('no decorations for plain text with no code', () => {
    const doc = 'just a plain sentence';
    assert.deepEqual(decorate(doc), []);
});
