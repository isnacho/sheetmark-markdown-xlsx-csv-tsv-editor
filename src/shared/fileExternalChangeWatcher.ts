import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function urisMatch(a: vscode.Uri, b: vscode.Uri): boolean {
    return a.fsPath.toLowerCase() === b.fsPath.toLowerCase();
}

function pathsMatch(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

export interface ExternalFileChangeWatcherOptions {
    filePath: string;
    documentUri: vscode.Uri;
    onChange: () => void | Promise<void>;
    onDelete?: () => void | Promise<void>;
    onMove?: (newUri: vscode.Uri) => void | Promise<void>;
    deleteDebounceMs?: number;
}

export interface ExternalFileChangeWatcher extends vscode.Disposable {
    repoint(newFilePath: string, newDocumentUri: vscode.Uri): void;
}

/**
 * Watches a single file for external changes. Combines VS Code's
 * FileSystemWatcher (onDidChange + onDidCreate for atomic saves) with Node's
 * fs.watch as a fallback for out-of-workspace paths and editors that rename
 * files on save. Detects renames via onDidRenameFiles and debounces delete
 * events so moves are not reported as deletions.
 */
export function createExternalFileChangeWatcher(
    options: ExternalFileChangeWatcherOptions
): ExternalFileChangeWatcher {
    const {
        onChange,
        onDelete,
        onMove,
        deleteDebounceMs = 250,
    } = options;

    let watchedFilePath = options.filePath;
    let watchedDocumentUri = options.documentUri;
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
        if (!onMove) {
            return;
        }
        for (const { oldUri, newUri } of event.files) {
            if (!pathsMatch(oldUri.fsPath, watchedFilePath)) {
                continue;
            }
            cancelPendingDelete();
            watchedFilePath = newUri.fsPath;
            watchedDocumentUri = newUri;
            disposePathWatchers();
            attachPathWatchers(watchedFilePath, watchedDocumentUri);
            void onMove(newUri);
            break;
        }
    });

    return {
        repoint(newFilePath: string, newDocumentUri: vscode.Uri) {
            if (pathsMatch(watchedFilePath, newFilePath) && urisMatch(watchedDocumentUri, newDocumentUri)) {
                return;
            }
            watchedFilePath = newFilePath;
            watchedDocumentUri = newDocumentUri;
            disposePathWatchers();
            attachPathWatchers(watchedFilePath, watchedDocumentUri);
        },
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
