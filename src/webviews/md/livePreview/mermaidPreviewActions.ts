import { EditorSelection, EditorState } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { findMermaidFenceRanges } from './mermaidDetection';
import {
    mermaidPreviewModeField,
    setMermaidPreviewModeEffect,
    type MermaidPreviewMode,
} from './mermaidPreviewMode';

let onMermaidPreviewModeChangedCallback: ((mode: MermaidPreviewMode) => void) | undefined;

export function setMermaidPreviewModeCallback(callback: ((mode: MermaidPreviewMode) => void) | undefined): void {
    onMermaidPreviewModeChangedCallback = callback;
}

function adjustSelectionForDiagramMode(state: EditorState): EditorSelection | undefined {
    const { from, to } = state.selection.main;
    let nextFrom = from;
    let nextTo = to;
    let changed = false;

    for (const fence of findMermaidFenceRanges(state)) {
        if (nextFrom > fence.from && nextFrom < fence.to) {
            nextFrom = fence.to;
            changed = true;
        }
        if (nextTo > fence.from && nextTo < fence.to) {
            nextTo = fence.to;
            changed = true;
        }
        if (nextFrom <= fence.from && nextTo >= fence.to) {
            nextTo = fence.to;
            if (nextFrom >= fence.from) {
                nextFrom = fence.to;
            }
            changed = true;
        }
    }

    if (!changed) {
        return undefined;
    }
    return EditorSelection.single(nextFrom, nextTo);
}

export function dispatchMermaidPreviewMode(view: EditorView, mode: MermaidPreviewMode): void {
    const selection = mode === 'diagram' ? adjustSelectionForDiagramMode(view.state) : undefined;
    view.dispatch({
        effects: setMermaidPreviewModeEffect.of(mode),
        ...(selection ? { selection } : {}),
    });
    onMermaidPreviewModeChangedCallback?.(mode);
}

export function createMermaidModeSelect(view: EditorView, mode: MermaidPreviewMode): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'cm-md-mermaid-mode-select';
    select.title = 'Preview mode';
    select.disabled = view.state.readOnly;
    for (const [value, label] of [['diagram', 'Diagram'], ['code', 'Code']] as const) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = mode === value;
        select.appendChild(option);
    }
    select.addEventListener('mousedown', (event) => event.stopPropagation());
    select.addEventListener('pointerdown', (event) => event.stopPropagation());
    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('change', () => {
        const next = select.value === 'code' ? 'code' : 'diagram';
        dispatchMermaidPreviewMode(view, next);
    });
    return select;
}

export function shouldRebuildMermaidDecorations(tr: Transaction): boolean {
    return tr.docChanged
        || tr.effects.some((effect) => effect.is(setMermaidPreviewModeEffect))
        || tr.startState.field(mermaidPreviewModeField) !== tr.state.field(mermaidPreviewModeField);
}
