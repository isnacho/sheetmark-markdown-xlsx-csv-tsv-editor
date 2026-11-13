// Keeps the cursor out from under the floating stats pill (bottom right). Runtime: WEBVIEW.
//
// The pill is fixed over the editor, so when typing or arrowing down near the bottom of the
// window, CodeMirror's default few pixels of scroll margin left the cursor's line behind it.
// This tells CodeMirror to keep that much room at the bottom when it scrolls the cursor into view.

import { EditorView } from '@codemirror/view';

/**
 * Room to keep below the cursor: from the pill's top edge to the bottom of what is visible, plus a
 * gap. The visible bottom is the editor's bottom or the window's, whichever is higher: with the
 * toolbar not sticky the whole page scrolls and the editor box runs far below the window, and
 * measuring from its bottom asked for hundreds of pixels, so every arrow key scrolled the page.
 * Never more than a quarter of the window, whatever the layout.
 */
export function bottomClearance(pill: DOMRect | null, scrollerBottom: number, windowHeight: number, gap = 8): number {
    if (!pill || pill.width === 0 || pill.height === 0) { return 0; }
    const visibleBottom = Math.min(scrollerBottom, windowHeight);
    return Math.min(Math.max(0, visibleBottom - pill.top + gap), windowHeight / 4);
}

export const statusBarScrollMargins = EditorView.scrollMargins.of((view) => {
    const pill = document.getElementById('statusInfo');
    return { bottom: bottomClearance(pill?.getBoundingClientRect() ?? null, view.scrollDOM.getBoundingClientRect().bottom, window.innerHeight) };
});
