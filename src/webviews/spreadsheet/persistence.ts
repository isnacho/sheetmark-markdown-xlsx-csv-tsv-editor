// Saving the spreadsheet: building the saveXlsxEdits payload, autosave scheduling, edits made
// outside edit mode, and the host's saveResult. Pinned by src/test/webview/spreadsheetEditing.spec.mts.
// Runtime: WEBVIEW (browser).

import { Utils } from '../shared/utils';
import { getCellRichRuns, hasRunFormatting } from './components/spreadsheetRichTextComponent';
import { getCellFromRow } from './components/spreadsheetSheetDataComponent';
import type { CellStyleEdit, WorksheetOp } from './components/spreadsheetTypes';
import { getCellNormalizedValue, getCellType, getOrCreateRowCellData, parseBooleanCellValue } from './cellValues';
import { post } from './messaging';
import { state } from './state';
import { captureOriginalCellValues, hideLoading, setButtonsEnabled, setLoadingText, showLoading } from './ui';
import type { MessageOf } from '../../protocol/common';
import type { HostToSpreadsheetWebview } from '../../protocol/spreadsheet';

const showToast = Utils.showToast;

export type XlsxAutoSaveChangeKind = 'text' | 'control' | 'format' | 'structure';

/** What persistence needs from the rest of the webview. */
export interface PersistenceHooks {
    setEditMode(enabled: boolean, preserveSelection?: boolean): void;
}

let hooks: PersistenceHooks;

/** Call once at startup, before any edit or host message. */
export function initPersistence(h: PersistenceHooks): void {
    hooks = h;
}

export function showManualSaveReminderIfNeeded() {
    const isAutosaveOff = !state.currentSettings.autoSave;
    const shouldShowForPlain = state.isPlainView && !state.isVersionPreviewMode && isAutosaveOff;
    const shouldShowForStyled = !state.isPlainView && !state.isEditMode && !state.isVersionPreviewMode && isAutosaveOff && state.currentSettings.showManualSavePopup;

    if (!shouldShowForPlain && !shouldShowForStyled) {
        return;
    }

    const now = Date.now();
    if (now < state.manualSaveReminderUntil) {
        return;
    }

    state.manualSaveReminderUntil = now + 2500;
    showToast('Autosave is off. Press Ctrl/Cmd+S to save or enable it in settings', false, 1800);
}

export function upsertPendingOutsideControlEdit(row: number, col: number, value: string) {
    const existingIndex = state.pendingOutsideControlEdits.findIndex((edit) => edit.row === row && edit.col === col);
    const next = { row, col, value };

    if (existingIndex >= 0) {
        state.pendingOutsideControlEdits[existingIndex] = next;
        return;
    }

    state.pendingOutsideControlEdits.push(next);
}

export function removePendingOutsideControlEdit(row: number, col: number) {
    state.pendingOutsideControlEdits = state.pendingOutsideControlEdits.filter((edit) => edit.row !== row || edit.col !== col);
}

export function clearPendingOutsideControlEdits() {
    state.pendingOutsideControlEdits = [];
}

export function shouldScheduleAutosaveForChange(kind: XlsxAutoSaveChangeKind): boolean {
    if (state.isTemporaryStyleFile && (kind === 'format' || kind === 'structure')) {
        return true;
    }

    if (!state.currentSettings.autoSave) {
        return false;
    }

    const mode = state.currentSettings.autoSaveMode === 'controlsOnly' ? 'controlsOnly' : 'all';
    if (mode === 'all') {
        return true;
    }

    return kind === 'control';
}

export function persistInteractiveControlEdit(cell: HTMLElement) {
    if (state.isVersionPreviewMode || state.isEditMode) {return;}

    const row = parseInt(cell.getAttribute('data-rownum') || '0', 10);
    const col = parseInt(cell.getAttribute('data-colnum') || '0', 10);
    if (!row || !col) {return;}

    const value = getCellNormalizedValue(cell).replace(/\u00a0/g, '');
    syncLocalSnapshotValue(row, col, value);

    if (!state.currentSettings.autoSave) {
        upsertPendingOutsideControlEdit(row, col, value);
        showManualSaveReminderIfNeeded();
        return;
    }

    removePendingOutsideControlEdit(row, col);
    post({
        command: 'saveXlsxEdits',
        sheetIndex: state.currentWorksheet,
        edits: [{ row, col, value }],
        richEdits: [],
        styleEdits: [],
        operations: [],
        isAutosave: true
    });
}

export function persistPlainTextEdit(cell: HTMLElement) {
    if (state.isVersionPreviewMode || state.isEditMode) {return;}

    const row = parseInt(cell.getAttribute('data-rownum') || '0', 10);
    const col = parseInt(cell.getAttribute('data-colnum') || '0', 10);
    if (!row || !col) {return;}

    const value = getCellNormalizedValue(cell).replace(/\u00a0/g, '');
    syncLocalSnapshotValue(row, col, value);
    cell.dataset.originalText = value;
    cell.dataset.originalHtml = cell.innerHTML;

    if (!state.currentSettings.autoSave) {
        upsertPendingOutsideControlEdit(row, col, value);
        showManualSaveReminderIfNeeded();
        return;
    }

    removePendingOutsideControlEdit(row, col);
    post({
        command: 'saveXlsxEdits',
        sheetIndex: state.currentWorksheet,
        edits: [{ row, col, value }],
        richEdits: [],
        styleEdits: [],
        operations: [],
        isAutosave: true
    });
}

export function syncLocalSnapshotValue(rowNumber: number, colNumber: number, value: string) {
    const applyValue = (rows: any[] | null) => {
        if (!rows || rowNumber <= 0 || colNumber <= 0) {return;}
        const row = rows.find((entry) => Number(entry?.rowNumber) === rowNumber);
        if (!row) {return;}

        const existing = getCellFromRow(row, colNumber);
        if (existing) {
            existing.value = value;
            return;
        }

        if (!Array.isArray(row.cells)) {
            row.cells = [];
        }
        row.cells.push({ rowNumber, colNumber, value });
        row.cells.sort((a: any, b: any) => (a.colNumber || 0) - (b.colNumber || 0));
    };

    applyValue(state.sourceRowsSnapshot);
    applyValue(state.transformedRowsSnapshot);
}

export function hasPendingXlsxEdits(): boolean {
    if (state.pendingOutsideControlEdits.length > 0) {
        return true;
    }

    if (state.pendingWorksheetOps.length > 0 || state.pendingCellStyleEdits.size > 0) {
        return true;
    }

    const table = document.querySelector('#tableContainer table');
    if (!table) {return false;}

    const editedCell = Array.from(table.querySelectorAll('td.editable-cell')).find((td) => {
        const htmlTd = td as HTMLElement;
        const original = (htmlTd.dataset.originalText || '').replace(/\u00a0/g, '');
        const current = getCellNormalizedValue(htmlTd).replace(/\u00a0/g, '');
        return current !== original;
    });

    return !!editedCell;
}

export function clearAutoSaveTimer() {
    if (state.autoSaveTimer) {
        clearTimeout(state.autoSaveTimer);
        state.autoSaveTimer = null;
    }
}

export function scheduleAutoSave(kind: XlsxAutoSaveChangeKind = 'text') {
    if (!state.isEditMode || state.isVersionPreviewMode || state.isSaving) {
        if (state.isPlainView && !state.isVersionPreviewMode && !state.currentSettings.autoSave) {
            showManualSaveReminderIfNeeded();
        }
        return;
    }
    if (!shouldScheduleAutosaveForChange(kind)) {
        if (!state.currentSettings.autoSave) {
            showManualSaveReminderIfNeeded();
        }
        return;
    }

    clearAutoSaveTimer();
    state.autoSaveTimer = setTimeout(() => {
        state.autoSaveTimer = null;
        if ((!state.currentSettings.autoSave && !(state.isTemporaryStyleFile && (kind === 'format' || kind === 'structure'))) || !state.isEditMode || state.isVersionPreviewMode || state.isSaving) {
            return;
        }
        if (!hasPendingXlsxEdits()) {
            return;
        }
        saveEdits(false, true);
    }, 1100);
}

export function saveEdits(shouldExit = false, isAutosave = false) {
    if (state.isSaving) {return;}
    if (isAutosave && !state.currentSettings.autoSave) {return;}

    const table = document.querySelector('#tableContainer table');
    const hasPendingStyleOrStructureChanges = state.pendingCellStyleEdits.size > 0 || state.pendingWorksheetOps.length > 0;
    const canSaveFromEditMode = state.isEditMode && !!table;
    const canSaveOutsideEditMode = !state.isEditMode && (state.pendingOutsideControlEdits.length > 0 || hasPendingStyleOrStructureChanges);

    if (!canSaveFromEditMode && !canSaveOutsideEditMode) {
        return;
    }

    clearAutoSaveTimer();
    state.isSaving = true;
    state.exitAfterSave = canSaveFromEditMode && !isAutosave ? !!shouldExit : false;
    if (canSaveFromEditMode) {
        if (!isAutosave) {
            setButtonsEnabled(false);

            if (document.activeElement && document.activeElement.tagName === 'TD') {
                (document.activeElement as HTMLElement).blur();
            }
            // Don't clear the logical cell selection on save; keep selected cells highlighted.
            if (window.getSelection) {
                window.getSelection()!.removeAllRanges();
            }
        }
    }

    const edits: any[] = [];
    const richEdits: any[] = [];
    let styleEdits: CellStyleEdit[] = [];
    let operations: WorksheetOp[] = [];

    if (canSaveFromEditMode && table) {
        table.querySelectorAll('td.editable-cell').forEach(td => {
            const htmlTd = td as HTMLElement;
            const row = parseInt(htmlTd.getAttribute('data-rownum') || '0', 10);
            const col = parseInt(htmlTd.getAttribute('data-colnum') || '0', 10);
            if (!row || !col) {return;}

            const cellType = getCellType(htmlTd);
            const original = (htmlTd.dataset.originalText || '').replace(/\u00a0/g, '');
            const current = getCellNormalizedValue(htmlTd).replace(/\u00a0/g, '');
            const originalHtml = (htmlTd.dataset.originalHtml || '').trim();
            const currentHtml = (htmlTd.innerHTML || '').trim();

            const runs = cellType === 'text' ? getCellRichRuns(htmlTd) : [];
            const shouldSaveRuns = cellType === 'text' && (hasRunFormatting(runs) || currentHtml !== originalHtml);

            if (shouldSaveRuns) {
                richEdits.push({ row, col, runs });
            }

            if (current !== original) {
                edits.push({ row, col, value: current });
                const cellData = getOrCreateRowCellData(row - 1, col - 1);
                if (cellData) {
                    cellData.value = current;
                    if (cellType === 'checkbox') {
                        cellData.checkboxChecked = parseBooleanCellValue(current) === true;
                    }
                }
            }
        });

        styleEdits = Array.from(state.pendingCellStyleEdits.values());
        operations = state.pendingWorksheetOps;
    } else {
        state.pendingOutsideControlEdits.forEach((edit) => {
            const cellData = getOrCreateRowCellData(edit.row - 1, edit.col - 1);
            if (cellData) {
                cellData.value = edit.value;
            }
            edits.push({ row: edit.row, col: edit.col, value: edit.value });
        });

        styleEdits = Array.from(state.pendingCellStyleEdits.values());
        operations = state.pendingWorksheetOps;
    }

    if (canSaveFromEditMode && state.pendingOutsideControlEdits.length > 0) {
        state.pendingOutsideControlEdits.forEach((edit) => {
            const cellData = getOrCreateRowCellData(edit.row - 1, edit.col - 1);
            if (cellData) {
                cellData.value = edit.value;
            }
            const existingIndex = edits.findIndex((candidate) => candidate.row === edit.row && candidate.col === edit.col);
            if (existingIndex >= 0) {
                edits[existingIndex].value = edit.value;
                return;
            }
            edits.push({ row: edit.row, col: edit.col, value: edit.value });
        });
    }

    if (!edits.length && !richEdits.length && !styleEdits.length && !operations.length) {
        state.isSaving = false;
        if (canSaveFromEditMode) {
            setButtonsEnabled(true);
        }
        return;
    }

    if (!isAutosave) {
        setLoadingText('Saving worksheet...');
        showLoading();
    }
    post({ command: 'saveXlsxEdits', sheetIndex: state.currentWorksheet, edits, richEdits, styleEdits, operations, isAutosave });
}

export function onSaveResult(message: MessageOf<HostToSpreadsheetWebview, 'saveResult'>) {
    hideLoading();
    setLoadingText('Rendering worksheet...');
    state.isSaving = false;
    setButtonsEnabled(true);
    if (message.ok) {
        const thead = document.querySelector('#xlsxTable thead') as HTMLElement | null;
        if (thead) {thead.style.display = 'table-header-group';}
        const isAutosaveResult = !!message.isAutosave;
        showToast(isAutosaveResult ? 'Autosaved' : 'Saved', isAutosaveResult, 1000);
        state.pendingWorksheetOps = [];
        state.pendingCellStyleEdits.clear();
        clearPendingOutsideControlEdits();
        state.manualSaveReminderUntil = 0;

        const shouldExitAfterManualSave = !isAutosaveResult || state.exitAfterSave;
        if (shouldExitAfterManualSave) {
            state.exitAfterSave = false;
            // Preserve selection when save requests exit so user doesn't lose context
            hooks.setEditMode(false, true);
        } else if (state.isEditMode) {
            captureOriginalCellValues();
        }
    } else {
        const isAutosaveResult = !!message.isAutosave;
        showToast(isAutosaveResult ? 'Autosave failed' : 'Error saving', isAutosaveResult, 1000);
    }
}
