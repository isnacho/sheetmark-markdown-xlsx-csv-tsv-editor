// Spreadsheet editor (xlsxViewer.xlsx / .csv / .tsv) message contract. TYPES ONLY; see common.ts.

import type { CommonHostToWebview, CommonWebviewToHost } from './common';

export type SpreadsheetFileType = 'xlsx' | 'csv' | 'tsv';
export type SpreadsheetInitReason = 'open' | 'reload' | 'save' | 'preview' | 'previewEnd' | 'restore';

export interface SpreadsheetSettings {
    firstRowIsHeader: boolean;
    stickyToolbar: boolean;
    stickyHeader: boolean;
    autoSave: boolean;
    hyperlinkPreview: boolean;
    spaciousCells: boolean;
    mergeWarningEnabled: boolean;
    isDefaultEditor: boolean;
    textWrap: boolean;
}

/** The settings for this file's type: xlsx, csv and tsv each have their own `xlsxViewer.<type>.*` values. */
export interface SpreadsheetSettingsPayload {
    settings: SpreadsheetSettings;
}

/** One cell value edit; row and col are 1-based. */
export interface CellEdit { row: number; col: number; value: string }

export interface WorksheetMeta {
    name: string;
    index: number;
    totalRows: number;
    columnCount: number;
    columnWidths: number[];
    mergedCells: unknown[];
    rowHeights: number[];
}

export type SpreadsheetWebviewToHost =
    | CommonWebviewToHost
    | { command: 'getRows'; start: number; end: number; requestId: string; sheetIndex?: number }
    | {
        command: 'saveXlsxEdits';
        sheetIndex: number;
        edits: CellEdit[];
        /** Rich-text runs, style edits and structural operations: shapes owned by the webview's save code. */
        richEdits: any[];
        styleEdits: any[];
        operations: any[];
        isAutosave: boolean;
        /** Save even though the file changed on disk since it was loaded (the user confirmed). */
        force?: boolean;
    }
    | { command: 'updateSettings'; settings: Partial<SpreadsheetSettings> }
    | { command: 'restoreVersion'; versionId: string | null }
    | { command: 'convertFile' }
    /** From the legacy-styles notice: convert this CSV/TSV to XLSX keeping its Sheetmark-only formatting. */
    | { command: 'convertToXlsx' }
    /** From the legacy-styles notice: forget the Sheetmark-only formatting stored for this CSV/TSV. */
    | { command: 'dismissLegacyStyles' };

export type HostToSpreadsheetWebview =
    | CommonHostToWebview
    | {
        command: 'initVirtualTable';
        worksheets: WorksheetMeta[];
        rowHeaderWidth: number;
        fileType: SpreadsheetFileType;
        /** Why the table is (re)sent: the webview keeps its unsaved edits across 'save', and drops them for 'reload' and 'restore'. */
        reason: SpreadsheetInitReason;
        /** CSV/TSV only: the file has formatting that only Sheetmark stored (it is no longer shown). */
        legacyStylesNotice?: boolean;
        previewMode: boolean;
        versionId: string | null;
        timestamp: number | null;
    }
    /** Row objects come from the host's worksheet extractor (cells, styles, merges). */
    | { command: 'rowsData'; requestId: string; start: number; end: number; rows: any[] }
    | ({ command: 'initSettings' } & SpreadsheetSettingsPayload)
    | ({ command: 'settingsUpdated' } & SpreadsheetSettingsPayload)
    | { command: 'saveResult'; ok: boolean; isAutosave?: boolean; error?: string }
    /** The file changed on disk and is no longer the one that was loaded or last saved. Nothing was reloaded. */
    | { command: 'diskChangedExternally' }
    /** A save was refused because the file changed on disk; nothing was written. Send it again with `force` to save over it. */
    | { command: 'saveConflict' }
    | { command: 'versionRestoredXlsx'; versionId: string; timestamp: number }
    | { command: 'versionPreviewCancelledXlsx' };
