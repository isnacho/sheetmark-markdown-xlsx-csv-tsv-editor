// Row heights and offsets of the current sheet, for virtual scrolling. Wraps the pure math in
// rowMetrics.ts with the cached prefix sums kept in `state`. Runtime: WEBVIEW (browser).

import { VirtualScrollConfig } from '../shared/common';
import { state } from './state';
import { buildRowOffsetPrefix, rowIndexAtOffset, rowRangeHeight, rowTopOffset } from './rowMetrics';

const { ROW_HEIGHT } = VirtualScrollConfig;

export function getMutableRowsSnapshot(): any[] {
    const rows: any[] = [];
    for (let i = 0; i < state.totalRows; i++) {
        rows.push(state.rowCache.get(i) || { cells: [], rowNumber: i + 1, height: state.allRowHeights[i] || ROW_HEIGHT });
    }
    return rows;
}

export function getEffectiveRowHeightFromValue(height: number): number {
    const normalized = Number.isFinite(height) && height > 0 ? height : ROW_HEIGHT;

    // Plain view follows CSV/TSV row metrics exactly.
    if (state.isPlainView) {
        return 24;
    }

    if (!state.currentSettings.spaciousCells) {
        return Math.max(normalized, 24);
    }

    return Math.max(normalized + 8, 28);
}

export function getEffectiveRowHeightByIndex(rowIndex: number): number {
    const base = state.allRowHeights[rowIndex] || ROW_HEIGHT;
    return getEffectiveRowHeightFromValue(base);
}

export function invalidateRowMetrics() {
    state.rowMetricsVersion += 1;
    state.rowOffsetPrefixVersion = -1;
    state.rowOffsetPrefix = [0];
    state.totalContentHeight = 0;
}

export function ensureRowOffsetPrefix() {
    if (state.rowOffsetPrefixVersion === state.rowMetricsVersion && state.rowOffsetPrefix.length === state.totalRows + 1) {
        return;
    }

    state.rowOffsetPrefix = buildRowOffsetPrefix(state.totalRows, getEffectiveRowHeightByIndex);
    state.totalContentHeight = state.rowOffsetPrefix[state.totalRows] || 0;
    state.rowOffsetPrefixVersion = state.rowMetricsVersion;
}

export function getRowTopOffset(rowIndex: number): number {
    ensureRowOffsetPrefix();
    return rowTopOffset(state.rowOffsetPrefix, state.totalRows, rowIndex);
}

export function getRowHeightRange(startIndex: number, endIndex: number): number {
    ensureRowOffsetPrefix();
    return rowRangeHeight(state.rowOffsetPrefix, state.totalRows, startIndex, endIndex);
}

export function findRowIndexByOffset(offset: number): number {
    ensureRowOffsetPrefix();
    return rowIndexAtOffset(state.rowOffsetPrefix, state.totalRows, offset);
}
