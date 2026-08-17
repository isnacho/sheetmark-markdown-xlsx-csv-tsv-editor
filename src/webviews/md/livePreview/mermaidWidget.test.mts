import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { isMermaidFence } from './mermaidDetection.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
}

function mermaidFenceCount(state: EditorState, tree = syntaxTree(state)): number {
    let count = 0;
    tree.iterate({
        enter(node) {
            if (node.name === 'FencedCode' && isMermaidFence(state, node.node)) {
                count++;
            }
        },
    });
    return count;
}

test('samples/test.md: mermaid fence is only visible after full syntax parse', () => {
    const doc = readFileSync('samples/test.md', 'utf8');
    const state = stateFor(doc);

    assert.ok(syntaxTree(state).length < doc.length);
    assert.equal(mermaidFenceCount(state), 0);

    const fullTree = ensureSyntaxTree(state, doc.length, 5000);
    assert.ok(fullTree);
    assert.equal(fullTree!.length, doc.length);
    assert.equal(mermaidFenceCount(state, fullTree!), 1);
});
