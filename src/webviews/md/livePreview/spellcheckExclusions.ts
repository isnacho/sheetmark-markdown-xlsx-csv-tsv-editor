// Pure spell-check exclusion ranges — no frontmatter import so headless unit
// tests can import this file without Node ESM resolution issues.

import { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { VisibleRange } from './revealDecorations';

const noSpellcheck = Decoration.mark({ attributes: { spellcheck: 'false' } });

export interface TextRange {
    from: number;
    to: number;
}

/** Ranges where dictionary spell check must not run (code + frontmatter). */
export function collectSpellcheckExclusionRanges(
    state: EditorState,
    visibleRanges: readonly VisibleRange[],
    frontmatterRange?: TextRange | null,
): TextRange[] {
    const ranges: TextRange[] = [];
    if (frontmatterRange) {
        ranges.push(frontmatterRange);
    }
    const tree = syntaxTree(state);
    for (const { from, to } of visibleRanges) {
        tree.iterate({
            from,
            to,
            enter(node) {
                if (node.name === 'InlineCode' || node.name === 'FencedCode') {
                    ranges.push({ from: node.from, to: node.to });
                }
            },
        });
    }
    return ranges;
}

export function rangesOverlap(pos: number, end: number, ranges: readonly TextRange[]): boolean {
    for (const r of ranges) {
        if (pos < r.to && end > r.from) { return true; }
    }
    return false;
}

export function isSpellcheckExcluded(
    from: number,
    to: number,
    state: EditorState,
    frontmatterRange?: TextRange | null,
): boolean {
    // Scope the syntax-tree walk to the queried word. Iterating the whole
    // document here forced the parser through the entire file on every
    // right-click; `iterate` still enters nodes that merely overlap the range,
    // so a code span the word sits inside is found either way.
    const exclusions = collectSpellcheckExclusionRanges(state, [{ from, to }], frontmatterRange);
    return rangesOverlap(from, to, exclusions);
}

export function computeSpellcheckExclusions(
    state: EditorState,
    visibleRanges: readonly VisibleRange[],
    frontmatterRange?: { from: number; to: number } | null,
): DecorationSet {
    const specs: { from: number; to: number; value: ReturnType<typeof Decoration.mark> }[] = [];

    if (frontmatterRange) {
        specs.push({ from: frontmatterRange.from, to: frontmatterRange.to, value: noSpellcheck });
    }

    for (const { from, to } of visibleRanges) {
        syntaxTree(state).iterate({
            from,
            to,
            enter(node) {
                if (node.name === 'InlineCode' || node.name === 'FencedCode') {
                    specs.push({ from: node.from, to: node.to, value: noSpellcheck });
                }
            },
        });
    }

    return Decoration.set(specs.map(s => s.value.range(s.from, s.to)), true);
}
