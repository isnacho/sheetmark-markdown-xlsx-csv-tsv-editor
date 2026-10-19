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
});
