import * as vscode from 'vscode';
import { FrontmatterPanelStorageService } from './frontmatterPanelStorageService';
import { StyleStorageService } from './styleStorageService';
import { TableColumnWidthStorageService } from './tableColumnWidthStorageService';
import { migrateVersionHistory } from './versionHistory';

export interface MigrateFileUriStateOptions {
    kind: string;
    isSpreadsheet: boolean;
    tableColumnWidthStorage?: TableColumnWidthStorageService;
    frontmatterPanelStorage?: FrontmatterPanelStorageService;
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
    } else {
        await options.tableColumnWidthStorage?.migrateUri(oldUri, newUri);
        await options.frontmatterPanelStorage?.migrateUri(oldUri, newUri);
    }

    await migrateVersionHistory(
        context.globalStorageUri.fsPath,
        oldUri.fsPath,
        newUri.fsPath,
        options.kind,
        options.isSpreadsheet,
    );
}
