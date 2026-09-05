// CM6 click-interaction detection for the Markdown "Preview Edit" mode.
//
// Runtime: WEBVIEW (browser). No Node / no `vscode` module here.
//
// Legacy Preview Edit renders real HTML: <a> for links, <img class="zoomable">
// for images, a small "#" anchor icon after each heading, a hover copy button
// on each fenced code block. CM6 shows raw markdown text, so none of those
// elements exist to click. Rather than build hover-affordance widgets (that's
// decoration-layer machinery that lands with the reveal engine, Phase 4),
// link-open uses plain click when the link is collapsed (caret outside the
// link node — same active check as revealDecorations) and Ctrl/Cmd+Click
// always; image-lightbox / copy-heading-link / copy-code stay modifier-only.
// Plain click elsewhere keeps CM6's normal "place the caret" behavior.
//
// This module only answers "what markdown construct is at this position" via
// the @lezer/markdown syntax tree — it knows nothing about postMessage,
// clipboard, or the lightbox. mdWebview.ts owns those side effects (it already
// has documentUri, resolvedImageUriCache, showLightbox, etc.) and just
// switches on the Cm6Interaction this returns.

import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { extractFenceBody } from './fenceExtraction';

export type Cm6Interaction =
    | { kind: 'link'; href: string }
    | { kind: 'image'; src: string }
    | { kind: 'heading'; line: number }
    | { kind: 'code'; text: string };

const HEADING_NODE_NAMES = new Set([
    'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
    'SetextHeading1', 'SetextHeading2',
]);

function rangesIntersect(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
    return aFrom <= bTo && aTo >= bFrom;
}

/** Same half-open active rule as revealDecorations `isActive` — caret at node end is outside. */
function isConstructActive(state: EditorState, from: number, to: number): boolean {
    const selFrom = state.selection.main.from;
    const selTo = state.selection.main.to;
    if (selFrom === selTo) {
        return from <= selFrom && selFrom < to;
    }
    return rangesIntersect(selFrom, selTo, from, to);
}

function isInsideImage(state: EditorState, pos: number): boolean {
    const leaf = syntaxTree(state).resolveInner(pos, 1);
    for (let node: SyntaxNode | null = leaf; node; node = node.parent) {
        if (node.name === 'Image') { return true; }
    }
    return false;
}

/** Visible link label range — between "[" and "]", excluding the bracket marks. */
function linkLabelRange(node: SyntaxNode): { from: number; to: number } | null {
    const marks = node.getChildren('LinkMark');
    if (marks.length < 2) { return null; }
    const open = marks[0];
    const closeBracket = marks[1];
    if (open.to >= closeBracket.from) { return null; }
    return { from: open.to, to: closeBracket.from };
}

function isPosInLinkLabel(node: SyntaxNode, pos: number): boolean {
    const label = linkLabelRange(node);
    if (!label) { return false; }
    return label.from <= pos && pos < label.to;
}

/** Plain-click navigation target: a Link at `pos` whose syntax is currently collapsed. */
export function detectCollapsedLinkAtPos(state: EditorState, pos: number): { href: string } | null {
    if (isInsideImage(state, pos)) { return null; }
    const leaf = syntaxTree(state).resolveInner(pos, 1);
    for (let node: SyntaxNode | null = leaf; node; node = node.parent) {
        if (node.name === 'Link') {
            const url = node.getChild('URL');
            if (!url) { return null; }
            if (!isPosInLinkLabel(node, pos)) { return null; }
            if (isConstructActive(state, node.from, node.to)) { return null; }
            return { href: state.doc.sliceString(url.from, url.to) };
        }
    }
    return null;
}

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
            return { kind: 'code', text: extractFenceBody(state, node) };
        }
    }
    return null;
}
