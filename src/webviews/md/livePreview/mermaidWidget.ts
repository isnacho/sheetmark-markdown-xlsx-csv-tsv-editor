import { EditorState, EditorSelection, StateField } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { Transaction } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import mermaid from 'mermaid';
import { Icons } from '../../shared/icons';
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

function createToolbar(
    view: EditorView,
    mode: MermaidPreviewMode,
    langLabel: string,
    zoomControls?: HTMLElement,
): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'cm-md-mermaid-toolbar';

    const lang = document.createElement('span');
    lang.className = 'cm-md-mermaid-lang';
    lang.textContent = langLabel;

    toolbar.appendChild(lang);

    const right = document.createElement('div');
    right.className = 'cm-md-mermaid-toolbar-right';
    if (zoomControls) {
        right.appendChild(zoomControls);
    }
    right.appendChild(createModeSelect(view, mode));
    toolbar.appendChild(right);

    return toolbar;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

function clampZoom(scale: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/** Wires Ctrl/Cmd+wheel zoom, drag-to-pan (once zoomed), buttons, and reset onto a rendered diagram. */
function attachZoomPan(diagramWrap: HTMLElement, mermaidEl: HTMLElement): HTMLElement {
    let scale = 1;
    let tx = 0;
    let ty = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const controls = document.createElement('div');
    controls.className = 'cm-md-mermaid-zoom-controls';

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.className = 'cm-md-mermaid-zoom-btn';
    zoomOutBtn.title = 'Zoom out';
    zoomOutBtn.innerHTML = Icons.ZoomOut;

    const pct = document.createElement('span');
    pct.className = 'cm-md-mermaid-zoom-pct';

    const zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.className = 'cm-md-mermaid-zoom-btn';
    zoomInBtn.title = 'Zoom in';
    zoomInBtn.innerHTML = Icons.ZoomIn;

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'cm-md-mermaid-zoom-btn';
    resetBtn.title = 'Reset zoom';
    resetBtn.innerHTML = Icons.ZoomReset;

    controls.append(zoomOutBtn, pct, zoomInBtn, resetBtn);

    function applyTransform(): void {
        mermaidEl.style.transform = scale === 1 && tx === 0 && ty === 0
            ? ''
            : `translate(${tx}px, ${ty}px) scale(${scale})`;
    }

    function updateUI(): void {
        pct.textContent = `${Math.round(scale * 100)}%`;
        pct.style.display = scale === 1 ? 'none' : '';
        zoomOutBtn.disabled = scale <= ZOOM_MIN;
        zoomInBtn.disabled = scale >= ZOOM_MAX;
        diagramWrap.style.cursor = scale > 1 ? 'grab' : 'default';
    }

    function zoomAtPoint(clientX: number, clientY: number, targetScale: number): void {
        const newScale = clampZoom(targetScale);
        if (newScale === scale) {
            return;
        }
        const rect = mermaidEl.getBoundingClientRect();
        const ratio = 1 - newScale / scale;
        tx += (clientX - rect.left) * ratio;
        ty += (clientY - rect.top) * ratio;
        scale = newScale;
        applyTransform();
        updateUI();
    }

    function zoomFromCenter(factor: number): void {
        const rect = diagramWrap.getBoundingClientRect();
        zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, scale * factor);
    }

    function reset(): void {
        scale = 1;
        tx = 0;
        ty = 0;
        applyTransform();
        updateUI();
    }

    for (const btn of [zoomOutBtn, zoomInBtn, resetBtn]) {
        btn.addEventListener('mousedown', (event) => event.stopPropagation());
    }
    zoomOutBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        zoomFromCenter(1 / ZOOM_STEP);
    });
    zoomInBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        zoomFromCenter(ZOOM_STEP);
    });
    resetBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        reset();
    });

    diagramWrap.addEventListener('wheel', (event) => {
        if (!(event.ctrlKey || event.metaKey)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const factor = Math.exp(-event.deltaY * 0.0015);
        zoomAtPoint(event.clientX, event.clientY, scale * factor);
    }, { passive: false });

    diagramWrap.addEventListener('pointerdown', (event) => {
        if (scale <= 1) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        diagramWrap.setPointerCapture(event.pointerId);
        diagramWrap.style.cursor = 'grabbing';
    });
    diagramWrap.addEventListener('pointermove', (event) => {
        if (!dragging) {
            return;
        }
        tx += event.clientX - lastX;
        ty += event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        applyTransform();
    });
    const endDrag = (event: PointerEvent): void => {
        if (!dragging) {
            return;
        }
        dragging = false;
        diagramWrap.style.cursor = scale > 1 ? 'grab' : 'default';
        if (diagramWrap.hasPointerCapture(event.pointerId)) {
            diagramWrap.releasePointerCapture(event.pointerId);
        }
    };
    diagramWrap.addEventListener('pointerup', endDrag);
    diagramWrap.addEventListener('pointercancel', endDrag);
    diagramWrap.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        reset();
    });

    updateUI();
    return controls;
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

        const diagramWrap = document.createElement('div');
        diagramWrap.className = 'cm-md-mermaid-diagram';

        const mermaidEl = document.createElement('div');
        mermaidEl.className = 'mermaid';
        mermaidEl.textContent = this.source;
        diagramWrap.appendChild(mermaidEl);

        const zoomControls = attachZoomPan(diagramWrap, mermaidEl);
        block.appendChild(createToolbar(view, this.mode, this.langLabel, zoomControls));
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

/** CM6 parses large docs incrementally; widget fields must rebuild when the tree extends. */
function shouldRebuildMermaidWidgets(tr: Transaction): boolean {
    return tr.docChanged
        || tr.effects.some((effect) => effect.is(setMermaidPreviewModeEffect))
        || syntaxTree(tr.state).length > syntaxTree(tr.startState).length;
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

function buildMermaidAtomicRanges(view: EditorView): DecorationSet {
    const state = view.state;
    if (state.field(mermaidPreviewModeField) !== 'diagram') {
        return Decoration.none;
    }
    const marker = Decoration.mark({});
    const ranges: { from: number; to: number }[] = [];
    for (const { from, to } of view.visibleRanges) {
        ranges.push(...findMermaidFenceRanges(state, { from, to }));
    }
    return Decoration.set(ranges.map((range) => marker.range(range.from, range.to)));
}

export const mermaidAtomicRanges = EditorView.atomicRanges.of((view) => buildMermaidAtomicRanges(view));
