// Disk-vs-editor diff overlay. Wraps @codemirror/merge's unified merge view so
// livePreviewEditor.ts can drop it into a compartment; the pure line-counting
// helper lives in ../diffStats.ts (kept CM-free so it stays unit-testable).
import { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import {
    acceptChunk,
    getChunks,
    goToNextChunk,
    goToPreviousChunk,
    rejectChunk,
    unifiedMergeView,
    updateOriginalDoc,
} from '@codemirror/merge';

/**
 * Build the unified merge extension comparing the live document against
 * `original` (the content the user was looking at before an external write).
 *
 * Deleted text is deliberately NOT syntax-highlighted: deleted chunks are
 * Markdown fragments, not standalone documents, so highlighting them with the
 * document's language produces noise.
 */
export function buildDiffExtension(original: string): Extension {
    return unifiedMergeView({
        original,
        mergeControls: true,
        gutter: true,
        highlightChanges: true,
        allowInlineDiffs: true,
        syntaxHighlightDeletions: false,
        // Bounds the diff cost on large external rewrites; CM falls back to a
        // coarser algorithm past these limits rather than blocking the webview.
        diffConfig: { scanLimit: 500, timeout: 500 },
    });
}

/** Number of still-unresolved changed chunks, 0 when the diff is not mounted. */
export function countDiffChunks(view: EditorView): number {
    return getChunks(view.state)?.chunks.length ?? 0;
}

export function nextDiffChunk(view: EditorView): boolean {
    return goToNextChunk({ state: view.state, dispatch: view.dispatch });
}

export function prevDiffChunk(view: EditorView): boolean {
    return goToPreviousChunk({ state: view.state, dispatch: view.dispatch });
}

/** Keep the incoming (disk) version of the chunk under the cursor. */
export function acceptDiffChunkAtCursor(view: EditorView): boolean {
    return acceptChunk(view);
}

/** Restore the baseline version of the chunk under the cursor. */
export function rejectDiffChunkAtCursor(view: EditorView): boolean {
    return rejectChunk(view);
}

/**
 * Accept every remaining chunk, keeping the incoming (disk) version throughout.
 * Returns how many were accepted.
 *
 * Chunks are taken one at a time from the front because each acceptance
 * rewrites the chunk set. The loop stops if a pass fails to shrink it, so a
 * chunk that refuses to resolve can't spin forever.
 */
export function acceptAllDiffChunks(view: EditorView): number {
    let accepted = 0;
    for (;;) {
        const chunks = getChunks(view.state)?.chunks;
        if (!chunks || chunks.length === 0) {
            return accepted;
        }
        const before = chunks.length;
        if (!acceptChunk(view, chunks[0].fromB)) {
            return accepted;
        }
        accepted++;
        if ((getChunks(view.state)?.chunks.length ?? 0) >= before) {
            return accepted;
        }
    }
}

/**
 * True when this update resolved a chunk via accept.
 *
 * Accepting keeps the current text, so it produces no document change — only an
 * `updateOriginalDoc` effect. Anything watching `docChanged` alone would miss
 * every accept and leave the change count stale.
 */
export function isDiffChunkResolution(update: ViewUpdate): boolean {
    return update.transactions.some(tr => tr.effects.some(e => e.is(updateOriginalDoc)));
}
