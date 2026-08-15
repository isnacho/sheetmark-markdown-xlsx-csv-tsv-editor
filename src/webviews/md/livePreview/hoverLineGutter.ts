// Hover indicator for the Preview Edit line-number gutter.
//
// Runtime: WEBVIEW (browser). No Node / no `vscode` module here.
//
// A subtle, muted sibling to CM6's built-in `highlightActiveLineGutter()`
// (styled in cm6Theme.ts): as the mouse moves over the gutter, whichever
// row it's over gets a `cm-md-hover-line-gutter` class. When the hovered
// row is also the active (cursor) line, the active-line styling wins
// outright — enforced here at the data layer (gutterLineClass compute),
// not left to CSS paint order.

import { EditorView, GutterMarker, gutterLineClass } from '@codemirror/view';
import type { BlockInfo } from '@codemirror/view';
import { StateField, StateEffect, RangeSet } from '@codemirror/state';

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

/** CM6 extensions for the hovered-line state itself (field + gutter-class facet). */
export function hoverLineGutter() {
    return [hoveredLineField, hoverGutterHighlighter];
}

/**
 * `domEventHandlers` to merge into `lineNumbers({ domEventHandlers })`.
 *
 * Deliberately NOT `EditorView.domEventHandlers` — that API only attaches
 * listeners to `view.contentDOM`, which never receives events that occur
 * purely over the gutter (a sibling DOM subtree, not a descendant of
 * contentDOM), so a mousemove-only-over-the-gutter approach built on it
 * would silently never fire. The gutter's own `domEventHandlers` config
 * (already used for the click-to-select-line handler below) attaches
 * directly to the gutter's DOM instead.
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
            const contentLeft = view.contentDOM.getBoundingClientRect().left;
            const pos = view.posAtCoords({ x: contentLeft + 4, y: mouse.clientY });
            if (pos === null) { return false; }
            const line = view.state.doc.lineAt(pos);
            const current = view.state.field(hoveredLineField);
            const currentLineNumber = current === null ? null : view.state.doc.lineAt(current).number;
            if (currentLineNumber !== line.number) {
                view.dispatch({ effects: setHoveredLine.of(line.from) });
            }
            return false;
        },
        // Fires when the pointer leaves the gutter's own DOM box (mouseleave
        // doesn't bubble, but still fires on the element it's attached to).
        mouseleave(view) {
            if (view.state.field(hoveredLineField) !== null) {
                view.dispatch({ effects: setHoveredLine.of(null) });
            }
            return false;
        },
    };
}
