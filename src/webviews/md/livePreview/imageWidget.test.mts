import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import {
    computeImageDecorations,
    extractImageAlt,
    extractImageUrl,
    imageReplaceRange,
    setImageUriResolver,
} from './imageWidget.ts';

const mockResolver = {
    getResolved: () => undefined,
    requestResolve: () => { /* noop */ },
};

function stateFor(doc: string, cursor = 0): EditorState {
    setImageUriResolver(mockResolver);
    return EditorState.create({
        doc,
        selection: { anchor: cursor },
        extensions: [markdown({ extensions: GFM })],
    });
}

test('imageReplaceRange: standalone line uses full line block range', () => {
    const doc = '![icon](../icon.png)\n';
    const state = stateFor(doc);
    const tree = syntaxTree(state);
    let imageNode: { from: number; to: number; node: any } | null = null;
    tree.iterate({
        enter(node) {
            if (node.name === 'Image') {
                imageNode = { from: node.from, to: node.to, node: node.node };
            }
        },
    });
    assert.ok(imageNode);
    const range = imageReplaceRange(state, imageNode!.node);
    assert.equal(range.block, true);
    assert.equal(range.from, 0);
    assert.equal(range.to, doc.trimEnd().length);
});

test('computeImageDecorations: cursor away replaces standalone image', () => {
    const doc = '![icon](../icon.png)\n';
    const state = stateFor(doc, doc.length);
    const set = computeImageDecorations(state, doc.length, doc.length);
    const specs: { from: number; to: number }[] = [];
    set.between(0, doc.length, (from, to) => specs.push({ from, to }));
    assert.equal(specs.length, 1);
    assert.equal(specs[0].from, 0);
    assert.equal(specs[0].to, doc.trimEnd().length);
});

test('computeImageDecorations: cursor inside image does not replace', () => {
    const doc = '![icon](../icon.png)\n';
    const cursor = doc.indexOf('icon');
    const state = stateFor(doc, cursor);
    const set = computeImageDecorations(state, cursor, cursor);
    const specs: { from: number; to: number }[] = [];
    set.between(0, doc.length, (from, to) => specs.push({ from, to }));
    assert.equal(specs.length, 0);
});

test('extractImageUrl and extractImageAlt read URL and alt text', () => {
    const doc = 'text ![Super Viewer icon](../icon.png) tail';
    const state = stateFor(doc);
    const tree = syntaxTree(state);
    let imageNode: any = null;
    tree.iterate({
        enter(node) {
            if (node.name === 'Image') {
                imageNode = node.node;
            }
        },
    });
    assert.ok(imageNode);
    assert.equal(extractImageAlt(state, imageNode), 'Super Viewer icon');
    assert.equal(extractImageUrl(state, imageNode), '../icon.png');
});
