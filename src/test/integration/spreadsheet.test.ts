// Spreadsheet host behavior in a real VS Code: saves, version history, links, CSP, Convert.

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import * as Excel from 'exceljs';
import { getVersionHistoryDir } from '../../shared/versionHistory';
import { normalizeStoredStyle } from '../../spreadsheet/excelStyle';
import { parseCsp } from '../../shared/webviewCsp';
import { closeAllEditors, cspOf, fixtureDir, openInSheetmark, sheetmark, stub, waitFor } from './helpers';

const CSV = 'name,score\nada,1\nbob,2\n';

function save(edits: Array<{ row: number; col: number; value: string }>) {
    return { command: 'saveXlsxEdits', edits, richEdits: [], styleEdits: [], operations: [], sheetIndex: 0, isAutosave: true };
}

suite('Spreadsheet editor (host)', () => {
    teardown(closeAllEditors);

    test('overlapping autosaves both land (saves are queued)', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'data.csv': CSV }), 'data.csv');
        const editor = await openInSheetmark(api, file, 'xlsxViewer.csv');

        // Posted back to back, like two quick checkbox toggles; neither waits for the other.
        await Promise.all([
            editor.dispatch(save([{ row: 2, col: 2, value: '10' }])),
            editor.dispatch(save([{ row: 3, col: 2, value: '20' }])),
        ]);

        assert.strictEqual(fs.readFileSync(file, 'utf8').trim(), 'name,score\nada,10\nbob,20');
    });

    test('a CSV save is recorded in version history', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'history.csv': CSV }), 'history.csv');
        const editor = await openInSheetmark(api, file, 'xlsxViewer.csv');

        await editor.dispatch(save([{ row: 2, col: 1, value: 'ada lovelace' }]));

        const indexPath = path.join(getVersionHistoryDir(api.globalStoragePath, file, 'csv'), 'index.json');
        const entries: Array<{ hash: string }> = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        const savedHash = createHash('sha1').update(fs.readFileSync(file)).digest('hex');
        assert.strictEqual(entries[entries.length - 1]?.hash, savedHash, 'latest history entry should be the saved file');
    });

    test('openExternal only opens http, https and mailto links', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'links.csv': CSV }), 'links.csv');
        const editor = await openInSheetmark(api, file, 'xlsxViewer.csv');

        const opened: string[] = [];
        const restoreOpen = stub(vscode.env, 'openExternal', async (uri: vscode.Uri) => { opened.push(uri.toString(true)); return true; });
        const restoreWarn = stub(vscode.window, 'showWarningMessage', (async () => undefined) as typeof vscode.window.showWarningMessage);
        try {
            for (const url of ['file:///etc/passwd', 'command:workbench.action.terminal.new', 'https://example.com/', 'mailto:a@b.co']) {
                await editor.dispatch({ command: 'openExternal', url });
            }
        } finally {
            restoreOpen();
            restoreWarn();
        }
        assert.deepStrictEqual(opened, ['https://example.com/', 'mailto:a@b.co']);
    });

    test('the webview HTML never allows inline script', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'csp.csv': CSV }), 'csp.csv');
        const editor = await openInSheetmark(api, file, 'xlsxViewer.csv');

        const scriptSrc = parseCsp(cspOf(editor.panel.webview.html)).get('script-src') ?? [];
        assert.ok(scriptSrc.length > 0, 'script-src must be set');
        assert.ok(!scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'unsafe-eval'"), scriptSrc.join(' '));
    });

    test('Command Palette Convert keeps stored font size and wrap', async () => {
        const api = await sheetmark();
        const dir = fixtureDir({ 'styled.csv': CSV });
        const source = vscode.Uri.file(path.join(dir, 'styled.csv'));
        const target = vscode.Uri.file(path.join(dir, 'styled.xlsx'));
        // Stored the way styled-mode saves store them: already in CSS form ("14pt", "pre-wrap").
        await api.styleStorage.saveStyles(source, { '2:1': normalizeStoredStyle({ fontSize: 14, wrapMode: 'wrap', bold: true }) });

        const restorePick = stub(vscode.window, 'showQuickPick', (async (items: any) => (await items).find((item: any) => item.type === 'xlsx')) as any);
        const restoreSave = stub(vscode.window, 'showSaveDialog', async () => target);
        const restoreInfo = stub(vscode.window, 'showInformationMessage', (async () => undefined) as any);
        try {
            await vscode.commands.executeCommand('xlsx-viewer.convertFile', source);
        } finally {
            restorePick();
            restoreSave();
            restoreInfo();
        }

        await waitFor('converted xlsx', () => fs.existsSync(target.fsPath));
        const workbook = new Excel.Workbook();
        await workbook.xlsx.readFile(target.fsPath);
        const cell = workbook.worksheets[0].getRow(2).getCell(1);
        assert.strictEqual(cell.font?.size, 14);
        assert.strictEqual(cell.font?.bold, true);
        assert.strictEqual(cell.alignment?.wrapText, true);
    });

    test('Command Palette Convert keeps stored merges and controls', async () => {
        const api = await sheetmark();
        const dir = fixtureDir({ 'kept.csv': 'title,b,c\nyes,pick,3\n' });
        const source = vscode.Uri.file(path.join(dir, 'kept.csv'));
        const target = vscode.Uri.file(path.join(dir, 'kept.xlsx'));
        await api.styleStorage.saveMetadata(source, {
            cells: {
                '2:1': { control: { controlType: 'checkbox' } },
                '2:2': { control: { controlType: 'dropdown', dropdownOptions: ['pick', 'other'] } },
            },
            merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 3 }],
        });

        const restorePick = stub(vscode.window, 'showQuickPick', (async (items: any) => (await items).find((item: any) => item.type === 'xlsx')) as any);
        const restoreSave = stub(vscode.window, 'showSaveDialog', async () => target);
        const restoreInfo = stub(vscode.window, 'showInformationMessage', (async () => undefined) as any);
        try {
            await vscode.commands.executeCommand('xlsx-viewer.convertFile', source);
        } finally {
            restorePick();
            restoreSave();
            restoreInfo();
        }

        await waitFor('converted xlsx', () => fs.existsSync(target.fsPath));
        const workbook = new Excel.Workbook();
        await workbook.xlsx.readFile(target.fsPath);
        const sheet = workbook.worksheets[0];
        assert.strictEqual(sheet.getRow(1).getCell(3).isMerged, true, 'the stored merge is kept');
        assert.deepStrictEqual(sheet.getRow(2).getCell(1).dataValidation?.formulae, ['"TRUE,FALSE"'], 'the checkbox is kept');
        assert.deepStrictEqual(sheet.getRow(2).getCell(2).dataValidation?.formulae, ['"pick,other"'], 'the dropdown is kept');
        assert.strictEqual(await api.styleStorage.getMetadata(source), undefined, 'stored formatting is cleared after converting');
    });

    test('a CSV with stored formatting opens data-only and flags the legacy notice', async () => {
        const api = await sheetmark();
        const dir = fixtureDir({ 'legacy.csv': CSV, 'clean.csv': CSV });
        const legacy = path.join(dir, 'legacy.csv');
        await api.styleStorage.saveStyles(vscode.Uri.file(legacy), { '1:1': normalizeStoredStyle({ bold: true }) });

        const legacyEditor = await openInSheetmark(api, legacy, 'xlsxViewer.csv');
        const legacyInit = await waitFor('initVirtualTable', () => legacyEditor.sent().find((m: any) => m?.command === 'initVirtualTable')) as any;
        assert.strictEqual(legacyInit.legacyStylesNotice, true);
        assert.strictEqual(legacyInit.isPlainView, undefined, 'there are no view modes any more');

        const cleanEditor = await openInSheetmark(api, path.join(dir, 'clean.csv'), 'xlsxViewer.csv');
        const cleanInit = await waitFor('initVirtualTable', () => cleanEditor.sent().find((m: any) => m?.command === 'initVirtualTable')) as any;
        assert.notStrictEqual(cleanInit.legacyStylesNotice, true);
    });

    test('Dismiss on the legacy notice deletes the stored formatting; saving never writes any', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'dismiss.csv': CSV }), 'dismiss.csv');
        const uri = vscode.Uri.file(file);
        await api.styleStorage.saveStyles(uri, { '1:1': normalizeStoredStyle({ bold: true }) });
        const editor = await openInSheetmark(api, file, 'xlsxViewer.csv');
        await waitFor('initVirtualTable', () => editor.sent().find((m: any) => m?.command === 'initVirtualTable'));

        await editor.dispatch({ command: 'dismissLegacyStyles' });
        assert.strictEqual(await api.styleStorage.getStyles(uri), undefined);

        await editor.dispatch(save([{ row: 2, col: 1, value: 'x' }]));
        assert.strictEqual(await api.styleStorage.getMetadata(uri), undefined, 'a CSV save stores nothing on the side');
    });

    test('Convert to XLSX from the notice keeps stored formatting and merges', async () => {
        const api = await sheetmark();
        const dir = fixtureDir({ 'notice.csv': CSV });
        const file = path.join(dir, 'notice.csv');
        const target = vscode.Uri.file(path.join(dir, 'notice.xlsx'));
        const uri = vscode.Uri.file(file);
        await api.styleStorage.saveMetadata(uri, {
            cells: { '2:1': { style: normalizeStoredStyle({ bold: true }) } },
            merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 2 }],
        });
        const editor = await openInSheetmark(api, file, 'xlsxViewer.csv');
        await waitFor('initVirtualTable', () => editor.sent().find((m: any) => m?.command === 'initVirtualTable'));

        const restoreSave = stub(vscode.window, 'showSaveDialog', async () => target);
        try {
            await editor.dispatch({ command: 'convertToXlsx' });
        } finally {
            restoreSave();
        }

        await waitFor('converted xlsx', () => fs.existsSync(target.fsPath));
        const workbook = new Excel.Workbook();
        await workbook.xlsx.readFile(target.fsPath);
        assert.strictEqual(workbook.worksheets[0].getRow(2).getCell(1).font?.bold, true);
        assert.strictEqual(workbook.worksheets[0].getRow(1).getCell(2).isMerged, true);
    });
});
