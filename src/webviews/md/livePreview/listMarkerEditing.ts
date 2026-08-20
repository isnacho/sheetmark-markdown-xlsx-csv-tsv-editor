// List-marker atomic navigation and delete for CM6 Preview Edit.
//
// Runtime: WEBVIEW (browser). Pure compute helpers are headlessly testable;
// keymap + atomicRanges wire in livePreviewEditor.ts with reveal decorations.
//
// Treats each list item's marker prefix (ListMark or Task + gap space) as one
// cursor unit — Notion-style arrow-left from item text and one-press backspace.

import { EditorState, EditorSelection, Prec } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView, keymap, Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

export interface VisibleRange {
    from: number;
    to: number;
}

function isSetextUnderlineListMarkerLine(state: EditorState, setextNode: SyntaxNode): boolean {
    if (setextNode.name !== 'SetextHeading1' && setextNode.name !== 'SetextHeading2') { return false; }
    const line = state.doc.lineAt(setextNode.to - 1);
    const text = state.sliceDoc(line.from, line.to);
    if (/^={3,}\s*$/.test(text) || /^-{3,}\s*$/.test(text)) { return false; }
    if (/^[-*+]\s*$/.test(text)) { return true; }
    if (/^--\s?$/.test(text)) { return true; }
    return false;
}

/** Line text matches an activated list marker (trailing gap space present). */
export function listMarkerLineIsActivated(lineText: string): boolean {
    return /^\s*(?:[-*+]\s\[[ xX]\]\s|[-*+]\s(?!\[)|\d+[.)]\s)/.test(lineText);
}

/** True once the marker has its required trailing gap space (e.g. "1. ", "- ", "- [ ] "). */
export function listItemMarkerIsActivated(state: EditorState, item: SyntaxNode): boolean {
    if (item.name !== 'ListItem') { return false; }
    if (!item.getChild('ListMark')) { return false; }
    return listMarkerLineIsActivated(state.doc.lineAt(item.from).text);
}

/** ListItem marker through its trailing gap space (includes Task on checkbox lines). */
export function computeListItemPrefixRange(state: EditorState, item: SyntaxNode): VisibleRange | null {
    if (!listItemMarkerIsActivated(state, item)) { return null; }
    const mark = item.getChild('ListMark');
    if (!mark) { return null; }
    const taskMarker = item.getChild('Task')?.getChild('TaskMarker');
    let end = taskMarker ? taskMarker.to : mark.to;
    if (end < state.doc.length && state.sliceDoc(end, end + 1) === ' ') {
        end += 1;
    }
    return { from: mark.from, to: end };
}

function computeSetextListMarkerPrefix(state: EditorState, setextNode: SyntaxNode): VisibleRange | null {
    if (!isSetextUnderlineListMarkerLine(state, setextNode)) { return null; }
    const underline = state.doc.lineAt(setextNode.to - 1);
    const text = state.sliceDoc(underline.from, underline.to);
    if (!/^[-*+]/.test(text)) { return null; }
    const spaceIdx = text.search(/\s/);
    if (spaceIdx < 0) { return null; }
    return { from: underline.from, to: underline.from + spaceIdx + 1 };
}

/**
 * Every list-marker prefix span within `bounds` (defaults to the whole
 * document — used by tests and by the atomicRanges builder, which passes one
 * call per `view.visibleRanges` chunk instead of scanning the whole tree).
 */
export function computeListMarkerRanges(state: EditorState, bounds?: VisibleRange): VisibleRange[] {
    const ranges: VisibleRange[] = [];
    syntaxTree(state).iterate({
        from: bounds?.from,
        to: bounds?.to,
        enter(node) {
            if (node.name === 'ListItem') {
                const range = computeListItemPrefixRange(state, node.node);
                if (range) { ranges.push(range); }
            } else if (node.name === 'SetextHeading1' || node.name === 'SetextHeading2') {
                const range = computeSetextListMarkerPrefix(state, node.node);
                if (range) { ranges.push(range); }
            }
        },
    });
    return ranges;
}

// A marker always sits on the same line as the cursor position being tested
// against it, so the keymap handlers below only ever need that one line's
// worth of tree — not a full-document scan on every keypress.

function findListPrefixEndingAt(state: EditorState, pos: number): VisibleRange | null {
    const line = state.doc.lineAt(pos);
    for (const range of computeListMarkerRanges(state, { from: line.from, to: line.to })) {
        if (range.to === pos) { return range; }
    }
    return null;
}

function findListPrefixStartingAt(state: EditorState, pos: number): VisibleRange | null {
    const line = state.doc.lineAt(pos);
    for (const range of computeListMarkerRanges(state, { from: line.from, to: line.to })) {
        if (range.from === pos) { return range; }
    }
    return null;
}

function findListPrefixOnLine(state: EditorState, lineNumber: number): VisibleRange | null {
    const line = state.doc.line(lineNumber);
    for (const range of computeListMarkerRanges(state, { from: line.from, to: line.to })) {
        if (range.from >= line.from && range.from <= line.to) { return range; }
    }
    return null;
}

export function computeListMarkerBackspace(state: EditorState): TransactionSpec | null {
    const sel = state.selection.main;
    if (!sel.empty) { return null; }
    const prefix = findListPrefixEndingAt(state, sel.head);
    if (!prefix) { return null; }
    return {
        changes: { from: prefix.from, to: prefix.to },
        selection: EditorSelection.cursor(prefix.from),
    };
}

export function computeListMarkerDelete(state: EditorState): TransactionSpec | null {
    const sel = state.selection.main;
    if (!sel.empty) { return null; }
    const prefix = findListPrefixStartingAt(state, sel.head);
    if (!prefix) { return null; }
    return {
        changes: { from: prefix.from, to: prefix.to },
        selection: EditorSelection.cursor(prefix.from),
    };
}

export function computeListMarkerArrowLeft(state: EditorState): TransactionSpec | null {
    const sel = state.selection.main;
    if (!sel.empty) { return null; }
    const prefix = findListPrefixEndingAt(state, sel.head)
        ?? findListPrefixStartingAt(state, sel.head);
    if (!prefix) { return null; }
    const line = state.doc.lineAt(sel.head);
    if (line.number <= 1) { return null; }
    const prev = state.doc.line(line.number - 1);
    return { selection: EditorSelection.cursor(prev.from + prev.length) };
}

/** Skip marker prefix — land at item text start, never before the visible marker. */
export function computeListMarkerArrowRight(state: EditorState): TransactionSpec | null {
    const sel = state.selection.main;
    if (!sel.empty) { return null; }
    const pos = sel.head;
    const posLine = state.doc.lineAt(pos);

    for (const range of computeListMarkerRanges(state, { from: posLine.from, to: posLine.to })) {
        if (pos >= range.from && pos < range.to) {
            return { selection: EditorSelection.cursor(range.to) };
        }
    }

    const atLineEnd = pos === posLine.from + posLine.length;
    const arrowRightLeavesLine = pos + 1 === posLine.from + posLine.length;
    if ((atLineEnd || arrowRightLeavesLine) && posLine.number < state.doc.lines) {
        const nextPrefix = findListPrefixOnLine(state, posLine.number + 1);
        if (nextPrefix) {
            return { selection: EditorSelection.cursor(nextPrefix.to) };
        }
    }

    return null;
}

function runListMarkerBackspace(view: EditorView): boolean {
    const spec = computeListMarkerBackspace(view.state);
    if (!spec) { return false; }
    view.dispatch(spec);
    return true;
}

function runListMarkerDelete(view: EditorView): boolean {
    const spec = computeListMarkerDelete(view.state);
    if (!spec) { return false; }
    view.dispatch(spec);
    return true;
}

function runListMarkerArrowLeft(view: EditorView): boolean {
    const spec = computeListMarkerArrowLeft(view.state);
    if (!spec) { return false; }
    view.dispatch(spec);
    return true;
}

function runListMarkerArrowRight(view: EditorView): boolean {
    const spec = computeListMarkerArrowRight(view.state);
    if (!spec) { return false; }
    view.dispatch(spec);
    return true;
}

function buildListMarkerAtomicRanges(view: EditorView): DecorationSet {
    const marker = Decoration.mark({});
    const ranges: VisibleRange[] = [];
    for (const { from, to } of view.visibleRanges) {
        ranges.push(...computeListMarkerRanges(view.state, { from, to }));
    }
    return Decoration.set(ranges.map(r => marker.range(r.from, r.to)));
}

export const listMarkerAtomicRanges = EditorView.atomicRanges.of((view) => buildListMarkerAtomicRanges(view));

export const listMarkerKeymap = Prec.highest(keymap.of([
    { key: 'Backspace', run: runListMarkerBackspace },
    { key: 'Delete', run: runListMarkerDelete },
    { key: 'ArrowLeft', run: runListMarkerArrowLeft },
    { key: 'ArrowRight', run: runListMarkerArrowRight },
]));

export const listMarkerBoundaryExtensions = [
    listMarkerKeymap,
    listMarkerAtomicRanges,
];
