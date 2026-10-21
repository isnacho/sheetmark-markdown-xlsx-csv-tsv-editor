// Undo/redo for the spreadsheet webview. Two kinds of entries on state.editUndoStack:
// 'style' (per-cell DOM + pending style snapshots, used for text, formatting and controls) and
// 'sheet' (whole-worksheet snapshots, used for structure edits, merges, paste and inserted controls).
// Runtime: WEBVIEW (browser).

import { state } from './state';
import { getCellType, normalizeCellText } from './cellValues';
import { persistInteractiveControlEdit } from './persistence';
import type { CellUndoState, WorksheetStateSnapshot } from './components/spreadsheetTypes';
import { cloneCellData, normalizeRowsAfterStructureChange, cloneWorksheetOps } from './components/spreadsheetSheetDataComponent';
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
    const pendingStyle = state.pendingCellStyleEdits.has(key)
        ? cloneCellStyleEdit(state.pendingCellStyleEdits.get(key) || null)
        : null;
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
        pendingStyle
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
        state.pendingCellStyleEdits.set(undoState.key, cloneCellStyleEdit(undoState.pendingStyle)!);
    } else {
        state.pendingCellStyleEdits.delete(undoState.key);
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
        pendingWorksheetOps: cloneWorksheetOps(state.pendingWorksheetOps)
    };
}

export function restoreWorksheetStateSnapshot(snapshot: WorksheetStateSnapshot) {
    state.totalRows = snapshot.totalRows;
    state.columnCount = snapshot.columnCount;
    state.columnWidths = cloneCellData(snapshot.columnWidths || []);
    state.allRowHeights = cloneCellData(snapshot.allRowHeights || []);
    invalidateRowMetrics();
    state.mergedCells = cloneCellData(snapshot.mergedCells || []);
    state.pendingWorksheetOps = cloneWorksheetOps(snapshot.pendingWorksheetOps || []);

    normalizeRowsAfterStructureChange(cloneCellData(snapshot.rows || []), state.rowCache);
    hooks.clearSelection();
    hooks.hideHeaderContextMenu();
    hooks.rerenderCurrentSheetFromLocalState();
}

export function pushEditUndoEntry(entry: { before: CellUndoState[]; after: CellUndoState[] }) {
    if (!entry.before.length || !entry.after.length) {return;}
    state.editUndoStack.push({ kind: 'style', before: entry.before, after: entry.after });
    if (state.editUndoStack.length > 100) {
        state.editUndoStack.shift();
    }
    state.editRedoStack.length = 0;
}

export function pushSheetUndoEntry(before: WorksheetStateSnapshot, after: WorksheetStateSnapshot) {
    state.editUndoStack.push({ kind: 'sheet', before, after });
    if (state.editUndoStack.length > 100) {
        state.editUndoStack.shift();
    }
    state.editRedoStack.length = 0;
}

export function undoEditAction() {
    const entry = state.editUndoStack.pop();
    if (!entry) {return false;}

    if (entry.kind === 'style') {
        entry.before.forEach((undoState: CellUndoState) => applyCellUndoState(undoState));
    } else {
        restoreWorksheetStateSnapshot(entry.before);
    }

    state.editRedoStack.push(entry);
    hooks.applyFindHighlightsInVisibleCells();

    if (!state.isEditMode && entry.kind === 'style') {
        syncControlEditsAfterUndoRedo(entry.before);
    }

    return true;
}

export function redoEditAction() {
    const entry = state.editRedoStack.pop();
    if (!entry) {return false;}

    if (entry.kind === 'style') {
        entry.after.forEach((undoState: CellUndoState) => applyCellUndoState(undoState));
    } else {
        restoreWorksheetStateSnapshot(entry.after);
    }

    state.editUndoStack.push(entry);
    hooks.applyFindHighlightsInVisibleCells();

    if (!state.isEditMode && entry.kind === 'style') {
        syncControlEditsAfterUndoRedo(entry.after);
    }

    return true;
}

export function syncControlEditsAfterUndoRedo(states: CellUndoState[]) {
    if (state.isEditMode || state.isVersionPreviewMode || !Array.isArray(states) || !states.length) {
        return;
    }

    states.forEach((undoState) => {
        const cell = document.querySelector(`td[data-row="${undoState.row}"][data-col="${undoState.col}"]`) as HTMLElement | null;
        if (!cell) {
            return;
        }

        const cellType = getCellType(cell);
        if (cellType === 'checkbox' || cellType === 'dropdown' || cellType === 'rating' || cellType === 'date') {
            persistInteractiveControlEdit(cell);
        }
    });
}

export function pushSingleCellUndo(before: CellUndoState | null, after: CellUndoState | null) {
    if (!before || !after) {return;}
    pushEditUndoEntry({ before: [before], after: [after] });
}
