import { EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { computeCodeDecorations } from './codeStyling';
import { isMermaidFence } from './mermaidDetection';
import { mermaidPreviewModeField } from './mermaidPreviewMode';

function buildFromView(view: EditorView): DecorationSet {
    const mode = view.state.field(mermaidPreviewModeField);
    const shouldSkipFencedCode = mode === 'diagram'
        ? (node: SyntaxNode) => isMermaidFence(view.state, node)
        : undefined;
    return computeCodeDecorations(view.state, view.visibleRanges, shouldSkipFencedCode);
}

export const codeStylingPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
        this.decorations = buildFromView(view);
    }
    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged
            || update.startState.field(mermaidPreviewModeField) !== update.state.field(mermaidPreviewModeField)) {
            this.decorations = buildFromView(update.view);
        }
    }
}, {
    decorations: v => v.decorations,
});
