// Shared callout type constants and opener-line parsing for Preview Edit.

import type { Text } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';

export const BUILTIN_CALLOUT_TYPES = ['info', 'warning', 'error', 'success'] as const;
export type BuiltinCalloutType = typeof BUILTIN_CALLOUT_TYPES[number];

export const CALLOUT_TYPE_LABELS: Record<BuiltinCalloutType, string> = {
    info: 'Info',
    warning: 'Warning',
    error: 'Error',
    success: 'Success',
};

/** Dropdown value for non-built-in callouts (type edited on the `:::` opener line). */
export const CUSTOM_CALLOUT_OPTION = '__custom__';

/** Default slug written when choosing Custom — edit on the opener line to rename. */
export const CUSTOM_CALLOUT_TYPE_SLUG = 'custom';

/** Opening fence: `:::`, `:::info`, `::: info`, optional title after type. */
export const OPEN_FENCE_RE = /^\s*:::\s*(?:([\w-]+))?(?:\s+(.*))?\s*$/;
export const CLOSE_FENCE_RE = /^\s*:::\s*$/;

const BUILTIN_SET = new Set<string>(BUILTIN_CALLOUT_TYPES);

export function isBuiltinCalloutType(type: string): type is BuiltinCalloutType {
    return BUILTIN_SET.has(type);
}

export function isCustomCalloutType(type: string): boolean {
    return !isBuiltinCalloutType(type);
}

export function normalizeCalloutTypeSlug(raw: string): string | null {
    const slug = raw.trim().toLowerCase();
    return /^[\w-]*$/.test(slug) ? slug : null;
}

export function parseCalloutOpener(lineText: string): { leading: string; type: string; titleSuffix: string } | null {
    const leading = lineText.match(/^\s*/)?.[0] ?? '';
    const trimmed = lineText.slice(leading.length);
    const match = trimmed.match(/^:::\s*(?:([\w-]+))?(?:\s+(.*))?\s*$/);
    if (!match) {
        return null;
    }
    const type = (match[1] ?? '').toLowerCase();
    const title = match[2]?.trim();
    return { leading, type, titleSuffix: title ? ` ${title}` : '' };
}

export function formatCalloutOpener(type: string, leading = '', titleSuffix = ''): string {
    const slug = type || CUSTOM_CALLOUT_TYPE_SLUG;
    return `${leading}:::${slug}${titleSuffix}`;
}

export function buildCalloutSnippet(type: string): string {
    return `:::${type}\n\n:::`;
}

export function calloutCursorOffsetForType(type: string): number {
    return `:::${type}\n`.length;
}

export function calloutTypeClass(type: string): string {
    return isBuiltinCalloutType(type) ? `cm-md-callout-${type}` : 'cm-md-callout-neutral';
}

export interface CalloutBlock {
    type: string;
    openLine: number;
    closeLine: number | null;
    openFrom: number;
    openTo: number;
    closeFrom: number | null;
    closeTo: number | null;
    contentStartLine: number;
    contentEndLine: number;
}

export function findCalloutBlocks(doc: Text): CalloutBlock[] {
    const blocks: CalloutBlock[] = [];
    let lineNum = 1;
    while (lineNum <= doc.lines) {
        const line = doc.line(lineNum);
        const openMatch = line.text.match(OPEN_FENCE_RE);
        if (!openMatch) {
            lineNum++;
            continue;
        }
        const type = (openMatch[1] ?? '').toLowerCase();
        const openLine = lineNum;
        let closeLine: number | null = null;
        for (let scan = lineNum + 1; scan <= doc.lines; scan++) {
            if (CLOSE_FENCE_RE.test(doc.line(scan).text)) {
                closeLine = scan;
                break;
            }
        }
        const contentStartLine = openLine + 1;
        const contentEndLine = closeLine !== null ? closeLine - 1 : doc.lines;
        const closeLineObj = closeLine !== null ? doc.line(closeLine) : null;
        blocks.push({
            type,
            openLine,
            closeLine,
            openFrom: line.from,
            openTo: line.to,
            closeFrom: closeLineObj?.from ?? null,
            closeTo: closeLineObj?.to ?? null,
            contentStartLine,
            contentEndLine,
        });
        lineNum = closeLine !== null ? closeLine + 1 : doc.lines + 1;
    }
    return blocks;
}

function rangesIntersect(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
    return aFrom <= bTo && aTo >= bFrom;
}

/** Callout block containing the primary selection, if any. */
export function findActiveCalloutBlock(state: EditorState): CalloutBlock | null {
    const { from, to } = state.selection.main;
    for (const block of findCalloutBlocks(state.doc)) {
        const blockTo = block.closeTo ?? state.doc.length;
        if (from === to) {
            if (block.openFrom <= from && from < blockTo) {
                return block;
            }
        } else if (rangesIntersect(from, to, block.openFrom, blockTo)) {
            return block;
        }
    }
    return null;
}
