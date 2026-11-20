import { getWebviewContent } from './spreadsheet/spreadsheetHtmlRenderer';
import * as vscode from 'vscode';
import * as Excel from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { VERSION_HISTORY_RETENTION_MS, getVersionHistoryDir, pickVersionHistoryEntry } from './shared/versionHistory';
import { convertARGBToRGBA, isShadeOfBlack, isShadeOfWhite } from './spreadsheet/spreadsheetUtilities';
import { applyStoredMetadataToWorksheet, applyStyleEditToCell } from './spreadsheet/excelStyle';
import { convertTabularFile, readTabularFile, detectTabularFileType, writeTabularFile, TabularFileType } from './shared/fileConversionService';
import { StyleStorageService } from './shared/styleStorageService';
import { createSerialQueue, type SerialQueue } from './shared/serialQueue';
import { createMessageDispatcher, SPREADSHEET_FILE_WRITING_COMMANDS } from './shared/messageDispatch';
import { recordSentInTests, trackOpenEditor, type OpenEditorHandle } from './shared/editorTestHooks';
import { handleSharedHostMessage, isSharedHostMessage, syncColorTheme, syncFontFamily, type SharedHostContext } from './shared/commonHostMessages';
import type { HostToSpreadsheetWebview, SpreadsheetSettings, SpreadsheetWebviewToHost } from './protocol/spreadsheet';
import { createExternalFileChangeWatcher } from './shared/fileExternalChangeWatcher';
import { isSheetmarkConfiguredAsDefault } from './shared/editorAssociationUtils';

export class SpreadsheetEditorProvider implements vscode.CustomReadonlyEditorProvider {
    private readonly styleStorage: StyleStorageService;
    /** Open panels, for the integration tests only (see editorTestHooks.ts). */
    readonly openEditors = new Set<OpenEditorHandle>();
    /** Each open panel's write queue, keyed by lowercased path (see flushWrites). */
    private readonly fileQueues = new Map<string, SerialQueue>();

    /** Resolves once saves already queued for `uri` have finished (used before a rename moves its state). */
    async flushWrites(uri: vscode.Uri): Promise<void> {
        await this.fileQueues.get(uri.fsPath.toLowerCase())?.run(async () => { });
    }
    constructor(private readonly context: vscode.ExtensionContext) {
        this.styleStorage = new StyleStorageService(context);
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => { } };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        const webview = webviewPanel.webview;
        // Typed send: the compiler checks every host-to-webview message against src/protocol/spreadsheet.ts.
        const { post, sent } = recordSentInTests<HostToSpreadsheetWebview>(
            this.context.extensionMode === vscode.ExtensionMode.Test,
            (message) => webview.postMessage(message),
        );

        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
                vscode.Uri.joinPath(this.context.extensionUri, 'dist')
            ]
        };

        // Set the webview shell immediately; it will show its own loading overlay.
        webview.html = getWebviewContent(webviewPanel, this.context);

        let isWebviewReady = false;
        // Store parsed worksheet data for virtualization
        let worksheetsData: any[] = [];
        let rowHeaderWidth = 40;
        let currentUri = document.uri;
        let filePath = currentUri.fsPath;
        let currentFileType: TabularFileType = detectTabularFileType(filePath) || 'xlsx';
        // CSV/TSV only: Sheetmark still holds formatting for this file that the file itself cannot store.
        let legacyStylesNotice = false;
        // Save and restore both read-modify-write the file; run them one at a time (see serialQueue.ts).
        const fileQueue = createSerialQueue();
        const fileQueueKey = document.uri.fsPath.toLowerCase();
        this.fileQueues.set(fileQueueKey, fileQueue);
        webviewPanel.onDidDispose(() => this.fileQueues.delete(fileQueueKey));
        let lastSaveTime = 0;

        type VersionHistoryEntry = {
            id: string;
            timestamp: number;
            fileName: string;
            byteSize: number;
            hash: string;
            fileType: TabularFileType;
            snapshotFile: string;
        };

        let previewVersionId: string | null = null;
        let previewVersionTimestamp: number | null = null;
        let restoredVersionId: string | null = null;

        const getHistoryDir = () => {
            return getVersionHistoryDir(this.context.globalStorageUri.fsPath, filePath, currentFileType);
        };

        const getHistoryIndexPath = () => path.join(getHistoryDir(), 'index.json');
        const getSnapshotPath = (snapshotFile: string) => path.join(getHistoryDir(), snapshotFile);
        const getSnapshotFileType = (snapshotFile: string, fallbackType: TabularFileType): TabularFileType => {
            const extension = path.extname(snapshotFile).toLowerCase().replace(/^\./, '');
            if (extension === 'csv' || extension === 'tsv' || extension === 'xlsx') {
                return extension;
            }

            return fallbackType;
        };

        const applyDelimitedOperationsToRows = (rows: string[][], op: any) => {
            const type = typeof op?.type === 'string' ? op.type : '';
            const index = typeof op?.index === 'number' ? op.index : 0;
            const row = typeof op?.row === 'number' ? op.row : 0;
            const col = typeof op?.col === 'number' ? op.col : 0;

            switch (type) {
                case 'insertRowAbove':
                    if (index > 0) {rows.splice(index - 1, 0, []);}
                    break;
                case 'insertRowBelow':
                    if (index > 0) {rows.splice(index, 0, []);}
                    break;
                case 'deleteRow':
                    if (index > 0 && index <= rows.length) {rows.splice(index - 1, 1);}
                    break;
                case 'insertColumnLeft':
                    if (index > 0) {
                        rows.forEach(rowData => rowData.splice(index - 1, 0, ''));
                    }
                    break;
                case 'insertColumnRight':
                    if (index > 0) {
                        rows.forEach(rowData => rowData.splice(index, 0, ''));
                    }
                    break;
                case 'deleteColumn':
                    if (index > 0) {
                        rows.forEach(rowData => {
                            if (index - 1 < rowData.length) {
                                rowData.splice(index - 1, 1);
                            }
                        });
                    }
                    break;
                case 'insertCellShiftRight': {
                    if (row > 0 && col > 0 && row <= rows.length) {
                        const rowData = rows[row - 1];
                        if (!rowData) {break;}
                        while (rowData.length < col - 1) {
                            rowData.push('');
                        }
                        rowData.splice(col - 1, 0, '');
                    }
                    break;
                }
                case 'insertCellShiftDown': {
                    if (row > 0 && col > 0 && row <= rows.length) {
                        rows.push([]);
                        for (let r = rows.length - 2; r >= row - 1; r--) {
                            const sourceRow = rows[r];
                            let targetRow = rows[r + 1];
                            if (!targetRow) {
                                targetRow = [];
                                rows[r + 1] = targetRow;
                            }
                            while (targetRow.length < col) {
                                targetRow.push('');
                            }
                            const sourceValue = sourceRow && sourceRow.length >= col ? sourceRow[col - 1] : '';
                            targetRow[col - 1] = sourceValue ?? '';
                        }
                        const insertRow = rows[row - 1];
                        if (insertRow) {
                            while (insertRow.length < col) {
                                insertRow.push('');
                            }
                            insertRow[col - 1] = '';
                        }
                    }
                    break;
                }
                case 'deleteCellShiftLeft': {
                    if (row > 0 && col > 0 && row <= rows.length) {
                        const rowData = rows[row - 1];
                        if (col - 1 < rowData.length) {
                            rowData.splice(col - 1, 1);
                        }
                    }
                    break;
                }
                case 'deleteCellShiftUp': {
                    if (row > 0 && col > 0) {
                        for (let r = row - 1; r < rows.length - 1; r++) {
                            const nextValue = rows[r + 1][col - 1] ?? '';
                            rows[r][col - 1] = nextValue;
                        }
                        const lastRow = rows[rows.length - 1];
                        if (lastRow && col - 1 < lastRow.length) {
                            lastRow.splice(col - 1, 1);
                        }
                    }
                    break;
                }
            }
        };

        const applyDelimitedEditValues = (rows: string[][], edits: any[]) => {
            for (const edit of edits) {
                const row = typeof edit?.row === 'number' ? edit.row : 0;
                const col = typeof edit?.col === 'number' ? edit.col : 0;
                if (!row || !col) {continue;}

                while (rows.length < row) {
                    rows.push([]);
                }
                const rowData = rows[row - 1];
                while (rowData.length < col) {
                    rowData.push('');
                }
                rowData[col - 1] = typeof edit.value === 'string' ? edit.value : '';
            }
        };

        // CSV/TSV hold data only: the file is the whole truth, nothing is stored on the side.
        const saveDelimitedFile = async (sourceType: TabularFileType, edits: any[], operations: any[], isAutosave: boolean) => {
            const { workbook: tabularData } = await readTabularFile(currentUri.fsPath, sourceType);
            const rows = tabularData.sheets[0]?.rows ? tabularData.sheets[0].rows.map(row => [...row]) : [];

            for (const op of operations) {
                applyDelimitedOperationsToRows(rows, op);
            }

            applyDelimitedEditValues(rows, edits);

            await writeTabularFile(currentUri.fsPath, {
                sheets: [{ name: 'Sheet1', rows }]
            }, sourceType);
            lastSaveTime = Date.now();

            // Keep the provider-side worksheet cache in sync with the file.
            await loadWorkbookPayload();

            try {
                post({ command: 'saveResult', ok: true, isAutosave });
            } catch {
                // ignore
            }
        };

        const convertCurrentFileToXlsx = async () => {
            const sourceType = detectTabularFileType(currentUri.fsPath);
            if (!sourceType || sourceType === 'xlsx') {
                return;
            }

            const parsedSourcePath = path.parse(currentUri.fsPath);
            const defaultTargetUri = vscode.Uri.file(path.join(parsedSourcePath.dir, `${parsedSourcePath.name}.xlsx`));
            const targetUri = await vscode.window.showSaveDialog({
                defaultUri: defaultTargetUri,
                filters: { XLSX: ['xlsx'] }
            });

            if (!targetUri) {
                return;
            }

            const targetPath = targetUri.fsPath.toLowerCase().endsWith('.xlsx') ? targetUri.fsPath : `${targetUri.fsPath}.xlsx`;

            await convertTabularFile({
                sourcePath: currentUri.fsPath,
                targetPath,
                sourceType,
                targetType: 'xlsx'
            });

            // Keep everything Sheetmark stored for this file: styles, merges and controls.
            const storedMetadata = await this.styleStorage.getMetadata(currentUri);
            if (storedMetadata) {
                const workbook = new Excel.Workbook();
                await workbook.xlsx.readFile(targetPath);
                const worksheet = workbook.worksheets[0];
                if (worksheet) {
                    applyStoredMetadataToWorksheet(worksheet, storedMetadata);
                    await workbook.xlsx.writeFile(targetPath);
                }
            }

            await this.styleStorage.clearStyles(currentUri);
            legacyStylesNotice = false;

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(targetPath), 'xlsxViewer.xlsx');
        };

        const ensureHistoryDir = async () => {
            await fs.promises.mkdir(getHistoryDir(), { recursive: true });
        };

        const loadHistory = async (): Promise<VersionHistoryEntry[]> => {
            try {
                const raw = await fs.promises.readFile(getHistoryIndexPath(), 'utf8');
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                    return [];
                }
                return parsed as VersionHistoryEntry[];
            } catch {
                return [];
            }
        };

        const saveHistory = async (entries: VersionHistoryEntry[]) => {
            await ensureHistoryDir();
            await fs.promises.writeFile(getHistoryIndexPath(), JSON.stringify(entries), 'utf8');
        };

        const pruneHistory = async (entries?: VersionHistoryEntry[]) => {
            const now = Date.now();
            const source = entries ?? await loadHistory();
            const kept: VersionHistoryEntry[] = [];

            for (const entry of source) {
                if (!entry || typeof entry.snapshotFile !== 'string') {
                    continue;
                }

                const expired = now - entry.timestamp > VERSION_HISTORY_RETENTION_MS;
                const snapshotPath = getSnapshotPath(entry.snapshotFile);

                if (expired) {
                    try {
                        await fs.promises.unlink(snapshotPath);
                    } catch {
                        // ignore
                    }
                    continue;
                }

                try {
                    await fs.promises.access(snapshotPath, fs.constants.F_OK);
                    kept.push(entry);
                } catch {
                    // ignore missing snapshot files
                }
            }

            if (kept.length !== source.length) {
                await saveHistory(kept);
            }

            return kept;
        };

        const persistVersionSnapshot = async () => {
            try {
                const history = await pruneHistory();
                const snapshotBytes = await fs.promises.readFile(filePath);
                const snapshotHash = createHash('sha1').update(snapshotBytes).digest('hex');
                const last = history.length ? history[history.length - 1] : null;
                if (last?.hash === snapshotHash) {
                    return;
                }

                const now = Date.now();
                const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
                const snapshotFile = `${id}.${currentFileType}`;

                await ensureHistoryDir();
                await fs.promises.writeFile(getSnapshotPath(snapshotFile), snapshotBytes);

                history.push({
                    id,
                    timestamp: now,
                    fileName: path.basename(filePath),
                    byteSize: snapshotBytes.length,
                    hash: snapshotHash,
                    fileType: currentFileType,
                    snapshotFile
                });

                await saveHistory(history);
            } catch {
                // ignore history snapshot errors
            }
        };

        const getAssociationType = (): 'xlsx' | 'csv' | 'tsv' =>
            currentFileType === 'csv' || currentFileType === 'tsv' ? currentFileType : 'xlsx';

        // xlsx, csv and tsv each keep their own settings under `xlsxViewer.<type>.*`.
        const getSettings = (fileType: TabularFileType = currentFileType): SpreadsheetSettings => {
            const cfg = vscode.workspace.getConfiguration('xlsxViewer');
            const delimited = fileType === 'csv' || fileType === 'tsv';
            const prefix = delimited ? fileType : 'xlsx';
            return {
                firstRowIsHeader: cfg.get(`${prefix}.firstRowIsHeader`, true),
                stickyToolbar: cfg.get(`${prefix}.stickyToolbar`, true),
                stickyHeader: cfg.get(`${prefix}.stickyHeader`, false),
                // Autosave is on for CSV/TSV and off for XLSX: an XLSX save rewrites the whole workbook.
                autoSave: cfg.get(`${prefix}.autoSave`, delimited),
                hyperlinkPreview: delimited ? true : cfg.get('xlsx.hyperlinkPreview', true),
                spaciousCells: cfg.get(`${prefix}.spaciousCells`, false),
                mergeWarningEnabled: delimited ? true : cfg.get('xlsx.mergeWarningEnabled', true),
                isDefaultEditor: isSheetmarkConfiguredAsDefault(prefix),
                textWrap: cfg.get(`${prefix}.textWrap`, false)
            };
        };

        const trySendSettings = () => {
            if (!isWebviewReady) {return;}
            try {
                post({ command: 'initSettings', settings: getSettings() });
            } catch {
                // ignore
            }
        };

        // Pushes the VS Code theme now (on webviewReady) and on every theme change.
        const sendTheme = syncColorTheme(webviewPanel, post);
        const sendFont = syncFontFamily(webviewPanel, post);

        const trySendInit = () => {
            if (!isWebviewReady || !worksheetsData.length) {return;}
            try {
                // Send metadata for virtual scrolling instead of full data
                // Include row heights for stable scroll calculations
                const worksheetsMeta = worksheetsData.map((ws, index) => ({
                    name: ws.name,
                    index,
                    totalRows: ws.data.maxRow,
                    columnCount: ws.data.maxCol,
                    columnWidths: ws.data.columnWidths,
                    mergedCells: ws.data.mergedCells,
                    rowHeights: ws.data.rows.map((row: any) => row.height || 21)
                }));
                post({
                    command: 'initVirtualTable',
                    worksheets: worksheetsMeta,
                    rowHeaderWidth,
                    fileType: currentFileType,
                    legacyStylesNotice: legacyStylesNotice || undefined,
                    previewMode: !!previewVersionId,
                    versionId: previewVersionId,
                    timestamp: previewVersionTimestamp
                });
            } catch {
                // ignore
            }
        };

        const loadWorkbookPayload = async (sourcePath: string = filePath, sourceTypeOverride?: TabularFileType) => {
            const fileType = sourceTypeOverride || detectTabularFileType(sourcePath) || 'xlsx';
            currentFileType = fileType;
            legacyStylesNotice = false;
            const workbook = new Excel.Workbook();

            if (fileType === 'xlsx') {
                await workbook.xlsx.readFile(sourcePath);
            } else {
                // CSV/TSV hold data only. Formatting that older versions stored on the side is not
                // shown; the webview offers to convert it into an XLSX or to forget it.
                const { workbook: tabularData } = await readTabularFile(sourcePath, fileType);
                const ws = workbook.addWorksheet('Data');
                if (tabularData.sheets.length > 0) {
                    const rows = tabularData.sheets[0].rows;
                    for (let r = 0; r < rows.length; r++) {
                        const rowData = rows[r];
                        for (let c = 0; c < rowData.length; c++) {
                            ws.getCell(r + 1, c + 1).value = rowData[c];
                        }
                    }
                }

                const metadata = await this.styleStorage.getMetadata(currentUri);
                legacyStylesNotice = !!metadata && (
                    (metadata.merges?.length ?? 0) > 0
                    || Object.values(metadata.cells ?? {}).some(cell => !!cell?.style || !!cell?.control)
                );
            }

            worksheetsData = workbook.worksheets.map((worksheet, index) => {
                const data = this.extractWorksheetData(worksheet, workbook);
                return {
                    name: worksheet.name,
                    index,
                    data
                };
            });

            // Start compact and let the webview grow row header width only when needed for visible rows.
            rowHeaderWidth = 40;
        };

        // Listen for messages
        const sharedContext: SharedHostContext = {
            post,
            associationType: getAssociationType,
            sendSettings: () => trySendSettings(),
        };

        const handleMessage = async (message: SpreadsheetWebviewToHost) => {
            // Links, feedback and the default-editor toggle are shared with the Markdown editor.
            if (isSharedHostMessage(message)) {
                await handleSharedHostMessage(message, sharedContext);
                return;
            }

            if (message?.command === 'webviewReady') {
                isWebviewReady = true;
                await pruneHistory();
                await persistVersionSnapshot();
                trySendSettings();
                trySendInit();
                sendTheme();
                sendFont();
                return;
            }

            if (message?.command === 'showVersionHistory') {
                try {
                    const history = await pruneHistory();
                    if (!history.length) {
                        post({
                            command: 'versionHistoryError',
                            message: 'No saved versions available'
                        });
                        return;
                    }

                    const pickedEntry = await pickVersionHistoryEntry(history, restoredVersionId, (entry) => `${entry.fileName} • ${(entry.byteSize / 1024).toFixed(1)} KB`);

                    if (!pickedEntry) {
                        return;
                    }

                    const snapshotFileType = getSnapshotFileType(pickedEntry.snapshotFile, pickedEntry.fileType || currentFileType);
                    await loadWorkbookPayload(getSnapshotPath(pickedEntry.snapshotFile), snapshotFileType);
                    previewVersionId = pickedEntry.id;
                    previewVersionTimestamp = pickedEntry.timestamp;
                    trySendInit();
                } catch (err) {
                    post({
                        command: 'versionHistoryError',
                        message: `Version history failed: ${String(err)}`
                    });
                }
                return;
            }

            if (message?.command === 'cancelVersionPreview') {
                if (previewVersionId) {
                    previewVersionId = null;
                    previewVersionTimestamp = null;
                    restoredVersionId = null;
                    await loadWorkbookPayload(filePath, currentFileType);
                    trySendInit();
                    post({ command: 'versionPreviewCancelledXlsx' });
                }
                return;
            }

            if (message?.command === 'restoreVersion') {
                try {
                    const versionId = typeof message.versionId === 'string' ? message.versionId : '';
                    if (!versionId) {
                        return;
                    }

                    const history = await pruneHistory();
                    const entry = history.find(item => item.id === versionId);
                    if (!entry) {
                        post({
                            command: 'versionHistoryError',
                            message: 'Selected version is no longer available'
                        });
                        return;
                    }

                    const snapshotBuffer = await fs.promises.readFile(getSnapshotPath(entry.snapshotFile));
                    await vscode.workspace.fs.writeFile(currentUri, snapshotBuffer);

                    previewVersionId = null;
                    previewVersionTimestamp = null;
                    restoredVersionId = entry.id;
                    await loadWorkbookPayload(filePath, currentFileType);
                    trySendInit();
                    await persistVersionSnapshot();

                    post({
                        command: 'versionRestoredXlsx',
                        versionId: entry.id,
                        timestamp: entry.timestamp
                    });
                } catch (err) {
                    post({
                        command: 'versionHistoryError',
                        message: `Restore failed: ${String(err)}`
                    });
                }
                return;
            }

            if (message?.command === 'updateSettings') {
                try {
                    const s = message.settings || {};
                    const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                    // Each file type keeps its own values: a CSV never writes the xlsx.* keys.
                    const prefix = currentFileType === 'csv' || currentFileType === 'tsv' ? currentFileType : 'xlsx';
                    const firstRowIsHeader = !!s.firstRowIsHeader;
                    const stickyHeader = firstRowIsHeader ? !!s.stickyHeader : false;

                    await cfg.update(`${prefix}.firstRowIsHeader`, firstRowIsHeader, vscode.ConfigurationTarget.Global);
                    await cfg.update(`${prefix}.stickyToolbar`, !!s.stickyToolbar, vscode.ConfigurationTarget.Global);
                    await cfg.update(`${prefix}.stickyHeader`, stickyHeader, vscode.ConfigurationTarget.Global);
                    await cfg.update(`${prefix}.autoSave`, !!s.autoSave, vscode.ConfigurationTarget.Global);
                    await cfg.update(`${prefix}.spaciousCells`, !!s.spaciousCells, vscode.ConfigurationTarget.Global);
                    await cfg.update(`${prefix}.textWrap`, !!s.textWrap, vscode.ConfigurationTarget.Global);
                    if (prefix === 'xlsx') {
                        await cfg.update('xlsx.hyperlinkPreview', !!s.hyperlinkPreview, vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.mergeWarningEnabled', !!s.mergeWarningEnabled, vscode.ConfigurationTarget.Global);
                    }
                } catch (err) {
                    console.error('Failed to persist spreadsheet settings:', err);
                }
                return;
            }

            // Handle getRows request for virtual scrolling
            if (message?.command === 'getRows') {
                const { start, end, requestId, sheetIndex } = message;
                const wsIndex = typeof sheetIndex === 'number' ? sheetIndex : 0;
                const ws = worksheetsData[wsIndex];
                if (!ws) {
                    post({
                        command: 'rowsData',
                        rows: [],
                        start,
                        end,
                        requestId
                    });
                    return;
                }

                const clampedStart = Math.max(0, start);
                const clampedEnd = Math.min(ws.data.rows.length, end);
                const rows = ws.data.rows.slice(clampedStart, clampedEnd);

                post({
                    command: 'rowsData',
                    rows,
                    start: clampedStart,
                    end: clampedEnd,
                    requestId
                });
                return;
            }

            if (message?.command === 'convertFile') {
                try {
                    await vscode.commands.executeCommand('xlsx-viewer.convertFile', currentUri);
                } catch (err) {
                    vscode.window.showErrorMessage(`Error converting file: ${err}`);
                }
                return;
            }

            if (message?.command === 'requestFreshData') {
                try {
                    await loadWorkbookPayload();
                    trySendInit();
                } catch {
                    // ignore reload errors
                }
                return;
            }

            if (message?.command === 'convertToXlsx') {
                try {
                    await convertCurrentFileToXlsx();
                } catch (err) {
                    vscode.window.showErrorMessage(`Error converting file: ${err}`);
                }
                return;
            }

            if (message?.command === 'dismissLegacyStyles') {
                try {
                    await this.styleStorage.clearStyles(currentUri);
                    legacyStylesNotice = false;
                } catch {
                    // ignore: the notice simply shows again next time
                }
                return;
            }

            if (message?.command === 'saveXlsxEdits') {
                try {
                    if (previewVersionId) {
                        post({ command: 'saveResult', ok: false, error: 'Preview mode is read-only' });
                        return;
                    }

                    const edits = Array.isArray(message.edits) ? message.edits : [];
                    const richEdits = Array.isArray(message.richEdits) ? message.richEdits : [];
                    const styleEdits = Array.isArray(message.styleEdits) ? message.styleEdits : [];
                    const operations = Array.isArray(message.operations) ? message.operations : [];
                    const sheetIndex = typeof message.sheetIndex === 'number' ? message.sheetIndex : 0;
                    const isAutosave = !!message.isAutosave;

                    if (!edits.length && !operations.length && !styleEdits.length && !richEdits.length) {
                        try { post({ command: 'saveResult', ok: true, isAutosave }); } catch { }
                        return;
                    }

                    const sourceType = detectTabularFileType(currentUri.fsPath) || 'xlsx';
                    if (sourceType === 'csv' || sourceType === 'tsv') {
                        await saveDelimitedFile(sourceType, edits, operations, isAutosave);
                        // Same as the XLSX path below: every save is a restorable version (deduped by hash).
                        await persistVersionSnapshot();
                        return;
                    }

                    const workbook = new Excel.Workbook();
                    await workbook.xlsx.readFile(currentUri.fsPath);
                    const ws = workbook.worksheets[sheetIndex];
                    if (!ws) {
                        throw new Error('Worksheet not found');
                    }

                    for (const op of operations) {
                        const type = typeof op?.type === 'string' ? op.type : '';
                        const index = typeof op?.index === 'number' ? op.index : 0;
                        if (!type) {continue;}

                        switch (type) {
                            case 'insertRowAbove':
                                if (index > 0) {ws.spliceRows(index, 0, []);}
                                break;
                            case 'insertRowBelow':
                                if (index > 0) {ws.spliceRows(index + 1, 0, []);}
                                break;
                            case 'deleteRow':
                                if (index > 0 && ws.rowCount > 1) {
                                    ws.spliceRows(index, 1);
                                }
                                break;
                            case 'insertColumnLeft':
                                if (index > 0) {ws.spliceColumns(index, 0, []);}
                                break;
                            case 'insertColumnRight':
                                if (index > 0) {ws.spliceColumns(index + 1, 0, []);}
                                break;
                            case 'deleteColumn':
                                if (index > 0 && ws.columnCount > 1) {
                                    ws.spliceColumns(index, 1);
                                }
                                break;
                            case 'insertCellShiftRight': {
                                const row = typeof op?.row === 'number' ? op.row : 0;
                                const col = typeof op?.col === 'number' ? op.col : 0;
                                if (!row || !col) {break;}

                                const rowRef = ws.getRow(row);
                                const lastColumn = Math.max(ws.columnCount, rowRef.cellCount || 0);
                                for (let c = lastColumn + 1; c > col; c--) {
                                    const src = rowRef.getCell(c - 1);
                                    const dst = rowRef.getCell(c);
                                    dst.value = src.value as any;
                                }
                                rowRef.getCell(col).value = null;
                                break;
                            }
                            case 'insertCellShiftDown': {
                                const row = typeof op?.row === 'number' ? op.row : 0;
                                const col = typeof op?.col === 'number' ? op.col : 0;
                                if (!row || !col) {break;}

                                const lastRow = ws.rowCount;
                                ws.spliceRows(lastRow + 1, 0, []);
                                for (let r = lastRow + 1; r > row; r--) {
                                    const src = ws.getRow(r - 1).getCell(col);
                                    const dst = ws.getRow(r).getCell(col);
                                    dst.value = src.value as any;
                                }
                                ws.getRow(row).getCell(col).value = null;
                                break;
                            }
                            case 'deleteCellShiftLeft': {
                                const row = typeof op?.row === 'number' ? op.row : 0;
                                const col = typeof op?.col === 'number' ? op.col : 0;
                                if (!row || !col) {break;}

                                for (let c = col; c < ws.columnCount; c++) {
                                    const src = ws.getRow(row).getCell(c + 1);
                                    const dst = ws.getRow(row).getCell(c);
                                    dst.value = src.value as any;
                                }
                                ws.getRow(row).getCell(ws.columnCount).value = null;
                                break;
                            }
                            case 'deleteCellShiftUp': {
                                const row = typeof op?.row === 'number' ? op.row : 0;
                                const col = typeof op?.col === 'number' ? op.col : 0;
                                if (!row || !col) {break;}

                                for (let r = row; r < ws.rowCount; r++) {
                                    const src = ws.getRow(r + 1).getCell(col);
                                    const dst = ws.getRow(r).getCell(col);
                                    dst.value = src.value as any;
                                }
                                ws.getRow(ws.rowCount).getCell(col).value = null;
                                break;
                            }
                            case 'mergeRange': {
                                const startRow = typeof op?.startRow === 'number' ? op.startRow : 0;
                                const startCol = typeof op?.startCol === 'number' ? op.startCol : 0;
                                const endRow = typeof op?.endRow === 'number' ? op.endRow : 0;
                                const endCol = typeof op?.endCol === 'number' ? op.endCol : 0;
                                if (!startRow || !startCol || !endRow || !endCol) {break;}

                                try {
                                    ws.mergeCells(startRow, startCol, endRow, endCol);
                                } catch {
                                    // ignore invalid merge requests
                                }
                                break;
                            }
                            case 'unmergeRange': {
                                const startRow = typeof op?.startRow === 'number' ? op.startRow : 0;
                                const startCol = typeof op?.startCol === 'number' ? op.startCol : 0;
                                const endRow = typeof op?.endRow === 'number' ? op.endRow : 0;
                                const endCol = typeof op?.endCol === 'number' ? op.endCol : 0;
                                if (!startRow || !startCol || !endRow || !endCol) {break;}

                                try {
                                    ws.unMergeCells(startRow, startCol, endRow, endCol);
                                } catch {
                                    // ignore invalid unmerge requests
                                }
                                break;
                            }
                            case 'insertControl': {
                                const row = typeof op?.row === 'number' ? op.row : 0;
                                const col = typeof op?.col === 'number' ? op.col : 0;
                                const controlType = typeof op?.controlType === 'string' ? op.controlType : '';
                                const defaultValue = typeof op?.defaultValue === 'string' ? op.defaultValue : '';
                                const dropdownOptions = Array.isArray(op?.dropdownOptions)
                                    ? op.dropdownOptions.map((v: any) => String(v ?? '').trim()).filter((v: string) => !!v)
                                    : [];

                                if (!row || !col || !controlType) {break;}

                                const cell = ws.getRow(row).getCell(col);

                                if (controlType === 'checkbox') {
                                    const normalized = defaultValue.trim().toLowerCase();
                                    const next = normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y';
                                    cell.dataValidation = {
                                        type: 'list',
                                        allowBlank: true,
                                        formulae: ['"TRUE,FALSE"']
                                    } as any;
                                    cell.value = next;
                                    break;
                                }

                                if (controlType === 'dropdown') {
                                    const options = dropdownOptions
                                        .map((item: string) => item.replace(/[\r\n,]/g, ' ').trim())
                                        .filter((item: string, idx: number, arr: string[]) => !!item && arr.indexOf(item) === idx)
                                        .slice(0, 80);
                                    if (!options.length) {break;}

                                    const first = options[0];
                                    const inline = options.join(',');
                                    cell.dataValidation = {
                                        type: 'list',
                                        allowBlank: true,
                                        formulae: [`"${inline}"`]
                                    } as any;
                                    cell.value = defaultValue && options.includes(defaultValue) ? defaultValue : first;
                                    break;
                                }

                                if (controlType === 'rating') {
                                    const parsed = parseInt(defaultValue, 10);
                                    const rating = Number.isFinite(parsed) ? Math.max(0, Math.min(5, parsed)) : 3;
                                    cell.dataValidation = {
                                        type: 'list',
                                        allowBlank: true,
                                        formulae: ['"1,2,3,4,5"']
                                    } as any;
                                    cell.value = rating;
                                    break;
                                }

                                if (controlType === 'date') {
                                    const parsed = new Date(defaultValue || Date.now());
                                    const nextDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
                                    cell.dataValidation = {
                                        type: 'date',
                                        operator: 'between',
                                        allowBlank: true,
                                        formulae: [new Date(1900, 0, 1), new Date(2199, 11, 31)]
                                    } as any;
                                    cell.numFmt = 'yyyy-mm-dd';
                                    cell.value = nextDate;
                                }
                                break;
                            }
                        }
                    }

                    const richEditedKeys = new Set<string>();
                    for (const rich of richEdits) {
                        const row = typeof rich?.row === 'number' ? rich.row : 0;
                        const col = typeof rich?.col === 'number' ? rich.col : 0;
                        const runs = Array.isArray(rich?.runs) ? rich.runs : [];
                        if (!row || !col || !runs.length) {continue;}

                        const richText = runs
                            .map((r: any) => {
                                const text = typeof r?.text === 'string' ? r.text : '';
                                if (!text) {return null;}

                                const font: any = {};
                                if (r.bold === true) {font.bold = true;}
                                if (r.italic === true) {font.italic = true;}
                                const color = typeof r?.color === 'string' ? r.color : '';
                                const hex = color.match(/^#([0-9a-fA-F]{6})$/);
                                if (hex) {font.color = { argb: ('FF' + hex[1]).toUpperCase() };}

                                return Object.keys(font).length > 0 ? { text, font } : { text };
                            })
                            .filter((v: any) => !!v);

                        if (!richText.length) {continue;}

                        const cell = ws.getRow(row).getCell(col);
                        cell.value = { richText } as any;
                        richEditedKeys.add(row + ':' + col);
                    }

                    const parseBooleanText = (value: string): boolean | null => {
                        const normalized = value.trim().toLowerCase();
                        if (normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y') {return true;}
                        if (normalized === 'false' || normalized === 'no' || normalized === '0' || normalized === 'n') {return false;}
                        return null;
                    };

                    const isBooleanValidationCell = (cell: Excel.Cell): boolean => {
                        const dv = (cell as any)?.dataValidation;
                        if (!dv || dv.type !== 'list') {return false;}
                        const formula = Array.isArray(dv.formulae) ? String(dv.formulae[0] || '').trim() : '';
                        const direct = formula.startsWith('=') ? formula.slice(1) : formula;
                        const inlineMatch = direct.match(/^"([\s\S]*)"$/);
                        if (!inlineMatch) {return false;}
                        const options = inlineMatch[1]
                            .split(',')
                            .map((item) => parseBooleanText(item))
                            .filter((item): item is boolean => item !== null);
                        return options.length >= 2 && new Set(options).size === 2;
                    };

                    const isRatingValidationCell = (cell: Excel.Cell): boolean => {
                        const options = this.getDropdownOptions(cell, ws, workbook);
                        return this.isRatingOptionList(options);
                    };

                    const parseDateInput = (value: string): Date | null => {
                        const raw = String(value || '').trim();
                        if (!raw) {return null;}

                        const parsed = new Date(raw);
                        if (Number.isNaN(parsed.getTime())) {
                            return null;
                        }

                        return parsed;
                    };

                    for (const edit of edits) {
                        const row = typeof edit.row === 'number' ? edit.row : undefined;
                        const col = typeof edit.col === 'number' ? edit.col : undefined;
                        if (!row || !col) {continue;}

                        if (richEditedKeys.has(row + ':' + col)) {
                            continue;
                        }

                        const newText = typeof edit.value === 'string' ? edit.value : '';
                        const cell = ws.getRow(row).getCell(col);
                        const asBool = parseBooleanText(newText);
                        const shouldStoreBoolean = asBool !== null && (typeof cell.value === 'boolean' || isBooleanValidationCell(cell));
                        const shouldStoreRating = isRatingValidationCell(cell);
                        const ratingValue = this.normalizeRatingValue(newText);
                        const shouldStoreDate = this.isDateValidationCell(cell) || cell.type === Excel.ValueType.Date || cell.value instanceof Date;
                        const parsedDate = parseDateInput(newText);

                        if (cell.type === Excel.ValueType.Hyperlink) {
                            const hyperlinkValue = cell.value as Excel.CellHyperlinkValue;
                            cell.value = {
                                text: newText,
                                hyperlink: hyperlinkValue.hyperlink
                            } as Excel.CellHyperlinkValue;
                        } else if (shouldStoreBoolean) {
                            cell.value = asBool;
                        } else if (shouldStoreRating) {
                            cell.value = ratingValue > 0 ? ratingValue : null;
                        } else if (shouldStoreDate) {
                            if (!newText.trim()) {
                                cell.value = null;
                            } else if (parsedDate) {
                                cell.numFmt = 'yyyy-mm-dd';
                                cell.value = parsedDate;
                            } else {
                                cell.value = newText;
                            }
                        } else {
                            cell.value = newText;
                        }
                    }

                    for (const s of styleEdits) {
                        const row = typeof s?.row === 'number' ? s.row : 0;
                        const col = typeof s?.col === 'number' ? s.col : 0;
                        if (!row || !col) {continue;}

                        applyStyleEditToCell(ws.getRow(row).getCell(col), s);
                    }

                    await workbook.xlsx.writeFile(currentUri.fsPath);
                    lastSaveTime = Date.now();
                    await persistVersionSnapshot();
                    previewVersionId = null;
                    previewVersionTimestamp = null;

                    if (operations.length > 0) {
                        const requiresFullRefresh = operations.some((op: any) => {
                            const type = typeof op?.type === 'string' ? op.type : '';
                            return type !== 'insertControl';
                        });

                        // Keep insert-control autosave smooth by avoiding a full webview re-init.
                        await loadWorkbookPayload();
                        if (requiresFullRefresh) {
                            trySendInit();
                        }
                    } else {
                        // For pure text/style edits, update worksheetsData internally but don't force a full webview re-render
                        await loadWorkbookPayload();
                    }
                    try { post({ command: 'saveResult', ok: true, isAutosave }); } catch { }
                } catch (err) {
                    try { post({ command: 'saveResult', ok: false, error: String(err), isAutosave: !!message?.isAutosave }); } catch { }
                }
                return;
            }

            // Compile-time check that every SpreadsheetWebviewToHost command has a handler above.
            const unhandled: never = message;
            void unhandled;
        };

        const dispatch = createMessageDispatcher({
            handle: handleMessage,
            queue: fileQueue,
            queuedCommands: SPREADSHEET_FILE_WRITING_COMMANDS,
        });
        webview.onDidReceiveMessage(dispatch);
        trackOpenEditor(this.openEditors, { panel: webviewPanel, uri: () => currentUri, dispatch, sent });

        // Forward settings changes made outside the webview
        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('xlsxViewer.xlsx') || e.affectsConfiguration('xlsxViewer') || e.affectsConfiguration('workbench.editorAssociations')) {
                try {
                    post({ command: 'settingsUpdated', settings: getSettings() });
                } catch {
                    // ignore
                }
            }
        });
        webviewPanel.onDidDispose(() => configChangeDisposable.dispose());

        const externalFileWatcher = createExternalFileChangeWatcher({
            filePath,
            documentUri: currentUri,
            onChange: async () => {
                if (fileQueue.busy || Date.now() - lastSaveTime < 1000) {
                    return;
                }
                try {
                    await loadWorkbookPayload();
                    trySendInit();
                } catch {
                    // ignore reload errors
                }
            },
            onDelete: () => {
                if (fileQueue.busy) {
                    return;
                }
                try {
                    post({ command: 'diskDeletedExternally' });
                } catch { }
            },
        });
        webviewPanel.onDidDispose(() => externalFileWatcher.dispose());

        try {
            await loadWorkbookPayload();
            trySendSettings();
            trySendInit();
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading XLSX file: ${error}`);
        }
    }

    private extractWorksheetData(worksheet: Excel.Worksheet, workbook: Excel.Workbook): any {
        const data: any = {
            rows: [],
            maxRow: 0,
            maxCol: 0,
            mergedCells: []
        };
        const imageMap = this.getWorksheetImageMap(workbook, worksheet);

        // Extract merged cell ranges
        try {
            // Check different ways ExcelJS might store merged cells
            let merges: any[] = [];

            // Method 1: Check worksheet.model.merges
            if ((worksheet as any).model && (worksheet as any).model.merges) {
                merges = (worksheet as any).model.merges;
            }

            // Method 2: Check worksheet._merges (fallback)
            if (merges.length === 0 && (worksheet as any)._merges) {
                merges = (worksheet as any)._merges;
            }

            // Method 3: Check worksheet.merged (another possible location)
            if (merges.length === 0 && (worksheet as any).merged) {
                merges = (worksheet as any).merged;
            }

            merges.forEach((merge: any) => {
                // Handle different merge formats
                let startRow, startCol, endRow, endCol;

                if (merge.top !== undefined) {
                    // Format: {top, left, bottom, right}
                    startRow = merge.top;
                    startCol = merge.left;
                    endRow = merge.bottom;
                    endCol = merge.right;
                } else if (merge.start && merge.end) {
                    // Format: {start: {row, col}, end: {row, col}}
                    startRow = merge.start.row;
                    startCol = merge.start.col;
                    endRow = merge.end.row;
                    endCol = merge.end.col;
                } else if (typeof merge === 'string') {
                    // Format: "A1:B2" - parse range string
                    const range = this.parseRange(merge);
                    if (range) {
                        startRow = range.startRow;
                        startCol = range.startCol;
                        endRow = range.endRow;
                        endCol = range.endCol;
                    }
                }

                if (startRow && startCol && endRow && endCol) {
                    data.mergedCells.push({
                        startRow,
                        startCol,
                        endRow,
                        endCol
                    });
                }
            });
        } catch {
            // Silently continue without merged cells if there's an error
        }

        // Find actual data bounds
        let maxRow = 0;
        let maxCol = 0;

        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            maxRow = Math.max(maxRow, rowNumber);
            row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                maxCol = Math.max(maxCol, colNumber);
            });
        });

        // Include at least some empty rows/cols for better display
        maxRow = Math.max(maxRow, 20);
        maxCol = Math.max(maxCol, 10);

        data.maxRow = maxRow;
        data.maxCol = maxCol;

        // Create a 2D grid to track merged cells
        const cellGrid: any[][] = [];
        for (let r = 0; r <= maxRow; r++) {
            cellGrid[r] = [];
        }

        // Mark merged cells in the grid
        data.mergedCells.forEach((range: any) => {
            for (let r = range.startRow; r <= range.endRow; r++) {
                for (let c = range.startCol; c <= range.endCol; c++) {
                    cellGrid[r][c] = {
                        isMerged: true,
                        isMaster: r === range.startRow && c === range.startCol,
                        rowspan: range.endRow - range.startRow + 1,
                        colspan: range.endCol - range.startCol + 1,
                        masterRow: range.startRow,
                        masterCol: range.startCol
                    };
                }
            }
        });

        // Extract all cell data
        for (let r = 1; r <= maxRow; r++) {
            const row = worksheet.getRow(r);
            const rowData: any = {
                rowNumber: r,
                cells: [],
                height: row.height || 15 // Default row height
            };

            for (let c = 1; c <= maxCol; c++) {
                const mergeInfo = cellGrid[r] && cellGrid[r][c];

                // Track covered merged positions so renderer can skip phantom placeholders.
                if (mergeInfo && mergeInfo.isMerged && !mergeInfo.isMaster) {
                    rowData.cells.push({
                        value: '',
                        hyperlink: '',
                        style: {},
                        colNumber: c,
                        rowNumber: r,
                        isDefaultColor: false,
                        hasDefaultBg: true,
                        hasWhiteBackground: false,
                        hasBlackBorder: false,
                        hasWhiteBorder: false,
                        hasBlackBackground: false,
                        hasDefaultBorder: true,
                        originalColor: 'rgb(0, 0, 0)',
                        isEmpty: true,
                        rowspan: mergeInfo.rowspan,
                        colspan: mergeInfo.colspan,
                        isMerged: true,
                        isMaster: false,
                        isMergeCovered: true,
                        masterRow: mergeInfo.masterRow,
                        masterCol: mergeInfo.masterCol
                    });
                    continue;
                }

                const cell = worksheet.getRow(r).getCell(c);
                const cellStyle = this.getCellStyle(cell);
                let cellValue = this.getCellValue(cell);
                const hyperlinkUrl = this.getCellHyperlink(cell);
                const dropdownOptions = this.getDropdownOptions(cell, worksheet, workbook);
                const imageSrc = imageMap.get(`${r}:${c}`) || '';
                const booleanFromValue = this.parseBooleanLike(cell.value);
                const booleanFromText = this.parseBooleanLike(cellValue);
                const isRating = this.isRatingOptionList(dropdownOptions);
                const dateInputValue = this.toIsoDateInputValue(cell.value) || this.toIsoDateInputValue(cellValue);
                const isDate = this.isDateValidationCell(cell) || !!dateInputValue;
                const isCheckbox = !isRating && this.isBooleanOptionList(dropdownOptions);

                const checkboxChecked = booleanFromValue ?? booleanFromText ?? false;
                const cellType = imageSrc
                    ? 'image'
                    : (isCheckbox
                        ? 'checkbox'
                        : (isRating
                            ? 'rating'
                            : (dropdownOptions.length > 0
                                ? 'dropdown'
                                : (isDate ? 'date' : 'text'))));

                if (cellType === 'checkbox') {
                    cellValue = checkboxChecked ? 'TRUE' : 'FALSE';
                } else if (cellType === 'rating') {
                    const rating = this.normalizeRatingValue(cellValue);
                    cellValue = rating > 0 ? String(rating) : '';
                } else if (cellType === 'date') {
                    cellValue = dateInputValue || '';
                }

                // For merged master cells, ensure we get the value
                if (mergeInfo && mergeInfo.isMaster && !cellValue) {
                    // Try to get value from any cell in the merged range
                    for (let mr = mergeInfo.masterRow; mr <= mergeInfo.masterRow + mergeInfo.rowspan - 1; mr++) {
                        for (let mc = mergeInfo.masterCol; mc <= mergeInfo.masterCol + mergeInfo.colspan - 1; mc++) {
                            const testCell = worksheet.getRow(mr).getCell(mc);
                            const testValue = this.getCellValue(testCell);
                            if (testValue) {
                                cellValue = testValue;
                                break;
                            }
                        }
                        if (cellValue) {break;}
                    }
                }

                const cellData: any = {
                    value: cellValue,
                    hyperlink: hyperlinkUrl,
                    style: cellStyle,
                    cellType,
                    dropdownOptions,
                    checkboxChecked,
                    imageSrc,
                    colNumber: c,
                    rowNumber: r,
                    // Add data attributes for proper color handling
                    isDefaultColor: cellStyle._isDefaultColor || false,
                    // True when cell had no explicit background defined in the file
                    hasDefaultBg: !cellStyle.backgroundColor,
                    // True when the cell had an explicit white (or near-white) background
                    hasWhiteBackground: cellStyle._hasWhiteBackground || false,
                    hasBlackBorder: cellStyle._hasBlackBorder || false,
                    hasWhiteBorder: cellStyle._hasWhiteBorder || false,
                    hasBlackBackground: cellStyle._hasBlackBackground || false,
                    // True when cell has no explicit border (should use theme default)
                    hasDefaultBorder: cellStyle._hasDefaultBorder || false,
                    originalColor: cellStyle.color || 'rgb(0, 0, 0)',
                    isEmpty: !cell || (cell.value === null && !cellStyle.backgroundColor),
                    // Merged cell info
                    rowspan: mergeInfo ? mergeInfo.rowspan : 1,
                    colspan: mergeInfo ? mergeInfo.colspan : 1,
                    isMerged: !!(mergeInfo && mergeInfo.isMerged),
                    isMaster: !!(mergeInfo && mergeInfo.isMaster),
                    isMergeCovered: false,
                    masterRow: mergeInfo ? mergeInfo.masterRow : r,
                    masterCol: mergeInfo ? mergeInfo.masterCol : c
                };

                rowData.cells.push(cellData);
            }

            data.rows.push(rowData);
        }

        // Column widths
        data.columnWidths = [];
        for (let c = 1; c <= maxCol; c++) {
            const col = worksheet.getColumn(c);
            data.columnWidths.push(col.width || 10);
        }

        return data;
    }

    private parseRange(rangeStr: string): any {
        try {
            const clean = String(rangeStr || '').trim().replace(/\$/g, '').toUpperCase();
            if (!clean) {return null;}

            const parts = clean.split(':');
            const start = parts[0];
            const end = parts[1] || parts[0];

            const startCoord = this.parseCell(start);
            const endCoord = this.parseCell(end);

            if (startCoord && endCoord) {
                return {
                    startRow: Math.min(startCoord.row, endCoord.row),
                    startCol: Math.min(startCoord.col, endCoord.col),
                    endRow: Math.max(startCoord.row, endCoord.row),
                    endCol: Math.max(startCoord.col, endCoord.col)
                };
            }

            const colOnly = start.match(/^([A-Z]+)$/);
            const endColOnly = end.match(/^([A-Z]+)$/);
            if (colOnly && endColOnly) {
                const startCol = this.columnLettersToIndex(colOnly[1]);
                const endCol = this.columnLettersToIndex(endColOnly[1]);
                return {
                    startRow: 1,
                    startCol: Math.min(startCol, endCol),
                    endRow: 1048576,
                    endCol: Math.max(startCol, endCol)
                };
            }
        } catch {
            // ignore parse failures
        }
        return null;
    }

    private columnLettersToIndex(colStr: string): number {
        let col = 0;
        for (let i = 0; i < colStr.length; i++) {
            col = col * 26 + (colStr.charCodeAt(i) - 64);
        }
        return col;
    }

    private parseCell(cellStr: string): any {
        try {
            const match = String(cellStr || '').trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
            if (match) {
                const colStr = match[1];
                const rowStr = match[2];

                const col = this.columnLettersToIndex(colStr);

                return {
                    row: parseInt(rowStr, 10),
                    col
                };
            }
        } catch {
            // ignore parse failures
        }
        return null;
    }

    private parseBooleanLike(value: unknown): boolean | null {
        if (typeof value === 'boolean') {
            return value;
        }

        if (value === null || value === undefined) {
            return null;
        }

        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'true' || normalized === 'yes' || normalized === 'y') {
            return true;
        }
        if (normalized === 'false' || normalized === 'no' || normalized === 'n') {
            return false;
        }

        return null;
    }

    private isBooleanOptionList(options: string[]): boolean {
        if (!Array.isArray(options) || options.length < 2) {
            return false;
        }

        const parsed = options
            .map((item) => this.parseBooleanLike(item))
            .filter((item): item is boolean => item !== null);

        if (parsed.length < 2) {
            return false;
        }

        return new Set(parsed).size === 2;
    }

    private normalizeRatingValue(value: unknown): number {
        const parsed = parseInt(String(value ?? ''), 10);
        if (!Number.isFinite(parsed)) {
            return 0;
        }
        return Math.max(0, Math.min(5, parsed));
    }

    private isRatingOptionList(options: string[]): boolean {
        if (!Array.isArray(options) || options.length < 5) {
            return false;
        }

        const parsed = options
            .map((item) => this.normalizeRatingValue(item))
            .filter((item) => item >= 1 && item <= 5);

        if (!parsed.length) {
            return false;
        }

        const unique = new Set(parsed);
        return unique.size === 5 && [1, 2, 3, 4, 5].every((v) => unique.has(v));
    }

    private isDateValidationCell(cell: Excel.Cell): boolean {
        const dv = (cell as any)?.dataValidation;
        return !!dv && dv.type === 'date';
    }

    private toIsoDateInputValue(value: unknown): string {
        if (!value) {return '';}

        let asDate: Date | null = null;
        if (value instanceof Date) {
            asDate = value;
        } else if (typeof value === 'string') {
            const raw = value.trim();
            if (!raw) {return '';}
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) && !/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(raw)) {
                return '';
            }
            const parsed = new Date(raw);
            if (!Number.isNaN(parsed.getTime())) {
                asDate = parsed;
            }
        }

        if (!asDate) {
            return '';
        }

        if (Number.isNaN(asDate.getTime())) {
            return '';
        }

        const yyyy = asDate.getFullYear();
        const mm = String(asDate.getMonth() + 1).padStart(2, '0');
        const dd = String(asDate.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    private getInlineListOptions(formula: string): string[] {
        const trimmed = formula.trim();
        const unwrapped = trimmed.startsWith('=') ? trimmed.slice(1).trim() : trimmed;
        const quoted = unwrapped.match(/^"([\s\S]*)"$/);
        if (!quoted) {
            return [];
        }

        return quoted[1]
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
    }

    private getDropdownOptions(cell: Excel.Cell, worksheet: Excel.Worksheet, workbook: Excel.Workbook): string[] {
        try {
            const dataValidation = (cell as any)?.dataValidation;
            if (!dataValidation || dataValidation.type !== 'list') {
                return [];
            }

            const formula = Array.isArray(dataValidation.formulae) ? String(dataValidation.formulae[0] || '').trim() : '';
            if (!formula) {
                return [];
            }

            const inline = this.getInlineListOptions(formula);
            if (inline.length > 0) {
                return inline;
            }

            const normalized = formula.startsWith('=') ? formula.slice(1).trim() : formula.trim();
            const sheetRef = normalized.match(/^'([^']+)'!(.+)$/) || normalized.match(/^([A-Za-z0-9_]+)!(.+)$/);

            let targetWorksheet = worksheet;
            let rangeExpr = normalized;

            if (sheetRef) {
                const sheetName = sheetRef[1];
                const target = workbook.getWorksheet(sheetName);
                if (!target) {return [];}
                targetWorksheet = target;
                rangeExpr = sheetRef[2];
            }

            const cleanRange = rangeExpr.replace(/\$/g, '').replace(/^=/, '');
            const parsed = this.parseRange(cleanRange);
            if (!parsed) {
                return [];
            }

            const options: string[] = [];
            const seen = new Set<string>();

            const MAX_OPTIONS = 80;
            const MAX_ROWS = 5000;
            const maxRow = Math.min(parsed.endRow, Math.max(parsed.startRow, parsed.startRow + MAX_ROWS - 1));
            let blankStreak = 0;
            let hasStarted = false;

            for (let row = parsed.startRow; row <= maxRow; row++) {
                for (let col = parsed.startCol; col <= parsed.endCol; col++) {
                    const value = this.getCellValue(targetWorksheet.getRow(row).getCell(col))
                        .replace(/<[^>]*>/g, '')
                        .trim();
                    if (!value) {
                        if (hasStarted) {
                            blankStreak++;
                            if (blankStreak >= 20) {
                                return options;
                            }
                        }
                        continue;
                    }

                    blankStreak = 0;
                    hasStarted = true;
                    if (seen.has(value)) {continue;}
                    seen.add(value);
                    options.push(value);

                    if (options.length >= MAX_OPTIONS) {
                        return options;
                    }
                }
            }

            return options;
        } catch {
            return [];
        }
    }

    private getImageDataUri(image: any): string {
        try {
            if (!image) {return '';}

            const extRaw = typeof image.extension === 'string' ? image.extension.toLowerCase() : 'png';
            const ext = extRaw === 'jpg' ? 'jpeg' : extRaw;
            const mime = ext === 'png' || ext === 'jpeg' || ext === 'gif' || ext === 'webp'
                ? `image/${ext}`
                : 'image/png';

            if (typeof image.base64 === 'string' && image.base64.trim().length > 0) {
                const trimmed = image.base64.trim();
                if (trimmed.startsWith('data:')) {
                    return trimmed;
                }
                return `data:${mime};base64,${trimmed}`;
            }

            if (image.buffer) {
                const buffer: Buffer = Buffer.isBuffer(image.buffer)
                    ? image.buffer
                    : Buffer.from(image.buffer);
                return `data:${mime};base64,${buffer.toString('base64')}`;
            }
        } catch {
            // ignore image conversion errors
        }
        return '';
    }

    private getWorksheetImageMap(workbook: Excel.Workbook, worksheet: Excel.Worksheet): Map<string, string> {
        const map = new Map<string, string>();

        try {
            const images = typeof (worksheet as any).getImages === 'function'
                ? (worksheet as any).getImages()
                : [];

            if (!Array.isArray(images)) {
                return map;
            }

            images.forEach((imgRef: any) => {
                try {
                    const image = workbook.getImage(imgRef.imageId);
                    const uri = this.getImageDataUri(image);
                    if (!uri) {return;}

                    const range = imgRef.range;
                    let row = 0;
                    let col = 0;

                    if (range && typeof range === 'object' && range.tl) {
                        row = Math.floor(Number(range.tl.nativeRow ?? range.tl.row ?? 0)) + 1;
                        col = Math.floor(Number(range.tl.nativeCol ?? range.tl.col ?? 0)) + 1;
                    } else if (range && typeof range === 'string') {
                        const parsed = this.parseRange(range.replace(/\$/g, ''));
                        if (parsed) {
                            row = parsed.startRow;
                            col = parsed.startCol;
                        }
                    }

                    if (row > 0 && col > 0) {
                        map.set(`${row}:${col}`, uri);
                    }
                } catch {
                    // ignore invalid image anchors
                }
            });
        } catch {
            // ignore image extraction errors
        }

        return map;
    }

    private getCellValue(cell: Excel.Cell): string {
        if (!cell || !cell.value) {return '';}

        // Some ExcelJS hyperlink cells expose the URL via cell.hyperlink even when cell.type isn't Hyperlink.
        // In those cases, keep showing the displayed text/value.
        const anyCell = cell as any;
        if (typeof anyCell.hyperlink === 'string' && anyCell.hyperlink) {
            const v = cell.value as any;
            if (typeof v === 'string') {return v;}
            if (v && typeof v === 'object' && typeof v.text === 'string') {return v.text;}
        }

        // Handle different value types with proper type checking
        if (cell.type === Excel.ValueType.Hyperlink) {
            const hyperlinkValue = cell.value as Excel.CellHyperlinkValue;
            return hyperlinkValue.text || '';
        } else if (cell.type === Excel.ValueType.Formula) {
            return cell.result?.toString() || '';
        } else if (cell.type === Excel.ValueType.RichText) {
            const richTextValue = cell.value as Excel.CellRichTextValue;
            return richTextValue.richText.map((rt: any) => {
                let txt = (rt.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                if (rt.font) {
                    if (rt.font.bold) {txt = `<b>${txt}</b>`;}
                    if (rt.font.italic) {txt = `<i>${txt}</i>`;}
                    if (rt.font.color && rt.font.color.argb) {
                        const argb = rt.font.color.argb;
                        let hex = argb;
                        if (argb.length === 8) {
                            hex = '#' + argb.substring(2);
                        } else if (argb.length === 6) {
                            hex = '#' + argb;
                        }
                        // argb comes from the file: only emit it when it is really a hex color.
                        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                            txt = `<span style="color: ${hex};">${txt}</span>`;
                        }
                    }
                }
                return txt;
            }).join('');
        } else if (cell.type === Excel.ValueType.Date) {
            const dateValue = cell.value as Date;
            return dateValue.toLocaleDateString();
        } else if (cell.value instanceof Date) {
            // Additional check for Date objects
            return cell.value.toLocaleDateString();
        } else if (typeof cell.value === 'boolean') {
            return cell.value ? 'TRUE' : 'FALSE';
        } else {
            return cell.value.toString();
        }
    }

    private getCellHyperlink(cell: Excel.Cell): string {
        try {
            if (!cell) {return '';}

            const anyCell = cell as any;
            if (typeof anyCell.hyperlink === 'string' && anyCell.hyperlink) {
                return anyCell.hyperlink;
            }

            if (cell.type === Excel.ValueType.Hyperlink) {
                const hyperlinkValue = cell.value as Excel.CellHyperlinkValue;
                return hyperlinkValue.hyperlink || '';
            }

            const v = cell.value as any;
            if (v && typeof v === 'object' && typeof v.hyperlink === 'string') {
                return v.hyperlink;
            }
        } catch {
            // ignore
        }
        return '';
    }

    private getCellStyle(cell: Excel.Cell): any {
        const style: any = {};
        let isDefaultColor = false;
        let hasBlackBorder = false;
        let hasBlackBackground = false;
        let hasWhiteBackground = false;

        // Background color
        if (cell.fill && cell.fill.type === 'pattern' && (cell.fill as any).fgColor) {
            const color = (cell.fill as any).fgColor;
            if (color.argb) {
                const bgColor = convertARGBToRGBA(color.argb);
                style.backgroundColor = bgColor;
                // Check if background is black or shade of black - be very strict
                hasBlackBackground = isShadeOfBlack(bgColor);
                // Check if background is white or shade of white
                hasWhiteBackground = isShadeOfWhite(bgColor);
            }
        }

        // Font
        if (cell.font) {
            if (cell.font.color && cell.font.color.argb) {
                const fontColor = convertARGBToRGBA(cell.font.color.argb);
                style.color = fontColor;
                // If it's a shade of black, we can treat it as default color for theme switching
                if (isShadeOfBlack(fontColor)) {
                    isDefaultColor = true;
                }
            } else {
                // No custom font color set, defaults to black
                style.color = 'rgb(0, 0, 0)';
                isDefaultColor = true;
            }
            if (cell.font.bold) {style.fontWeight = 'bold';}
            if (cell.font.italic) {style.fontStyle = 'italic';}
            if (cell.font.underline) {style.textDecoration = 'underline';}
            if (cell.font.strike) {style.textDecoration = (style.textDecoration || '') + ' line-through';}
            if (cell.font.size) {style.fontSize = `${cell.font.size}pt`;}
            if (cell.font.name) {style.fontFamily = cell.font.name;}
        } else {
            // No font styling at all, defaults to black
            style.color = 'rgb(0, 0, 0)';
            isDefaultColor = true;
        }

        // Alignment
        if (cell.alignment) {
            if (cell.alignment.horizontal) {
                switch (cell.alignment.horizontal) {
                    case 'left':
                        style.textAlign = 'left';
                        break;
                    case 'center':
                        style.textAlign = 'center';
                        break;
                    case 'right':
                        style.textAlign = 'right';
                        break;
                    case 'justify':
                        style.textAlign = 'justify';
                        break;
                    default:
                        style.textAlign = cell.alignment.horizontal;
                }
            }
            if (cell.alignment.vertical) {
                switch (cell.alignment.vertical) {
                    case 'top':
                        style.verticalAlign = 'top';
                        break;
                    case 'middle':
                        style.verticalAlign = 'middle';
                        break;
                    case 'bottom':
                        style.verticalAlign = 'bottom';
                        break;
                    default:
                        style.verticalAlign = cell.alignment.vertical;
                }
            }
            if (cell.alignment.wrapText) {
                style.whiteSpace = 'pre-wrap';
                style.wordWrap = 'break-word';
            }
            if (cell.alignment.indent) {
                style.paddingLeft = `${cell.alignment.indent * 8}px`;
            }
        }

        // Borders
        let hasWhiteBorder = false;
        if (cell.border) {
            style.border = {};
            ['top', 'right', 'bottom', 'left'].forEach(side => {
                const border = (cell.border as any)[side];
                if (border && border.style) {
                    const originalColor = border.color && border.color.argb
                        ? convertARGBToRGBA(border.color.argb)
                        : 'rgba(0, 0, 0, 1)';

                    // Only mark as black border if it's actually black or a shade of black
                    const isBlack = isShadeOfBlack(originalColor);
                    if (isBlack) {
                        hasBlackBorder = true;
                    }

                    // Check for white borders
                    const isWhite = isShadeOfWhite(originalColor);
                    if (isWhite) {
                        hasWhiteBorder = true;
                    }

                    let width = '1px';
                    let styleStr = 'solid';

                    switch (border.style) {
                        case 'thin': width = '1px'; break;
                        case 'medium': width = '2px'; break;
                        case 'thick': width = '3px'; break;
                        case 'dotted': styleStr = 'dotted'; break;
                        case 'dashed': styleStr = 'dashed'; break;
                        case 'dashDot':
                        case 'dashDotDot':
                        case 'slantDashDot':
                            styleStr = 'dashed';
                            break;
                        case 'mediumDashed':
                        case 'mediumDashDot':
                        case 'mediumDashDotDot':
                            width = '2px';
                            styleStr = 'dashed';
                            break;
                        case 'hair':
                            styleStr = 'dotted';
                            break;
                        case 'double': styleStr = 'double'; width = '3px'; break;
                    }

                    style.border[side] = `${width} ${styleStr} ${originalColor}`;
                }
            });
        }

        // Track if cell has no explicit border (should use theme default)
        const hasExplicitBorder = cell.border && (
            cell.border.top || cell.border.right || cell.border.bottom || cell.border.left
        );

        // Add tracking properties for dark mode handling
        style._isDefaultColor = isDefaultColor;
        style._hasBlackBorder = hasBlackBorder;
        style._hasWhiteBorder = hasWhiteBorder;
        style._hasBlackBackground = hasBlackBackground;
        style._hasWhiteBackground = hasWhiteBackground;
        style._hasDefaultBorder = !hasExplicitBorder;

        return style;
    }
}

