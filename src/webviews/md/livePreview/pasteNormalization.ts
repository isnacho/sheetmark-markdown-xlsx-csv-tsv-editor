// Clipboard paste normalization for Preview Edit.
//
// Runtime: WEBVIEW (browser). Pure helpers are headlessly testable; wired via
// EditorView.clipboardInputFilter and the paste domEventHandler in
// livePreviewEditor.ts.
//
// Copying a whole line usually puts a trailing `\n` on the clipboard. When the
// editor selection ends at `line.to` (line text only, no break — gutter click,
// Shift+Cmd+Arrow line boundary, etc.), a naive replace inserts that `\n`
// before the line's existing break → blank line. CM6 triple-click / selectLine
// include the break and do not hit this path.

import { EditorState } from '@codemirror/state';

/** True when `to` sits immediately after a `\n` in the selected range. */
export function selectionIncludesTrailingLineBreak(state: EditorState, from: number, to: number): boolean {
    return to > from && to <= state.doc.length && state.sliceDoc(to - 1, to) === '\n';
}

/**
 * Drop redundant trailing newline(s) from clipboard text for the current selection.
 * Returns the text unchanged when no normalization applies.
 */
export function normalizeClipboardPasteText(state: EditorState, text: string): string {
    if (!text) { return text; }
    text = text.replace(/\r\n?/g, '\n');

    const sel = state.selection.main;
    if (sel.empty || sel.from >= sel.to) { return text; }

    const includesBreak = selectionIncludesTrailingLineBreak(state, sel.from, sel.to);
    if (!includesBreak && text.endsWith('\n')) {
        return text.slice(0, -1);
    }
    if (includesBreak && text.endsWith('\n\n')) {
        return text.slice(0, -1);
    }
    return text;
}
