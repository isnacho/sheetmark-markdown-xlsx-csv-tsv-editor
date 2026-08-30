// Map a screen Y coordinate to a document line position using DOM line
// elements when possible, otherwise `lineBlockAtHeight` + `documentTop`.

import { EditorSelection } from '@codemirror/state';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

function closestCmLine(view: EditorView, target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Node)) { return null; }
    let el: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement;
    while (el && el !== view.contentDOM) {
        if (el.classList.contains('cm-line')) { return el; }
        el = el.parentElement;
    }
    return null;
}

/** Start position of the `.cm-line` row under the pointer (content or gutter). */
export function resolveLinePosAtPointer(
    view: EditorView,
    clientY: number,
    target: EventTarget | null,
): number {
    const lineEl = closestCmLine(view, target);
    if (lineEl) {
        try {
            return view.posAtDOM(lineEl, 0);
        } catch {
            // Fall through to height-based resolution.
        }
    }
    return view.lineBlockAtHeight(clientY - view.documentTop).from;
}

export function closestCmLineElement(view: EditorView, target: EventTarget | null): HTMLElement | null {
    return closestCmLine(view, target);
}

/** End position for a whole-line selection (CM6 `selectLine` / triple-click convention). */
export function lineSelectionEnd(line: { to: number }, docLength: number): number {
    return Math.min(line.to + 1, docLength);
}

/** Whole-line selection for triple-click (line text only — no trailing break). */
export function computeTripleClickLineSelection(
    state: EditorState,
    pos: number,
    shiftKey: boolean,
): TransactionSpec {
    const line = state.doc.lineAt(pos);
    if (shiftKey) {
        const anchor = state.selection.main.anchor;
        return { selection: EditorSelection.range(Math.min(anchor, line.from), Math.max(anchor, line.to)) };
    }
    return { selection: EditorSelection.range(line.from, line.to) };
}
