// DOM-accurate click positioning for CM6 Preview Edit.
//
// CM6's height map ignores CSS margins on decorated lines and replace widgets
// (see line-number-gutter-alignment QA / codemirror/dev#1164). `posAtCoords`
// can land one line low while the painted text sits higher. Resolve the target
// row from the clicked `.cm-line` element instead, then map the column with the
// browser caret API.
//
// Double-click selects the whole line (overriding CM6's default word select).
// Single-click still corrects row alignment when the height map drifts.

import { EditorSelection } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { closestCmLineElement, computeLineClickSelection } from './pointerLineResolution';

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
    if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(x, y);
        if (range) { return { node: range.startContainer, offset: range.startOffset }; }
    }
    const legacy = (document as Document & {
        caretPositionFromPoint?: (px: number, py: number) => { offsetNode: Node; offset: number } | null;
    }).caretPositionFromPoint;
    if (legacy) {
        const pos = legacy(x, y);
        if (pos) { return { node: pos.offsetNode, offset: pos.offset }; }
    }
    return null;
}

/** Document position for a content click, or null when not on a text line. */
export function resolveContentClickPos(view: EditorView, event: MouseEvent): number | null {
    const lineEl = closestCmLineElement(view, event.target);
    if (!lineEl) { return null; }

    let lineFrom: number;
    try {
        lineFrom = view.posAtDOM(lineEl, 0);
    } catch {
        return null;
    }
    const line = view.state.doc.lineAt(lineFrom);

    const caret = caretFromPoint(event.clientX, event.clientY);
    if (caret) {
        try {
            const pos = view.posAtDOM(caret.node, caret.offset);
            if (view.state.doc.lineAt(pos).number === line.number) {
                return pos;
            }
        } catch {
            // Caret node may sit outside the editor content subtree.
        }
    }

    const height = event.clientY - view.documentTop;
    const block = view.lineBlockAtHeight(height);
    if (view.state.doc.lineAt(block.from).number === line.number) {
        const lineBlock = view.lineBlockAt(line.from);
        const clampedHeight = Math.max(
            lineBlock.top + 1,
            Math.min(height, lineBlock.top + lineBlock.height - 1),
        );
        const colPos = view.posAtCoords({ x: event.clientX, y: view.documentTop + clampedHeight }, false);
        if (colPos !== null && view.state.doc.lineAt(colPos).number === line.number) {
            return colPos;
        }
    }

    return lineFrom;
}

/** When DOM row disagrees with `posAtCoords`, snap to the DOM row. */
export function computeContentClickCorrection(
    view: EditorView,
    event: MouseEvent,
): TransactionSpec | null {
    const corrected = resolveContentClickPos(view, event);
    if (corrected === null) { return null; }

    const rough = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (rough !== null && view.state.doc.lineAt(rough).number === view.state.doc.lineAt(corrected).number) {
        return null;
    }

    if (event.shiftKey) {
        return { selection: EditorSelection.range(view.state.selection.main.anchor, corrected) };
    }
    return { selection: EditorSelection.cursor(corrected) };
}

function dispatchClickSpec(view: EditorView, spec: TransactionSpec): void {
    const head = view.state.update(spec).state.selection.main.head;
    view.dispatch({ ...spec, effects: EditorView.scrollIntoView(head) });
}

function runContentClick(view: EditorView, event: MouseEvent): boolean {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) {
        return false;
    }
    if (event.detail === 2) {
        const pos = resolveContentClickPos(view, event);
        if (pos === null) { return false; }
        dispatchClickSpec(view, computeLineClickSelection(view.state, pos, event.shiftKey));
        event.preventDefault();
        return true;
    }
    if (event.detail > 2) {
        return false;
    }
    const spec = computeContentClickCorrection(view, event);
    if (!spec) { return false; }
    dispatchClickSpec(view, spec);
    event.preventDefault();
    return true;
}

export const contentClickHandlers = EditorView.domEventHandlers({
    mousedown: (event, view) => runContentClick(view, event),
});

/** Row under the pointer for hover highlighting (content or gutter). */
export { resolveLinePosAtPointer as resolveHoverLinePos } from './pointerLineResolution';