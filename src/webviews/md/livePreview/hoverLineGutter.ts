// Hover indicator for the Preview Edit line-number gutter.
//
// Runtime: WEBVIEW (browser). No Node / no `vscode` module here.
//
// A subtle, muted sibling to CM6's built-in `highlightActiveLineGutter()`
// (styled in cm6Theme.ts): as the mouse moves over a row — either its
// gutter cell or its text — that row's gutter cell gets a
// `cm-md-hover-line-gutter` class. The rendered effect stays gutter-only
// (no tint in the content/text column); only the *detection area* covers
// the whole row. When the hovered row is also the active (cursor) line,
// the active-line styling wins outright — enforced here at the data layer
// (gutterLineClass compute), not left to CSS paint order.
//
// Two separate DOM event sources feed the same state, because the gutter
// and the content column are sibling DOM subtrees (see the doc comments
// below on each handler set for why neither alone covers both areas).

import { EditorView, GutterMarker, gutterLineClass } from '@codemirror/view';
import type { BlockInfo } from '@codemirror/view';
import { StateField, StateEffect, RangeSet } from '@codemirror/state';

/** Keep in sync with pointerLineResolution.ts (not imported here — node tests load this module directly). */
function resolveLinePosAtPointer(view: EditorView, clientY: number, target: EventTarget | null): number {
    if (target instanceof Node) {
        let el: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement;
        while (el && el !== view.contentDOM) {
            if (el.classList.contains('cm-line')) {
                try { return view.posAtDOM(el, 0); } catch { break; }
            }
            el = el.parentElement;
        }
    }
    return view.lineBlockAtHeight(clientY - view.documentTop).from;
}

/** Exported for hoverLineGutter.test.mts (headless state-layer verification). */
export const setHoveredLine = StateEffect.define<number | null>();

// Resets to null on any doc change rather than remapping the position —
// simplest safe behavior; the next mousemove re-establishes it.
const hoveredLineField = StateField.define<number | null>({
    create: () => null,
    update(value, tr) {
        if (tr.docChanged) { return null; }
        for (const effect of tr.effects) {
            if (effect.is(setHoveredLine)) { value = effect.value; }
        }
        return value;
    },
});

class HoverLineGutterMarker extends GutterMarker {
    elementClass = 'cm-md-hover-line-gutter';
}
const hoverLineGutterMarker = new HoverLineGutterMarker();

// Mirrors CM6's own `activeLineGutterHighlighter` (view package internals):
// a gutterLineClass facet computed from state, re-run on selection changes
// too so the active-line-wins suppression below stays correct as the
// cursor moves without any mouse activity.
const hoverGutterHighlighter = gutterLineClass.compute([hoveredLineField, 'selection'], (state) => {
    const hoveredPos = state.field(hoveredLineField);
    if (hoveredPos === null) { return RangeSet.empty; }
    const hoveredLine = state.doc.lineAt(hoveredPos);
    const activeLine = state.doc.lineAt(state.selection.main.head);
    if (activeLine.number === hoveredLine.number) { return RangeSet.empty; }
    return RangeSet.of([hoverLineGutterMarker.range(hoveredLine.from)]);
});

/** Dispatches `setHoveredLine` only when the resolved line actually changes. */
function updateHoveredLine(view: EditorView, docPos: number): void {
    const line = view.state.doc.lineAt(docPos);
    const current = view.state.field(hoveredLineField);
    const currentLineNumber = current === null ? null : view.state.doc.lineAt(current).number;
    if (currentLineNumber !== line.number) {
        view.dispatch({ effects: setHoveredLine.of(line.from) });
    }
}

/** Clears the hovered-line state, if set. Shared by both handler sets' `mouseleave`. */
function clearHoveredLine(view: EditorView): void {
    if (view.state.field(hoveredLineField) !== null) {
        view.dispatch({ effects: setHoveredLine.of(null) });
    }
}

/**
 * CM6 extensions for the hovered-line state itself: the field, the
 * gutter-class facet, and content-column `mousemove`/`mouseleave` handlers
 * (`EditorView.domEventHandlers` attaches these to `view.contentDOM`, so
 * they only ever see events over the text column — the gutter is a sibling
 * DOM subtree and needs its own handlers; see `hoverGutterDomEventHandlers`
 * below, wired separately into `lineNumbers({ domEventHandlers })`).
 */
export function hoverLineGutter() {
    return [
        hoveredLineField,
        hoverGutterHighlighter,
        EditorView.domEventHandlers({
            mousemove(event, view) {
                updateHoveredLine(view, resolveLinePosAtPointer(view, event.clientY, event.target));
                return false;
            },
            mouseleave(_event, view) {
                clearHoveredLine(view);
                return false;
            },
        }),
    ];
}

/**
 * `domEventHandlers` to merge into `lineNumbers({ domEventHandlers })`.
 *
 * Deliberately NOT (only) `EditorView.domEventHandlers` — that API attaches
 * listeners to `view.contentDOM`, which never receives events that occur
 * purely over the gutter (a sibling DOM subtree, not a descendant of
 * contentDOM), so a mousemove-only-over-the-gutter approach built on it
 * would silently never fire there. The gutter's own `domEventHandlers`
 * config (already used for the click-to-select-line handler below) attaches
 * directly to the gutter's DOM instead, covering the other half of the row.
 */
export function hoverGutterDomEventHandlers(): Record<string, (view: EditorView, line: BlockInfo, event: Event) => boolean> {
    return {
        // Resolves the line via the content column's X instead of trusting
        // the `line` CM6 already computed for us — same fix already applied
        // to the click handler (CM6 otherwise resolves from the gutter
        // cell's vertical midpoint, which reads one line off on tall/wrapped
        // rows).
        mousemove(view, _line, event) {
            const mouse = event as MouseEvent;
            updateHoveredLine(view, resolveLinePosAtPointer(view, mouse.clientY, mouse.target));
            return false;
        },
        // Fires when the pointer leaves the gutter's own DOM box (mouseleave
        // doesn't bubble, but still fires on the element it's attached to).
        mouseleave(view) {
            clearHoveredLine(view);
            return false;
        },
    };
}
