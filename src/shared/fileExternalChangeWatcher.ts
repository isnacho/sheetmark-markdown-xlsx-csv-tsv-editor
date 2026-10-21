import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

function pathsMatch(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

export interface ExternalFileChangeWatcherOptions {
    filePath: string;
    documentUri: vscode.Uri;
    onChange: () => void | Promise<void>;
    onDelete?: () => void | Promise<void>;
    deleteDebounceMs?: number;
}

export type ExternalFileChangeWatcher = vscode.Disposable;

/**
 * Watches a single file for external changes. Combines VS Code's
 * FileSystemWatcher (onDidChange + onDidCreate for atomic saves) with Node's
 * fs.watch as a fallback for out-of-workspace paths and editors that rename
 * files on save. Delete events are debounced.
 *
 * A rename inside VS Code is not a delete: VS Code closes this editor and opens
 * a new one at the new path (state moves in renameStateMigration.ts), so the
 * watcher just stops reporting for the old path.
 */
export function createExternalFileChangeWatcher(
    options: ExternalFileChangeWatcherOptions
): ExternalFileChangeWatcher {
    const {
        onChange,
        onDelete,
        deleteDebounceMs = 250,
    } = options;

    const watchedFilePath = options.filePath;
    const watchedDocumentUri = options.documentUri;
    const pathDisposables: vscode.Disposable[] = [];

    let changeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let deleteDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleChange = () => {
        if (changeDebounceTimer) {
            clearTimeout(changeDebounceTimer);
        }
        changeDebounceTimer = setTimeout(() => {
            changeDebounceTimer = null;
            void onChange();
        }, 150);
    };

    const cancelPendingDelete = () => {
        if (deleteDebounceTimer) {
            clearTimeout(deleteDebounceTimer);
            deleteDebounceTimer = null;
        }
    };

    const scheduleDelete = () => {
        if (!onDelete) {
            return;
        }
        cancelPendingDelete();
        deleteDebounceTimer = setTimeout(() => {
            deleteDebounceTimer = null;
            void onDelete();
        }, deleteDebounceMs);
    };

    const disposePathWatchers = () => {
        pathDisposables.forEach(d => d.dispose());
        pathDisposables.length = 0;
    };

    const createPattern = (filePath: string, documentUri: vscode.Uri): vscode.RelativePattern => {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
        return workspaceFolder
            ? new vscode.RelativePattern(workspaceFolder, path.relative(workspaceFolder.uri.fsPath, filePath))
            : new vscode.RelativePattern(vscode.Uri.file(path.dirname(filePath)), path.basename(filePath));
    };

    const attachPathWatchers = (filePath: string, documentUri: vscode.Uri) => {
        const watcher = vscode.workspace.createFileSystemWatcher(createPattern(filePath, documentUri));
        watcher.onDidChange(scheduleChange);
        watcher.onDidCreate(scheduleChange);
        if (onDelete) {
            watcher.onDidDelete(scheduleDelete);
        }
        pathDisposables.push(watcher);

        try {
            const nodeWatcher = fs.watch(filePath, { persistent: false }, (eventType) => {
                if (eventType === 'change' || eventType === 'rename') {
                    scheduleChange();
                }
            });
            pathDisposables.push({ dispose: () => nodeWatcher.close() });
        } catch {
            // fs.watch can fail on deleted/missing paths; the VS Code watcher remains.
        }
    };

    attachPathWatchers(watchedFilePath, watchedDocumentUri);

    const renameDisposable = vscode.workspace.onDidRenameFiles((event) => {
        if (event.files.some(({ oldUri }) => pathsMatch(oldUri.fsPath, watchedFilePath))) {
            cancelPendingDelete();
            disposePathWatchers();
        }
    });

    return {
        dispose() {
            cancelPendingDelete();
            if (changeDebounceTimer) {
                clearTimeout(changeDebounceTimer);
            }
            disposePathWatchers();
            renameDisposable.dispose();
        },
    };
}
