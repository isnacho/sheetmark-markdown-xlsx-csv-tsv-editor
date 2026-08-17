// Phase 5 — formatting commands for CM6 Preview Edit mode.
//
// Runtime: WEBVIEW (browser). Ports the Split-mode formatting helpers
// (mdWebview.ts wrapSelection/toggleLinePrefix/... — see AGENTS.md's
// "formatting commands" note in the plan doc) from an imperative
// mutate-`editor.value`-then-read model to CM6's compute-a-TransactionSpec-
// then-dispatch model. Each `computeXxx` function is a pure function of
// `EditorState` (headlessly testable, no `EditorView`/DOM); each is wrapped
// by `runFormatCommand`/`livePreviewFormatKeymap` for the two real call
// sites: toolbar clicks (mdWebview.ts `applyFormat`) and CM6-native
// keybindings (Tab/Shift-Tab, Mod+letter shortcuts).
//
// Enter-key list/blockquote continuation and smart Backspace are NOT ported
// here — `@codemirror/lang-markdown`'s `markdown({..})` already installs its
// own `markdownKeymap` (Enter -> insertNewlineContinueMarkup, Backspace ->
// deleteMarkupBackward) with `Prec.high`, which is strictly more capable than
// the legacy regex (it also continues blockquotes, which the legacy
// bullet/ordered/checkbox-only regex never did). Reusing it beats
// reimplementing it, same reasoning the plan already applied to the slash
// menu (`@codemirror/autocomplete` over a hand-rolled popup).

import { EditorState, EditorSelection, ChangeSet, Prec } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { KeyBinding } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

function safeSlice(state: EditorState, from: number, to: number): string {
    const len = state.doc.length;
    const f = Math.max(0, Math.min(from, len));
    const t = Math.max(f, Math.min(to, len));
    return state.sliceDoc(f, t);
}

// Mirrored from listSetextAmbiguity.ts — kept local so formatCommands.test.mts
// can load this file under Node's ESM resolver (no extensionless relative imports).
function setextListMarkerLineAt(state: EditorState, pos: number): boolean {
    let found = false;
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name !== 'SetextHeading1' && node.name !== 'SetextHeading2') { return; }
            const underline = state.doc.lineAt(node.to - 1);
            const text = state.sliceDoc(underline.from, underline.to);
            if (/^={3,}\s*$/.test(text) || /^-{3,}\s*$/.test(text)) { return; }
            if (!/^[-*+]\s*$/.test(text) && !/^--\s?$/.test(text)) { return; }
            if (pos >= underline.from && pos <= underline.to && /^[-*+]/.test(text)) { found = true; }
        },
    });
    return found;
}

function dispatchSpec(view: EditorView, spec: TransactionSpec | null): boolean {
    if (!spec) { return false; }
    view.dispatch(spec);
    return true;
}

// ===== Pure compute functions (headlessly testable) =====

export function computeWrapSelection(state: EditorState, before: string, after: string): TransactionSpec {
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);
    const bLen = before.length;
    const aLen = after.length;

    if (from >= bLen && safeSlice(state, from - bLen, from) === before && safeSlice(state, to, to + aLen) === after) {
        return {
            changes: { from: from - bLen, to: to + aLen, insert: selected },
            selection: EditorSelection.range(from - bLen, to - bLen),
        };
    }
    return {
        changes: { from, to, insert: before + selected + after },
        selection: EditorSelection.range(from + bLen, to + bLen),
    };
}

export function computeToggleLinePrefix(state: EditorState, prefix: string): TransactionSpec {
    const { from, to } = state.selection.main;
    const firstLineNum = state.doc.lineAt(from).number;
    const lastLineNum = state.doc.lineAt(to).number;

    if (firstLineNum === lastLineNum) {
        const line = state.doc.line(firstLineNum);
        const lineStart = line.from;
        const lineEnd = line.to;
        const lineContent = state.sliceDoc(lineStart, lineEnd);

        if (lineContent.startsWith(prefix)) {
            return {
                changes: { from: lineStart, to: lineStart + prefix.length, insert: '' },
                selection: EditorSelection.range(Math.max(lineStart, from - prefix.length), Math.max(lineStart, to - prefix.length)),
            };
        }

        let cleaned = lineContent;
        if (prefix.startsWith('#')) {
            cleaned = lineContent.replace(/^#{1,6}\s/, '');
        }
        const diff = prefix.length + cleaned.length - lineContent.length;
        return {
            changes: { from: lineStart, to: lineEnd, insert: prefix + cleaned },
            selection: EditorSelection.range(from + diff, to + diff),
        };
    }

    const lines: { from: number; to: number; text: string }[] = [];
    for (let lineNum = firstLineNum; lineNum <= lastLineNum; lineNum++) {
        const line = state.doc.line(lineNum);
        lines.push({ from: line.from, to: line.to, text: state.sliceDoc(line.from, line.to) });
    }

    const allHavePrefix = lines.every((line) => line.text.startsWith(prefix));
    const changes: { from: number; to: number; insert: string }[] = [];

    for (const line of lines) {
        if (allHavePrefix) {
            changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
            continue;
        }
        if (line.text.startsWith(prefix)) {
            continue;
        }
        let cleaned = line.text;
        if (prefix.startsWith('#')) {
            cleaned = line.text.replace(/^#{1,6}\s/, '');
        }
        changes.push({ from: line.from, to: line.to, insert: prefix + cleaned });
    }

    if (changes.length === 0) {
        return { changes: [] };
    }

    const changeSet = ChangeSet.of(changes, state.doc.length);
    return { changes, selection: state.selection.map(changeSet) };
}

export function computeInsertAtCursor(state: EditorState, text: string, cursorOffset?: number): TransactionSpec {
    const { from, to } = state.selection.main;
    const pos = cursorOffset !== undefined ? from + cursorOffset : from + text.length;
    return { changes: { from, to, insert: text }, selection: EditorSelection.cursor(pos) };
}

export function computeInsertLink(state: EditorState): TransactionSpec {
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);
    if (selected) {
        return {
            changes: { from, to, insert: '[' + selected + '](url)' },
            selection: EditorSelection.range(to + 3, to + 6),
        };
    }
    return {
        changes: { from, to, insert: '[text](url)' },
        selection: EditorSelection.range(from + 1, from + 5),
    };
}

/** Single-line clipboard text that should trigger paste-to-link (http(s):// or www.). */
export function isPasteableUrl(text: string): boolean {
    const url = text.trim();
    if (!url || /[\r\n]/.test(url)) { return false; }
    return /^(https?:\/\/|www\.)\S+$/i.test(url);
}

/** True when paste-linkify must fall through to a plain paste at this range. */
export function isPasteLinkifyBlocked(state: EditorState, from: number, to: number): boolean {
    if (isPosInPasteLinkifyProtectedContext(state, from)) { return true; }
    if (from !== to && isPosInPasteLinkifyProtectedContext(state, to)) { return true; }
    return false;
}

function isPosInPasteLinkifyProtectedContext(state: EditorState, pos: number): boolean {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
        if (node.name === 'InlineCode' || node.name === 'FencedCode') { return true; }
        if (node.name === 'Link' && pos >= node.from && pos <= node.to) { return true; }
    }
    return false;
}

/** Paste a URL as markdown link markup, or null to fall through to default paste. */
export function computePasteLink(state: EditorState, clipboardText: string): TransactionSpec | null {
    const url = clipboardText.trim();
    if (!isPasteableUrl(url)) { return null; }
    const { from, to } = state.selection.main;
    if (isPasteLinkifyBlocked(state, from, to)) { return null; }

    const selected = state.sliceDoc(from, to);
    const insert = selected ? `[${selected}](${url})` : `[${url}](${url})`;
    return {
        changes: { from, to, insert },
        selection: EditorSelection.cursor(from + insert.length),
    };
}

export function computeInsertImage(state: EditorState): TransactionSpec {
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);
    const alt = selected || 'alt text';
    const snippet = `![${alt}](image-url)`;
    return {
        changes: { from, to, insert: snippet },
        selection: EditorSelection.range(from + alt.length + 4, from + alt.length + 13),
    };
}

export function computeInsertTable(state: EditorState): TransactionSpec {
    const table = '\n|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n';
    return computeInsertAtCursor(state, table);
}

export function computeInsertHorizontalRule(state: EditorState): TransactionSpec {
    const { from } = state.selection.main;
    const before = from === 0 ? '' : '\n';
    return computeInsertAtCursor(state, before + '---\n');
}

export function computeToggleCodeBlock(state: EditorState): TransactionSpec {
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);

    if (selected.startsWith('```') && selected.endsWith('```')) {
        const inner = selected.slice(3, -3).replace(/^\n/, '').replace(/\n$/, '');
        return {
            changes: { from, to, insert: inner },
            selection: EditorSelection.range(from, from + inner.length),
        };
    }
    const body = selected || 'code';
    return {
        changes: { from, to, insert: '```\n' + body + '\n```' },
        selection: EditorSelection.range(from + 4, from + 4 + body.length),
    };
}

export function computeMultiLineIndent(state: EditorState, outdent: boolean): TransactionSpec {
    const { from, to } = state.selection.main;
    const blockFrom = state.doc.lineAt(from).from;
    const blockTo = state.doc.lineAt(to).to;
    const lines = state.sliceDoc(blockFrom, blockTo).split('\n');

    let firstLineShift = 0;
    let totalShift = 0;
    const newLines = lines.map((line, i) => {
        if (outdent) {
            if (line.startsWith('    ')) {
                if (i === 0) { firstLineShift = -4; }
                totalShift -= 4;
                return line.slice(4);
            } else if (line.startsWith('\t')) {
                if (i === 0) { firstLineShift = -1; }
                totalShift -= 1;
                return line.slice(1);
            }
            return line;
        }
        if (i === 0) { firstLineShift = 4; }
        totalShift += 4;
        return '    ' + line;
    });

    return {
        changes: { from: blockFrom, to: blockTo, insert: newLines.join('\n') },
        selection: EditorSelection.range(Math.max(blockFrom, from + firstLineShift), to + totalShift),
    };
}

/**
 * The nearest enclosing ListItem for a position at the start of a physical line — the
 * marker line itself, or a wrapped continuation line within that item's content. Same
 * "walk node.parent for a named ancestor" shape as revealDecorations.ts's
 * enclosingBlockquote.
 */
export function enclosingListItem(state: EditorState, pos: number): SyntaxNode | null {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
        if (node.name === 'ListItem') { return node; }
    }
    return null;
}

/** Count of ListItem ancestors at `pos` — how many list levels deep this position is. */
export function listItemDepth(state: EditorState, pos: number): number {
    let depth = 0;
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
        if (node.name === 'ListItem') { depth++; }
    }
    return depth;
}

/**
 * Column width of a ListItem's own marker + the whitespace before its content starts
 * (e.g. 2 for "- ", 3 for "1. ") — this is exactly the indent a child needs to nest
 * one level under it. Measured from the marker's own line, independent of that line's
 * leading indentation, so it's the same value regardless of nesting depth.
 */
function markerPrefixWidth(state: EditorState, item: SyntaxNode): number {
    const mark = item.getChild('ListMark');
    if (!mark) { return 4; }
    const markLine = state.doc.lineAt(mark.from);
    const afterMarker = state.sliceDoc(mark.to, markLine.to);
    const gap = /^[ \t]*/.exec(afterMarker)![0].length;
    return (mark.to - mark.from) + Math.max(1, gap);
}

/** The ListItem immediately before `item` in the same list, or null if it's the first. */
function previousSiblingListItem(item: SyntaxNode): SyntaxNode | null {
    const list = item.parent;
    if (!list) { return null; }
    let prev: SyntaxNode | null = null;
    for (let child = list.firstChild; child; child = child.nextSibling) {
        if (child.name !== 'ListItem') { continue; }
        if (child.from === item.from) { return prev; }
        prev = child;
    }
    return null;
}

/** The ListItem whose content contains `item`'s own list, or null if `item` is top-level. */
function parentListItem(item: SyntaxNode): SyntaxNode | null {
    const list = item.parent;
    const parent = list ? list.parent : null;
    return parent && parent.name === 'ListItem' ? parent : null;
}

function computeSingleLineIndentBy(state: EditorState, line: ReturnType<EditorState['doc']['lineAt']>, outdent: boolean, amount: number, cursorPos: number): TransactionSpec | null {
    if (outdent) {
        if (line.text.startsWith(' '.repeat(amount))) {
            return { changes: { from: line.from, to: line.from + amount, insert: '' }, selection: EditorSelection.cursor(Math.max(line.from, cursorPos - amount)) };
        }
        if (line.text.startsWith('\t')) {
            return { changes: { from: line.from, to: line.from + 1, insert: '' }, selection: EditorSelection.cursor(Math.max(line.from, cursorPos - 1)) };
        }
        return null;
    }
    return { changes: { from: line.from, to: line.from, insert: ' '.repeat(amount) }, selection: EditorSelection.cursor(cursorPos + amount) };
}

/**
 * Same shift as `computeSingleLineIndentBy`, plus resets this item's own typed digit to
 * "1" — used only when Tab is about to make this item the first (and so far only) child
 * of a brand-new nested list. Without this, the item keeps whatever digit it had at its
 * old (shallower) position — e.g. the 3rd top-level item is textually "3." — and because
 * `orderedListStartNumber` seeds a list's numbering from its first item's own digit, that
 * stale "3" would become the new nested list's start value, rendering "c." (depth-2 alpha)
 * instead of "a." for what is, positionally, the first item at that depth. Only the
 * lone-first-child case is wrong this way — an item appended to an EXISTING nested list
 * keeps its own digit untouched, since the numbering there is seeded from the existing
 * first child, not from the newly-appended item.
 */
function computeOrderedNestIndentBy(state: EditorState, line: ReturnType<EditorState['doc']['lineAt']>, mark: SyntaxNode, amount: number, cursorPos: number): TransactionSpec {
    const markFromRel = mark.from - line.from;
    const markToRel = mark.to - line.from;
    const delimiter = line.text.slice(markToRel - 1, markToRel);
    const rewrittenLine = line.text.slice(0, markFromRel) + '1' + delimiter + line.text.slice(markToRel);
    const insert = ' '.repeat(amount) + rewrittenLine;
    const shift = insert.length - line.text.length;
    return { changes: { from: line.from, to: line.to, insert }, selection: EditorSelection.cursor(cursorPos + shift) };
}

function rewriteOrderedMarkerDigitToOne(lineText: string, markFromRel: number, markToRel: number): string {
    const delimiter = lineText.slice(markToRel - 1, markToRel);
    return lineText.slice(0, markFromRel) + '1' + delimiter + lineText.slice(markToRel);
}

function shouldResetOrderedDigitForMultiLine(
    i: number,
    kinds: Array<'marker' | 'continuation' | 'ordinary'>,
    items: (SyntaxNode | null)[],
    neighbors: (SyntaxNode | null)[],
    movable: boolean[],
    outdent: boolean,
): boolean {
    if (outdent || kinds[i] !== 'marker' || !movable[i]) { return false; }
    const item = items[i];
    if (!item || item.parent?.name !== 'OrderedList') { return false; }
    if (!item.getChild('ListMark')) { return false; }
    const prev = neighbors[i];
    if (!prev) { return false; }
    if (prev.getChild('OrderedList') || prev.getChild('BulletList')) { return false; }
    const prevIndex = items.findIndex((it, idx) => kinds[idx] === 'marker' && it && it.from === prev.from);
    if (prevIndex !== -1 && prevIndex < i && movable[prevIndex]) { return false; }
    return true;
}

/** Prepend/strip `step` columns of leading whitespace on one line's text. `step <= 0` is a no-op. */
function shiftLineFlat(lineText: string, outdent: boolean, step: number): { text: string; shift: number } {
    if (step <= 0) { return { text: lineText, shift: 0 }; }
    if (outdent) {
        if (lineText.startsWith(' '.repeat(step))) { return { text: lineText.slice(step), shift: -step }; }
        if (lineText.startsWith('\t')) { return { text: lineText.slice(1), shift: -1 }; }
        return { text: lineText, shift: 0 };
    }
    return { text: ' '.repeat(step) + lineText, shift: step };
}

/**
 * List-aware, best-effort version of `computeMultiLineIndent` for a selection spanning
 * multiple lines.
 *
 * Marker lines split into "roots" (no marker-line ancestor within the same selection)
 * and "descendants" (their nearest list-item ancestor's own marker line IS also in the
 * selection). Only roots are independently eligible/ineligible: a root's own neighbor
 * (`previousSiblingListItem`/`parentListItem`) determines whether it CAN move at all —
 * "only" (the very first item overall) has none and is never eligible, regardless of
 * what any other line in the selection can do; roots at the same original depth share
 * one step (the first eligible root's neighbor width), so raw marker-text-width
 * differences within a sibling group (e.g. "9." vs "10.") don't produce a jagged shift.
 * A descendant never runs its own eligibility check — it simply inherits whatever its
 * nearest selected ancestor ends up doing (same exact column shift, or none). Shifting
 * an already-validly-nested descendant by the SAME amount as its ancestor always
 * preserves the relative gap between them, so the whole selected subtree moves as one
 * rigid unit, keeping pre-existing depth differences intact — selecting items at mixed
 * depths and pressing Tab moves everything down one level together, not just the
 * shallowest ones. Wrapped continuation lines ride along at their own item's marker
 * width unconditionally (no depth change, no validation needed); lines outside any
 * list item keep today's flat 4-space/tab shift, unconditionally, same as before.
 */
export function computeMultiLineListAwareIndent(state: EditorState, outdent: boolean): TransactionSpec | null {
    const { from, to } = state.selection.main;
    const firstLine = state.doc.lineAt(from);
    const lastLine = state.doc.lineAt(to);
    const lineNumbers: number[] = [];
    for (let n = firstLine.number; n <= lastLine.number; n++) { lineNumbers.push(n); }

    type Kind = 'marker' | 'continuation' | 'ordinary';
    const kinds: Kind[] = [];
    const items: (SyntaxNode | null)[] = [];
    for (const n of lineNumbers) {
        const line = state.doc.line(n);
        const contentOffset = line.text.length - line.text.trimStart().length;
        let item: SyntaxNode | null = null;
        let kind: Kind = 'ordinary';
        if (contentOffset < line.text.length) {
            item = enclosingListItem(state, line.from + contentOffset);
            if (item) {
                const mark = item.getChild('ListMark');
                kind = mark && state.doc.lineAt(mark.from).number === n ? 'marker' : 'continuation';
            }
        }
        kinds.push(kind);
        items.push(item);
    }

    // Nearest ancestor marker-line index (within THIS selection) for each marker line,
    // or -1 if none — i.e. this marker line is a "root" of its own chain in the batch.
    const parentMarkerIndex: number[] = items.map((item, i) => {
        if (kinds[i] !== 'marker') { return -1; }
        for (let p = parentListItem(item!); p; p = parentListItem(p)) {
            const j = items.findIndex((it, idx) => kinds[idx] === 'marker' && it && it.from === p!.from);
            if (j !== -1) { return j; }
        }
        return -1;
    });

    // Root eligibility: its OWN neighbor. Roots at the same original depth share one
    // step (the first eligible root's neighbor width) instead of each computing its own
    // immediate neighbor independently.
    const neighbors: (SyntaxNode | null)[] = items.map((item, i) => {
        if (kinds[i] !== 'marker' || parentMarkerIndex[i] !== -1) { return null; }
        return outdent ? parentListItem(item!) : previousSiblingListItem(item!);
    });

    const sharedStepByDepth = new Map<number, number>();
    for (let i = 0; i < kinds.length; i++) {
        if (!neighbors[i]) { continue; }
        const depth = listItemDepth(state, items[i]!.from);
        if (!sharedStepByDepth.has(depth)) { sharedStepByDepth.set(depth, markerPrefixWidth(state, neighbors[i]!)); }
    }

    const blockFrom = firstLine.from;
    const blockTo = lastLine.to;
    const originalBlock = state.sliceDoc(blockFrom, blockTo);
    const origLines = originalBlock.split('\n');

    const candidateStep = items.map((item, i) => (neighbors[i] ? sharedStepByDepth.get(listItemDepth(state, item!.from)) ?? 0 : 0));
    const movable = candidateStep.map((step) => step > 0);

    // Descendants never validate independently — they just mirror their nearest
    // selected ancestor's outcome (same shift, preserving the gap between them).
    // Ascending line order is safe: an ancestor's own marker line always comes before
    // its descendants' in a contiguous selection, so it's already resolved by the time
    // a later index copies from it.
    function propagateToDescendants(): void {
        for (let i = 0; i < kinds.length; i++) {
            const p = parentMarkerIndex[i];
            if (p !== -1) { candidateStep[i] = candidateStep[p]; movable[i] = movable[p]; }
        }
    }
    propagateToDescendants();

    function buildBlock(): { text: string; shifts: number[] } {
        const shifts: number[] = [];
        const resultLines = origLines.map((lineText, i) => {
            let text = lineText;
            if (shouldResetOrderedDigitForMultiLine(i, kinds, items, neighbors, movable, outdent)) {
                const item = items[i]!;
                const mark = item.getChild('ListMark')!;
                const line = state.doc.line(lineNumbers[i]);
                const markFromRel = mark.from - line.from;
                const markToRel = mark.to - line.from;
                text = rewriteOrderedMarkerDigitToOne(text, markFromRel, markToRel);
            }
            const step = kinds[i] === 'ordinary' ? 4
                : kinds[i] === 'continuation' ? markerPrefixWidth(state, items[i]!)
                : movable[i] ? candidateStep[i] : 0;
            const { text: shiftedText, shift } = shiftLineFlat(text, outdent, step);
            shifts.push(shift);
            return shiftedText;
        });
        return { text: resultLines.join('\n'), shifts };
    }

    // Fixed-point over ROOTS only: a root's own validity can depend on ANOTHER root at
    // the same depth also having moved (two siblings must shift together to land as
    // siblings under the item above them) — validating each line in isolation against
    // the un-shifted original document gives false negatives. Build the full combined
    // trial with every still-movable candidate applied (roots AND their descendants),
    // check each ROOT's depth in THAT trial, drop any that don't validate, re-propagate
    // to descendants, and rebuild — repeat until nothing more changes.
    for (let iteration = 0; iteration < kinds.length + 1; iteration++) {
        if (!movable.some(Boolean)) { break; }
        const { text: trialBlockText } = buildBlock();
        const trialState = state.update({ changes: { from: blockFrom, to: blockTo, insert: trialBlockText } }).state;

        let changed = false;
        for (let i = 0; i < kinds.length; i++) {
            if (kinds[i] !== 'marker' || parentMarkerIndex[i] !== -1 || !movable[i]) { continue; }
            const n = lineNumbers[i];
            const origLine = state.doc.line(n);
            const trialLine = trialState.doc.line(n);
            const origProbe = origLine.from + (origLine.text.length - origLine.text.trimStart().length);
            const trialProbe = trialLine.from + (trialLine.text.length - trialLine.text.trimStart().length);
            const depthBefore = listItemDepth(state, origProbe);
            const depthAfter = listItemDepth(trialState, trialProbe);
            if (depthAfter !== depthBefore + (outdent ? -1 : 1)) { movable[i] = false; changed = true; }
        }
        if (!changed) { break; }
        propagateToDescendants();
    }

    const { text: newBlock, shifts } = buildBlock();
    if (newBlock === originalBlock) { return null; } // nothing in the selection could move

    return {
        changes: { from: blockFrom, to: blockTo, insert: newBlock },
        selection: EditorSelection.range(Math.max(blockFrom, from + shifts[0]), to + shifts.reduce((a, b) => a + b, 0)),
    };
}

export function computeTabIndent(state: EditorState, shiftKey: boolean): TransactionSpec | null {
    const { from, to } = state.selection.main;
    if (from !== to && state.sliceDoc(from, to).includes('\n')) {
        return computeMultiLineListAwareIndent(state, shiftKey);
    }

    const line = state.doc.lineAt(from);
    // Resolve the enclosing item from the cursor position itself, not the
    // line's raw start — an already-nested line's leading whitespace can
    // include a "gap" beyond what's structurally required for its own depth,
    // which has no specific enclosing node and would resolve to the wrong
    // (shallower) ancestor. The cursor is always inside real content.
    const item = from === to ? enclosingListItem(state, from) : null;

    if (item) {
        const hasIndent = /^[ \t]/.test(line.text);
        if (shiftKey && !hasIndent) {
            return null; // Shift-Tab on an already-flush list line stays a true no-op
        }

        const mark = item.getChild('ListMark');
        const isMarkerLine = mark ? state.doc.lineAt(mark.from).number === line.number : false;

        // The marker's own line changes list nesting depth, so its step must be the
        // *other* item's marker width — the preceding sibling being nested under (Tab),
        // or the parent being left (Shift-Tab) — not a flat 4 spaces (bullet markers
        // only need 2 columns per level, not 4; a flat 4 either overshoots CommonMark's
        // nesting tolerance into a code block, or under/over-shoots by leaving a
        // mismatched multiple of the marker width). A wrapped continuation line doesn't
        // change depth at all, so it just reuses its own item's already-established
        // marker width for a cosmetically consistent shift.
        let step: number;
        let prevSibling: SyntaxNode | null = null;
        if (isMarkerLine) {
            if (!shiftKey) {
                prevSibling = previousSiblingListItem(item);
                if (!prevSibling) {
                    // No sibling to nest under — top-level only/first items get a
                    // safe flat indent at line start (own marker width, not 4
                    // spaces at cursor). Nested only-children stay a no-op.
                    if (listItemDepth(state, from) > 1) { return null; }
                    return computeSingleLineIndentBy(state, line, false, markerPrefixWidth(state, item), from);
                }
                step = markerPrefixWidth(state, prevSibling);
            } else {
                const parent = parentListItem(item);
                if (!parent) { return null; } // already top-level
                step = markerPrefixWidth(state, parent);
            }
        } else {
            step = markerPrefixWidth(state, item);
        }

        // Nesting an ordered-list item under a sibling that has no nested list of its
        // own yet makes this item the first child of a brand-new list — its own typed
        // digit must reset to "1" or it wrongly seeds that list's numbering (see
        // computeOrderedNestIndentBy's doc comment).
        const createsNewOrderedList = isMarkerLine && !shiftKey && mark
            && item.parent?.name === 'OrderedList'
            && prevSibling && !prevSibling.getChild('OrderedList') && !prevSibling.getChild('BulletList');

        const spec = createsNewOrderedList
            ? computeOrderedNestIndentBy(state, line, mark, step, from)
            : computeSingleLineIndentBy(state, line, shiftKey, step, from);
        if (!spec) { return null; }

        if (isMarkerLine) {
            // Re-parse the trial result and verify depth actually changed by exactly
            // one level — a document with pre-existing non-standard indentation (e.g.
            // extra padding beyond the minimum) could still leave the step short of a
            // real level change; refuse rather than risk a corrupted structure.
            const trialState = state.update(spec).state;
            const depthBefore = listItemDepth(state, from);
            const depthAfter = listItemDepth(trialState, trialState.selection.main.from);
            if (depthAfter !== depthBefore + (shiftKey ? -1 : 1)) {
                return null;
            }
        }
        return spec;
    }

    // Setext-vs-bullet ambiguity: `paragraph\n- ` is parsed as Setext, not a list,
    // so `enclosingListItem` returns null even though the reveal layer shows a
    // bullet. Fall through to flat 4-space Tab here and the marker line gets
    // mangled; treat it as a lone list marker (no sibling to nest under) instead.
    if (setextListMarkerLineAt(state, from)) {
        return null;
    }

    const beforeCursor = state.sliceDoc(line.from, from);
    if (shiftKey) {
        if (beforeCursor.startsWith('    ')) {
            return { changes: { from: line.from, to: line.from + 4, insert: '' }, selection: EditorSelection.cursor(from - 4) };
        }
        if (beforeCursor.startsWith('\t')) {
            return { changes: { from: line.from, to: line.from + 1, insert: '' }, selection: EditorSelection.cursor(from - 1) };
        }
        return null;
    }
    return { changes: { from, to, insert: '    ' }, selection: EditorSelection.cursor(from + 4) };
}

export function computeDuplicateLine(state: EditorState): TransactionSpec {
    const pos = state.selection.main.from;
    const line = state.doc.lineAt(pos);
    const offset = pos - line.from;
    return {
        changes: { from: line.to, to: line.to, insert: '\n' + line.text },
        selection: EditorSelection.cursor(line.to + 1 + offset),
    };
}

export function computeDeleteLine(state: EditorState): TransactionSpec {
    const pos = state.selection.main.from;
    const line = state.doc.lineAt(pos);
    if (line.number === state.doc.lines) {
        const from = Math.max(0, line.from - 1);
        return { changes: { from, to: state.doc.length, insert: '' }, selection: EditorSelection.cursor(from) };
    }
    return { changes: { from: line.from, to: line.to + 1, insert: '' }, selection: EditorSelection.cursor(line.from) };
}

export function computeMoveLineUp(state: EditorState): TransactionSpec | null {
    const { from, to } = state.selection.main;
    const firstLine = state.doc.lineAt(from);
    if (firstLine.number === 1) { return null; }

    const adjustedTo = (to > from && state.sliceDoc(to - 1, to) === '\n') ? to - 1 : to;
    const lastLine = state.doc.lineAt(adjustedTo);
    const prevLine = state.doc.line(firstLine.number - 1);
    const currentBlock = state.sliceDoc(firstLine.from, lastLine.to);
    const shift = firstLine.from - prevLine.from;

    return {
        changes: { from: prevLine.from, to: lastLine.to, insert: currentBlock + '\n' + prevLine.text },
        selection: EditorSelection.range(from - shift, to - shift),
    };
}

export function computeMoveLineDown(state: EditorState): TransactionSpec | null {
    const { from, to } = state.selection.main;
    const firstLine = state.doc.lineAt(from);
    const adjustedTo = (to > from && state.sliceDoc(to - 1, to) === '\n') ? to - 1 : to;
    const lastLine = state.doc.lineAt(adjustedTo);
    if (lastLine.number === state.doc.lines) { return null; }

    const nextLine = state.doc.line(lastLine.number + 1);
    const currentBlock = state.sliceDoc(firstLine.from, lastLine.to);
    const shift = nextLine.text.length + 1;

    return {
        changes: { from: firstLine.from, to: nextLine.to, insert: nextLine.text + '\n' + currentBlock },
        selection: EditorSelection.range(from + shift, to + shift),
    };
}

export function computeSelectWord(state: EditorState): TransactionSpec | null {
    const pos = state.selection.main.from;
    const wordChars = /[\w-]/;
    let wStart = pos;
    let wEnd = pos;
    while (wStart > 0 && wordChars.test(state.sliceDoc(wStart - 1, wStart))) { wStart--; }
    while (wEnd < state.doc.length && wordChars.test(state.sliceDoc(wEnd, wEnd + 1))) { wEnd++; }
    if (wStart === wEnd) { return null; }
    return { selection: EditorSelection.range(wStart, wEnd) };
}

export function computeTransformCase(state: EditorState, mode: 'upper' | 'lower' | 'title'): TransactionSpec | null {
    const { from, to } = state.selection.main;
    if (from === to) { return null; }
    const selected = state.sliceDoc(from, to);
    const transformed = mode === 'upper' ? selected.toUpperCase()
        : mode === 'lower' ? selected.toLowerCase()
        : selected.replace(/\b\w/g, c => c.toUpperCase());
    return {
        changes: { from, to, insert: transformed },
        selection: EditorSelection.range(from, from + transformed.length),
    };
}

export function computeSortSelectedLines(state: EditorState, descending: boolean): TransactionSpec | null {
    const { from, to } = state.selection.main;
    if (from === to) { return null; }
    const firstLine = state.doc.lineAt(from);
    const lastLine = state.doc.lineAt(to);
    const lines = state.sliceDoc(firstLine.from, lastLine.to).split('\n');
    lines.sort((a, b) => descending ? b.localeCompare(a) : a.localeCompare(b));
    const sorted = lines.join('\n');
    return {
        changes: { from: firstLine.from, to: lastLine.to, insert: sorted },
        selection: EditorSelection.range(firstLine.from, firstLine.from + sorted.length),
    };
}

export function computeTrimTrailingWhitespace(state: EditorState): TransactionSpec | null {
    const text = state.doc.toString();
    const re = /[ \t]+$/gm;
    const changes: { from: number; to: number; insert: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        changes.push({ from: m.index, to: m.index + m[0].length, insert: '' });
    }
    if (changes.length === 0) { return null; }
    return { changes };
}

function promptLineNumber(lineCount: number): Promise<number | null> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'feedback-overlay reload-confirm-overlay';
        const modal = document.createElement('div');
        modal.className = 'feedback-modal';

        const header = document.createElement('div');
        header.className = 'feedback-header';
        const title = document.createElement('h2');
        title.textContent = 'Go to Line';
        header.appendChild(title);

        const body = document.createElement('div');
        body.className = 'feedback-body';
        body.style.padding = '20px 24px 24px';
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '16px';

        const label = document.createElement('label');
        label.textContent = `Line number (1–${lineCount})`;
        label.style.fontSize = '13px';
        label.style.color = 'var(--color-text-primary)';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = String(lineCount);
        input.className = 'search-input';
        input.style.width = '100%';
        input.style.boxSizing = 'border-box';

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.justifyContent = 'flex-end';
        actions.style.gap = '8px';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'reload-confirm-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'background:none;border:1px solid var(--color-border-default);border-radius:6px;color:var(--color-text-primary);font-size:13px;font-weight:500;padding:6px 14px;cursor:pointer;';

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'reload-confirm-ok';
        okBtn.textContent = 'Go';
        okBtn.style.cssText = 'background:var(--color-action);border:none;border-radius:6px;color:var(--color-text-on-action);font-size:13px;font-weight:600;padding:6px 14px;cursor:pointer;';

        actions.append(cancelBtn, okBtn);
        body.append(label, input, actions);
        modal.append(header, body);
        document.body.append(overlay, modal);

        const finish = (value: number | null) => {
            overlay.remove();
            modal.remove();
            resolve(value);
        };

        const submit = () => {
            const lineNum = parseInt(input.value, 10);
            if (isNaN(lineNum) || lineNum < 1 || lineNum > lineCount) {
                input.focus();
                return;
            }
            finish(lineNum);
        };

        overlay.addEventListener('click', () => finish(null));
        cancelBtn.addEventListener('click', () => finish(null));
        okBtn.addEventListener('click', submit);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submit();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                finish(null);
            }
        });

        requestAnimationFrame(() => {
            overlay.classList.add('active');
            modal.classList.add('active');
            input.focus();
            input.select();
        });
    });
}

export function computeJumpToLine(state: EditorState, lineNum: number): TransactionSpec {
    const pos = state.doc.line(lineNum).from;
    return {
        selection: EditorSelection.cursor(pos),
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    };
}

function runJumpToLine(view: EditorView): boolean {
    const lineCount = view.state.doc.lines;
    void promptLineNumber(lineCount).then((lineNum) => {
        if (lineNum === null) { return; }
        view.dispatch(computeJumpToLine(view.state, lineNum));
        view.focus();
    });
    return true;
}

// ===== Dispatch table — one entry point for both the toolbar and the keymap =====

export function runFormatCommand(view: EditorView, action: string): boolean {
    const { state } = view;
    switch (action) {
        case 'bold': return dispatchSpec(view, computeWrapSelection(state, '**', '**'));
        case 'italic': return dispatchSpec(view, computeWrapSelection(state, '*', '*'));
        case 'strikethrough': return dispatchSpec(view, computeWrapSelection(state, '~~', '~~'));
        case 'inlineCode': return dispatchSpec(view, computeWrapSelection(state, '`', '`'));
        case 'codeBlock': return dispatchSpec(view, computeToggleCodeBlock(state));
        case 'link': return dispatchSpec(view, computeInsertLink(state));
        case 'image': return dispatchSpec(view, computeInsertImage(state));
        case 'table': return dispatchSpec(view, computeInsertTable(state));
        case 'heading1': return dispatchSpec(view, computeToggleLinePrefix(state, '# '));
        case 'heading2': return dispatchSpec(view, computeToggleLinePrefix(state, '## '));
        case 'heading3': return dispatchSpec(view, computeToggleLinePrefix(state, '### '));
        case 'bulletList': return dispatchSpec(view, computeToggleLinePrefix(state, '- '));
        case 'orderedList': return dispatchSpec(view, computeToggleLinePrefix(state, '1. '));
        case 'checkbox': return dispatchSpec(view, computeToggleLinePrefix(state, '- [ ] '));
        case 'blockquote': return dispatchSpec(view, computeToggleLinePrefix(state, '> '));
        case 'hr': return dispatchSpec(view, computeInsertHorizontalRule(state));
        case 'duplicateLine': return dispatchSpec(view, computeDuplicateLine(state));
        case 'deleteLine': return dispatchSpec(view, computeDeleteLine(state));
        case 'moveUp': return dispatchSpec(view, computeMoveLineUp(state));
        case 'moveDown': return dispatchSpec(view, computeMoveLineDown(state));
        case 'selectWord': return dispatchSpec(view, computeSelectWord(state));
        case 'jumpToLine': return runJumpToLine(view);
        case 'uppercase': return dispatchSpec(view, computeTransformCase(state, 'upper'));
        case 'lowercase': return dispatchSpec(view, computeTransformCase(state, 'lower'));
        case 'titlecase': return dispatchSpec(view, computeTransformCase(state, 'title'));
        case 'sortLines': return dispatchSpec(view, computeSortSelectedLines(state, false));
        case 'sortLinesDesc': return dispatchSpec(view, computeSortSelectedLines(state, true));
        case 'trimWhitespace': return dispatchSpec(view, computeTrimTrailingWhitespace(state));
        default: return false;
    }
}

// ===== CM6-native keymap — Tab/Shift-Tab (no CM6 default) + Mod shortcuts =====
// Placed ahead of `defaultKeymap` in the EditorView's extensions (see
// livePreviewEditor.ts) so these win over any colliding default binding
// (e.g. defaultKeymap's own "Mod-i" -> selectParentSyntax).

export const livePreviewTabKeymap = Prec.highest(keymap.of([
    { key: 'Tab', run: (view) => dispatchSpec(view, computeTabIndent(view.state, false)) },
    { key: 'Shift-Tab', run: (view) => dispatchSpec(view, computeTabIndent(view.state, true)) },
]));

export const livePreviewFormatKeymap: KeyBinding[] = [
    { key: 'Mod-b', run: (view) => runFormatCommand(view, 'bold') },
    { key: 'Mod-i', run: (view) => runFormatCommand(view, 'italic') },
    { key: 'Mod-k', run: (view) => runFormatCommand(view, 'link') },
    { key: 'Mod-e', run: (view) => runFormatCommand(view, 'inlineCode') },
    { key: 'Mod-Shift-e', run: (view) => runFormatCommand(view, 'codeBlock') },
    { key: 'Mod-Shift-x', run: (view) => runFormatCommand(view, 'strikethrough') },
    { key: 'Mod-l', run: (view) => runFormatCommand(view, 'bulletList') },
    { key: 'Mod-Shift-l', run: (view) => runFormatCommand(view, 'orderedList') },
    { key: 'Mod-1', run: (view) => runFormatCommand(view, 'heading1') },
    { key: 'Mod-2', run: (view) => runFormatCommand(view, 'heading2') },
    { key: 'Mod-3', run: (view) => runFormatCommand(view, 'heading3') },
    { key: 'Mod-Shift-d', run: (view) => runFormatCommand(view, 'duplicateLine') },
    { key: 'Mod-Shift-k', run: (view) => runFormatCommand(view, 'deleteLine') },
    { key: 'Mod-d', run: (view) => runFormatCommand(view, 'selectWord') },
    { key: 'Mod-g', run: (view) => runFormatCommand(view, 'jumpToLine') },
    { key: 'Mod-Shift-u', run: (view) => runFormatCommand(view, 'uppercase') },
    { key: 'Mod-u', run: (view) => runFormatCommand(view, 'lowercase') },
    { key: 'Alt-ArrowUp', run: (view) => runFormatCommand(view, 'moveUp') },
    { key: 'Alt-ArrowDown', run: (view) => runFormatCommand(view, 'moveDown') },
];
