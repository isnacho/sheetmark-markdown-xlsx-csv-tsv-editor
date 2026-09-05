import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import {
    extractFenceBody,
    extractFenceLangName,
    fenceDisplayLang,
} from './fenceExtraction.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown()] });
}

function firstFencedCode(state: EditorState) {
    let found: { node: import('@lezer/common').SyntaxNode } | undefined;
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name === 'FencedCode' && !found) {
                found = { node: node.node };
            }
        },
    });
    return found;
}

test('extractFenceLangName and fenceDisplayLang', () => {
    const state = stateFor('```js\nconst x = 1;\n```');
    const fenced = firstFencedCode(state);
    assert.ok(fenced);
    assert.equal(extractFenceLangName(state, fenced!.node), 'js');
    assert.equal(fenceDisplayLang(state, fenced!.node), 'js');
});

test('fenceDisplayLang falls back to text when unlabeled', () => {
    const state = stateFor('```\nplain\n```');
    const fenced = firstFencedCode(state);
    assert.ok(fenced);
    assert.equal(extractFenceLangName(state, fenced!.node), '');
    assert.equal(fenceDisplayLang(state, fenced!.node), 'text');
});

test('extractFenceBody excludes fence delimiters', () => {
    const state = stateFor('```js\nconst a = 1;\nconst b = 2;\n```');
    const fenced = firstFencedCode(state);
    assert.ok(fenced);
    assert.equal(extractFenceBody(state, fenced!.node), 'const a = 1;\nconst b = 2;');
});

test('extractFenceBody returns empty string for empty fence', () => {
    const state = stateFor('```js\n```');
    const fenced = firstFencedCode(state);
    assert.ok(fenced);
    assert.equal(extractFenceBody(state, fenced!.node), '');
});
