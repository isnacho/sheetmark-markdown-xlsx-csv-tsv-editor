// What follows a file when it is renamed in VS Code. VS Code closes the open Sheetmark editor and
// opens a new one at the new path, so per-file state (Markdown column widths, CSV styles, version
// history) must already be migrated when the new editor loads it.

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getVersionHistoryDir } from '../../shared/versionHistory';
import { normalizeStoredStyle } from '../../spreadsheet/excelStyle';
import { closeAllEditors, fixtureDir, openInSheetmark, sheetmark, waitFor } from './helpers';

async function rename(from: vscode.Uri, to: vscode.Uri) {
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(from, to, { overwrite: false });
    assert.ok(await vscode.workspace.applyEdit(edit), 'rename failed');
}

function firstSent<T>(editor: { sent(): readonly unknown[] }, command: string): T | undefined {
    return editor.sent().find((message: any) => message?.command === command) as T | undefined;
}

suite('Renaming an open file', () => {
    const workbench = () => vscode.workspace.getConfiguration('workbench');
    suiteSetup(async () => {
        // Markdown's Sheetmark editor is opt-in; make it the default so a rename reopens in Sheetmark.
        await workbench().update('editorAssociations', { '*.md': 'xlsxViewer.md' }, vscode.ConfigurationTarget.Global);
    });
    suiteTeardown(async () => {
        await workbench().update('editorAssociations', undefined, vscode.ConfigurationTarget.Global);
    });
    teardown(closeAllEditors);

    test('Markdown column widths are there when the reopened editor loads', async () => {
        const api = await sheetmark();
        const dir = fixtureDir({ 'a/table.md': '| a | b |\n| - | - |\n| 1 | 2 |\n' });
        const from = vscode.Uri.file(path.join(dir, 'a', 'table.md'));
        const to = vscode.Uri.file(path.join(dir, 'b', 'table.md'));
        const editor = await openInSheetmark(api, from.fsPath, 'xlsxViewer.md');
        await editor.dispatch({ command: 'saveTableColumnWidths', widths: { 0: [150, 90] } });

        await rename(from, to);

        const reopened = await waitFor('reopened Markdown editor', () => api.openEditors().find(e => e.uri().fsPath === to.fsPath));
        const init = await waitFor('initMarkdown', () => firstSent<{ tableColumnWidths: unknown }>(reopened, 'initMarkdown'));
        assert.deepStrictEqual(init.tableColumnWidths, { 0: [150, 90] });
    });

    test('CSV styles and version history move with the file', async () => {
        const api = await sheetmark();
        const dir = fixtureDir({ 'a/data.csv': 'x,y\n1,2\n' });
        const from = vscode.Uri.file(path.join(dir, 'a', 'data.csv'));
        const to = vscode.Uri.file(path.join(dir, 'b', 'data.csv'));
        await api.styleStorage.saveStyles(from, { '1:1': normalizeStoredStyle({ bold: true }) });
        const editor = await openInSheetmark(api, from.fsPath, 'xlsxViewer.csv');
        await editor.dispatch({ command: 'saveXlsxEdits', sheetIndex: 0, edits: [{ row: 2, col: 1, value: '9' }], richEdits: [], styleEdits: [], operations: [], isAutosave: true });

        await rename(from, to);

        const reopened = await waitFor('reopened CSV editor', () => api.openEditors().find(e => e.uri().fsPath === to.fsPath));
        const init = await waitFor('initVirtualTable', () => firstSent<{ isPlainView: boolean }>(reopened, 'initVirtualTable'));
        assert.strictEqual(init.isPlainView, false, 'the moved file should still open in styled mode');
        assert.ok(await api.styleStorage.getStyles(to), 'styles stored under the new path');
        assert.ok(fs.existsSync(path.join(getVersionHistoryDir(api.globalStoragePath, to.fsPath, 'csv'), 'index.json')), 'history under the new path');
    });
});
