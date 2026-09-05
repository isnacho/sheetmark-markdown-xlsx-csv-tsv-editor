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
        out.push({
            from,
            to,
            class: (value.spec as { class?: string }).class,
        });
    });
    return out;
}

function classAtLine(decos: FlatDeco[], doc: string, lineNumber: number): string | undefined {
    const lines = doc.split('\n');
    let offset = 0;
    for (let i = 0; i < lineNumber - 1; i++) {
        offset += lines[i].length + 1;
    }
    return decos.find((d) => d.from === offset)?.class;
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
    assert.equal(
        classAtLine(decos, doc, 3),
        'cm-md-fenced-code-line cm-md-fenced-code-line-first cm-md-fenced-code-line-gap-before',
    );
    assert.equal(classAtLine(decos, doc, 4), 'cm-md-fenced-code-line');
    assert.equal(classAtLine(decos, doc, 5), 'cm-md-fenced-code-line');
    assert.equal(
        classAtLine(decos, doc, 6),
        'cm-md-fenced-code-line cm-md-fenced-code-line-last cm-md-fenced-code-line-gap-after',
    );
});

test('gap-after class stays on the closing fence line, not the line below', () => {
    const doc = 'before\n\n```js\nconst a = 1;\n```\n\nafter';
    assert.equal(
        classAtLine(decorate(doc), doc, 5),
        'cm-md-fenced-code-line cm-md-fenced-code-line-last cm-md-fenced-code-line-gap-after',
    );
    assert.equal(classAtLine(decorate(doc), doc, 6), undefined);
});

test('no decorations for plain text with no code', () => {
    const doc = 'just a plain sentence';
    assert.deepEqual(decorate(doc), []);
});
