// Keeps the cursor out from under the floating stats pill (bottom right). Runtime: WEBVIEW.
//
// The pill is fixed over the editor, so when typing or arrowing down near the bottom of the
// window, CodeMirror's default few pixels of scroll margin left the cursor's line behind it.
// This tells CodeMirror to keep that much room at the bottom when it scrolls the cursor into view.

import { EditorView } from '@codemirror/view';

/** Room to keep below the cursor: from the pill's top edge to the editor's bottom, plus a gap. */
export function bottomClearance(pill: DOMRect | null, scrollerBottom: number, gap = 8): number {
    if (!pill || pill.width === 0 || pill.height === 0) { return 0; }
    return Math.max(0, scrollerBottom - pill.top + gap);
}

export const statusBarScrollMargins = EditorView.scrollMargins.of((view) => {
    const pill = document.getElementById('statusInfo');
    return { bottom: bottomClearance(pill?.getBoundingClientRect() ?? null, view.scrollDOM.getBoundingClientRect().bottom) };
});
