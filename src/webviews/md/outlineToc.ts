// Pure TOC item model + HTML for sidebar outline and the preview-edit line rail.
// Runtime: WEBVIEW (browser).

import { Utils } from '../shared/utils';

export interface TocItem {
    id: string;
    level: number;
    text: string;
    /** 1-indexed document line */
    line: number;
}

export function collectTocItems(
    tokens: any[],
    bodyStartLine: number,
    normalizeText: (raw: string) => string,
): TocItem[] {
    const items: TocItem[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type !== 'heading_open') { continue; }
        const inline = tokens[i + 1];
        const raw = inline && inline.type === 'inline' ? inline.content : '';
        const text = normalizeText(raw);
        const id = token.attrGet?.('id') ?? '';
        const level = parseInt((token.tag || 'h2').replace('h', ''), 10);
        if (!id || !text || !Array.isArray(token.map)) { continue; }
        items.push({
            id,
            level,
            text,
            line: token.map[0] + bodyStartLine,
        });
    }
    return items;
}

export function renderTocEmptyHtml(): string {
    return '<div class="toc-empty">No headings found</div>';
}

export function renderTocListHtml(items: readonly TocItem[]): string {
    if (!items.length) {
        return renderTocEmptyHtml();
    }
    return items.map((item) => {
        const safeText = Utils.escapeHtml(item.text);
        return `<div class="toc-item toc-level-${item.level}"><a href="#${item.id}" data-target="${item.id}">${safeText}</a></div>`;
    }).join('');
}

/** Tick width (px) for outline rail lines: index 0 = H1 … 5 = H6 (8px step, floor 8). */
export const OUTLINE_RAIL_WIDTH_PX_BY_LEVEL = [32, 24, 16, 8, 8, 8];

export function renderRailLinesHtml(items: readonly TocItem[], activeId?: string): string {
    if (!items.length) { return ''; }
    return items.map((item) => {
        const width = OUTLINE_RAIL_WIDTH_PX_BY_LEVEL[Math.min(Math.max(item.level, 1), 6) - 1];
        const active = item.id === activeId ? ' active' : '';
        return `<span class="outline-rail-line-slot" data-level="${item.level}"><span class="outline-rail-line${active}" data-target="${item.id}" style="width:${width}px" aria-hidden="true"></span></span>`;
    }).join('');
}
