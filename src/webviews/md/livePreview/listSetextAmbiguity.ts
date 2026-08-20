// Setext-heading vs bullet-list ambiguity (CommonMark).
//
// A single newline between paragraph text and a line like "- " is parsed as a
// Setext h2 underline, not a bullet list. While typing a list after a
// paragraph (without a blank line), that mis-parse makes the paragraph look
// like a heading and hides the bullet marker. These helpers detect when the
// Setext "underline" line is really a list marker so styling can prefer list UX.

import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { syntaxTree } from '@codemirror/language';

/** Text of the Setext underline line, or null when `node` is not Setext. */
export function getSetextUnderlineLineText(state: EditorState, node: SyntaxNode): string | null {
    if (node.name !== 'SetextHeading1' && node.name !== 'SetextHeading2') { return null; }
    const line = state.doc.lineAt(node.to - 1);
    return state.sliceDoc(line.from, line.to);
}

/**
 * True when a Setext node's underline line looks like a bullet-list marker
 * (`- `, `* `, `+ `, a lone marker, or `--` while typing) rather than a real
 * underline (`---`, `====`, …).
 */
export function isSetextUnderlineListMarker(state: EditorState, node: SyntaxNode): boolean {
    const text = getSetextUnderlineLineText(state, node);
    if (text === null) { return false; }
    // Real Setext underlines / horizontal rules — three or more repeated chars.
    if (/^={3,}\s*$/.test(text)) { return false; }
    if (/^-{3,}\s*$/.test(text)) { return false; }
    // Bullet marker, optional trailing space only (no content yet).
    if (/^[-*+]\s*$/.test(text)) { return true; }
    // Double dash before the space — common while typing "- ".
    if (/^--\s?$/.test(text)) { return true; }
    return false;
}

/** When `pos` sits on a Setext "underline" that is really a bullet marker, its line range. */
export function setextListMarkerLineAt(state: EditorState, pos: number): { lineFrom: number; lineTo: number; markFrom: number } | null {
    let found: { lineFrom: number; lineTo: number; markFrom: number } | null = null;
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name !== 'SetextHeading1' && node.name !== 'SetextHeading2') { return; }
            if (!isSetextUnderlineListMarker(state, node.node)) { return; }
            const underline = state.doc.lineAt(node.to - 1);
            if (pos < underline.from || pos > underline.to) { return; }
            const text = state.sliceDoc(underline.from, underline.to);
            if (!/^[-*+]/.test(text)) { return; }
            if (!/\s/.test(text)) { return; }
            found = { lineFrom: underline.from, lineTo: underline.to, markFrom: underline.from };
        },
    });
    return found;
}
