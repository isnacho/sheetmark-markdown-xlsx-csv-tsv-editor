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

function fencedCodeLineDecoration(position: 'only' | 'first' | 'middle' | 'last') {
    const parts = ['cm-md-fenced-code-line'];
    if (position === 'only') {
        parts.push('cm-md-fenced-code-line-first', 'cm-md-fenced-code-line-last');
    } else if (position === 'first') {
        parts.push('cm-md-fenced-code-line-first');
    } else if (position === 'last') {
        parts.push('cm-md-fenced-code-line-last');
    }
    return Decoration.line({ class: parts.join(' ') });
}

export function computeCodeDecorations(
    state: EditorState,
    visibleRanges: readonly VisibleRange[],
    shouldSkipFencedCode?: (node: SyntaxNode) => boolean,
): DecorationSet {
    const specs: { from: number; to: number; value: ReturnType<typeof Decoration.mark> | ReturnType<typeof Decoration.line> }[] = [];

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
                            value: fencedCodeLineDecoration(position),
                        });
                    }
                }
            },
        });
    }

    return Decoration.set(specs.map(s => s.value.range(s.from, s.to)), true);
}
