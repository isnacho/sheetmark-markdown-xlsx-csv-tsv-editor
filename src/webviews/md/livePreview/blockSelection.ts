// Block selection for Notion-style block drag: clicking a block's grip selects the whole block.
//
// Runtime: WEBVIEW (browser). The field and its rules are pure (unit-tested headlessly); the
// layers only run in an EditorView.
//
// Under the hood a block selection is an ordinary text selection over the blocks' full text, so
// copy, cut, Delete and typing behave as with any selection. The field only remembers that the
// selection came from a grip, so the highlight can paint whole blocks (widgets included) instead
// of text runs. Any selection change that no longer matches drops it.
//
// The same module paints the dimmed source while a drag is in progress.

import { EditorSelection, StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, TransactionSpec } from '@codemirror/state';
import { EditorView, layer, RectangleMarker } from '@codemirror/view';

export interface BlockRange { from: number; to: number; }

export const selectBlocksEffect = StateEffect.define<BlockRange | null>();
export const setDragSourceEffect = StateEffect.define<BlockRange | null>();

export const blockSelectionField = StateField.define<BlockRange | null>({
    create: () => null,
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(selectBlocksEffect)) { return effect.value; }
        }
        if (!value) { return null; }
        let next = value;
        if (tr.docChanged) {
            next = { from: tr.changes.mapPos(value.from, 1), to: tr.changes.mapPos(value.to, -1) };
        }
        const sel = tr.state.selection.main;
        if (sel.from !== next.from || sel.to !== next.to) { return null; }
        return next;
    },
});

export const dragSourceField = StateField.define<BlockRange | null>({
    create: () => null,
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setDragSourceEffect)) { return effect.value; }
        }
        return value && tr.docChanged ? null : value;
    },
});

/** Select [from, to] as a block selection. */
export function selectBlocksSpec(range: BlockRange): TransactionSpec {
    return {
        selection: EditorSelection.single(range.from, range.to),
        effects: selectBlocksEffect.of(range),
    };
}

export function activeBlockSelection(state: EditorState): BlockRange | null {
    return state.field(blockSelectionField, false) ?? null;
}

function blockMarkers(view: EditorView, range: BlockRange, className: string): RectangleMarker[] {
    const viewport = view.viewport;
    const from = Math.max(range.from, viewport.from);
    const to = Math.min(range.to, viewport.to);
    if (from > to) { return []; }
    const scroller = view.scrollDOM.getBoundingClientRect();
    const baseTop = scroller.top - view.scrollDOM.scrollTop * view.scaleY;
    const baseLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
    const content = view.contentDOM.getBoundingClientRect();
    const style = getComputedStyle(view.contentDOM);
    const left = (content.left + parseFloat(style.paddingLeft) * view.scaleX - baseLeft) / view.scaleX - 4;
    const right = (content.right - parseFloat(style.paddingRight) * view.scaleX - baseLeft) / view.scaleX + 4;
    const offset = (view.documentTop - baseTop) / view.scaleY;
    const top = view.lineBlockAt(from).top + offset;
    const bottom = view.lineBlockAt(to).bottom + offset;
    return [new RectangleMarker(className, left, top, right - left, bottom - top)];
}

const blockSelectionLayer = layer({
    above: false,
    class: 'cm-md-block-selection-layer',
    update: (update) => update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged
        || update.startState.field(blockSelectionField, false) !== update.state.field(blockSelectionField, false),
    markers(view) {
        const range = view.state.field(blockSelectionField, false);
        return range ? blockMarkers(view, range, 'cm-md-block-selected') : [];
    },
});

const dragSourceLayer = layer({
    above: true,
    class: 'cm-md-block-drag-source-layer',
    update: (update) => update.docChanged || update.viewportChanged || update.geometryChanged
        || update.startState.field(dragSourceField, false) !== update.state.field(dragSourceField, false),
    markers(view) {
        const range = view.state.field(dragSourceField, false);
        return range ? blockMarkers(view, range, 'cm-md-block-drag-source') : [];
    },
});

export const blockSelectionExtensions: Extension = [
    blockSelectionField,
    dragSourceField,
    blockSelectionLayer,
    dragSourceLayer,
    EditorView.editorAttributes.compute([blockSelectionField], (state): Record<string, string> =>
        state.field(blockSelectionField) ? { class: 'cm-md-has-block-selection' } : {}),
];
