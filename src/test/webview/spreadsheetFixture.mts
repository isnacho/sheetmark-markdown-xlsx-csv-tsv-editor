// Boots the spreadsheet webview the way SpreadsheetEditorProvider does (initSettings, then
// initVirtualTable) and answers its getRows requests from in-memory rows.

import { openWebview, type WebviewHarness } from './harness.mts';
import type { HostToSpreadsheetWebview, SpreadsheetFileType, SpreadsheetSettings } from '../../protocol/spreadsheet.ts';

export const SPREADSHEET_SETTINGS: SpreadsheetSettings = {
    firstRowIsHeader: false, stickyToolbar: true, stickyHeader: true, autoSave: false, autoSaveMode: 'all',
    showManualSavePopup: false, allowInteractiveControlsOutsideEditMode: true, hyperlinkPreview: true,
    spaciousCells: false, mergeWarningEnabled: true, isDefaultEditor: false, textWrap: false,
};

/** Row objects in the shape the host's worksheet extractor sends. */
export function rowsFromValues(values: string[][], cellProps: Record<string, object> = {}) {
    return values.map((cells, r) => ({
        rowNumber: r + 1,
        height: 21,
        cells: cells.map((value, c) => ({ rowNumber: r + 1, colNumber: c + 1, value, style: {}, ...cellProps[`${r}:${c}`] })),
    }));
}

export interface SpreadsheetFixture extends WebviewHarness {
    /** Send initVirtualTable again (as the host does after a reload) and wait for the new table. */
    reinit(overrides?: Partial<Extract<HostToSpreadsheetWebview, { command: 'initVirtualTable' }>>): Promise<void>;
    cell(row: number, col: number): string;
    stop(): Promise<void>;
}

export async function bootSpreadsheet(options: {
    values: string[][];
    /** Extra cell fields keyed `row:col` (zero-based), for example `{ '0:0': { hyperlink: 'https://…' } }`. */
    cellProps?: Record<string, object>;
    settings?: Partial<SpreadsheetSettings>;
    fileType?: SpreadsheetFileType;
    extraInitScript?: string;
    initVirtualTable?: Partial<Extract<HostToSpreadsheetWebview, { command: 'initVirtualTable' }>>;
}): Promise<SpreadsheetFixture> {
    const rows = rowsFromValues(options.values, options.cellProps);
    const columnCount = Math.max(...options.values.map(r => r.length));
    const settings = { ...SPREADSHEET_SETTINGS, ...options.settings };
    const webview = await openWebview('spreadsheet', { extraInitScript: options.extraInitScript });
    await webview.waitForPosted('webviewReady');

    let answered = 0;
    const rowsServer = setInterval(async () => {
        try {
            const requests = await webview.postedOf('getRows');
            for (const request of requests.slice(answered)) {
                answered++;
                await webview.send({ command: 'rowsData', requestId: request.requestId, start: request.start, end: request.end, rows: rows.slice(request.start, request.end) } satisfies HostToSpreadsheetWebview);
            }
        } catch { /* page closing */ }
    }, 25);
    rowsServer.unref(); // never keep the test process alive if a test fails before stop()

    const cell = (row: number, col: number) => `table:not([data-stale]) td[data-row="${row}"][data-col="${col}"]`;
    const reinit = async (overrides: Partial<Extract<HostToSpreadsheetWebview, { command: 'initVirtualTable' }>> = {}) => {
        await webview.page.evaluate(() => document.querySelectorAll('table').forEach(t => t.setAttribute('data-stale', '')));
        await webview.send({
            command: 'initVirtualTable',
            worksheets: [{ name: 'Sheet1', index: 0, totalRows: rows.length, columnCount, columnWidths: Array(columnCount).fill(120), mergedCells: [], rowHeights: rows.map(() => 21) }],
            rowHeaderWidth: 40, fileType: options.fileType ?? 'xlsx', isPlainView: false, previewMode: false, versionId: null, timestamp: null,
            ...options.initVirtualTable,
            ...overrides,
        } satisfies HostToSpreadsheetWebview);
        await webview.page.waitForSelector(cell(rows.length - 1, columnCount - 1), { timeout: 10000 });
    };

    await webview.send({ command: 'initSettings', settings, plainSettings: settings, styledSettings: settings, settingsScope: 'styled' } satisfies HostToSpreadsheetWebview);
    await reinit();
    return {
        ...webview,
        reinit,
        cell,
        async stop() {
            clearInterval(rowsServer);
            await webview.close();
        },
    };
}
