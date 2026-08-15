import { EditorState, EditorSelection, StateField } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { Transaction } from '@codemirror/state';
import mermaid from 'mermaid';
import {
    findMermaidFenceRanges,
    isMermaidFence,
    mermaidFenceDisplayLang,
    extractMermaidSource,
} from './mermaidDetection';
import {
    mermaidPreviewModeField,
    setMermaidPreviewModeEffect,
    type MermaidPreviewMode,
} from './mermaidPreviewMode';

export type { MermaidPreviewMode } from './mermaidPreviewMode';
export { mermaidPreviewModeField, setMermaidPreviewModeEffect, seedMermaidPreviewMode } from './mermaidPreviewMode';

let onMermaidPreviewModeChangedCallback: ((mode: MermaidPreviewMode) => void) | undefined;

export function setMermaidPreviewModeCallback(callback: ((mode: MermaidPreviewMode) => void) | undefined): void {
    onMermaidPreviewModeChangedCallback = callback;
}

function getMermaidTheme(): 'default' | 'dark' {
    const isDark = document.body.classList.contains('dark-mode')
        || document.body.classList.contains('dark-theme')
        || document.body.classList.contains('vscode-dark')
        || (document.body.classList.contains('vscode-theme') && document.body.classList.contains('vscode-dark'));
    return isDark ? 'dark' : 'default';
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

function dispatchMermaidPreviewMode(view: EditorView, mode: MermaidPreviewMode): void {
    const selection = mode === 'diagram' ? adjustSelectionForDiagramMode(view.state) : undefined;
    view.dispatch({
        effects: setMermaidPreviewModeEffect.of(mode),
        ...(selection ? { selection } : {}),
    });
    onMermaidPreviewModeChangedCallback?.(mode);
}

function createModeSelect(view: EditorView, mode: MermaidPreviewMode): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'cm-md-mermaid-mode-select';
    select.title = 'Preview mode';
    for (const [value, label] of [['diagram', 'Diagram'], ['code', 'Code']] as const) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = mode === value;
        select.appendChild(option);
    }
    select.addEventListener('mousedown', (event) => event.stopPropagation());
    select.addEventListener('change', () => {
        const next = select.value === 'code' ? 'code' : 'diagram';
        dispatchMermaidPreviewMode(view, next);
    });
    return select;
}

function createToolbar(view: EditorView, mode: MermaidPreviewMode, langLabel: string): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'cm-md-mermaid-toolbar';

    const lang = document.createElement('span');
    lang.className = 'cm-md-mermaid-lang';
    lang.textContent = langLabel;

    toolbar.appendChild(lang);
    toolbar.appendChild(createModeSelect(view, mode));
    return toolbar;
}

class MermaidToolbarWidget extends WidgetType {
    constructor(
        private readonly mode: MermaidPreviewMode,
        private readonly langLabel: string,
    ) {
        super();
    }

    eq(other: MermaidToolbarWidget): boolean {
        return other.mode === this.mode && other.langLabel === this.langLabel;
    }

    ignoreEvent(): boolean {
        return true;
    }

    toDOM(view: EditorView): HTMLElement {
        return createToolbar(view, this.mode, this.langLabel);
    }
}

class MermaidDiagramWidget extends WidgetType {
    constructor(
        private readonly mode: MermaidPreviewMode,
        private readonly langLabel: string,
        private readonly source: string,
        private readonly theme: 'default' | 'dark',
    ) {
        super();
    }

    eq(other: MermaidDiagramWidget): boolean {
        return other.mode === this.mode
            && other.langLabel === this.langLabel
            && other.source === this.source
            && other.theme === this.theme;
    }

    ignoreEvent(): boolean {
        return true;
    }

    toDOM(view: EditorView): HTMLElement {
        const block = document.createElement('div');
        block.className = 'cm-md-mermaid-block';
        block.appendChild(createToolbar(view, this.mode, this.langLabel));

        const diagramWrap = document.createElement('div');
        diagramWrap.className = 'cm-md-mermaid-diagram';

        const mermaidEl = document.createElement('div');
        mermaidEl.className = 'mermaid';
        mermaidEl.textContent = this.source;
        diagramWrap.appendChild(mermaidEl);
        block.appendChild(diagramWrap);

        mermaid.initialize({ startOnLoad: false, theme: this.theme });
        void mermaid.run({ nodes: [mermaidEl] }).catch((err: unknown) => {
            console.error('Mermaid render error:', err);
            diagramWrap.textContent = '';
            const errorEl = document.createElement('div');
            errorEl.className = 'cm-md-mermaid-error';
            errorEl.textContent = 'Mermaid syntax error — switch to Code to edit';
            diagramWrap.appendChild(errorEl);
        });

        return block;
    }
}

/** CM6 parses large docs incrementally; widget fields must rebuild when the tree extends. */
function shouldRebuildMermaidWidgets(tr: Transaction): boolean {
    return tr.docChanged
        || tr.effects.some((effect) => effect.is(setMermaidPreviewModeEffect))
        || syntaxTree(tr.state).length > syntaxTree(tr.startState).length;
}

function buildFromState(state: EditorState): DecorationSet {
    const mode = state.field(mermaidPreviewModeField);
    const theme = getMermaidTheme();
    const specs: ReturnType<Decoration['range']>[] = [];

    syntaxTree(state).iterate({
        enter(node) {
            if (node.name !== 'FencedCode' || !isMermaidFence(state, node.node)) {
                return;
            }
            const langLabel = mermaidFenceDisplayLang(state, node.node);
            if (mode === 'code') {
                specs.push(
                    Decoration.widget({
                        block: true,
                        side: -1,
                        widget: new MermaidToolbarWidget(mode, langLabel),
                    }).range(node.from),
                );
            } else {
                specs.push(
                    Decoration.replace({
                        block: true,
                        widget: new MermaidDiagramWidget(
                            mode,
                            langLabel,
                            extractMermaidSource(state, node.node),
                            theme,
                        ),
                    }).range(node.from, node.to),
                );
            }
        },
    });

    return Decoration.set(specs, true);
}

export const mermaidWidgetField = StateField.define<DecorationSet>({
    create: (state) => buildFromState(state),
    update(value, tr) {
        if (!shouldRebuildMermaidWidgets(tr)) {
            return value;
        }
        return buildFromState(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
});

function buildMermaidAtomicRanges(state: EditorState): DecorationSet {
    if (state.field(mermaidPreviewModeField) !== 'diagram') {
        return Decoration.none;
    }
    const marker = Decoration.mark({});
    return Decoration.set(
        findMermaidFenceRanges(state).map((range) => marker.range(range.from, range.to)),
    );
}

export const mermaidAtomicRanges = EditorView.atomicRanges.of((view) => buildMermaidAtomicRanges(view.state));
