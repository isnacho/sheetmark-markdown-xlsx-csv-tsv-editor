// Cmd/Ctrl+Arrow paragraph navigation for CM6 Preview Edit mode.
//
// Runtime: WEBVIEW (browser). Pure compute helpers are headlessly testable;
// the keymap wires in livePreviewEditor.ts.
//
// CM6's defaultKeymap binds macOS Cmd+Arrow to cursorLineBoundaryLeft/Right,
// which step through soft-wrap visual lines. VS Code (and user expectation for
// block-style editing) uses line/paragraph boundaries instead — end of the
// markdown Paragraph node, or the document line when no Paragraph wraps the
// cursor (headings, etc.).

import { EditorState, EditorSelection, Prec } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

export interface ParagraphBounds {
    from: number;
    to: number;
}

/** Markdown Paragraph enclosing `pos`, else the document line at `pos`. */
export function computeParagraphBounds(state: EditorState, pos: number): ParagraphBounds {
    const tree = syntaxTree(state);
    const node = tree.resolve(pos, 1);
    for (let n: SyntaxNode | null = node; n; n = n.parent) {
        if (n.name === 'Paragraph') {
            return { from: n.from, to: n.to };
        }
    }
    const line = state.doc.lineAt(pos);
    return { from: line.from, to: line.to };
}

export function computeParagraphBoundarySelection(
    state: EditorState,
    toStart: boolean,
): TransactionSpec {
    const sel = state.selection.main;
    const { from, to } = computeParagraphBounds(state, sel.head);
    const target = toStart ? from : to;
    const selection = sel.empty
        ? EditorSelection.cursor(target, toStart ? 1 : -1)
        : EditorSelection.range(sel.anchor, target);
    return {
        selection,
        effects: EditorView.scrollIntoView(target),
    };
}

function runParagraphBoundary(view: EditorView, toStart: boolean): boolean {
    view.dispatch(computeParagraphBoundarySelection(view.state, toStart));
    return true;
}

export const cursorParagraphStart = (view: EditorView) => runParagraphBoundary(view, true);
export const cursorParagraphEnd = (view: EditorView) => runParagraphBoundary(view, false);
export const selectParagraphStart = (view: EditorView) => runParagraphBoundary(view, true);
export const selectParagraphEnd = (view: EditorView) => runParagraphBoundary(view, false);

export const paragraphNavigationKeymap = Prec.high(keymap.of([
    { mac: 'Cmd-ArrowLeft', run: cursorParagraphStart, shift: selectParagraphStart, preventDefault: true },
    { mac: 'Cmd-ArrowRight', run: cursorParagraphEnd, shift: selectParagraphEnd, preventDefault: true },
]));
