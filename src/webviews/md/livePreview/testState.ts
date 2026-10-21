// Test-only helper (imported by *.test.mts, never by the bundle).
//
// CM6 parses within a 20 ms budget per state/transaction and keeps a partial tree when it runs out.
// A cold first parse in a busy test process can exceed that, so syntaxTree(state) comes back
// incomplete and tree-based assertions flake. Tests build states through this to get a full tree.

import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';

/** `state` with its syntax tree parsed to the end of the document. */
export function fullyParsed(state: EditorState): EditorState {
    ensureSyntaxTree(state, state.doc.length, 10_000);
    // ensureSyntaxTree advances the parse context; an empty update publishes that tree to syntaxTree().
    return state.update({}).state;
}
