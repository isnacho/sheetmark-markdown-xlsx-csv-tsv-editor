// Table rendering for the Markdown "Preview Edit" mode.
//
// Runtime: WEBVIEW (browser) for the ViewPlugin/WidgetType; the pure
// `computeTableDecorations` below has no DOM dependency beyond constructing a
// TableWidget (never calling its DOM-only `toDOM()`), so it's exercised
// headlessly in tableWidget.test.mts.
//
// CM6 has no built-in table grid — unlike headings/bold/italic (inline
// Decoration.mark/replace), a table needs an actual rendered <table> element,
// so this uses a block Decoration.replace with a WidgetType. Same reveal
// shape as the rest of the engine: cursor away from the table -> render the
// widget (real HTML grid); cursor inside the table's line range -> show raw
// markdown pipes for editing, same as clicking into a heading reveals its `#`.
//
// Reuses markdown-it (already a project dependency, not CM6-specific) to render
// the table's own source text — this guarantees the widget's table markup and
// `.md-table` styling are pixel-identical to the Reading-mode renderer's table
// output (resources/md/mdWebview.css's `.markdown-preview table.md-table` rules
// apply automatically since #markdownPreview carries the `.markdown-preview`
// class regardless of which engine is mounted inside it). This is a separate,
// bare MarkdownIt instance — not the fully-configured one in mdWebview.ts, to
// avoid a livePreview/ <-> mdWebview.ts circular import. Table cells still get
// full inline formatting (bold/italic/code/links) since that's core markdown-it
// behavior, not a plugin; extras like emoji/katex inside cells are an accepted
// v1 gap (mdWebview.ts's plugin-loaded instance isn't reachable here).

import MarkdownIt from 'markdown-it';
import { EditorState } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { VisibleRange } from './revealDecorations';

const md = new MarkdownIt();
const defaultTableOpen = md.renderer.rules.table_open || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrJoin('class', 'md-table');
    return defaultTableOpen(tokens, idx, options, env, self);
};

export class TableWidget extends WidgetType {
    readonly source: string;

    constructor(source: string) {
        super();
        this.source = source;
    }
    eq(other: TableWidget): boolean {
        return other.source === this.source;
    }
    toDOM(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'cm-md-table-widget';
        wrap.innerHTML = md.render(this.source);
        return wrap;
    }
    ignoreEvent(event: Event): boolean {
        // Let CM6 handle clicks (places the cursor -> reveals raw text to edit);
        // ignore everything else so the rendered table's own DOM behaves normally.
        return event.type !== 'mousedown' && event.type !== 'click';
    }
}

function rangesIntersect(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
    return aFrom <= bTo && aTo >= bFrom;
}

/** Pure, headless-testable core — see computeRevealDecorations for the same shape. */
export function computeTableDecorations(
    state: EditorState,
    selFrom: number,
    selTo: number,
    visibleRanges: readonly VisibleRange[],
): DecorationSet {
    const specs: { from: number; to: number; value: ReturnType<typeof Decoration.replace> }[] = [];

    for (const { from, to } of visibleRanges) {
        syntaxTree(state).iterate({
            from,
            to,
            enter(node) {
                if (node.name !== 'Table') { return; }
                if (rangesIntersect(selFrom, selTo, node.from, node.to)) { return; }
                const source = state.sliceDoc(node.from, node.to);
                specs.push({
                    from: node.from,
                    to: node.to,
                    value: Decoration.replace({ widget: new TableWidget(source), block: true }),
                });
            },
        });
    }

    return Decoration.set(specs.map(s => s.value.range(s.from, s.to)), true);
}

function buildFromView(view: EditorView): DecorationSet {
    const sel = view.state.selection.main;
    return computeTableDecorations(view.state, sel.from, sel.to, view.visibleRanges);
}

export const tableWidgetPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
        this.decorations = buildFromView(view);
    }
    update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = buildFromView(update.view);
        }
    }
}, {
    decorations: v => v.decorations,
});
