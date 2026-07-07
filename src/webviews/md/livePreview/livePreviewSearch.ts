// CM6 search integration for the Markdown "Preview Edit" mode.
//
// Runtime: WEBVIEW (browser). No Node / no `vscode` module here.
//
// mdWebview.ts's existing search overlay (input/prev/next/count) walks the
// rendered DOM with a TreeWalker when the legacy engine is active. CM6's doc
// is plain text with no rendered DOM to walk, so this module gives the same
// UI a CM6-native backend: SearchCursor for case-insensitive matches, a
// StateField<DecorationSet> for the highlight marks, current-match styling,
// and scroll-into-view. mdWebview.ts stays the only place that decides *when*
// to call these (branching on isLivePreviewActive()).

import { EditorState, StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { SearchCursor } from '@codemirror/search';

export interface Cm6Match {
    from: number;
    to: number;
}

const setMatches = StateEffect.define<{ matches: Cm6Match[]; current: number }>();

const matchField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(deco, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setMatches)) {
                const { matches, current } = effect.value;
                if (matches.length === 0) {return Decoration.none;}
                return Decoration.set(
                    matches.map((m, i) => Decoration.mark({
                        class: i === current ? 'cm-md-search-match cm-md-search-current' : 'cm-md-search-match',
                    }).range(m.from, m.to)),
                    true,
                );
            }
        }
        return deco.map(tr.changes);
    },
    provide: f => EditorView.decorations.from(f),
});

/** Extension to add to the EditorView so search highlights can render. */
export function livePreviewSearchField() {
    return matchField;
}

/** Case-insensitive match search over the CM6 doc (mirrors the legacy TreeWalker's toLowerCase() compare). */
export function findCm6Matches(state: EditorState, query: string): Cm6Match[] {
    if (!query) {return [];}
    const lower = query.toLowerCase();
    const cursor = new SearchCursor(state.doc, lower, 0, state.doc.length, s => s.toLowerCase());
    const matches: Cm6Match[] = [];
    while (!cursor.next().done) {
        matches.push({ from: cursor.value.from, to: cursor.value.to });
    }
    return matches;
}

export function setCm6SearchHighlights(view: EditorView, matches: Cm6Match[], current: number): void {
    view.dispatch({ effects: setMatches.of({ matches, current }) });
}

export function clearCm6SearchHighlights(view: EditorView): void {
    view.dispatch({ effects: setMatches.of({ matches: [], current: -1 }) });
}

export function scrollCm6ToMatch(view: EditorView, match: Cm6Match): void {
    view.dispatch({
        selection: { anchor: match.from, head: match.to },
        effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    });
}
