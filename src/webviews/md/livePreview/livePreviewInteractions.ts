// CM6 click-interaction detection for the Markdown "Preview Edit" mode.
//
// Runtime: WEBVIEW (browser). No Node / no `vscode` module here.
//
// Legacy Preview Edit renders real HTML: <a> for links, <img class="zoomable">
// for images, a small "#" anchor icon after each heading, a hover copy button
// on each fenced code block. CM6 shows raw markdown text, so none of those
// elements exist to click. Rather than build hover-affordance widgets (that's
// decoration-layer machinery that lands with the reveal engine, Phase 4),
// this ports the underlying ACTIONS onto a Ctrl/Cmd+Click convention: plain
// click keeps CM6's normal "place the caret" behavior (this is an editable
// text surface now, unlike the old non-editable render), Ctrl/Cmd+Click runs
// the link-open / image-lightbox / copy-heading-link / copy-code action.
//
// This module only answers "what markdown construct is at this position" via
// the @lezer/markdown syntax tree — it knows nothing about postMessage,
// clipboard, or the lightbox. mdWebview.ts owns those side effects (it already
// has documentUri, resolvedImageUriCache, showLightbox, etc.) and just
// switches on the Cm6Interaction this returns.

import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

export type Cm6Interaction =
    | { kind: 'link'; href: string }
    | { kind: 'image'; src: string }
    | { kind: 'heading'; line: number }
    | { kind: 'code'; text: string };

const HEADING_NODE_NAMES = new Set([
    'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
    'SetextHeading1', 'SetextHeading2',
]);

export function detectInteractionAtPos(state: EditorState, pos: number): Cm6Interaction | null {
    const leaf = syntaxTree(state).resolveInner(pos, 1);
    for (let node: SyntaxNode | null = leaf; node; node = node.parent) {
        if (node.name === 'Link') {
            const url = node.getChild('URL');
            return url ? { kind: 'link', href: state.doc.sliceString(url.from, url.to) } : null;
        }
        if (node.name === 'Image') {
            const url = node.getChild('URL');
            return url ? { kind: 'image', src: state.doc.sliceString(url.from, url.to) } : null;
        }
        if (HEADING_NODE_NAMES.has(node.name)) {
            return { kind: 'heading', line: state.doc.lineAt(node.from).number };
        }
        if (node.name === 'FencedCode') {
            const codeParts = node.getChildren('CodeText');
            if (codeParts.length === 0) {return { kind: 'code', text: '' };}
            const from = codeParts[0].from;
            const to = codeParts[codeParts.length - 1].to;
            return { kind: 'code', text: state.doc.sliceString(from, to) };
        }
    }
    return null;
}
