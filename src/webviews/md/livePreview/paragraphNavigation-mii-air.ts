// Shift+Option+Arrow paragraph selection for CM6 Preview Edit mode.
//
// Runtime: WEBVIEW (browser). Pure compute helpers are headlessly testable;
// the keymap wires in livePreviewEditor.ts.
//
// Horizontal Cmd+Arrow is intentionally NOT overridden here — CM6's
// defaultKeymap already binds macOS Cmd+Arrow to cursorLineBoundaryLeft/Right
// (and Shift variants), which matches Apple's HIG ("Command" = line-boundary
// semantic unit). Option+Up/Down is also left alone: it's bound elsewhere
// (formatCommands.ts) to move the current line up/down. This module only
// adds Shift+Option+Up/Down, for "select to paragraph start/end" — the one
// piece of the HIG matrix CM6 doesn't provide out of the box.

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

/** Extends the selection from its anchor to the enclosing paragraph's start/end. */
export function computeParagraphBoundarySelection(
    state: EditorState,
    toStart: boolean,
): TransactionSpec {
    const sel = state.selection.main;
    const { from, to } = computeParagraphBounds(state, sel.head);
    const target = toStart ? from : to;
    return {
        selection: EditorSelection.range(sel.anchor, target),
        effects: EditorView.scrollIntoView(target),
    };
}

function runParagraphSelection(view: EditorView, toStart: boolean): boolean {
    view.dispatch(computeParagraphBoundarySelection(view.state, toStart));
    return true;
}

export const selectToParagraphStart = (view: EditorView) => runParagraphSelection(view, true);
export const selectToParagraphEnd = (view: EditorView) => runParagraphSelection(view, false);

export const paragraphSelectionKeymap = Prec.high(keymap.of([
    { key: 'Alt-Shift-ArrowUp', run: selectToParagraphStart, preventDefault: true },
    { key: 'Alt-Shift-ArrowDown', run: selectToParagraphEnd, preventDefault: true },
]));
