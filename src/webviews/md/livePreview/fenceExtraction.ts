import { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

export function extractFenceLangName(state: EditorState, node: SyntaxNode): string {
    const info = node.getChild('CodeInfo');
    if (!info) {
        return '';
    }
    return state.doc.sliceString(info.from, info.to).trim().split(/\s+/g)[0] || '';
}

export function extractFenceBody(state: EditorState, node: SyntaxNode): string {
    const parts = node.getChildren('CodeText');
    if (parts.length === 0) {
        return '';
    }
    return state.doc.sliceString(parts[0].from, parts[parts.length - 1].to);
}

export function fenceDisplayLang(state: EditorState, node: SyntaxNode): string {
    const lang = extractFenceLangName(state, node);
    return lang || 'text';
}
