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

/**
 * goToNextChunk/goToPreviousChunk scroll only the minimum distance needed to
 * bring the chunk on screen (edge-aligned), which for a chunk that's already
 * partly visible can mean no movement at all. Re-centering afterward makes
 * every jump land the same way, and CM6 clamps this itself near the doc's
 * start/end, so "centered whenever possible" falls out for free.
 */
function centerOnSelection(view: EditorView): void {
    view.dispatch({
        effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }),
    });
}

export function nextDiffChunk(view: EditorView): boolean {
    const moved = goToNextChunk({ state: view.state, dispatch: view.dispatch });
    if (moved) { centerOnSelection(view); }
    return moved;
}

export function prevDiffChunk(view: EditorView): boolean {
    const moved = goToPreviousChunk({ state: view.state, dispatch: view.dispatch });
    if (moved) { centerOnSelection(view); }
    return moved;
}

/** Jump straight to the chunk at `index` (as ordered by `getChunks`) and center it. */
export function goToDiffChunkAt(view: EditorView, index: number): boolean {
    const chunks = getChunks(view.state)?.chunks;
    const chunk = chunks?.[index];
    if (!chunk) {
        return false;
    }
    view.dispatch({ selection: { anchor: chunk.fromB } });
    centerOnSelection(view);
    return true;
}

/**
 * Top position of every remaining chunk as a fraction [0, 1] of the
 * scrollable height, for a density ruler alongside the scrollbar. Uses
 * `scrollDOM.scrollHeight` (not `contentHeight`) as the denominator so a
 * tick at fraction `f` lines up with where the native scrollbar thumb sits
 * at that same fraction.
 */
export function diffChunkPositions(view: EditorView): number[] {
    const chunks = getChunks(view.state)?.chunks;
    if (!chunks || chunks.length === 0) {
        return [];
    }
    const scrollHeight = view.scrollDOM.scrollHeight;
    if (scrollHeight <= 0) {
        return [];
    }
    return chunks.map(c => Math.min(1, view.lineBlockAt(c.fromB).top / scrollHeight));
}

/**
 * 1-based position of the chunk the cursor is currently on/nearest to, for
 * an "N of M" indicator. 0 when there are no chunks.
 */
export function currentDiffChunkIndex(view: EditorView): number {
    const chunks = getChunks(view.state)?.chunks;
    if (!chunks || chunks.length === 0) {
        return 0;
    }
    const head = view.state.selection.main.head;
    let index = chunks.findIndex(c => head >= c.fromB && head <= c.toB);
    if (index === -1) {
        index = chunks.findIndex(c => c.fromB >= head);
    }
    if (index === -1) {
        index = chunks.length - 1;
    }
    return index + 1;
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
 * Reject every remaining chunk, restoring the baseline (pre-external-write)
 * version throughout. Returns how many were rejected. Mirrors
 * {@link acceptAllDiffChunks}'s one-at-a-time loop for the same reason: each
 * rejection rewrites the chunk set.
 */
export function rejectAllDiffChunks(view: EditorView): number {
    let rejected = 0;
    for (;;) {
        const chunks = getChunks(view.state)?.chunks;
        if (!chunks || chunks.length === 0) {
            return rejected;
        }
        const before = chunks.length;
        if (!rejectChunk(view, chunks[0].fromB)) {
            return rejected;
        }
        rejected++;
        if ((getChunks(view.state)?.chunks.length ?? 0) >= before) {
            return rejected;
        }
    }
}

/**
 * Which way (if any) this update resolved a chunk, for callers that need to
 * tally accepted vs. rejected — e.g. a closing "3 accepted, 1 rejected"
 * summary. `acceptChunk`/`rejectChunk` tag their transaction with a
 * matching `userEvent` ("accept"/"revert"); accepting also keeps the current
 * text, so it produces no document change, only an `updateOriginalDoc`
 * effect — anything watching `docChanged` alone would miss every accept.
 */
export function diffChunkResolutionKind(update: ViewUpdate): 'accept' | 'reject' | null {
    for (const tr of update.transactions) {
        if (tr.isUserEvent('accept')) { return 'accept'; }
        if (tr.isUserEvent('revert')) { return 'reject'; }
    }
    return null;
}
