// Highlights the gutter line number for the scroll-spy "current heading" (outline rail active).
// Runtime: WEBVIEW (browser).

import { StateField, StateEffect, RangeSet } from '@codemirror/state';
import { EditorView, GutterMarker, gutterLineClass } from '@codemirror/view';

export const setOutlineActiveHeadingLine = StateEffect.define<number | null>();

const outlineActiveHeadingLineField = StateField.define<number | null>({
    create: () => null,
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setOutlineActiveHeadingLine)) {
                return effect.value;
            }
        }
        return value;
    },
});

class OutlineActiveHeadingGutterMarker extends GutterMarker {
    elementClass = 'cm-md-outline-active-heading-gutter';
}
const outlineActiveHeadingGutterMarker = new OutlineActiveHeadingGutterMarker();

const outlineActiveHeadingGutterHighlighter = gutterLineClass.compute(
    [outlineActiveHeadingLineField, 'selection'],
    (state) => {
        const lineNumber = state.field(outlineActiveHeadingLineField);
        if (lineNumber === null || lineNumber < 1 || lineNumber > state.doc.lines) {
            return RangeSet.empty;
        }
        const activeLine = state.doc.lineAt(state.selection.main.head);
        if (activeLine.number === lineNumber) {
            return RangeSet.empty;
        }
        const line = state.doc.line(lineNumber);
        return RangeSet.of([outlineActiveHeadingGutterMarker.range(line.from)]);
    },
);

export function outlineActiveHeadingGutter() {
    return [outlineActiveHeadingLineField, outlineActiveHeadingGutterHighlighter];
}

export function syncOutlineActiveHeadingLine(view: EditorView | null, lineNumber: number | null): void {
    if (!view) { return; }
    const current = view.state.field(outlineActiveHeadingLineField);
    if (current === lineNumber) { return; }
    view.dispatch({ effects: setOutlineActiveHeadingLine.of(lineNumber) });
}
