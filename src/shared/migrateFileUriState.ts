import * as vscode from 'vscode';
import type { FilePreference } from './preferenceStore';
import { StyleStorageService } from './styleStorageService';
import { migrateVersionHistory } from './versionHistory';

export interface MigrateFileUriStateOptions {
    kind: string;
    isSpreadsheet: boolean;
    /** Per-file preferences to move (Markdown: MarkdownPreferences.perFile). */
    filePreferences?: readonly FilePreference<unknown>[];
    styleStorage?: StyleStorageService;
}

export async function migrateFileUriState(
    context: vscode.ExtensionContext,
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: MigrateFileUriStateOptions,
): Promise<void> {
    if (options.isSpreadsheet) {
        await options.styleStorage?.migrateUri(oldUri, newUri);
    }
    for (const preference of options.filePreferences ?? []) {
        await preference.migrate(oldUri, newUri);
    }

    await migrateVersionHistory(
        context.globalStorageUri.fsPath,
        oldUri.fsPath,
        newUri.fsPath,
        options.kind,
        options.isSpreadsheet,
    );
}
