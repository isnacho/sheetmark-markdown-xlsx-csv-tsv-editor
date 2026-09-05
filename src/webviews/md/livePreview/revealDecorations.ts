// Reveal-on-cursor decoration engine for the Markdown "Preview Edit" mode.
//
// Runtime: WEBVIEW (browser) for the ViewPlugin; the pure `computeRevealDecorations`
// below has no DOM dependency and is exercised headlessly in
// revealDecorations.test.mts.
//
// v1 scope (Phase 4, per the plan): headings (ATX + Setext) + bold
// (StrongEmphasis) + italic (Emphasis), including the nested ***bold-italic***
// case. Phase 7 extends this to strikethrough, inline-code, links, and
// blockquotes (same hide-marker/style-content shape) plus list markers/task
// checkboxes (always-on styling — see the Phase 7 design note below for why
// those two do NOT hide on cursor-away like everything else here).
//
// Design: content styling (heading-size / bold-weight / italic-style) is
// ALWAYS applied, independent of the selection — a heading stays reader-sized
// and bold/italic content stays weighted/styled whether or not the cursor is
// in it (confirmed against real usage: headings should keep their size when
// selected). Only the marker's visibility toggles: hidden (Decoration.replace)
// when the selection doesn't intersect the element, shown dimmed
// (Decoration.mark) when it does. ATX headings use a line-based collapsed-caret
// check so "#" / "# " mid-typing (caret at node end) still reveals the marker.
// This sidesteps the plan's "block-height reveal" hazard entirely for headings,
// since size no longer changes on cursor enter/exit — there's nothing left to
// cause a scroll jump.
//
// Caret-behavior decision (the "atomic ranges" hazard from the plan): NOT using
// an `atomicRanges` facet. Because decorations recompute on every selection
// update, moving the caret toward a hidden marker reveals it as soon as the
// selection touches the element's range — arrow keys and backspace act on the
// real character positions and the marker reveals itself on approach, rather
// than jumping over the whole marker atomically. Documented as the intended
// behavior (plan explicitly asks to "confirm this is the intended caret
// behavior; add an atomicRanges facet OR handle cursor-into-marker explicitly" —
// this is the "handle explicitly, don't add the facet" branch).
//
// Phase 7 design decision: list markers and task checkboxes are NOT hidden on
// cursor-away, unlike every other mark this engine hides (#, **, *, ~~, ``,
// [](), >), which is pure decoration on top of otherwise-plain text — once you
// see the styled content, the marker is redundant clutter. A list
// bullet/number is not: it's the ONLY visual signal that a line is a list
// item at all. Hiding it on cursor-away would make list items
// indistinguishable from indented paragraphs, which is a worse reveal than no
// reveal. So list/task markers get restyled — no selection check, no
// hide/dim branch — but "restyled" doesn't always mean `Decoration.mark`:
// bullet markers are `Decoration.replace`d with a small circular dot widget
// (filled at depth 1, outline-only at deeper depths — mirrors the browser's
// own disc/circle default for nested `<ul>`s) because a raw "-"/"*"/"+"
// character recolored in place can never actually look like a bullet;
// ordered-list markers are similarly `Decoration.replace`d, but with a
// computed label (depth-cycling + auto-sequential numbering, see the
// list-editing-polish idea) because the *displayed digits* themselves need to
// diverge from the raw source text, not just their shape/color — still
// always-on and cursor-position-independent, just via a different decoration
// kind for a different reason. Note this is a narrower claim than
// codeStyling.ts's "unconditional": list/task styling still lives in this
// compartment-gated plugin, so it disappears along with every other content
// class here (heading size, bold weight, ...) if the user turns the
// `livePreviewReveal` setting off — only the *cursor-position* independence is
// being claimed, not independence from the setting.

import { EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { appendCalloutDecorationSpecs } from './calloutDecorations';
import { isSetextUnderlineListMarker } from './listSetextAmbiguity';
import { listItemMarkerIsActivated, orderedListStartNumber, listItemPositionInSegment } from './listMarkerEditing';

export interface VisibleRange {
    from: number;
    to: number;
}

const HEADING_LEVEL: Record<string, number> = {
    ATXHeading1: 1, ATXHeading2: 2, ATXHeading3: 3, ATXHeading4: 4, ATXHeading5: 5, ATXHeading6: 6,
    SetextHeading1: 1, SetextHeading2: 2,
};

function rangesIntersect(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
    return aFrom <= bTo && aTo >= bFrom;
}

// ===== Ordered-list depth-cycling marker labels (list-editing-polish idea) =====
// Depth 1 = decimal (1. 2. 3.), depth 2 = lowercase alpha (a. b. c.), depth 3 =
// lowercase roman (i. ii. iii.), depth 4+ cycles back to decimal. Visual only —
// the raw markdown source stays plain numeric at every depth (required for
// Reading mode/Obsidian/GitHub compatibility; "a."/"i." aren't valid CommonMark).

const ROMAN_NUMERALS: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

export function numberToLowerAlpha(n: number): string {
    let result = '';
    let remaining = n;
    while (remaining > 0) {
        remaining--;
        result = String.fromCharCode(97 + (remaining % 26)) + result;
        remaining = Math.floor(remaining / 26);
    }
    return result;
}

export function numberToLowerRoman(n: number): string {
    let result = '';
    let remaining = n;
    for (const [value, symbol] of ROMAN_NUMERALS) {
        while (remaining >= value) {
            result += symbol;
            remaining -= value;
        }
    }
    return result;
}

export function formatOrderedMarkerLabel(depth: number, value: number, delimiter: string): string {
    const cycle = (depth - 1) % 3; // 0=decimal, 1=alpha, 2=roman — cycles every 3 depths
    const numeral = cycle === 0 ? String(value) : cycle === 1 ? numberToLowerAlpha(value) : numberToLowerRoman(value);
    return numeral + delimiter;
}

// Counts ALL enclosing BulletList/OrderedList ancestors (both types), including `node`
// itself if it is one. A bullet list nested under an ordered list still adds +1 to depth
// even though only ordered lists render the cycle — deliberate simple default for the
// mixed-nesting edge case, not a bug to "fix" later.
export function listContainerDepth(node: SyntaxNode): number {
    let depth = 0;
    for (let p: SyntaxNode | null = node; p; p = p.parent) {
        if (p.name === 'BulletList' || p.name === 'OrderedList') { depth++; }
    }
    return depth;
}

/** 0-based index of `item` among its ListItem siblings under `item.parent`. */
export function listItemPosition(item: SyntaxNode): number {
    let index = 0;
    for (let sib = item.parent?.firstChild ?? null; sib; sib = sib.nextSibling) {
        if (sib.from === item.from) { return index; }
        if (sib.name === 'ListItem') { index++; }
    }
    return index;
}

/**
 * The computed display label for an ordered-list ListMark node — seeded from the list's
 * first item's own typed digits, then incremented by sibling position (mirrors
 * @codemirror/lang-markdown's own itemNumber()/renumberList() pattern, applied to
 * rendering instead of doc-rewriting) so numbering stays auto-sequential regardless of
 * what individual items literally typed. Returns null when `mark`'s ListItem isn't a
 * direct child of an OrderedList (bullet markers, including checkbox bullets).
 */
export function computeOrderedMarkerLabel(state: EditorState, mark: SyntaxNode): string | null {
    const item = mark.parent;
    const list = item?.parent;
    if (!item || item.name !== 'ListItem' || !list || list.name !== 'OrderedList') { return null; }
    const delimiter = state.sliceDoc(mark.to - 1, mark.to);
    const value = orderedListStartNumber(state, item) + listItemPositionInSegment(state, item);
    return formatOrderedMarkerLabel(listContainerDepth(list), value, delimiter);
}

interface Spec {
    from: number;
    to: number;
    value: ReturnType<typeof Decoration.mark> | ReturnType<typeof Decoration.replace> | ReturnType<typeof Decoration.line>;
}

const hiddenBulletMark = Decoration.mark({ class: 'cm-md-checkbox-bullet-hidden' });
const taskDoneContentDeco = Decoration.mark({ class: 'cm-md-task-done-content' });
const blockquoteLineDeco = Decoration.line({ class: 'cm-md-blockquote-line' });
/**
 * Renders a full-width horizontal rule over a `HorizontalRule`'s exact range
 * when the cursor is away. Owns mousedown to place the caret on the rule line
 * (the styled border sits in a block widget, so a bare click would otherwise
 * miss the tiny hidden source text and land on the next line).
 */
export class HorizontalRuleWidget extends WidgetType {
    readonly nodeFrom: number;
    readonly nodeTo: number;

    constructor(nodeFrom: number, nodeTo: number) {
        super();
        this.nodeFrom = nodeFrom;
        this.nodeTo = nodeTo;
    }
    eq(other: HorizontalRuleWidget): boolean {
        return other.nodeFrom === this.nodeFrom && other.nodeTo === this.nodeTo;
    }
    toDOM(view: EditorView): HTMLElement {
        const rule = document.createElement('span');
        rule.className = 'cm-md-hr-widget';
        rule.setAttribute('aria-hidden', 'true');
        rule.addEventListener('mousedown', (event) => {
            event.preventDefault();
            view.dispatch({
                selection: { anchor: this.nodeTo, head: this.nodeTo },
                scrollIntoView: true,
            });
            view.focus();
        });
        return rule;
    }
    ignoreEvent(): boolean {
        return true;
    }
}

/**
 * Renders a real `<input type="checkbox">` over a `TaskMarker`'s exact range
 * and owns its own click handling to toggle `[ ]`/`[x]` in the source text —
 * same shape as `TableWidget`'s self-owned event handling in tableWidget.ts,
 * opposite `ignoreEvent` direction: this widget's whole purpose IS the click,
 * so CM6 should do nothing else with it (no cursor-placement/reveal, unlike
 * every other marker in this file).
 */
export class TaskCheckboxWidget extends WidgetType {
    readonly checked: boolean;
    readonly markerFrom: number;
    readonly markerTo: number;

    constructor(checked: boolean, markerFrom: number, markerTo: number) {
        super();
        this.checked = checked;
        this.markerFrom = markerFrom;
        this.markerTo = markerTo;
    }
    eq(other: TaskCheckboxWidget): boolean {
        return other.checked === this.checked && other.markerFrom === this.markerFrom && other.markerTo === this.markerTo;
    }
    toDOM(view: EditorView): HTMLElement {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'cm-md-task-checkbox';
        box.checked = this.checked;
        box.setAttribute('aria-label', this.checked ? 'Mark task as not done' : 'Mark task as done');
        // Checkbox focus is assigned on mousedown's default action, before
        // `click` fires — `click`'s own preventDefault() can't undo it, so it
        // has to be stopped here to keep focus in the editor.
        box.addEventListener('mousedown', (event) => event.preventDefault());
        box.addEventListener('click', (event) => {
            event.preventDefault();
            view.dispatch(computeToggleTaskMarker(view.state, this.markerFrom, this.markerTo));
        });
        return wrapInListMarkerSlot(box);
    }
    ignoreEvent(): boolean {
        return true;
    }
}

/** Pure, headless-testable — same compute-then-dispatch shape as formatCommands.ts's computeXxx helpers. */
export function computeToggleTaskMarker(state: EditorState, markerFrom: number, markerTo: number): TransactionSpec {
    const isDone = /\[[xX]\]/.test(state.sliceDoc(markerFrom, markerTo));
    return { changes: { from: markerFrom, to: markerTo, insert: isDone ? '[ ]' : '[x]' } };
}

/**
 * Renders the computed depth-cycling label (1./a./i./...) over an ordered-list
 * ListMark's exact range. A static label, not an interactive control — unlike
 * TaskCheckboxWidget/TableWidget, it does NOT set `ignoreEvent()` to true: CM6's
 * normal click-to-place-cursor must still run so a click lands a real cursor,
 * which the atomicRanges extension below then snaps to just before/after the
 * marker (`ignoreEvent`'s base default is already `true` — "ignore all events" —
 * so this class exists purely to override it back to `false`).
 */
export class OrderedMarkerWidget extends WidgetType {
    readonly label: string;

    constructor(label: string) {
        super();
        this.label = label;
    }
    eq(other: OrderedMarkerWidget): boolean {
        return other.label === this.label;
    }
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'cm-md-ordered-marker';
        span.textContent = this.label;
        return wrapInListMarkerSlot(span, 'cm-md-list-marker-slot-numeric');
    }
    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Renders a bullet-list ListMark ("-"/"*"/"+") as an actual dot instead of the
 * raw typed character — filled at the outermost depth, outline-only at every
 * nested depth (mirrors the browser's own disc/circle default for nested
 * `<ul>`s). Same non-interactive-but-clickable shape as OrderedMarkerWidget
 * above, for the same reason: a real cursor still needs to land here on click.
 */
export class BulletMarkerWidget extends WidgetType {
    readonly nested: boolean;

    constructor(nested: boolean) {
        super();
        this.nested = nested;
    }
    eq(other: BulletMarkerWidget): boolean {
        return other.nested === this.nested;
    }
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = this.nested ? 'cm-md-bullet-marker cm-md-bullet-marker-nested' : 'cm-md-bullet-marker';
        return wrapInListMarkerSlot(span);
    }
    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Wraps a marker widget's own element (dot / label / checkbox, unchanged) in
 * a slot span whose `min-width` comes from the `--list-col` custom property
 * set on the enclosing line's decoration (see getListColumnMetrics below).
 * CSS custom properties inherit down through descendant DOM, so this needs no
 * per-widget width field/constructor param — the same widget DOM instance
 * keeps being reused across rebuilds (via each widget's existing `eq()`) even
 * as the list's column width changes from edits elsewhere in the same list;
 * only the inherited CSS variable (and thus the repaint) changes.
 *
 * Default alignment is LEFT (near the cascade boundary — the parent's own
 * text start) — right for bullets/checkboxes, which never need to grow, so
 * hugging the column's own text side just eats the floor's slack as dead
 * space and reads as misaligned with the level above. `extraClass` opts a
 * marker into right-alignment instead (`cm-md-list-marker-slot-numeric`, for
 * ordered labels only) — those DO grow (more digits, wider roman numerals),
 * and need to stay flush against their own text as that happens.
 */
function wrapInListMarkerSlot(marker: HTMLElement, extraClass?: string): HTMLElement {
    const slot = document.createElement('span');
    slot.className = extraClass ? `cm-md-list-marker-slot ${extraClass}` : 'cm-md-list-marker-slot';
    slot.appendChild(marker);
    return slot;
}

// ===== List item hanging indent / marker column width (hanging-indent-list-text-wrap idea) =====
// Every list gets one "text-start column" that its item text — first line and
// wrapped/lazy-continuation lines — aligns to. Floor = width of a 2-digit
// decimal marker ("12."); grows only for the one list whose own labels are
// wider (3+ digit numbers, or — since ordered markers cycle decimal/alpha/
// roman by depth, see formatOrderedMarkerLabel above — a long roman numeral
// or double-letter alpha label). Bullets/tasks never exceed the floor
// (computeOrderedMarkerLabel returns null for them, so they never contribute
// to the max below).
export const LIST_INDENT_FLOOR_CHARS = 3; // "12." — two digits + delimiter

// `--font-mono` is fixed-pitch (unlike `.cm-content`'s proportional
// `--font-family`), so its character count converts to pixels exactly once
// its real rendered advance width is known. This constant is a deterministic
// stand-in for headless tests; production measures the real value once via
// getMonoCharWidthPx() below (never per-list, never per-render — see there).
export const DEFAULT_MONO_CHAR_WIDTH_PX = 8;

// A top-level bullet/checkbox has no parent list to cascade from, so it gets
// NO leading inset — its own left edge lines up exactly with plain paragraph
// text at the same depth. A nested one needs a small inset so it doesn't sit
// flush against the cascade boundary (the parent's own text start) — see the
// "clear gap on the left" requirement in the idea this feature comes from.
export const LIST_MARKER_NESTED_INSET_PX = 4;

/** Widest ordered-marker label among `list`'s direct ListItem children, floored at LIST_INDENT_FLOOR_CHARS. */
export function computeListOwnColumnChars(state: EditorState, list: SyntaxNode): number {
    let maxLabelLen = 0;
    for (let item = list.firstChild; item; item = item.nextSibling) {
        if (item.name !== 'ListItem') { continue; }
        const mark = item.getChild('ListMark');
        const label = mark && computeOrderedMarkerLabel(state, mark);
        if (label) { maxLabelLen = Math.max(maxLabelLen, label.length); }
    }
    return Math.max(LIST_INDENT_FLOOR_CHARS, maxLabelLen);
}

function enclosingListContainer(node: SyntaxNode | null): SyntaxNode | null {
    for (let p = node; p; p = p.parent) {
        if (p.name === 'BulletList' || p.name === 'OrderedList') { return p; }
    }
    return null;
}

export interface ListColumnMetrics {
    columnChars: number;
    columnPx: number;
    offsetPx: number;
    totalPx: number;
    markerLineDeco: ReturnType<typeof Decoration.line>;
    continuationLineDeco: ReturnType<typeof Decoration.line>;
}

/**
 * Per-list text-start column, memoized in `cache` (keyed by the list node's
 * own start offset) for the lifetime of one computeRevealDecorations call —
 * every ListItem in the same list shares one entry, so the O(items-in-list)
 * scan in computeListOwnColumnChars runs once per list per rebuild, not once
 * per item. A nested list's `offsetPx` is its immediate parent's own
 * `totalPx` — the cascading step-in lands at the parent's TEXT column, not
 * the parent's marker column.
 */
export function getListColumnMetrics(
    state: EditorState,
    list: SyntaxNode,
    monoCharWidthPx: number,
    cache: Map<number, ListColumnMetrics>,
): ListColumnMetrics {
    const cached = cache.get(list.from);
    if (cached) { return cached; }
    const columnChars = computeListOwnColumnChars(state, list);
    const columnPx = columnChars * monoCharWidthPx;
    const parentList = enclosingListContainer(list.parent);
    const offsetPx = parentList ? getListColumnMetrics(state, parentList, monoCharWidthPx, cache).totalPx : 0;
    const totalPx = offsetPx + columnPx;
    const markerInsetPx = offsetPx === 0 ? 0 : LIST_MARKER_NESTED_INSET_PX;
    const metrics: ListColumnMetrics = {
        columnChars, columnPx, offsetPx, totalPx,
        markerLineDeco: Decoration.line({
            class: 'cm-md-list-line',
            attributes: { style: `padding-left:${totalPx}px;text-indent:-${columnPx}px;--list-col:${columnPx}px;--list-marker-inset:${markerInsetPx}px` },
        }),
        continuationLineDeco: Decoration.line({
            class: 'cm-md-list-line',
            attributes: { style: `padding-left:${totalPx}px` },
        }),
    };
    cache.set(list.from, metrics);
    return metrics;
}

/**
 * `item`'s own last content line — covers CommonMark lazy continuation (a
 * second typed source line with no blank line, swallowed into the same
 * Paragraph/Task node) so its wrapped/continuation lines get indented too.
 * Stops before a trailing nested sublist (that sublist indents its own lines
 * separately, at its own deeper column, when its own items are visited),
 * including the case where the item has no body text of its own and a
 * nested list starts immediately on the next line.
 *
 * Note: flush-left continuation lines (no leading whitespace) are still
 * inside the parse tree here, but `applyListLineIndentDecorations` skips
 * decorating them so they align with plain paragraphs — the usual shape when
 * a user exits a list by deleting the auto-inserted marker.
 */
function listItemBodyLastLine(state: EditorState, item: SyntaxNode): number {
    const firstLine = state.doc.lineAt(item.from).number;
    let sublistFrom: number | null = null;
    for (let child = item.lastChild; child && (child.name === 'BulletList' || child.name === 'OrderedList'); child = child.prevSibling) {
        sublistFrom = child.from;
    }
    if (sublistFrom === null) { return state.doc.lineAt(item.to).number; }
    return Math.max(firstLine, state.doc.lineAt(sublistFrom).number - 1);
}

// Source indentation (the literal leading spaces markdown uses to signal
// nesting depth, and any leading whitespace on a lazy-continuation line) is
// real, selectable text that sits BEFORE the marker/content — left alone, it
// renders as dead selectable space to the left of the CSS-driven column,
// doubling up with padding-left/text-indent. Hidden unconditionally (no
// active-state toggle), same category as this file's other always-on
// structural hides (hiddenBulletMark, the marker's own trailing gap space).
const hiddenListIndent = Decoration.replace({});

/** Non-marker lines that carry explicit list continuation (leading whitespace). */
function listContinuationLineNeedsIndent(lineText: string): boolean {
    return /^[ \t]/.test(lineText);
}

function applyListLineIndentDecorations(state: EditorState, item: SyntaxNode, metrics: ListColumnMetrics, specs: Spec[]) {
    const firstLine = state.doc.lineAt(item.from).number;
    const lastLine = listItemBodyLastLine(state, item);
    for (let n = firstLine; n <= lastLine; n++) {
        const line = state.doc.line(n);
        if (n > firstLine && !listContinuationLineNeedsIndent(line.text)) {
            continue;
        }
        specs.push({ from: line.from, to: line.from, value: n === firstLine ? metrics.markerLineDeco : metrics.continuationLineDeco });
        if (n === firstLine) {
            if (item.from > line.from) {
                specs.push({ from: line.from, to: item.from, value: hiddenListIndent });
            }
        } else {
            const leadingWhitespace = /^[ \t]*/.exec(line.text)![0].length;
            if (leadingWhitespace > 0) {
                specs.push({ from: line.from, to: line.from + leadingWhitespace, value: hiddenListIndent });
            }
        }
    }
}

/**
 * Pure, headless-testable core: given a doc state, the primary selection range,
 * and the ranges actually worth decorating (view.visibleRanges in production,
 * [{from:0, to:doc.length}] in tests), returns the decoration set. No EditorView
 * / DOM involved.
 */
export function computeRevealDecorations(
    state: EditorState,
    selFrom: number,
    selTo: number,
    visibleRanges: readonly VisibleRange[],
    monoCharWidthPx: number = DEFAULT_MONO_CHAR_WIDTH_PX,
): DecorationSet {
    const specs: Spec[] = [];
    const dimMark = Decoration.mark({ class: 'cm-md-reveal-mark' });
    const hiddenMark = Decoration.replace({});
    const listColumnCache = new Map<number, ListColumnMetrics>();

    const isActive = (from: number, to: number) => {
        // Lezer node ranges are half-open [from, to). A collapsed caret sitting
        // exactly at `to` (immediately after the closing mark) must not count as
        // inside — otherwise paste-to-link, which places the caret there, leaves
        // the link permanently expanded.
        if (selFrom === selTo) {
            return from <= selFrom && selFrom < to;
        }
        return rangesIntersect(selFrom, selTo, from, to);
    };

    function isHeadingLineActive(node: SyntaxNode): boolean {
        if (selFrom !== selTo) {
            return isActive(node.from, node.to);
        }
        // Collapsed caret: anywhere on the heading line reveals "#" (including
        // title-less "#" / "# " while typing, where the caret sits at node.to
        // and the global isActive half-open rule would hide the marker).
        return state.doc.lineAt(selFrom).number === state.doc.lineAt(node.from).number;
    }

    function handleHeading(node: SyntaxNode, level: number) {
        const marks = node.getChildren('HeaderMark');
        if (marks.length === 0) { return; }
        const open = marks[0];
        // The grammar skips exactly one space after the opening marker without
        // giving it a node of its own — hide it too so text doesn't start with
        // a leading space once the marker's hidden.
        const hasGapSpace = state.sliceDoc(open.to, open.to + 1) === ' ';
        const gapEnd = hasGapSpace ? open.to + 1 : open.to;
        const active = isHeadingLineActive(node);
        // The dimmed "#" (shown while the cursor is on the heading line) gets
        // the SAME `cm-md-hN` size class as the content, not the base editor font
        // size `cm-md-reveal-mark` alone would give it — otherwise the marker
        // renders visibly smaller than the heading text sitting right next to
        // it. Marker + its trailing gap space are one combined span so the
        // space doesn't sit at yet another (base) size between the two.
        const dimHeadingMark = Decoration.mark({ class: `cm-md-reveal-mark cm-md-h${level}` });

        if (active) {
            specs.push({ from: open.from, to: gapEnd, value: dimHeadingMark });
        } else {
            specs.push({ from: open.from, to: open.to, value: hiddenMark });
            if (hasGapSpace) {
                specs.push({ from: open.to, to: gapEnd, value: hiddenMark });
            }
        }
        // Rare closing "## Title ##" form: hide/dim the closer(s) symmetrically.
        for (let i = 1; i < marks.length; i++) {
            const closer = marks[i];
            specs.push({ from: closer.from, to: closer.to, value: active ? dimHeadingMark : hiddenMark });
        }
        // `Decoration.mark` throws "Mark decorations may not be empty" for a
        // zero-length range — hit in practice by typing "#"/"# " (a valid,
        // title-less ATXHeading per CommonMark) while completing a heading.
        // A ViewPlugin that throws mid-update drops decorations for the WHOLE
        // plugin, not just the offending node — every other heading in the
        // doc loses its size/hidden-marker styling until something recovers
        // it. Guard every content push in this file the same way, not just
        // this one call site.
        if (gapEnd < node.to) {
            specs.push({ from: gapEnd, to: node.to, value: Decoration.mark({ class: `cm-md-heading-content cm-md-h${level}` }) });
        }
    }

    function handlePairedMarks(node: SyntaxNode, markName: string, contentClass: string) {
        const marks = node.getChildren(markName);
        if (marks.length < 2) { return; }
        const open = marks[0];
        const close = marks[marks.length - 1];
        const active = isActive(node.from, node.to);

        specs.push({ from: open.from, to: open.to, value: active ? dimMark : hiddenMark });
        specs.push({ from: close.from, to: close.to, value: active ? dimMark : hiddenMark });
        if (open.to < close.from) {
            specs.push({ from: open.to, to: close.from, value: Decoration.mark({ class: contentClass }) });
        }
    }

    // InlineCode already gets its baseline monospace/background look from
    // codeStylingPlugin (always-on, a separate decoration set) — this only
    // layers the marker hide/dim on top, no content span of its own.
    function handleInlineCode(node: SyntaxNode) {
        const marks = node.getChildren('CodeMark');
        if (marks.length < 2) { return; }
        const open = marks[0];
        const close = marks[marks.length - 1];
        const active = isActive(node.from, node.to);
        specs.push({ from: open.from, to: open.to, value: active ? dimMark : hiddenMark });
        specs.push({ from: close.from, to: close.to, value: active ? dimMark : hiddenMark });
    }

    // Image: ImageMark("!") LinkMark("[") Text LinkMark("]") LinkMark("(") URL LinkMark(")").
    // Preview rendering is owned by imageWidget.ts when the cursor is away; here
    // we only dim/hide syntax while the caret is inside the construct.
    function handleImage(node: SyntaxNode) {
        const active = isActive(node.from, node.to);
        if (!active) { return; }

        const imageMark = node.getChild('ImageMark');
        if (imageMark) {
            specs.push({ from: imageMark.from, to: imageMark.to, value: dimMark });
        }
        const marks = node.getChildren('LinkMark');
        if (marks.length >= 2) {
            specs.push({ from: marks[1].from, to: node.to, value: dimMark });
        }
        const text = node.getChild('Text');
        if (text && text.from < text.to) {
            specs.push({ from: text.from, to: text.to, value: Decoration.mark({ class: 'cm-md-image-alt-content' }) });
        }
    }

    // Link tree shape (verified against the real parse tree, not assumed):
    function handleLink(node: SyntaxNode) {
        // A malformed label (e.g. nested "[" before the real closing "]") makes
        // lezer-markdown close on the wrong bracket and emit a Link node with no
        // URL child — skip decorating those so they don't get styled as real links.
        if (!node.getChild('URL')) { return; }
        const marks = node.getChildren('LinkMark');
        if (marks.length < 2) { return; }
        const open = marks[0];
        const closeBracket = marks[1];
        const active = isActive(node.from, node.to);
        specs.push({ from: open.from, to: open.to, value: active ? dimMark : hiddenMark });
        specs.push({ from: closeBracket.from, to: node.to, value: active ? dimMark : hiddenMark });
        // Empty label ("[]()") — same zero-length-mark hazard as handleHeading.
        if (open.to < closeBracket.from) {
            specs.push({ from: open.to, to: closeBracket.from, value: Decoration.mark({ class: 'cm-md-link-content' }) });
        }
    }

    // A Blockquote spans every line of the quote, but only its FIRST line's
    // QuoteMark (">") is a direct child — lazy continuation means CommonMark
    // merges un-blank-line-separated quote lines into one Paragraph, and any
    // subsequent line's QuoteMark ends up nested *inside* that Paragraph, not
    // a sibling of the first (verified against the real parse tree — same
    // "don't assume, dump it" lesson as Phase 4's ***bold-italic*** nesting).
    // So marks are handled one at a time wherever `iterate` finds them (see
    // `handleQuoteMark` below, dispatched straight off `node.name`), each
    // walking up to its enclosing Blockquote for the node-wide active check;
    // this handler only owns the per-line block decoration.
    function handleBlockquote(node: SyntaxNode) {
        const firstLine = state.doc.lineAt(node.from).number;
        const lastLine = state.doc.lineAt(node.to).number;
        for (let n = firstLine; n <= lastLine; n++) {
            const line = state.doc.line(n);
            specs.push({ from: line.from, to: line.from, value: blockquoteLineDeco });
        }
    }

    function enclosingBlockquote(node: SyntaxNode): SyntaxNode | null {
        for (let p = node.parent; p; p = p.parent) {
            if (p.name === 'Blockquote') { return p; }
        }
        return null;
    }

    // "Active" is node-wide (cursor anywhere in the enclosing quote), same
    // granularity as headings/paired marks, so marks across all lines hide/dim
    // together rather than flickering per line as the caret moves within one
    // quote.
    function handleQuoteMark(node: SyntaxNode) {
        const quote = enclosingBlockquote(node);
        if (!quote) { return; }
        const active = isActive(quote.from, quote.to);
        const hasGapSpace = state.sliceDoc(node.to, node.to + 1) === ' ';
        const gapEnd = hasGapSpace ? node.to + 1 : node.to;
        specs.push({ from: node.from, to: node.to, value: active ? dimMark : hiddenMark });
        if (!active && hasGapSpace) {
            specs.push({ from: node.to, to: gapEnd, value: hiddenMark });
        }
    }

    // Setext-vs-bullet ambiguity: `paragraph\n- ` is parsed as Setext h2, not a
    // list. When the underline line is really a list marker, render the bullet
    // widget and skip heading treatment (headingGutterSync uses the same check).
    function handleSetextAsListMarker(setextNode: SyntaxNode) {
        if (!isSetextUnderlineListMarker(state, setextNode)) { return; }
        const underlineLine = state.doc.lineAt(setextNode.to - 1);
        const text = state.sliceDoc(underlineLine.from, underlineLine.to);
        if (!/^[-*+]/.test(text)) { return; }
        const spaceIdx = text.search(/\s/);
        if (spaceIdx < 0) { return; }
        const markerFrom = underlineLine.from;
        const markerTo = markerFrom + 1;
        const nested = false;
        specs.push({ from: markerFrom, to: markerTo, value: Decoration.replace({ widget: new BulletMarkerWidget(nested) }) });
        specs.push({ from: markerTo, to: markerTo + 1, value: hiddenMark });
    }

    // Always-on (see the Phase 7 design note above) — no isActive() branch.
    // Three-way split, checked in this order: ordered markers get the
    // depth-cycling/auto-numbering widget (must run first — a numbered
    // checklist like "1. [ ] a" has no dash to hide, so it must land here, not
    // the task branch below); bullet markers on a checkbox item get their dash
    // hidden (the checkbox already signals "list item," the dash is
    // redundant); plain bullet markers get the dot widget (filled/outline by
    // depth — see BulletMarkerWidget).
    function hideMarkerGapAfter(from: number) {
        const hasGapSpace = state.sliceDoc(from, from + 1) === ' ';
        if (hasGapSpace) {
            specs.push({ from, to: from + 1, value: hiddenMark });
        }
    }

    function handleListMark(node: SyntaxNode) {
        const item = node.parent;
        if (!item || item.name !== 'ListItem' || !listItemMarkerIsActivated(state, item)) { return; }
        const list = item.parent;
        if (list && (list.name === 'BulletList' || list.name === 'OrderedList')) {
            const metrics = getListColumnMetrics(state, list, monoCharWidthPx, listColumnCache);
            applyListLineIndentDecorations(state, item, metrics, specs);
        }
        const orderedLabel = computeOrderedMarkerLabel(state, node);
        if (orderedLabel !== null) {
            specs.push({ from: node.from, to: node.to, value: Decoration.replace({ widget: new OrderedMarkerWidget(orderedLabel) }) });
            hideMarkerGapAfter(node.to);
            return;
        }
        const task = node.parent?.getChild('Task');
        if (task) {
            specs.push({ from: node.from, to: node.to, value: hiddenBulletMark });
            if (node.to < task.from) {
                specs.push({ from: node.to, to: task.from, value: hiddenBulletMark });
            }
            return;
        }
        const nested = listContainerDepth(node) > 1;
        specs.push({ from: node.from, to: node.to, value: Decoration.replace({ widget: new BulletMarkerWidget(nested) }) });
        hideMarkerGapAfter(node.to);
    }

    // Always-on (see the Phase 7 design note above) — no isActive() branch.
    function handleTaskMarker(node: SyntaxNode) {
        const item = node.parent?.parent;
        if (!item || item.name !== 'ListItem' || !listItemMarkerIsActivated(state, item)) { return; }
        const done = /\[[xX]\]/.test(state.sliceDoc(node.from, node.to));
        specs.push({ from: node.from, to: node.to, value: Decoration.replace({ widget: new TaskCheckboxWidget(done, node.from, node.to) }) });
        // The grammar skips exactly one space after "[ ]"/"[x]" without giving
        // it a node of its own — hide it too, since the checkbox widget's own
        // marginRight (cm6Theme.ts) already supplies that gap; leaving the
        // literal space in place doubled it up.
        const hasGapSpace = state.sliceDoc(node.to, node.to + 1) === ' ';
        const gapEnd = hasGapSpace ? node.to + 1 : node.to;
        if (hasGapSpace) {
            specs.push({ from: node.to, to: gapEnd, value: hiddenMark });
        }
        const task = node.parent;
        if (done && task && gapEnd < task.to) {
            specs.push({ from: gapEnd, to: task.to, value: taskDoneContentDeco });
        }
    }

    function isHorizontalRuleLineActive(node: SyntaxNode): boolean {
        if (selFrom !== selTo) {
            return isActive(node.from, node.to);
        }
        // Collapsed caret: anywhere on the rule line reveals raw "---"/"***"/
        // "___" (including end-of-line, where the global isActive half-open
        // rule would keep the styled widget visible).
        return state.doc.lineAt(selFrom).number === state.doc.lineAt(node.from).number;
    }

    // Whole node IS the marker (no separate marker/content split, unlike
    // headings) — away from the cursor it's a styled rule; cursor on the line,
    // no decoration at all, raw "---"/"***"/"___" shows for editing/deleting.
    // Inline replace only — block:true on this tiny span breaks CM6 layout and
    // stops rendering everything below the rule (tables/mermaid use block
    // replace only for full multi-line ranges).
    function handleHorizontalRule(node: SyntaxNode) {
        if (isHorizontalRuleLineActive(node)) { return; }
        specs.push({
            from: node.from,
            to: node.to,
            value: Decoration.replace({ widget: new HorizontalRuleWidget(node.from, node.to) }),
        });
    }

    for (const { from, to } of visibleRanges) {
        syntaxTree(state).iterate({
            from,
            to,
            enter(node) {
                const level = HEADING_LEVEL[node.name];
                if (level) {
                    if ((node.name === 'SetextHeading1' || node.name === 'SetextHeading2')
                        && isSetextUnderlineListMarker(state, node.node)) {
                        handleSetextAsListMarker(node.node);
                    } else {
                        handleHeading(node.node, level);
                    }
                } else if (node.name === 'StrongEmphasis') {
                    handlePairedMarks(node.node, 'EmphasisMark', 'cm-md-strong-content');
                } else if (node.name === 'Emphasis') {
                    handlePairedMarks(node.node, 'EmphasisMark', 'cm-md-em-content');
                } else if (node.name === 'Strikethrough') {
                    handlePairedMarks(node.node, 'StrikethroughMark', 'cm-md-strike-content');
                } else if (node.name === 'InlineCode') {
                    handleInlineCode(node.node);
                } else if (node.name === 'Link') {
                    handleLink(node.node);
                } else if (node.name === 'Image') {
                    handleImage(node.node);
                } else if (node.name === 'Blockquote') {
                    handleBlockquote(node.node);
                } else if (node.name === 'QuoteMark') {
                    handleQuoteMark(node.node);
                } else if (node.name === 'ListMark') {
                    handleListMark(node.node);
                } else if (node.name === 'TaskMarker') {
                    handleTaskMarker(node.node);
                } else if (node.name === 'HorizontalRule') {
                    handleHorizontalRule(node.node);
                }
            },
        });
    }

    appendCalloutDecorationSpecs(state, selFrom, selTo, specs, dimMark, hiddenMark);

    return Decoration.set(specs.map(s => s.value.range(s.from, s.to)), true);
}

let cachedMonoCharWidthPx: number | null = null;

/**
 * Measures `--font-mono`'s real rendered advance width once, via a hidden
 * probe span inserted into the view's own DOM (so it inherits the live theme
 * cascade — no hardcoded font-metrics ratio), then caches the result
 * module-wide. Never re-measured per list or per decoration rebuild — this is
 * the ONE DOM read this feature needs, not a per-list/per-render one. Falls
 * back to DEFAULT_MONO_CHAR_WIDTH_PX if the probe ever reports zero width
 * (e.g. measured before the view has laid out).
 */
function getMonoCharWidthPx(view: EditorView): number {
    if (cachedMonoCharWidthPx !== null) { return cachedMonoCharWidthPx; }
    const probe = document.createElement('span');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.whiteSpace = 'pre';
    probe.style.fontFamily = 'var(--font-mono)';
    probe.style.fontWeight = 'var(--font-mono-weight)';
    probe.style.fontSize = 'var(--font-mono-size)';
    const sample = '00000000';
    probe.textContent = sample;
    view.dom.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    view.dom.removeChild(probe);
    cachedMonoCharWidthPx = width > 0 ? width / sample.length : DEFAULT_MONO_CHAR_WIDTH_PX;
    return cachedMonoCharWidthPx;
}

function buildFromView(view: EditorView): DecorationSet {
    const sel = view.state.selection.main;
    return computeRevealDecorations(view.state, sel.from, sel.to, view.visibleRanges, getMonoCharWidthPx(view));
}

export const livePreviewRevealPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
        this.decorations = buildFromView(view);
    }
    update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
            this.decorations = buildFromView(update.view);
        }
    }
}, {
    decorations: v => v.decorations,
});

// Ordered-marker atomic ranges moved to listMarkerEditing.ts (marker + gap as
// one unit for all list types). computeOrderedMarkerRanges kept for tests that
// assert ordered marker text spans only.
export function computeOrderedMarkerRanges(state: EditorState): VisibleRange[] {
    const ranges: VisibleRange[] = [];
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name === 'ListMark' && computeOrderedMarkerLabel(state, node.node) !== null) {
                const item = node.node.parent;
                if (item && listItemMarkerIsActivated(state, item)) {
                    ranges.push({ from: node.from, to: node.to });
                }
            }
        },
    });
    return ranges;
}
