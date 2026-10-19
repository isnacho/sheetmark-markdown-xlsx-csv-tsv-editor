// Moves Sheetmark's per-file state (CSV/TSV styles and view mode, Markdown preferences, version
// history) when a file is renamed or moved inside VS Code.
//
// It runs in onWillRenameFiles and VS Code waits for it (waitUntil) before renaming. That ordering
// matters: VS Code closes an open Sheetmark editor on rename and opens a new one at the new path,
// which reads this state immediately. Migrating afterwards (onDidRenameFiles) lost that race, so
// the reopened editor showed default column widths and dropped CSV styling.
//
// Renames done outside VS Code (Finder, git mv) aren't reported by the API; the file then looks
// deleted to the open editor. Renaming a folder doesn't migrate the files inside it.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { migrateFileUriState } from './migrateFileUriState';
import type { MarkdownPreferences } from './preferenceStore';
import type { StyleStorageService } from './styleStorageService';

const SPREADSHEET_KINDS = new Set(['csv', 'tsv', 'xlsx']);

export interface RenameStateDeps {
    styleStorage: StyleStorageService;
    markdownPreferences: MarkdownPreferences;
    /** Wait for an open editor's in-flight saves, so none lands at the old path after the move. */
    flushWrites(uri: vscode.Uri): Promise<void>;
}

export function registerRenameStateMigration(context: vscode.ExtensionContext, deps: RenameStateDeps): vscode.Disposable {
    return vscode.workspace.onWillRenameFiles((event) => {
        event.waitUntil(Promise.all(event.files.map(({ oldUri, newUri }) =>
            migrateRenamedFile(context, oldUri, newUri, deps).catch((err) =>
                console.error('[Sheetmark] could not move state for renamed file', oldUri.fsPath, err)))));
    });
}

async function migrateRenamedFile(context: vscode.ExtensionContext, oldUri: vscode.Uri, newUri: vscode.Uri, deps: RenameStateDeps): Promise<void> {
    if (oldUri.scheme !== 'file') { return; }
    const kind = path.extname(oldUri.fsPath).slice(1).toLowerCase();
    if (kind !== 'md' && !SPREADSHEET_KINDS.has(kind)) { return; }
    const stat = await fs.promises.stat(oldUri.fsPath).catch(() => undefined);
    if (!stat?.isFile()) { return; }

    await deps.flushWrites(oldUri);
    const isSpreadsheet = SPREADSHEET_KINDS.has(kind);
    await migrateFileUriState(context, oldUri, newUri, isSpreadsheet
        ? { kind, isSpreadsheet, styleStorage: deps.styleStorage }
        : { kind, isSpreadsheet, filePreferences: deps.markdownPreferences.perFile });
}
