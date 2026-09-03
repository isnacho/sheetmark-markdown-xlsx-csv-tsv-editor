// List-marker atomic navigation and delete for CM6 Preview Edit.
//
// Runtime: WEBVIEW (browser). Pure compute helpers are headlessly testable;
// keymap + atomicRanges wire in livePreviewEditor.ts with reveal decorations.
//
// Treats each list item's marker prefix (ListMark or Task + gap space) as one
// cursor unit — Notion-style arrow-left from item text and one-press backspace.

import { EditorState, EditorSelection, Prec } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { insertNewlineContinueMarkupCommand, deleteMarkupBackward } from '@codemirror/lang-markdown';
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

/** True when a blank line separates two sibling list items in the source. */
export function listItemsSeparatedByBlankLine(state: EditorState, prev: SyntaxNode, next: SyntaxNode): boolean {
    if (next.from <= prev.to) { return false; }
    return /\n(?:[ \t]*\n)/.test(state.sliceDoc(prev.to, next.from));
}

/** First ListItem in the numbering segment that contains `item` (resets after blank lines). */
export function numberingSegmentStartItem(state: EditorState, item: SyntaxNode): SyntaxNode {
    let start = item;
    for (let sib = item.prevSibling; sib; sib = sib.prevSibling) {
        if (sib.name !== 'ListItem') { continue; }
        if (listItemsSeparatedByBlankLine(state, sib, start)) { break; }
        start = sib;
    }
    return start;
}

/** 0-based index of `item` within its numbering segment (resets after blank lines). */
export function listItemPositionInSegment(state: EditorState, item: SyntaxNode): number {
    const segmentStart = numberingSegmentStartItem(state, item);
    let index = 0;
    for (let sib: SyntaxNode | null = segmentStart; sib; sib = sib.nextSibling) {
        if (sib.name !== 'ListItem') { continue; }
        if (sib.from === item.from) { return index; }
        index++;
    }
    return index;
}

/** Parses the segment-start item's typed starting number (drops the trailing "."/")" ). */
export function orderedListStartNumber(state: EditorState, item: SyntaxNode): number {
    const segmentStart = numberingSegmentStartItem(state, item);
    const prev = segmentStart.prevSibling;
    if (prev?.name === 'ListItem' && listItemsSeparatedByBlankLine(state, prev, segmentStart)) {
        return 1;
    }
    const mark = segmentStart.getChild('ListMark');
    if (!mark) { return 1; }
    const n = parseInt(state.sliceDoc(mark.from, mark.to - 1), 10);
    return Number.isFinite(n) ? n : 1;
}

function enclosingListItem(state: EditorState, pos: number): SyntaxNode | null {
    const line = state.doc.lineAt(pos);
    const probe = pos > line.from && pos === line.to ? pos - 1 : pos;
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(probe, 1); node; node = node.parent) {
        if (node.name === 'ListItem') { return node; }
    }
    return null;
}

/** Activated list line with marker prefix only — no item text yet. */
export function isEmptyActivatedListItem(lineText: string): boolean {
    return /^\s*(?:\d+[.)]\s*|[-*+]\s(?:\[[ xX]\]\s)?)$/.test(lineText);
}

/** Fallback when insertNewlineContinueMarkup returns false on an activated list line. */
export function computeManualListContinuation(state: EditorState): TransactionSpec | null {
    const sel = state.selection.main;
    if (!sel.empty) { return null; }

    const line = state.doc.lineAt(sel.head);
    if (!listMarkerLineIsActivated(line.text)) { return null; }
    if (sel.head !== line.to) { return null; }

    const item = enclosingListItem(state, sel.head);
    if (!item) { return null; }

    const prefix = computeListItemPrefixRange(state, item);
    if (!prefix) { return null; }

    if (isEmptyActivatedListItem(line.text)) {
        return {
            changes: { from: prefix.from, to: line.to, insert: '\n' },
            selection: EditorSelection.cursor(prefix.from + 1),
        };
    }

    const mark = item.getChild('ListMark');
    if (!mark) { return null; }

    const linePrefix = state.sliceDoc(line.from, mark.from);
    const task = item.getChild('Task');

    if (item.parent?.name === 'OrderedList') {
        const nextNum = orderedListStartNumber(state, item) + listItemPositionInSegment(state, item) + 1;
        const delimiter = state.sliceDoc(mark.to - 1, mark.to);
        const insert = '\n' + linePrefix + String(nextNum) + delimiter + ' ';
        return {
            changes: { from: sel.head, insert },
            selection: EditorSelection.cursor(sel.head + insert.length),
        };
    }

    const bulletMarker = task ? '- [ ] ' : state.sliceDoc(mark.from, mark.to) + ' ';
    const insert = '\n' + linePrefix + bulletMarker;
    return {
        changes: { from: sel.head, insert },
        selection: EditorSelection.cursor(sel.head + insert.length),
    };
}

/**
 * ListItem marker through its trailing gap space (includes Task on checkbox
 * lines) — starting from the LINE's own start, not just the marker's own
 * start, so a nested item's literal leading indentation spaces are part of
 * this one atomic unit too. Without that, clicking in the (now visually much
 * wider, since the hanging-indent CSS reserves a real column there) gutter to
 * the left of a nested marker resolved to a cursor position inside those
 * leading spaces — nothing rendered there to click on, but a valid document
 * position all the same. Folding them into the atomic prefix range makes
 * such a click resolve to the nearest real boundary (line start or the
 * item's own text start) instead of parking a cursor in a visually empty gap.
 */
export function computeListItemPrefixRange(state: EditorState, item: SyntaxNode): VisibleRange | null {
    if (!listItemMarkerIsActivated(state, item)) { return null; }
    const mark = item.getChild('ListMark');
    if (!mark) { return null; }
    const taskMarker = item.getChild('Task')?.getChild('TaskMarker');
    let end = taskMarker ? taskMarker.to : mark.to;
    if (end < state.doc.length && state.sliceDoc(end, end + 1) === ' ') {
        end += 1;
    }
    return { from: state.doc.lineAt(mark.from).from, to: end };
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

const insertNewlineContinueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

export function runLivePreviewEnter(view: EditorView): boolean {
    if (insertNewlineContinueMarkup(view)) { return true; }
    const spec = computeManualListContinuation(view.state);
    if (!spec) { return false; }
    view.dispatch(spec);
    return true;
}

export const livePreviewMarkdownKeymap = Prec.high(keymap.of([
    { key: 'Enter', run: runLivePreviewEnter },
    { key: 'Backspace', run: deleteMarkupBackward },
]));
