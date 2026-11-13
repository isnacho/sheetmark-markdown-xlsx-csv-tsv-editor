// Callout line decorations for Preview Edit (wired into revealDecorations.ts).

import type { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import {
    calloutTitleOffset,
    calloutTypeClass,
    findCalloutBlocks,
} from './calloutTypes';

const titleMark = Decoration.mark({ class: 'cm-md-callout-title' });

function calloutLineDecoration(
    type: string,
    position: 'only' | 'first' | 'middle' | 'last',
    contentFirst: boolean,
    emptyClose = false,
    content = false,
) {
    const parts = ['cm-md-callout-line', calloutTypeClass(type)];
    if (position === 'only') {
        parts.push('cm-md-callout-line-first', 'cm-md-callout-line-last');
    } else if (position === 'first') {
        parts.push('cm-md-callout-line-first');
    } else if (position === 'last') {
        parts.push('cm-md-callout-line-last');
    }
    if (content) {
        parts.push('cm-md-callout-content');
    }
    if (contentFirst) {
        parts.push('cm-md-callout-content-first');
    }
    if (emptyClose) {
        parts.push('cm-md-callout-empty');
    }
    if (position !== 'middle' && !content) {
        parts.push('cm-md-callout-fence');
    }
    return Decoration.line({ class: parts.join(' ') });
}

interface CalloutSpec {
    from: number;
    to: number;
    value: ReturnType<typeof Decoration.mark> | ReturnType<typeof Decoration.replace> | ReturnType<typeof Decoration.line>;
}

export function appendCalloutDecorationSpecs(
    state: EditorState,
    selFrom: number,
    selTo: number,
    specs: CalloutSpec[],
    dimMark: ReturnType<typeof Decoration.mark>,
    hiddenMark: ReturnType<typeof Decoration.replace>,
): void {
    const doc = state.doc;

    const rangesIntersect = (aFrom: number, aTo: number, bFrom: number, bTo: number) =>
        aFrom <= bTo && aTo >= bFrom;

    const isBlockActive = (from: number, to: number) => {
        if (selFrom === selTo) {
            return from <= selFrom && selFrom < to;
        }
        return rangesIntersect(selFrom, selTo, from, to);
    };

    for (const block of findCalloutBlocks(doc, state)) {
        const blockTo = block.closeTo ?? doc.length;
        const active = isBlockActive(block.openFrom, blockTo);
        const fenceMark = active ? dimMark : hiddenMark;

        // A title after the type stays visible as the callout's first line; only `::: type` hides.
        const titleOffset = calloutTitleOffset(doc.line(block.openLine).text);
        const titleFrom = titleOffset === null ? null : block.openFrom + titleOffset;
        specs.push({ from: block.openFrom, to: titleFrom ?? block.openTo, value: fenceMark });
        if (titleFrom !== null) {
            specs.push({ from: titleFrom, to: block.openTo, value: titleMark });
        }
        if (block.closeFrom !== null && block.closeTo !== null) {
            specs.push({ from: block.closeFrom, to: block.closeTo, value: fenceMark });
        }

        const lastLine = block.closeLine ?? doc.lines;
        const hasContent = block.contentStartLine <= block.contentEndLine;
        const empty = !hasContent;

        for (let n = block.openLine; n <= lastLine; n++) {
            const line = doc.line(n);
            const isOpen = n === block.openLine;
            const isClose = block.closeLine !== null && n === block.closeLine;
            const isOnly = isOpen && isClose;

            let position: 'only' | 'first' | 'middle' | 'last';
            if (isOnly) {
                position = 'only';
            } else if (isOpen) {
                position = 'first';
            } else if (isClose) {
                position = 'last';
            } else {
                position = 'middle';
            }

            // A titled opener is the first content line (it carries the icon); otherwise the
            // first line after the opener is.
            const titleLine = titleFrom !== null && isOpen;
            const contentFirst = titleFrom !== null ? titleLine : hasContent && n === block.contentStartLine;
            const content = titleLine || (hasContent && n >= block.contentStartLine && n <= block.contentEndLine);
            specs.push({
                from: line.from,
                to: line.from,
                value: calloutLineDecoration(block.type, position, contentFirst, empty && isClose, content),
            });
        }
    }
}
