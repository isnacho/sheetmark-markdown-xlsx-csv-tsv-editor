import { EditorState, StateField } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
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
    type MermaidPreviewMode,
} from './mermaidPreviewMode';
import { createFenceChrome } from './fenceChromeWidget';
import {
    createMermaidModeSelect,
    shouldRebuildMermaidDecorations,
    setMermaidPreviewModeCallback,
} from './mermaidPreviewActions';

export type { MermaidPreviewMode } from './mermaidPreviewMode';
export {
    mermaidPreviewModeField,
    setMermaidPreviewModeEffect,
    seedMermaidPreviewMode,
} from './mermaidPreviewMode';
export { setMermaidPreviewModeCallback } from './mermaidPreviewActions';

function getMermaidTheme(): 'default' | 'dark' {
    const isDark = document.body.classList.contains('dark-mode')
        || document.body.classList.contains('dark-theme')
        || document.body.classList.contains('vscode-dark')
        || (document.body.classList.contains('vscode-theme') && document.body.classList.contains('vscode-dark'));
    return isDark ? 'dark' : 'default';
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

function clampZoom(scale: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

function isFenceChromeTarget(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('.cm-md-fence-chrome');
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
        if (isFenceChromeTarget(event.target)) {
            return;
        }
        if (!(event.ctrlKey || event.metaKey)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const factor = Math.exp(-event.deltaY * 0.0015);
        zoomAtPoint(event.clientX, event.clientY, scale * factor);
    }, { passive: false });

    mermaidEl.addEventListener('pointerdown', (event) => {
        if (scale <= 1) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        mermaidEl.setPointerCapture(event.pointerId);
        diagramWrap.style.cursor = 'grabbing';
    });
    mermaidEl.addEventListener('pointermove', (event) => {
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
        if (mermaidEl.hasPointerCapture(event.pointerId)) {
            mermaidEl.releasePointerCapture(event.pointerId);
        }
    };
    mermaidEl.addEventListener('pointerup', endDrag);
    mermaidEl.addEventListener('pointercancel', endDrag);
    mermaidEl.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        reset();
    });

    updateUI();
    return controls;
}

class MermaidDiagramWidget extends WidgetType {
    private readonly mode: MermaidPreviewMode;
    private readonly langLabel: string;
    private readonly source: string;
    private readonly theme: 'default' | 'dark';

    constructor(
        mode: MermaidPreviewMode,
        langLabel: string,
        source: string,
        theme: 'default' | 'dark',
    ) {
        super();
        this.mode = mode;
        this.langLabel = langLabel;
        this.source = source;
        this.theme = theme;
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
        const chrome = createFenceChrome({
            copyText: this.source,
            overlay: true,
            leadingActions: [zoomControls, createMermaidModeSelect(view, this.mode)],
        });
        diagramWrap.appendChild(chrome);
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
    if (mode === 'code') {
        return Decoration.none;
    }
    const theme = getMermaidTheme();
    const specs: ReturnType<Decoration['range']>[] = [];

    syntaxTree(state).iterate({
        enter(node) {
            if (node.name !== 'FencedCode' || !isMermaidFence(state, node.node)) {
                return;
            }
            const langLabel = mermaidFenceDisplayLang(state, node.node);
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
        },
    });

    return Decoration.set(specs, true);
}

/** CM6 parses large docs incrementally; widget fields must rebuild when the tree extends. */
function shouldRebuildMermaidWidgets(tr: import('@codemirror/state').Transaction): boolean {
    return shouldRebuildMermaidDecorations(tr)
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
