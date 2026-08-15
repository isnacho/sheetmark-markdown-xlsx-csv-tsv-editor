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

/** Parses the first item's own typed starting number off its ListMark text (drops the trailing "."/")" ). */
export function orderedListStartNumber(state: EditorState, list: SyntaxNode): number {
    const mark = list.firstChild?.getChild('ListMark');
    if (!mark) { return 1; }
    const n = parseInt(state.sliceDoc(mark.from, mark.to - 1), 10);
    return Number.isFinite(n) ? n : 1;
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
    const value = orderedListStartNumber(state, list) + listItemPosition(item);
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
        return box;
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
        return span;
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
        return span;
    }
    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Pure, headless-testable core: given a doc state, the primary selection range,
 * and the ranges actually worth decorating (view.visibleRanges in production,
 * [{from:0, to:doc.length}] in tests), returns the decoration set. No EditorView
 * / DOM involved.
 */
const dimMark = Decoration.mark({ class: 'cm-md-reveal-mark' });
const hiddenMark = Decoration.replace({});

export function computeRevealDecorations(
    state: EditorState,
    selFrom: number,
    selTo: number,
    visibleRanges: readonly VisibleRange[],
): DecorationSet {
    const specs: Spec[] = [];

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

    // Always-on (see the Phase 7 design note above) — no isActive() branch.
    // Three-way split, checked in this order: ordered markers get the
    // depth-cycling/auto-numbering widget (must run first — a numbered
    // checklist like "1. [ ] a" has no dash to hide, so it must land here, not
    // the task branch below); bullet markers on a checkbox item get their dash
    // hidden (the checkbox already signals "list item," the dash is
    // redundant); plain bullet markers get the dot widget (filled/outline by
    // depth — see BulletMarkerWidget).
    function handleListMark(node: SyntaxNode) {
        const orderedLabel = computeOrderedMarkerLabel(state, node);
        if (orderedLabel !== null) {
            specs.push({ from: node.from, to: node.to, value: Decoration.replace({ widget: new OrderedMarkerWidget(orderedLabel) }) });
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
    }

    // Always-on (see the Phase 7 design note above) — no isActive() branch.
    function handleTaskMarker(node: SyntaxNode) {
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
                    handleHeading(node.node, level);
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

function buildFromView(view: EditorView): DecorationSet {
    const sel = view.state.selection.main;
    return computeRevealDecorations(view.state, sel.from, sel.to, view.visibleRanges);
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

// ===== Ordered-marker atomicity (list-editing-polish idea) =====
// The cursor must never rest strictly INSIDE a multi-character ordered-list
// marker ("12.", "3)") — landing there via click or arrow key should snap to
// just before or after it. Bullet markers are single-character, so this
// doesn't apply to them (no "inside" position exists for a 1-char span).
// First real use of EditorView.atomicRanges in this codebase — the other
// comment in this file about atomic ranges (near the top) documents a
// deliberate decision NOT to use the facet for reveal-on-cursor hiding, for an
// unrelated reason (progressive reveal on approach); it doesn't apply here,
// since this is about blocking the cursor from landing inside VISIBLE marker
// text, not un-hiding a hidden one.

/** Pure, headlessly testable: every OrderedList ListMark span in the whole document. */
export function computeOrderedMarkerRanges(state: EditorState): VisibleRange[] {
    const ranges: VisibleRange[] = [];
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name === 'ListMark' && computeOrderedMarkerLabel(state, node.node) !== null) {
                ranges.push({ from: node.from, to: node.to });
            }
        },
    });
    return ranges;
}

// Deliberately scans the WHOLE document, not just view.visibleRanges: every
// consumer of this facet (arrow-key motion, click resolution, Mod-g jump-to-
// line) queries it fresh against the view's current state at the moment a
// motion is resolved, including jumps to positions that are off-screen at
// query time — scoping to visibleRanges would let the cursor land inside an
// off-screen marker uncorrected. Mirrors tableWidgetField's same whole-doc-scan
// tradeoff (tableWidget.ts), for a related reason.
function buildOrderedMarkerAtomicRanges(state: EditorState): DecorationSet {
    const marker = Decoration.mark({});
    return Decoration.set(computeOrderedMarkerRanges(state).map(r => marker.range(r.from, r.to)));
}

export const orderedListAtomicRanges = EditorView.atomicRanges.of((view) => buildOrderedMarkerAtomicRanges(view.state));
