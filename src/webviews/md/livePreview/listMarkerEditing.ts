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

/** ListItem marker through its trailing gap space (includes Task on checkbox lines). */
export function computeListItemPrefixRange(state: EditorState, item: SyntaxNode): VisibleRange | null {
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
    let to = underline.from + 1;
    if (text.length > 1 && text[1] === ' ') {
        to = underline.from + 2;
    } else {
        to = underline.to;
    }
    return { from: underline.from, to };
}

/** Every list-marker prefix span in the document (whole-doc scan for atomicRanges). */
export function computeListMarkerRanges(state: EditorState): VisibleRange[] {
    const ranges: VisibleRange[] = [];
    syntaxTree(state).iterate({
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

function findListPrefixEndingAt(state: EditorState, pos: number): VisibleRange | null {
    for (const range of computeListMarkerRanges(state)) {
        if (range.to === pos) { return range; }
    }
    return null;
}

function findListPrefixStartingAt(state: EditorState, pos: number): VisibleRange | null {
    for (const range of computeListMarkerRanges(state)) {
        if (range.from === pos) { return range; }
    }
    return null;
}

function findListPrefixOnLine(state: EditorState, lineNumber: number): VisibleRange | null {
    const line = state.doc.line(lineNumber);
    for (const range of computeListMarkerRanges(state)) {
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

    for (const range of computeListMarkerRanges(state)) {
        if (pos >= range.from && pos < range.to) {
            return { selection: EditorSelection.cursor(range.to) };
        }
    }

    const line = state.doc.lineAt(pos);
    const atLineEnd = pos === line.from + line.length;
    const arrowRightLeavesLine = pos + 1 === line.from + line.length;
    if ((atLineEnd || arrowRightLeavesLine) && line.number < state.doc.lines) {
        const nextPrefix = findListPrefixOnLine(state, line.number + 1);
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

function buildListMarkerAtomicRanges(state: EditorState): DecorationSet {
    const marker = Decoration.mark({});
    return Decoration.set(computeListMarkerRanges(state).map(r => marker.range(r.from, r.to)));
}

export const listMarkerAtomicRanges = EditorView.atomicRanges.of((view) => buildListMarkerAtomicRanges(view.state));

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
