// DOM-accurate click and drag positioning for CM6 Preview Edit.
//
// CM6's height map ignores CSS margins on decorated lines and replace widgets
// (see line-number-gutter-alignment QA / codemirror/dev#1164). `posAtCoords`
// can land one line low while the painted text sits higher. Resolve the target
// row from the clicked `.cm-line` element instead, then map the column with the
// browser caret API.
//
// List lines (`.cm-md-list-line`) also carry a negative `text-indent` for the
// hanging-indent column. `posAtCoords` / `posAndSideAtCoords` map horizontal
// pointer coordinates against the raw source layout, not the painted indent, so
// drag-to-select on bullet text often snaps the anchor to the line start and
// feels like the whole line got selected. `listLineMouseSelectionStyle` below
// routes those gestures through the same DOM caret resolver as single clicks.
//
// Triple-click selects the whole line without the trailing break (CM6's default
// includes the newline, which bleeds into the next row and breaks paste).
// Double-click stays CM6 default (word select). Single-click still corrects row
// alignment when the height map drifts.

import { EditorSelection, Prec } from '@codemirror/state';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { SelectionRange } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { MouseSelectionStyle } from '@codemirror/view';
import { closestCmLineElement, computeTripleClickLineSelection } from './pointerLineResolution';

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

function isListLineElement(lineEl: HTMLElement | null): boolean {
    return lineEl?.classList.contains('cm-md-list-line') ?? false;
}

/** Selection range for a list-line click (single / double / triple). */
export function selectionRangeForListLineClick(state: EditorState, pos: number, clickDetail: number): SelectionRange {
    if (clickDetail >= 3) {
        const line = state.doc.lineAt(pos);
        return EditorSelection.range(line.from, line.to);
    }
    if (clickDetail === 2) {
        return state.wordAt(pos) ?? EditorSelection.cursor(pos);
    }
    return EditorSelection.cursor(pos);
}

function removeRangeAround(sel: EditorSelection, pos: number): EditorSelection | null {
    for (let i = 0; i < sel.ranges.length; i++) {
        const { from, to } = sel.ranges[i];
        if (from <= pos && to >= pos) {
            return EditorSelection.create(
                sel.ranges.slice(0, i).concat(sel.ranges.slice(i + 1)),
                sel.mainIndex === i ? 0 : sel.mainIndex - (sel.mainIndex > i ? 1 : 0),
            );
        }
    }
    return null;
}

function makeListLineMouseSelectionStyle(view: EditorView, event: MouseEvent): MouseSelectionStyle | null {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) {
        return null;
    }
    if (!isListLineElement(closestCmLineElement(view, event.target))) {
        return null;
    }
    const clickDetail = event.detail || 1;
    const initial = resolveContentClickPos(view, event);
    if (initial === null) { return null; }

    let startPos = initial;
    let startSel = view.state.selection;

    return {
        update(update) {
            if (update.docChanged) {
                startPos = update.changes.mapPos(startPos);
                startSel = startSel.map(update.changes);
            }
        },
        get(event, extend, multiple) {
            const curPos = resolveContentClickPos(view, event) ?? startPos;
            let range = selectionRangeForListLineClick(view.state, curPos, clickDetail);
            if (startPos !== curPos && !extend && clickDetail === 1) {
                const startRange = selectionRangeForListLineClick(view.state, startPos, clickDetail);
                const from = Math.min(startRange.from, range.from);
                const to = Math.max(startRange.to, range.to);
                range = EditorSelection.range(from, to);
            }
            if (extend) {
                return startSel.replaceRange(startSel.main.extend(range.from, range.to));
            }
            if (multiple && clickDetail === 1 && startSel.ranges.length > 1) {
                const removed = removeRangeAround(startSel, curPos);
                if (removed) { return removed; }
            }
            if (multiple) { return startSel.addRange(range); }
            return EditorSelection.create([range]);
        },
    };
}

/** DOM-accurate mouse selection on hanging-indent list lines. */
export const listLineMouseSelectionStyle = Prec.high(
    EditorView.mouseSelectionStyle.of(makeListLineMouseSelectionStyle),
);

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
    // List-line clicks and drags are owned by listLineMouseSelectionStyle.
    if (isListLineElement(closestCmLineElement(view, event.target))) {
        return false;
    }
    if (event.detail === 3) {
        const pos = resolveContentClickPos(view, event);
        if (pos === null) { return false; }
        dispatchClickSpec(view, computeTripleClickLineSelection(view.state, pos, event.shiftKey));
        event.preventDefault();
        return true;
    }
    if (event.detail !== 1) {
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