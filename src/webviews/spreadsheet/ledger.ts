// The webview's one edit ledger (see pendingEdits.ts) plus small helpers bound to the sheet that is
// on screen. Everything that changes the workbook records into it; saving reads it back out.
// Runtime: WEBVIEW (browser).

import { PendingEdits } from './pendingEdits';
import { state } from './state';
import type { CellStyleEdit } from './components/spreadsheetTypes';

export const ledger = new PendingEdits();

function parseKey(key: string): { row: number; col: number } {
    const [row, col] = key.split(':').map(Number);
    return { row, col };
}

/** The pending style edit of a cell on the current sheet, by `row:col` key (1-based). */
export function getPendingStyle(key: string): CellStyleEdit | undefined {
    const { row, col } = parseKey(key);
    return ledger.getStyle(state.currentWorksheet, row, col);
}

export function setPendingStyle(key: string, style: CellStyleEdit): void {
    const { row, col } = parseKey(key);
    ledger.recordStyle(state.currentWorksheet, { ...style, row, col });
}

export function deletePendingStyle(key: string): void {
    const { row, col } = parseKey(key);
    ledger.removeStyle(state.currentWorksheet, row, col);
}
