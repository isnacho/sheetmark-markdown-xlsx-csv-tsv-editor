// Spreadsheet editor (xlsxViewer.xlsx / .csv / .tsv) message contract. TYPES ONLY; see common.ts.

import type { CommonHostToWebview, CommonWebviewToHost } from './common';

export type SpreadsheetFileType = 'xlsx' | 'csv' | 'tsv';
export type SpreadsheetSettingsScope = 'plain' | 'styled';

export interface SpreadsheetSettings {
    firstRowIsHeader: boolean;
    stickyToolbar: boolean;
    stickyHeader: boolean;
    autoSave: boolean;
    autoSaveMode: 'all' | 'controlsOnly';
    showManualSavePopup: boolean;
    allowInteractiveControlsOutsideEditMode: boolean;
    hyperlinkPreview: boolean;
    spaciousCells: boolean;
    mergeWarningEnabled: boolean;
    isDefaultEditor: boolean;
    textWrap: boolean;
}

export interface SpreadsheetSettingsPayload {
    settings: SpreadsheetSettings;
    plainSettings: SpreadsheetSettings;
    styledSettings: SpreadsheetSettings;
    settingsScope: SpreadsheetSettingsScope;
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
    }
    | { command: 'updateSettings'; settingsScope: SpreadsheetSettingsScope; settings: Partial<SpreadsheetSettings> }
    | { command: 'setPreferredViewMode'; mode: SpreadsheetSettingsScope }
    | { command: 'requestStyleMode' }
    | { command: 'styleModeDecision'; decision: string }
    | { command: 'restoreVersion'; versionId: string | null }
    | { command: 'convertFile' };

export type HostToSpreadsheetWebview =
    | CommonHostToWebview
    | {
        command: 'initVirtualTable';
        worksheets: WorksheetMeta[];
        rowHeaderWidth: number;
        fileType: SpreadsheetFileType;
        isPlainView: boolean;
        previewMode: boolean;
        versionId: string | null;
        timestamp: number | null;
    }
    /** Row objects come from the host's worksheet extractor (cells, styles, merges). */
    | { command: 'rowsData'; requestId: string; start: number; end: number; rows: any[] }
    | ({ command: 'initSettings' } & SpreadsheetSettingsPayload)
    | ({ command: 'settingsUpdated' } & SpreadsheetSettingsPayload)
    | { command: 'saveResult'; ok: boolean; isAutosave?: boolean; error?: string }
    | { command: 'styleModeActivated' }
    | { command: 'showStyleModeNotice' }
    | { command: 'styleModeCancelled' }
    | { command: 'versionRestoredXlsx'; versionId: string; timestamp: number }
    | { command: 'versionPreviewCancelledXlsx' };
