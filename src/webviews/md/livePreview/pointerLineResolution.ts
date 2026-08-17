// Map a screen Y coordinate to a document line position using DOM line
// elements when possible, otherwise `lineBlockAtHeight` + `documentTop`.

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
