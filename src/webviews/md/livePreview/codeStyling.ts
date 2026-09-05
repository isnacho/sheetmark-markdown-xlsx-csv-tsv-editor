// Baseline styling for inline code and fenced code blocks in the Markdown
// "Preview Edit" mode — NOT part of the reveal engine (revealDecorations.ts):
// nothing here hides a marker based on cursor position, it's always-on, same
// as CM6's own markdown-lang syntax coloring. Exists because @lezer/markdown
// tags both node types as `tags.monospace`, but @codemirror/language's
// `defaultHighlightStyle` has no rule for that tag — so without this, fenced/
// inline code renders with zero visual treatment (no monospace, no background),
// unlike the legacy renderer's `.inline-code` / `.code-block` CSS.
//
// Backtick/fence marks stay visible on purpose: hiding them is reveal-marker
// territory, explicitly slated for Phase 7 ("inline-code... follow in Phase 7,
// reusing this machinery") — this only adds the missing baseline look.

import { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { VisibleRange } from './revealDecorations';

const inlineCodeMark = Decoration.mark({ class: 'cm-md-inline-code' });

function fencedCodeLineDecoration(
    position: 'only' | 'first' | 'middle' | 'last',
    gapBefore: boolean,
    gapAfter: boolean,
) {
    const parts = ['cm-md-fenced-code-line'];
    if (position === 'only') {
        parts.push('cm-md-fenced-code-line-first', 'cm-md-fenced-code-line-last');
    } else if (position === 'first') {
        parts.push('cm-md-fenced-code-line-first');
    } else if (position === 'last') {
        parts.push('cm-md-fenced-code-line-last');
    }
    if (gapBefore && (position === 'first' || position === 'only')) {
        parts.push('cm-md-fenced-code-line-gap-before');
    }
    if (gapAfter && (position === 'last' || position === 'only')) {
        parts.push('cm-md-fenced-code-line-gap-after');
    }
    return Decoration.line({ class: parts.join(' ') });
}

function lineIsInsideAnyFencedCode(state: EditorState, lineNumber: number): boolean {
    const line = state.doc.line(lineNumber);
    let inside = false;
    syntaxTree(state).iterate({
        from: line.from,
        to: line.to,
        enter(node) {
            if (node.name === 'FencedCode') {
                inside = true;
            }
        },
    });
    return inside;
}

export function fenceExternalGapFlags(
    state: EditorState,
    nodeFrom: number,
    nodeTo: number,
): { gapBefore: boolean; gapAfter: boolean } {
    const firstLine = state.doc.lineAt(nodeFrom).number;
    const lastLine = state.doc.lineAt(nodeTo).number;
    return {
        gapBefore: firstLine === 1 || !lineIsInsideAnyFencedCode(state, firstLine - 1),
        gapAfter: lastLine === state.doc.lines || !lineIsInsideAnyFencedCode(state, lastLine + 1),
    };
}

export function computeCodeDecorations(
    state: EditorState,
    visibleRanges: readonly VisibleRange[],
    shouldSkipFencedCode?: (node: SyntaxNode) => boolean,
): DecorationSet {
    const specs: {
        from: number;
        to: number;
        value: ReturnType<typeof Decoration.mark> | ReturnType<typeof Decoration.line>;
    }[] = [];

    for (const { from, to } of visibleRanges) {
        syntaxTree(state).iterate({
            from,
            to,
            enter(node) {
                if (node.name === 'InlineCode') {
                    specs.push({ from: node.from, to: node.to, value: inlineCodeMark });
                } else if (node.name === 'FencedCode') {
                    if (shouldSkipFencedCode?.(node.node)) {
                        return;
                    }
                    const firstLine = state.doc.lineAt(node.from).number;
                    const lastLine = state.doc.lineAt(node.to).number;
                    const { gapBefore, gapAfter } = fenceExternalGapFlags(state, node.from, node.to);

                    for (let n = firstLine; n <= lastLine; n++) {
                        const position = firstLine === lastLine
                            ? 'only'
                            : n === firstLine
                                ? 'first'
                                : n === lastLine
                                    ? 'last'
                                    : 'middle';
                        specs.push({
                            from: state.doc.line(n).from,
                            to: state.doc.line(n).from,
                            value: fencedCodeLineDecoration(
                                position,
                                n === firstLine && gapBefore,
                                n === lastLine && gapAfter,
                            ),
                        });
                    }
                }
            },
        });
    }

    return Decoration.set(specs.map(s => s.value.range(s.from, s.to)), true);
}
