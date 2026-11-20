// Undo/redo for the spreadsheet webview, one stack pair per sheet. Three kinds of entries:
// 'style' (per-cell DOM + pending style snapshots, used for text, formatting and controls),
// 'values' (cell values only: paste and clear) and 'sheet' (whole-worksheet snapshots, used for
// structure edits, merges and inserted controls). Undoing or redoing records the restored state into
// the edit ledger and saves it like any other edit, so history survives a save; only 'sheet' entries
// and formatting that are already on disk are dropped when a save succeeds (dropUnrecoverableUndoEntries),
// because restoring a snapshot would no longer match the file.
// Runtime: WEBVIEW (browser).

import { state } from './state';
import { getCellNormalizedValue, normalizeCellText } from './cellValues';
import { recordCellValue, recordChange } from './persistence';
import { deletePendingStyle, getPendingStyle, ledger, setPendingStyle } from './ledger';
import type { CellUndoState, EditUndoEntry, WorksheetStateSnapshot } from './components/spreadsheetTypes';
import { cloneCellData, normalizeRowsAfterStructureChange } from './components/spreadsheetSheetDataComponent';
import { getMutableRowsSnapshot, invalidateRowMetrics } from './rowLayout';
import { cloneCellStyleEdit } from './styleEdits';
import { applyInteractiveControlState } from './interactiveControls';

/** What undo needs from the rest of the webview (still in spreadsheetWebview.ts). */
export interface UndoHooks {
    clearSelection(): void;
    hideHeaderContextMenu(): void;
    rerenderCurrentSheetFromLocalState(): void;
    applyFindHighlightsInVisibleCells(): void;
}

let hooks: UndoHooks;

/** Call once at startup, before any edit. */
export function initUndo(h: UndoHooks): void {
    hooks = h;
}

export function captureCellUndoState(cell: HTMLElement): CellUndoState | null {
    const row = parseInt(cell.getAttribute('data-row') || '-1', 10);
    const col = parseInt(cell.getAttribute('data-col') || '-1', 10);
    const rowNum = parseInt(cell.getAttribute('data-rownum') || '0', 10);
    const colNum = parseInt(cell.getAttribute('data-colnum') || '0', 10);
    if (row < 0 || col < 0 || !rowNum || !colNum) {return null;}

    const key = `${rowNum}:${colNum}`;
    const pendingStyle = cloneCellStyleEdit(getPendingStyle(key) || null);
    const dropdown = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
    const dropdownValue = dropdown
        ? normalizeCellText(dropdown.value || '')
        : (cell.getAttribute('data-dropdown-value') || '');

    return {
        row,
        col,
        key,
        styleAttr: cell.getAttribute('style') || '',
        innerHtml: cell.innerHTML,
        dataCellType: cell.getAttribute('data-cell-type') || 'text',
        dataCheckboxChecked: cell.getAttribute('data-checkbox-checked') || '',
        dataDropdownValue: dropdownValue,
        dataRatingValue: cell.getAttribute('data-rating-value') || '',
        dataDateValue: cell.getAttribute('data-date-value') || '',
        pendingStyle,
        value: getCellNormalizedValue(cell).replace(/\u00a0/g, '')
    };
}

export function applyCellUndoState(undoState: CellUndoState) {
    const cell = document.querySelector(`td[data-row="${undoState.row}"][data-col="${undoState.col}"]`) as HTMLElement | null;
    if (cell) {
        if (undoState.styleAttr) {
            cell.setAttribute('style', undoState.styleAttr);
        } else {
            cell.removeAttribute('style');
        }
        cell.innerHTML = undoState.innerHtml;

        cell.setAttribute('data-cell-type', undoState.dataCellType || 'text');
        if (undoState.dataCheckboxChecked) {
            cell.setAttribute('data-checkbox-checked', undoState.dataCheckboxChecked);
        } else {
            cell.removeAttribute('data-checkbox-checked');
        }
        if (undoState.dataDropdownValue) {
            cell.setAttribute('data-dropdown-value', undoState.dataDropdownValue);
        } else {
            cell.removeAttribute('data-dropdown-value');
        }
        if (undoState.dataRatingValue) {
            cell.setAttribute('data-rating-value', undoState.dataRatingValue);
        } else {
            cell.removeAttribute('data-rating-value');
        }
        if (undoState.dataDateValue) {
            cell.setAttribute('data-date-value', undoState.dataDateValue);
        } else {
            cell.removeAttribute('data-date-value');
        }

        const select = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
        if (select) {
            select.value = undoState.dataDropdownValue || '';
        }

        applyInteractiveControlState(cell);
    }

    if (undoState.pendingStyle) {
        setPendingStyle(undoState.key, cloneCellStyleEdit(undoState.pendingStyle)!);
    } else {
        deletePendingStyle(undoState.key);
    }

    // The restored value goes into the ledger too, so an undo is saved like any other edit.
    if (undoState.value !== undefined) {
        const [rowNum, colNum] = undoState.key.split(':').map(Number);
        recordCellValue(rowNum, colNum, undoState.value);
    }
}

export function captureWorksheetStateSnapshot(): WorksheetStateSnapshot {
    return {
        rows: cloneCellData(getMutableRowsSnapshot()),
        totalRows: state.totalRows,
        columnCount: state.columnCount,
        columnWidths: cloneCellData(state.columnWidths),
        allRowHeights: cloneCellData(state.allRowHeights),
        mergedCells: cloneCellData(state.mergedCells || []),
        pending: ledger.snapshot(state.currentWorksheet)
    };
}

/** Puts a snapshot's rows and sizes back into `state` (no re-render, the ledger is untouched). */
export function applyWorksheetSnapshotState(snapshot: WorksheetStateSnapshot) {
    state.totalRows = snapshot.totalRows;
    state.columnCount = snapshot.columnCount;
    state.columnWidths = cloneCellData(snapshot.columnWidths || []);
    state.allRowHeights = cloneCellData(snapshot.allRowHeights || []);
    invalidateRowMetrics();
    state.mergedCells = cloneCellData(snapshot.mergedCells || []);
    normalizeRowsAfterStructureChange(cloneCellData(snapshot.rows || []), state.rowCache);
}

export function restoreWorksheetStateSnapshot(snapshot: WorksheetStateSnapshot) {
    applyWorksheetSnapshotState(snapshot);
    ledger.restore(state.currentWorksheet, snapshot.pending);
    hooks.clearSelection();
    hooks.hideHeaderContextMenu();
    hooks.rerenderCurrentSheetFromLocalState();
}

let undoSeq = 0;

/** The sequence number of the most recent undo entry (entries made later have a higher one). */
export function lastUndoSeq(): number {
    return undoSeq;
}

function pushEntry(entry: EditUndoEntry) {
    state.editUndoStack.push(entry);
    if (state.editUndoStack.length > 100) {
        state.editUndoStack.shift();
    }
    state.editRedoStack.length = 0;
}

export function pushEditUndoEntry(entry: { before: CellUndoState[]; after: CellUndoState[] }) {
    if (!entry.before.length || !entry.after.length) {return;}
    pushEntry({ kind: 'style', seq: ++undoSeq, before: entry.before, after: entry.after });
}

export function pushSheetUndoEntry(before: WorksheetStateSnapshot, after: WorksheetStateSnapshot) {
    pushEntry({ kind: 'sheet', seq: ++undoSeq, before, after });
}

/** Paste and clear: the values of the cells they changed, before and after (1-based addresses). */
export function pushValuesUndoEntry(before: Array<{ row: number; col: number; value: string }>, after: Array<{ row: number; col: number; value: string }>) {
    if (!before.length) {return;}
    pushEntry({ kind: 'values', seq: ++undoSeq, before, after });
}

function applyValuesEntry(values: Array<{ row: number; col: number; value: string }>) {
    values.forEach(({ row, col, value }) => recordCellValue(row, col, value));
    hooks.rerenderCurrentSheetFromLocalState();
}

function applyEntry(entry: EditUndoEntry, direction: 'before' | 'after') {
    if (entry.kind === 'style') {
        entry[direction].forEach((undoState: CellUndoState) => applyCellUndoState(undoState));
    } else if (entry.kind === 'values') {
        applyValuesEntry(entry[direction]);
    } else {
        restoreWorksheetStateSnapshot(entry[direction]);
    }
}

export function canUndo(): boolean {
    return state.editUndoStack.length > 0;
}

export function canRedo(): boolean {
    return state.editRedoStack.length > 0;
}

export function undoEditAction() {
    const entry = state.editUndoStack.pop();
    if (!entry) {return false;}

    applyEntry(entry, 'before');
    state.editRedoStack.push(entry);
    hooks.applyFindHighlightsInVisibleCells();
    recordChange(entry.kind === 'sheet' ? 'structure' : 'text');
    return true;
}

export function redoEditAction() {
    const entry = state.editRedoStack.pop();
    if (!entry) {return false;}

    applyEntry(entry, 'after');
    state.editUndoStack.push(entry);
    hooks.applyFindHighlightsInVisibleCells();
    recordChange(entry.kind === 'sheet' ? 'structure' : 'text');
    return true;
}

export function pushSingleCellUndo(before: CellUndoState | null, after: CellUndoState | null) {
    if (!before || !after) {return;}
    pushEditUndoEntry({ before: [before], after: [after] });
}

/** Switching sheets: each sheet keeps its own undo and redo history. */
export function switchUndoSheet(fromSheet: number, toSheet: number) {
    if (fromSheet === toSheet) {return;}
    state.undoStacksBySheet.set(fromSheet, { undo: state.editUndoStack, redo: state.editRedoStack });
    const next = state.undoStacksBySheet.get(toSheet);
    state.editUndoStack = next ? next.undo : [];
    state.editRedoStack = next ? next.redo : [];
    state.undoStacksBySheet.delete(toSheet);
}

/** The file was reloaded from disk (or restored): no sheet has history any more. */
export function resetUndoHistory() {
    state.editUndoStack = [];
    state.editRedoStack = [];
    state.undoStacksBySheet.clear();
}

function changesFormatting(entry: EditUndoEntry): boolean {
    if (entry.kind !== 'style') {return false;}
    return entry.before.some((before, index) => {
        const after = entry.after[index];
        return !after
            || before.styleAttr !== after.styleAttr
            || JSON.stringify(before.pendingStyle) !== JSON.stringify(after.pendingStyle);
    });
}

/**
 * A save of `sheetIndex` succeeded. Entries made up to `upToSeq` that restore a snapshot ('sheet') or
 * formatting can no longer be undone correctly, because what they would restore is not on disk any
 * more and no inverse operation exists yet. They are dropped so Undo disables instead of misleading.
 * Text and control edits stay undoable: undoing them records the old value, which is then saved.
 */
export function dropUnrecoverableUndoEntries(sheetIndex: number, upToSeq: number) {
    const keep = (entry: EditUndoEntry) => entry.seq > upToSeq || !(entry.kind === 'sheet' || changesFormatting(entry));
    const filterStacks = (stacks: { undo: EditUndoEntry[]; redo: EditUndoEntry[] }) => {
        stacks.undo = stacks.undo.filter(keep);
        stacks.redo = stacks.redo.filter(keep);
    };
    if (sheetIndex === state.currentWorksheet) {
        const stacks = { undo: state.editUndoStack, redo: state.editRedoStack };
        filterStacks(stacks);
        state.editUndoStack = stacks.undo;
        state.editRedoStack = stacks.redo;
    } else {
        const stacks = state.undoStacksBySheet.get(sheetIndex);
        if (stacks) {filterStacks(stacks);}
    }
}
