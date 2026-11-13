// Pure spell-check exclusion ranges — no frontmatter import so headless unit
// tests can import this file without Node ESM resolution issues.

import { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { VisibleRange } from './revealDecorations';
import { findDetailsBlocks, toggleTagRanges } from './detailsTypes';

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
    // Hidden toggle tags are zero-height lines: their words (details, summary, open) must not be flagged.
    ranges.push(...toggleTagRanges(findDetailsBlocks(state.doc, state)));
    const tree = syntaxTree(state);
    for (const { from, to } of visibleRanges) {
        tree.iterate({
            from,
            to,
            enter(node) {
                if (NO_SPELLCHECK_NODES.has(node.name)) {
                    ranges.push({ from: node.from, to: node.to });
                }
            },
        });
        ranges.push(...urlLikeRanges(state.doc.sliceString(from, to), from));
    }
    return ranges;
}

/** Syntax nodes whose words are not prose: code, link targets, autolinks and HTML tags. */
const NO_SPELLCHECK_NODES = new Set(['InlineCode', 'FencedCode', 'URL', 'Autolink', 'HTMLTag']);

/** Web addresses and email addresses written as plain text (the parser may not mark them). */
const URL_LIKE_RE = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>()\[\]]+|\b[\w.+-]+@[\w-]+\.[\w.-]+/gi;

export function urlLikeRanges(text: string, offset = 0): TextRange[] {
    const ranges: TextRange[] = [];
    URL_LIKE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_LIKE_RE.exec(text))) {
        ranges.push({ from: offset + match.index, to: offset + match.index + match[0].length });
    }
    return ranges;
}

/**
 * Words common in technical Markdown that the English dictionary lacks. Checked lower case, so
 * "GFM", "Url" and "url" all pass.
 */
const TECH_WORDS = new Set([
    'api', 'apis', 'async', 'blockquote', 'blockquotes', 'boolean', 'callout', 'callouts', 'cli',
    'codebase', 'config', 'configs', 'css', 'csv', 'emoji', 'emojis', 'enum', 'frontmatter', 'gfm',
    'github', 'html', 'http', 'https', 'json', 'markdown', 'md', 'mermaid', 'npm', 'repo', 'repos',
    'svg', 'todo', 'todos', 'tsv', 'ui', 'url', 'urls', 'ux', 'vscode', 'workflow', 'workflows',
    'xlsx', 'yaml',
]);

export function isKnownTechWord(word: string): boolean {
    return TECH_WORDS.has(word.toLowerCase());
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
    // An address is only recognisable as a whole, so look at the word's line for those.
    const line = state.doc.lineAt(from);
    exclusions.push(...urlLikeRanges(line.text, line.from));
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
                if (NO_SPELLCHECK_NODES.has(node.name)) {
                    specs.push({ from: node.from, to: node.to, value: noSpellcheck });
                }
            },
        });
        for (const r of urlLikeRanges(state.doc.sliceString(from, to), from)) {
            specs.push({ from: r.from, to: r.to, value: noSpellcheck });
        }
    }

    return Decoration.set(specs.map(s => s.value.range(s.from, s.to)), true);
}
