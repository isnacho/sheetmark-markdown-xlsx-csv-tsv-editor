// Rendered image previews in CM6 live preview.
//
// Runtime: WEBVIEW (browser). URI resolution is delegated to mdWebview.ts via
// setImageUriResolver (same resolveImageUris host round-trip as reading preview).

import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

export interface ImageUriResolver {
    getResolved: (src: string) => string | undefined;
    requestResolve: (sources: string[]) => void;
    openLightbox?: (src: string, alt: string) => void;
    requestLightbox?: (src: string, alt: string) => void;
}

let imageUriResolver: ImageUriResolver | undefined;

export function setImageUriResolver(resolver: ImageUriResolver | undefined): void {
    imageUriResolver = resolver;
}

export const refreshImageWidgetsEffect = StateEffect.define<void>();

function isRemoteOrInlineUri(value: string): boolean {
    return /^(https?:|data:|mailto:|#)/i.test(value.trim());
}

export function extractImageAlt(state: EditorState, node: SyntaxNode): string {
    const text = node.getChild('Text');
    if (text) {
        return state.doc.sliceString(text.from, text.to);
    }
    const marks = node.getChildren('LinkMark');
    if (marks.length >= 2) {
        return state.doc.sliceString(marks[0].to, marks[1].from);
    }
    return '';
}

export function extractImageUrl(state: EditorState, node: SyntaxNode): string {
    const url = node.getChild('URL');
    return url ? state.doc.sliceString(url.from, url.to) : '';
}

export function imageReplaceRange(
    state: EditorState,
    node: SyntaxNode,
): { from: number; to: number; block: boolean } {
    const line = state.doc.lineAt(node.from);
    const imageText = state.doc.sliceString(node.from, node.to);
    if (line.text.trim() === imageText.trim()) {
        return { from: line.from, to: line.to, block: true };
    }
    return { from: node.from, to: node.to, block: false };
}

function rangesIntersect(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
    return aFrom <= bTo && aTo >= bFrom;
}

function isImageActive(node: SyntaxNode, selFrom: number, selTo: number): boolean {
    if (selFrom === selTo) {
        return node.from <= selFrom && selFrom <= node.to;
    }
    return rangesIntersect(selFrom, selTo, node.from, node.to);
}

function syncImageElement(
    img: HTMLImageElement,
    placeholder: HTMLElement,
    src: string,
    alt: string,
    resolvedSrc: string | undefined,
): void {
    const trimmed = src.trim();
    placeholder.classList.remove('cm-md-image-error');
    placeholder.textContent = alt || trimmed || 'Image';

    if (trimmed && isRemoteOrInlineUri(trimmed)) {
        img.hidden = false;
        if (img.getAttribute('src') !== trimmed) {
            img.src = trimmed;
        }
        img.removeAttribute('data-md-src');
        placeholder.hidden = true;
        return;
    }

    const resolved = resolvedSrc || (trimmed ? imageUriResolver?.getResolved(trimmed) : undefined);
    if (resolved) {
        img.hidden = false;
        if (img.getAttribute('src') !== resolved) {
            img.src = resolved;
        }
        img.removeAttribute('data-md-src');
        placeholder.hidden = true;
        return;
    }

    if (trimmed) {
        img.removeAttribute('src');
        img.hidden = true;
        img.setAttribute('data-md-src', trimmed);
        placeholder.hidden = false;
        imageUriResolver?.requestResolve([trimmed]);
        return;
    }

    img.hidden = true;
    placeholder.hidden = false;
}

class ImagePreviewWidget extends WidgetType {
    readonly src: string;
    readonly alt: string;
    readonly resolvedSrc: string | undefined;
    readonly imageFrom: number;
    readonly imageTo: number;
    readonly block: boolean;

    constructor(
        src: string,
        alt: string,
        resolvedSrc: string | undefined,
        imageFrom: number,
        imageTo: number,
        block: boolean,
    ) {
        super();
        this.src = src;
        this.alt = alt;
        this.resolvedSrc = resolvedSrc;
        this.imageFrom = imageFrom;
        this.imageTo = imageTo;
        this.block = block;
    }

    eq(other: ImagePreviewWidget): boolean {
        return other.src === this.src
            && other.alt === this.alt
            && other.resolvedSrc === this.resolvedSrc
            && other.imageFrom === this.imageFrom
            && other.imageTo === this.imageTo
            && other.block === this.block;
    }

    ignoreEvent(event: Event): boolean {
        return event.type === 'mousedown';
    }

    toDOM(view: EditorView): HTMLElement {
        const wrap = document.createElement(this.block ? 'div' : 'span');
        wrap.className = this.block ? 'cm-md-image-block' : 'cm-md-image-inline';

        const img = document.createElement('img');
        img.className = 'md-image zoomable cm-md-image-preview';
        img.alt = this.alt;
        img.loading = 'lazy';

        const placeholder = document.createElement('span');
        placeholder.className = 'cm-md-image-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');

        syncImageElement(img, placeholder, this.src, this.alt, this.resolvedSrc);

        img.addEventListener('error', () => {
            img.hidden = true;
            placeholder.hidden = false;
            placeholder.classList.add('cm-md-image-error');
            placeholder.textContent = this.alt
                ? `${this.alt} (not found)`
                : `Image not found: ${this.src.trim()}`;
        });

        img.addEventListener('mousedown', (event) => {
            const trimmed = this.src.trim();
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const lightboxSrc = this.resolvedSrc
                    || (trimmed && isRemoteOrInlineUri(trimmed) ? trimmed : imageUriResolver?.getResolved(trimmed));
                if (lightboxSrc) {
                    imageUriResolver?.openLightbox?.(lightboxSrc, this.alt);
                } else if (trimmed) {
                    imageUriResolver?.requestLightbox?.(trimmed, this.alt);
                }
                return;
            }
            event.preventDefault();
            view.dispatch({
                selection: { anchor: this.imageTo, head: this.imageTo },
                scrollIntoView: true,
            });
            view.focus();
        });

        wrap.appendChild(img);
        wrap.appendChild(placeholder);
        return wrap;
    }

    updateDOM(dom: HTMLElement, _view: EditorView, other: ImagePreviewWidget): boolean {
        if (other.src !== this.src || other.alt !== this.alt || other.resolvedSrc !== this.resolvedSrc) {
            return false;
        }
        const img = dom.querySelector('img');
        const placeholder = dom.querySelector('.cm-md-image-placeholder');
        if (img instanceof HTMLImageElement && placeholder instanceof HTMLElement) {
            syncImageElement(img, placeholder, this.src, this.alt, this.resolvedSrc);
        }
        return true;
    }
}

export function computeImageDecorations(
    state: EditorState,
    selFrom: number,
    selTo: number,
): DecorationSet {
    if (!imageUriResolver) {
        return Decoration.none;
    }

    const specs: ReturnType<Decoration['range']>[] = [];
    const resolver = imageUriResolver;

    syntaxTree(state).iterate({
        enter(nodeRef) {
            if (nodeRef.name !== 'Image') {
                return;
            }
            const node = nodeRef.node;
            if (isImageActive(node, selFrom, selTo)) {
                return;
            }

            const src = extractImageUrl(state, node);
            const alt = extractImageAlt(state, node);
            const trimmed = src.trim();
            const resolved = trimmed ? resolver.getResolved(trimmed) : undefined;
            const range = imageReplaceRange(state, node);

            specs.push(
                Decoration.replace({
                    block: range.block,
                    widget: new ImagePreviewWidget(
                        src,
                        alt,
                        resolved,
                        node.from,
                        node.to,
                        range.block,
                    ),
                }).range(range.from, range.to),
            );
        },
    });

    return Decoration.set(specs, true);
}

function buildFromState(state: EditorState): DecorationSet {
    const { from, to } = state.selection.main;
    return computeImageDecorations(state, from, to);
}

export const imageWidgetField = StateField.define<DecorationSet>({
    create: (state) => buildFromState(state),
    update(value, tr) {
        const selChanged = tr.startState.selection.main.from !== tr.state.selection.main.from
            || tr.startState.selection.main.to !== tr.state.selection.main.to;
        if (tr.docChanged || selChanged || tr.effects.some(e => e.is(refreshImageWidgetsEffect))) {
            return buildFromState(tr.state);
        }
        return value;
    },
    provide: (f) => EditorView.decorations.from(f),
});
