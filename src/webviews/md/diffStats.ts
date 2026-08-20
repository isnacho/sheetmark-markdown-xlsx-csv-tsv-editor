export interface DiffLineStats {
    /** Lines present in the new text but not matched in the baseline. */
    added: number;
    /** Lines present in the baseline but not matched in the new text. */
    removed: number;
}

/**
 * Above this many LCS cells the exact line diff is abandoned for a bounded
 * approximation (every unmatched line counted as both removed and added). Keeps
 * a pathological "entire file rewritten" case from freezing the webview.
 */
const LCS_CELL_LIMIT = 4_000_000;

/**
 * Line-level change counts between two revisions, matching what `diff -u`
 * reports: a modified line counts once as removed and once as added.
 *
 * Deliberately free of CodeMirror imports so it stays unit-testable under
 * `node --test` — the merge extension itself lives in
 * livePreview/diffView.ts.
 */
export function diffLineStats(baseline: string, current: string): DiffLineStats {
    if (baseline === current) {
        return { added: 0, removed: 0 };
    }

    // An empty document has zero lines, not one empty line — otherwise a
    // first write into an empty file would report a phantom removal.
    const a = baseline ? baseline.split('\n') : [];
    const b = current ? current.split('\n') : [];

    // Trim matching head and tail so the quadratic step only sees the
    // genuinely divergent middle — external edits are usually localized.
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) {
        start++;
    }
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }

    const removedSpan = endA - start;
    const addedSpan = endB - start;

    if (removedSpan === 0) {
        return { added: addedSpan, removed: 0 };
    }
    if (addedSpan === 0) {
        return { added: 0, removed: removedSpan };
    }
    if (removedSpan * addedSpan > LCS_CELL_LIMIT) {
        return { added: addedSpan, removed: removedSpan };
    }

    const matched = lcsLength(a, start, endA, b, start, endB);
    return { added: addedSpan - matched, removed: removedSpan - matched };
}

/** Longest common subsequence length over lines, rolling two rows only. */
function lcsLength(a: string[], aFrom: number, aTo: number, b: string[], bFrom: number, bTo: number): number {
    const width = bTo - bFrom;
    let prev = new Int32Array(width + 1);
    let cur = new Int32Array(width + 1);

    for (let i = aFrom; i < aTo; i++) {
        const line = a[i];
        cur[0] = 0;
        for (let j = 0; j < width; j++) {
            cur[j + 1] = line === b[bFrom + j]
                ? prev[j] + 1
                : Math.max(prev[j + 1], cur[j]);
        }
        const swap = prev;
        prev = cur;
        cur = swap;
    }

    return prev[width];
}

/** `+12 −3` style label, or null when the two revisions match. */
export function formatDiffLineStats(stats: DiffLineStats): string | null {
    if (!stats.added && !stats.removed) {
        return null;
    }
    return `+${stats.added} −${stats.removed}`;
}
