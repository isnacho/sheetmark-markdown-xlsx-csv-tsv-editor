// Heading line decorations for Preview Edit gutter alignment.
//
// CM6's height map ignores CSS margins on widgets/lines (codemirror/dev#1164).
// Per-level font-size on the content .cm-line keeps row height in sync with
// heading text. Gutter digits stay uniform 12px (see cm6Theme.ts) — never
// reuse .cm-md-hN on gutter elements.

import { EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { isSetextUnderlineListMarker } from './listSetextAmbiguity';

const HEADING_LEVEL: Record<string, number> = {
    ATXHeading1: 1, ATXHeading2: 2, ATXHeading3: 3, ATXHeading4: 4, ATXHeading5: 5, ATXHeading6: 6,
    SetextHeading1: 1, SetextHeading2: 2,
};

function forEachHeadingLine(state: EditorState, fn: (lineFrom: number, level: number) => void): void {
    const tree = syntaxTree(state);
    if (!tree.length) { return; }
    tree.iterate({
        enter(node) {
            const level = HEADING_LEVEL[node.name];
            if (!level) { return; }
            if (isSetextUnderlineListMarker(state, node.node)) { return; }
            fn(state.doc.lineAt(node.from).from, level);
        },
    });
}

function buildHeadingLineDecorations(state: EditorState): DecorationSet {
    const specs: { from: number; to: number; value: ReturnType<typeof Decoration.line> }[] = [];
    forEachHeadingLine(state, (lineFrom, level) => {
        specs.push({
            from: lineFrom,
            to: lineFrom,
            value: Decoration.line({ class: `cm-md-heading-line cm-md-h${level}` }),
        });
    });
    return specs.length ? Decoration.set(specs) : Decoration.none;
}

export const headingLineDecorationField = StateField.define<DecorationSet>({
    create: (state) => buildHeadingLineDecorations(state),
    update(value, tr) {
        if (!tr.docChanged) {
            return value;
        }
        return buildHeadingLineDecorations(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
});
