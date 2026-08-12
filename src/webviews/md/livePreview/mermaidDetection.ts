import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

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
    const info = node.getChild('CodeInfo');
    if (!info) {
        return '';
    }
    return state.doc.sliceString(info.from, info.to).trim().split(/\s+/g)[0] || '';
}

export function extractMermaidSource(state: EditorState, node: SyntaxNode): string {
    const parts = node.getChildren('CodeText');
    if (parts.length === 0) {
        return '';
    }
    return state.doc.sliceString(parts[0].from, parts[parts.length - 1].to);
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

export function findMermaidFenceRanges(state: EditorState): { from: number; to: number }[] {
    const ranges: { from: number; to: number }[] = [];
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name === 'FencedCode' && isMermaidFence(state, node.node)) {
                ranges.push({ from: node.from, to: node.to });
            }
        },
    });
    return ranges;
}
