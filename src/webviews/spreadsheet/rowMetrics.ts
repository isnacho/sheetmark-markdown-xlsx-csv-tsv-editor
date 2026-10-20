// Row geometry for the virtualized grid: prefix sums of row heights, and the row at a scroll
// offset (binary search). Pure. Runtime: WEBVIEW (browser).

/** `prefix[i]` is the top offset of row i; `prefix[count]` is the total height. */
export function buildRowOffsetPrefix(count: number, heightAt: (rowIndex: number) => number): number[] {
    const prefix = new Array<number>(count + 1);
    prefix[0] = 0;
    for (let i = 0; i < count; i++) {
        prefix[i + 1] = prefix[i] + heightAt(i);
    }
    return prefix;
}

/** Top offset of `rowIndex`, clamped to [0, count]. */
export function rowTopOffset(prefix: readonly number[], count: number, rowIndex: number): number {
    if (count <= 0) { return 0; }
    return prefix[Math.max(0, Math.min(rowIndex, count))] || 0;
}

/** Total height of rows [startIndex, endIndex), clamped to the grid. */
export function rowRangeHeight(prefix: readonly number[], count: number, startIndex: number, endIndex: number): number {
    if (count <= 0) { return 0; }
    const safeStart = Math.max(0, Math.min(startIndex, count));
    const safeEnd = Math.max(safeStart, Math.min(endIndex, count));
    return Math.max(0, (prefix[safeEnd] || 0) - (prefix[safeStart] || 0));
}

/** The row whose top is at or above `offset` (last row whose prefix <= offset), clamped to a valid row. */
export function rowIndexAtOffset(prefix: readonly number[], count: number, offset: number): number {
    if (count <= 0) { return 0; }
    const total = prefix[count] || 0;
    const target = Math.max(0, Math.min(offset, total));
    let low = 0;
    let high = count;
    while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        if ((prefix[mid] || 0) <= target) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    return Math.min(Math.max(low, 0), Math.max(count - 1, 0));
}
