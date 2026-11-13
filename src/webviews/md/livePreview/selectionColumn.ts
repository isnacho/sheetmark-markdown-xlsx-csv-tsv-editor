// Selection highlight kept inside the text column. Runtime: WEBVIEW.
//
// CodeMirror measures selection boxes from the content element's outer edge plus the first line's
// padding. Here the side gutters (`--cm-md-content-inset`, 40px each side) are padding on the
// content element itself, so a selection over several lines painted 40px into both gutters, and
// selecting just a line break drew a box in the left gutter. This layer draws the same boxes,
// trimmed to the text column, and CodeMirror's own selection layer is hidden.

import { EditorView, layer, RectangleMarker } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export interface SelectionBox { left: number; top: number; width: number; height: number }

/** Trim a box to [columnLeft, columnRight]; null when nothing of it is left inside the column. */
export function clampToColumn(box: SelectionBox, columnLeft: number, columnRight: number): SelectionBox | null {
    const left = Math.max(box.left, columnLeft);
    const right = Math.min(box.left + box.width, columnRight);
    if (right - left < 0.5) { return null; }
    return { left, top: box.top, width: right - left, height: box.height };
}

const columnSelectionLayer = layer({
    above: false,
    class: 'cm-md-selection-column',
    update: (update) => update.docChanged || update.selectionSet || update.viewportChanged,
    markers(view) {
        const ranges = view.state.selection.ranges.filter(range => !range.empty);
        if (ranges.length === 0) { return []; }
        const scroller = view.scrollDOM.getBoundingClientRect();
        const baseLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
        const content = view.contentDOM.getBoundingClientRect();
        const style = getComputedStyle(view.contentDOM);
        const columnLeft = content.left + parseFloat(style.paddingLeft) * view.scaleX - baseLeft;
        const columnRight = content.right - parseFloat(style.paddingRight) * view.scaleX - baseLeft;
        const markers: RectangleMarker[] = [];
        for (const range of ranges) {
            for (const marker of RectangleMarker.forRange(view, 'cm-selectionBackground', range)) {
                const box = clampToColumn(
                    { left: marker.left, top: marker.top, width: marker.width ?? columnRight - marker.left, height: marker.height },
                    columnLeft, columnRight);
                if (box) { markers.push(new RectangleMarker('cm-selectionBackground', box.left, box.top, box.width, box.height)); }
            }
        }
        return markers;
    },
});

/** Add after `drawSelection()`, which still draws the cursor. */
export const textColumnSelection: Extension = [
    columnSelectionLayer,
    EditorView.theme({
        '.cm-selectionLayer': { display: 'none' },
        // Behind the text, like CodeMirror's own selection layer; the colour comes from the
        // `.cm-selectionBackground` rule in cm6Theme.
        '.cm-md-selection-column': { zIndex: '-1' },
    }),
];
