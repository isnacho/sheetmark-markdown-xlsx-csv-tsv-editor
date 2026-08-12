import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import {
    isMermaidFenceContent,
    isMermaidFence,
    extractMermaidSource,
} from './mermaidDetection.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
}

function firstFencedCode(state: EditorState) {
    let found: ReturnType<typeof syntaxTree> extends infer _T ? { from: number; to: number; node: import('@lezer/common').SyntaxNode } | null : never = null;
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name === 'FencedCode' && !found) {
                found = { from: node.from, to: node.to, node: node.node };
            }
        },
    });
    return found;
}

test('isMermaidFenceContent: mermaid and flowchart language tags', () => {
    assert.equal(isMermaidFenceContent('mermaid', 'graph TD\n  A --> B'), true);
    assert.equal(isMermaidFenceContent('flowchart', 'graph LR\n  A --> B'), true);
});

test('isMermaidFenceContent: unlabeled gantt, sequence, and graph directives', () => {
    assert.equal(isMermaidFenceContent('', 'gantt\ntitle A'), true);
    assert.equal(isMermaidFenceContent('', 'sequenceDiagram\n  A->>B: hi'), true);
    assert.equal(isMermaidFenceContent('', 'graph TD\n  A --> B'), true);
    assert.equal(isMermaidFenceContent('', 'graph LR;\n  A --> B'), true);
});

test('isMermaidFenceContent: negative cases', () => {
    assert.equal(isMermaidFenceContent('js', 'const x = 1;'), false);
    assert.equal(isMermaidFenceContent('', 'plain text'), false);
    assert.equal(isMermaidFenceContent('', 'graphviz\n  digraph {}'), false);
});

test('isMermaidFence detects a fenced block in CM6 syntax tree', () => {
    const doc = 'intro\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nafter';
    const state = stateFor(doc);
    const fenced = firstFencedCode(state);
    assert.ok(fenced);
    assert.equal(isMermaidFence(state, fenced!.node), true);
    assert.equal(extractMermaidSource(state, fenced!.node), 'graph TD\n  A --> B');
});

test('isMermaidFence rejects a normal js fence', () => {
    const doc = '```js\nconsole.log(1);\n```';
    const state = stateFor(doc);
    const fenced = firstFencedCode(state);
    assert.ok(fenced);
    assert.equal(isMermaidFence(state, fenced!.node), false);
});
