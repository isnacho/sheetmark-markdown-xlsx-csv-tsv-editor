// Reveal-on-cursor decoration engine for the Markdown "Preview Edit" mode.
//
// Runtime: WEBVIEW (browser) for the ViewPlugin; the pure `computeRevealDecorations`
// below has no DOM dependency and is exercised headlessly in
// revealDecorations.test.mts.
//
// v1 scope (per the plan): headings (ATX + Setext) + bold (StrongEmphasis) +
// italic (Emphasis), including the nested ***bold-italic*** case. Strikethrough/
// inline-code/links/blockquote/lists follow in Phase 7, reusing this machinery.
//
// Design: content styling (heading-size / bold-weight / italic-style) is
// ALWAYS applied, independent of the selection — a heading stays reader-sized
// and bold/italic content stays weighted/styled whether or not the cursor is
// in it (confirmed against real usage: headings should keep their size when
// selected). Only the marker's visibility toggles: hidden (Decoration.replace)
// when the selection doesn't intersect the element, shown dimmed
// (Decoration.mark) when it does. This sidesteps the plan's "block-height
// reveal" hazard entirely for headings, since size no longer changes on
// cursor enter/exit — there's nothing left to cause a scroll jump.
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

import { EditorState } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

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

interface Spec {
    from: number;
    to: number;
    value: ReturnType<typeof Decoration.mark> | ReturnType<typeof Decoration.replace>;
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
): DecorationSet {
    const specs: Spec[] = [];
    const dimMark = Decoration.mark({ class: 'cm-md-reveal-mark' });
    const hiddenMark = Decoration.replace({});

    const isActive = (from: number, to: number) => rangesIntersect(selFrom, selTo, from, to);

    function handleHeading(node: SyntaxNode, level: number) {
        const marks = node.getChildren('HeaderMark');
        if (marks.length === 0) { return; }
        const open = marks[0];
        // The grammar skips exactly one space after the opening marker without
        // giving it a node of its own — hide it too so text doesn't start with
        // a leading space once the marker's hidden.
        const hasGapSpace = state.sliceDoc(open.to, open.to + 1) === ' ';
        const gapEnd = hasGapSpace ? open.to + 1 : open.to;
        const active = isActive(node.from, node.to);

        specs.push({ from: open.from, to: open.to, value: active ? dimMark : hiddenMark });
        if (!active && hasGapSpace) {
            specs.push({ from: open.to, to: gapEnd, value: hiddenMark });
        }
        // Rare closing "## Title ##" form: hide/dim the closer(s) symmetrically.
        for (let i = 1; i < marks.length; i++) {
            const closer = marks[i];
            specs.push({ from: closer.from, to: closer.to, value: active ? dimMark : hiddenMark });
        }
        specs.push({ from: gapEnd, to: node.to, value: Decoration.mark({ class: `cm-md-heading-content cm-md-h${level}` }) });
    }

    function handlePairedMarks(node: SyntaxNode, contentClass: string) {
        const marks = node.getChildren('EmphasisMark');
        if (marks.length < 2) { return; }
        const open = marks[0];
        const close = marks[marks.length - 1];
        const active = isActive(node.from, node.to);

        specs.push({ from: open.from, to: open.to, value: active ? dimMark : hiddenMark });
        specs.push({ from: close.from, to: close.to, value: active ? dimMark : hiddenMark });
        specs.push({ from: open.to, to: close.from, value: Decoration.mark({ class: contentClass }) });
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
                    handlePairedMarks(node.node, 'cm-md-strong-content');
                } else if (node.name === 'Emphasis') {
                    handlePairedMarks(node.node, 'cm-md-em-content');
                }
            },
        });
    }

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
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = buildFromView(update.view);
        }
    }
}, {
    decorations: v => v.decorations,
});
