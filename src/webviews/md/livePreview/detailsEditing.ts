// Pure compute functions for creating and restructuring toggle blocks (same compute-then-dispatch
// shape as calloutEditing.ts). Runtime: WEBVIEW.

import { Annotation, EditorSelection } from '@codemirror/state';
import type { EditorState, Text, TransactionSpec } from '@codemirror/state';
import type { DetailsBlock } from './detailsTypes';

export const HEADING_RE = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
export const FENCE_RE = /^\s*(```|~~~)/;

/** Marks our own transactions that intentionally change toggle markup, so the structure guard lets them through. */
export const structureEdit = Annotation.define<boolean>();

const HEAD_TO_TITLE = '<details open>\n<summary>\n\n';

export function isBlankLine(text: string): boolean {
    return text.trim() === '';
}

/** Full text of an open toggle. An empty `body` leaves one empty line to type in. */
export function toggleText(title: string, body: string): { text: string; titleOffset: number; bodyOffset: number } {
    const head = `${HEAD_TO_TITLE}${title}\n\n</summary>\n\n`;
    const tail = body === '' ? '\n</details>' : `${body}\n\n</details>`;
    return { text: head + tail, titleOffset: HEAD_TO_TITLE.length, bodyOffset: head.length };
}

/** Slash-menu snippet: an empty open toggle with `titlePrefix` (e.g. "## ") already in the title. */
export function toggleSlashSnippet(titlePrefix: string): { insert: string; cursorOffset: number } {
    const { text, titleOffset } = toggleText(titlePrefix, '');
    return { insert: text, cursorOffset: titleOffset + titlePrefix.length };
}

/** Last non-blank line of the section under a heading of `level`: runs to the next heading of the same or higher level. */
export function sectionEndLine(doc: Text, headingLine: number, level: number): number {
    let endNo = headingLine;
    let inFence = false;
    for (let n = headingLine + 1; n <= doc.lines; n++) {
        const text = doc.line(n).text;
        if (FENCE_RE.test(text)) { inFence = !inFence; }
        if (!inFence) {
            const next = HEADING_RE.exec(text);
            if (next && next[1].length <= level) { break; }
        }
        if (!isBlankLine(text)) { endNo = n; }
    }
    return endNo;
}

/** Turn a toggle back into ordinary blocks: the title, then the body, with no markup left. */
export function computeUnwrapToggle(state: EditorState, block: DetailsBlock): TransactionSpec {
    const { doc } = state;
    const title = block.legacy
        ? block.title
        : doc.sliceString(block.titleFrom, block.titleTo);
    const body = block.bodyFrom === null ? '' : doc.sliceString(block.bodyFrom, block.bodyTo!).replace(/^\s*\n/, '').replace(/\s+$/, '');
    const from = doc.line(block.openLine).from;
    return {
        changes: { from, to: doc.line(block.closeLine).to, insert: body ? `${title}\n\n${body}` : title },
        selection: EditorSelection.cursor(from),
    };
}

/** Remove the whole toggle: title, body and markup. */
export function computeDeleteToggle(state: EditorState, block: DetailsBlock): TransactionSpec {
    const { doc } = state;
    const to = block.closerRun.to;
    const from = to === doc.length && block.headRun.from > 0 ? block.headRun.from - 1 : block.headRun.from;
    return { changes: { from, to, insert: '' }, selection: EditorSelection.cursor(from) };
}

/** Write or remove the `open` attribute: the only action that edits it. */
export function computeSetStartOpen(state: EditorState, block: DetailsBlock, open: boolean): TransactionSpec | null {
    const line = state.doc.line(block.openLine);
    const match = /^(\s*)<details((?:\s[^>]*)?)>\s*$/i.exec(line.text);
    if (!match) { return null; }
    const attrs = match[2].replace(/\s*\bopen\b/gi, '').trimEnd();
    const next = `${match[1]}<details${attrs}${open ? ' open' : ''}>`;
    return { changes: { from: line.from, to: line.to, insert: next } };
}
