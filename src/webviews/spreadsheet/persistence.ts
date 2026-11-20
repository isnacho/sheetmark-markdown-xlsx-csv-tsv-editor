// Saving the spreadsheet. Every change is recorded into the edit ledger (ledger.ts); this module turns
// the ledger into `saveXlsxEdits` messages, schedules autosave, and settles the ledger when the host
// says a save worked. There is one path for every kind of edit and every file type.
// Pinned by src/test/webview/spreadsheetEditing.spec.mts. Runtime: WEBVIEW (browser).

import { Utils } from '../shared/utils';
import { getOrCreateRowCellData } from './cellValues';
import { getCellFromRow } from './components/spreadsheetSheetDataComponent';
import { dropUnrecoverableUndoEntries, lastUndoSeq } from './undo';
import { ledger } from './ledger';
import { post } from './messaging';
import { state } from './state';
import { hideLoading, setLoadingText, showLoading } from './ui';
import type { MessageOf } from '../../protocol/common';
import type { HostToSpreadsheetWebview } from '../../protocol/spreadsheet';
import type { SentMark } from './pendingEdits';

const showToast = Utils.showToast;

export type ChangeKind = 'text' | 'control' | 'format' | 'structure';

/** What persistence needs from the rest of the webview. */
export interface PersistenceHooks {
    /** Refresh Save / Undo / Redo enablement. */
    updateToolbarState(): void;
    /** Commit the cell being typed in, so a save includes it. */
    commitActiveCellEdit(): void;
}

let hooks: PersistenceHooks;

/** Call once at startup, before any edit or host message. */
export function initPersistence(h: PersistenceHooks): void {
    hooks = h;
}

/** The save that is waiting for the host's answer. */
let inFlight: { mark: SentMark; isAutosave: boolean; undoSeq: number } | null = null;

/** True when any sheet has changes that are not on disk yet. */
export function isDirty(): boolean {
    return ledger.isDirty();
}

/**
 * Records a cell value on the current sheet (and in the cached row data, so the cell keeps it when it
 * scrolls out of view and back). `value` is the text the cell shows; the original comes from the cache.
 */
export function recordCellValue(rowNum: number, colNum: number, value: string): void {
    if (!rowNum || !colNum) {return;}
    const rowKnown = state.rowCache.has(rowNum - 1);
    const cellData = getOrCreateRowCellData(rowNum - 1, colNum - 1);
    // A row that was never loaded has no known original: keep the entry whatever the value is.
    let original: string | undefined = !rowKnown ? undefined : (cellData && cellData.value !== undefined && cellData.value !== null ? String(cellData.value) : '');
    // TRUE and true are the same checkbox value.
    if (original !== undefined && /^(true|false)$/i.test(original) && value.toLowerCase() === original.toLowerCase()) {original = value;}
    ledger.recordValue(state.currentWorksheet, rowNum, colNum, value, original);
    if (cellData) {
        cellData.value = value;
        cellData.isEmpty = value === '';
        if (typeof cellData.checkboxChecked === 'boolean') {
            cellData.checkboxChecked = /^(true|1|yes|checked)$/i.test(value.trim());
        }
    }
    syncLocalSnapshotValue(rowNum, colNum, value);
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

export function clearAutoSaveTimer() {
    if (state.autoSaveTimer) {
        clearTimeout(state.autoSaveTimer);
        state.autoSaveTimer = null;
    }
}

/**
 * Call after anything was recorded into the ledger. Updates the toolbar and, with Autosave on,
 * saves shortly after the last change. With Autosave off nothing else happens: the enabled Save
 * button is the signal.
 */
export function recordChange(kind: ChangeKind = 'text'): void {
    void kind;
    if (state.isVersionPreviewMode) {return;}
    hooks.updateToolbarState();
    if (!state.currentSettings.autoSave) {return;}

    clearAutoSaveTimer();
    state.autoSaveTimer = setTimeout(() => {
        state.autoSaveTimer = null;
        if (!state.currentSettings.autoSave || state.isVersionPreviewMode || !isDirty()) {
            return;
        }
        saveEdits(true);
    }, 1100);
}

/**
 * Saves the unsaved changes, one sheet per message. A save asked for while one is in flight waits for
 * it. A manual save continues through every dirty sheet; autosave only saves what is dirty now.
 */
export function saveEdits(isAutosave = false): void {
    if (state.isVersionPreviewMode) {return;}
    if (isAutosave && !state.currentSettings.autoSave) {return;}
    if (state.isSaving) {
        state.saveQueued = { manual: !!state.saveQueued?.manual || !isAutosave };
        return;
    }

    if (!isAutosave) {hooks.commitActiveCellEdit();}
    clearAutoSaveTimer();

    const dirty = ledger.dirtySheets();
    if (!dirty.length) {
        hooks.updateToolbarState();
        return;
    }
    const sheet = dirty.includes(state.currentWorksheet) ? state.currentWorksheet : dirty[0];
    const { payload, mark } = ledger.takePayload(sheet);

    state.isSaving = true;
    inFlight = { mark, isAutosave, undoSeq: lastUndoSeq() };
    hooks.updateToolbarState();
    if (!isAutosave) {
        setLoadingText('Saving worksheet...');
        showLoading();
    }
    post({
        command: 'saveXlsxEdits',
        sheetIndex: sheet,
        edits: payload.edits,
        richEdits: payload.richEdits,
        styleEdits: payload.styleEdits,
        operations: payload.operations,
        isAutosave,
    });
}

export function onSaveResult(message: MessageOf<HostToSpreadsheetWebview, 'saveResult'>) {
    hideLoading();
    setLoadingText('Rendering worksheet...');
    state.isSaving = false;
    const sent = inFlight;
    inFlight = null;

    if (!message.ok) {
        state.saveQueued = null;
        hooks.updateToolbarState();
        const isAutosaveResult = !!message.isAutosave;
        showToast(isAutosaveResult ? 'Autosave failed' : 'Error saving', isAutosaveResult, 1000);
        return;
    }

    const thead = document.querySelector('#xlsxTable thead') as HTMLElement | null;
    if (thead) {thead.style.display = 'table-header-group';}

    if (sent) {
        // Only what was sent is settled: edits made while the save was in flight stay pending.
        ledger.settleSaved(sent.mark);
        // Structure edits and formatting that are on disk now cannot be undone by restoring a snapshot.
        dropUnrecoverableUndoEntries(sent.mark.sheet, sent.undoSeq);
        if (!ledger.hasOps(sent.mark.sheet)) {state.sheetStash.delete(sent.mark.sheet);}
    }

    const queued = state.saveQueued;
    state.saveQueued = null;
    const manualRun = !!sent && !sent.isAutosave;
    if (isDirty() && (queued || manualRun)) {
        saveEdits(!(queued?.manual || manualRun));
        return;
    }

    hooks.updateToolbarState();
    if (manualRun) {
        showToast('Saved', false, 1000);
    }
    if (isDirty() && state.currentSettings.autoSave) {
        recordChange('text');
    }
}
