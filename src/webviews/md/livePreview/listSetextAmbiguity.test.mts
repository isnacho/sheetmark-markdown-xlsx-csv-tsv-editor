import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { isSetextUnderlineListMarker, setextListMarkerLineAt } from './listSetextAmbiguity.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
}

function firstSetext(state: EditorState): SyntaxNode | null {
    let node: SyntaxNode | null = null;
    syntaxTree(state).iterate({
        enter(n) {
            if (!node && (n.name === 'SetextHeading1' || n.name === 'SetextHeading2')) {
                node = n.node;
            }
        },
    });
    return node;
}

test('isSetextUnderlineListMarker: paragraph + "- " is a list marker, not setext styling', () => {
    const state = stateFor('some text\n- ');
    const node = firstSetext(state);
    assert.ok(node);
    assert.equal(isSetextUnderlineListMarker(state, node!), true);
});

test('isSetextUnderlineListMarker: lone "-" while typing counts as list marker', () => {
    const state = stateFor('some text\n-');
    const node = firstSetext(state);
    assert.ok(node);
    assert.equal(isSetextUnderlineListMarker(state, node!), true);
});

test('isSetextUnderlineListMarker: real setext underline "---" or "====" is not a list marker', () => {
    for (const doc of ['some text\n---', 'some text\n====']) {
        const state = stateFor(doc);
        const node = firstSetext(state);
        assert.ok(node, doc);
        assert.equal(isSetextUnderlineListMarker(state, node!), false, doc);
    }
});

test('isSetextUnderlineListMarker: "--" while typing before the space is a list marker', () => {
    for (const doc of ['some text\n--', 'some text\n-- ']) {
        const state = stateFor(doc);
        const node = firstSetext(state);
        assert.ok(node, doc);
        assert.equal(isSetextUnderlineListMarker(state, node!), true, doc);
    }
});

test('isSetextUnderlineListMarker: blank line before "- " is a real bullet list (no setext node)', () => {
    const state = stateFor('some text\n\n- ');
    assert.equal(firstSetext(state), null);
});

test('setextListMarkerLineAt: finds the marker line while the cursor is on "- "', () => {
    const doc = 'some text\n- ';
    const state = stateFor(doc);
    const at = setextListMarkerLineAt(state, doc.length - 1);
    assert.deepEqual(at, { lineFrom: doc.indexOf('-'), lineTo: doc.length, markFrom: doc.indexOf('-') });
});
