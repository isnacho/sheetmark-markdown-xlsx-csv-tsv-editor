import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { extractFenceBody, extractFenceLangName } from './fenceExtraction';

const GRAPH_FIRST_LINE = /^graph (?:TB|BT|RL|LR|TD);?$/;

/** Pure fence heuristic — shared with markdown-it fence renderer in mdWebview.ts. */
export function isMermaidFenceContent(langName: string, code: string): boolean {
    const firstLine = code.trim().split(/\n/)[0]?.trim() ?? '';
    if (langName === 'mermaid' || langName === 'flowchart') {
        return true;
    }
    if (langName === '' && (firstLine === 'gantt' || firstLine === 'sequenceDiagram' || GRAPH_FIRST_LINE.test(firstLine))) {
        return true;
    }
    return false;
}

export function extractMermaidLangName(state: EditorState, node: SyntaxNode): string {
    return extractFenceLangName(state, node);
}

export function extractMermaidSource(state: EditorState, node: SyntaxNode): string {
    return extractFenceBody(state, node);
}

/** Display label for the fence header (never empty for a detected mermaid block). */
export function mermaidFenceDisplayLang(state: EditorState, node: SyntaxNode): string {
    const lang = extractMermaidLangName(state, node);
    return lang || 'mermaid';
}

export function isMermaidFence(state: EditorState, node: SyntaxNode): boolean {
    if (node.name !== 'FencedCode') {
        return false;
    }
    return isMermaidFenceContent(extractMermaidLangName(state, node), extractMermaidSource(state, node));
}

/** Mermaid fence ranges within `bounds` (defaults to the whole document). */
export function findMermaidFenceRanges(state: EditorState, bounds?: { from: number; to: number }): { from: number; to: number }[] {
    const ranges: { from: number; to: number }[] = [];
    syntaxTree(state).iterate({
        from: bounds?.from,
        to: bounds?.to,
        enter(node) {
            if (node.name === 'FencedCode' && isMermaidFence(state, node.node)) {
                ranges.push({ from: node.from, to: node.to });
            }
        },
    });
    return ranges;
}
