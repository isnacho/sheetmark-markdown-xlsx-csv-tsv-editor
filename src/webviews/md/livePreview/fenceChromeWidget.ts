import { EditorState, StateField } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { Icons } from '../../shared/icons';
import { extractFenceBody } from './fenceExtraction';
import { fenceExternalGapFlags } from './codeStyling';
import { isMermaidFence } from './mermaidDetection';
import { mermaidPreviewModeField, type MermaidPreviewMode } from './mermaidPreviewMode';
import { createMermaidModeSelect } from './mermaidPreviewActions';

let onFenceCopyCallback: ((success: boolean) => void) | undefined;

export function setFenceCopyCallback(callback: ((success: boolean) => void) | undefined): void {
    onFenceCopyCallback = callback;
}

function copyToClipboard(text: string): void {
    if (!navigator.clipboard) {
        onFenceCopyCallback?.(false);
        return;
    }
    navigator.clipboard.writeText(text)
        .then(() => onFenceCopyCallback?.(true))
        .catch(() => onFenceCopyCallback?.(false));
}

export interface FenceChromeOptions {
    copyText: string;
    fenceFrom?: number;
    /** Reserve space above the opening fence line (outside the card). */
    headGap?: boolean;
    /** Inserted before the copy button (zoom controls, mode select, …). */
    leadingActions?: HTMLElement[];
    /** When true, overlay controls inside a mermaid diagram preview. */
    overlay?: boolean;
}

export function createFenceChrome(options: FenceChromeOptions): HTMLElement {
    const chrome = document.createElement('div');
    chrome.className = 'cm-md-fence-chrome';
    if (options.fenceFrom !== undefined) {
        chrome.dataset.fenceFrom = String(options.fenceFrom);
    }

    const actions = document.createElement('div');
    actions.className = 'cm-md-fence-actions';
    for (const el of options.leadingActions ?? []) {
        actions.appendChild(el);
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'cm-md-fence-copy-btn';
    copyBtn.title = 'Copy code';
    copyBtn.innerHTML = Icons.Copy;
    copyBtn.addEventListener('mousedown', (event) => event.stopPropagation());
    copyBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        copyToClipboard(options.copyText);
    });
    actions.appendChild(copyBtn);

    chrome.appendChild(actions);

    if (options.overlay) {
        chrome.classList.add('cm-md-fence-chrome-overlay');
        for (const type of ['pointerdown', 'pointerup', 'mousedown', 'click', 'dblclick'] as const) {
            chrome.addEventListener(type, (event) => event.stopPropagation());
        }
        return chrome;
    }

    const host = document.createElement('div');
    host.className = 'cm-md-fence-chrome-host';
    host.appendChild(chrome);

    if (options.headGap) {
        const block = document.createElement('div');
        block.className = 'cm-md-fence-chrome-block';
        const headGap = document.createElement('div');
        headGap.className = 'cm-md-fenced-code-external-gap';
        headGap.setAttribute('aria-hidden', 'true');
        block.appendChild(headGap);
        block.appendChild(host);
        return block;
    }

    return host;
}

class FenceChromeWidget extends WidgetType {
    private readonly fenceFrom: number;
    private readonly copyText: string;
    private readonly mermaidMode: MermaidPreviewMode | null;
    private readonly headGap: boolean;

    constructor(
        fenceFrom: number,
        copyText: string,
        mermaidMode: MermaidPreviewMode | null,
        headGap: boolean,
    ) {
        super();
        this.fenceFrom = fenceFrom;
        this.copyText = copyText;
        this.mermaidMode = mermaidMode;
        this.headGap = headGap;
    }

    eq(other: FenceChromeWidget): boolean {
        return other.fenceFrom === this.fenceFrom
            && other.copyText === this.copyText
            && other.mermaidMode === this.mermaidMode
            && other.headGap === this.headGap;
    }

    ignoreEvent(): boolean {
        return true;
    }

    toDOM(view: EditorView): HTMLElement {
        const leadingActions: HTMLElement[] = [];
        if (this.mermaidMode !== null) {
            leadingActions.push(createMermaidModeSelect(view, this.mermaidMode));
        }
        return createFenceChrome({
            copyText: this.copyText,
            fenceFrom: this.fenceFrom,
            headGap: this.headGap,
            leadingActions,
        });
    }
}

class FenceTailGapWidget extends WidgetType {
    eq(other: FenceTailGapWidget): boolean {
        return other instanceof FenceTailGapWidget;
    }

    toDOM(): HTMLElement {
        const el = document.createElement('div');
        el.className = 'cm-md-fenced-code-external-gap';
        el.setAttribute('aria-hidden', 'true');
        return el;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

function shouldSkipFenceChrome(state: EditorState, node: import('@lezer/common').SyntaxNode): boolean {
    const mode = state.field(mermaidPreviewModeField, false) ?? 'diagram';
    return isMermaidFence(state, node) && mode === 'diagram';
}

function buildFromState(state: EditorState): DecorationSet {
    const mermaidMode = state.field(mermaidPreviewModeField);
    const specs: ReturnType<Decoration['range']>[] = [];

    syntaxTree(state).iterate({
        enter(node) {
            if (node.name !== 'FencedCode' || shouldSkipFenceChrome(state, node.node)) {
                return;
            }
            const mermaid = isMermaidFence(state, node.node);
            const { gapBefore, gapAfter } = fenceExternalGapFlags(state, node.from, node.to);
            specs.push(
                Decoration.widget({
                    block: true,
                    side: -1,
                    widget: new FenceChromeWidget(
                        node.from,
                        extractFenceBody(state, node.node),
                        mermaid ? mermaidMode : null,
                        gapBefore,
                    ),
                }).range(node.from),
            );
            if (gapAfter) {
                specs.push(
                    Decoration.widget({
                        block: true,
                        side: 1,
                        widget: new FenceTailGapWidget(),
                    }).range(node.to),
                );
            }
        },
    });

    return Decoration.set(specs, true);
}

function shouldRebuildFenceChrome(tr: Transaction): boolean {
    return tr.docChanged
        || tr.startState.field(mermaidPreviewModeField) !== tr.state.field(mermaidPreviewModeField)
        || syntaxTree(tr.state).length > syntaxTree(tr.startState).length;
}

export const fenceChromeWidgetField = StateField.define<DecorationSet>({
    create: (state) => buildFromState(state),
    update(value, tr) {
        if (!shouldRebuildFenceChrome(tr)) {
            return value;
        }
        return buildFromState(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
});
