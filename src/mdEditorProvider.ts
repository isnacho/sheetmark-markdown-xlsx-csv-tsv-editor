import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { VERSION_HISTORY_RETENTION_MS, VERSION_HISTORY_SNAPSHOT_DEBOUNCE_MS, getVersionHistoryFile, pickVersionHistoryEntry } from './shared/versionHistory';
import { createMarkdownPreferences, type MarkdownPreferences } from './shared/preferenceStore';
import { createCspNonce, markdownCsp } from './shared/webviewCsp';
import { createSerialQueue, type SerialQueue } from './shared/serialQueue';
import { createMessageDispatcher, MARKDOWN_FILE_WRITING_COMMANDS } from './shared/messageDispatch';
import { recordSentInTests, trackOpenEditor, type OpenEditorHandle } from './shared/editorTestHooks';
import { handleSharedHostMessage, isSharedHostMessage, syncColorTheme, type SharedHostContext } from './shared/commonHostMessages';
import type { MessageOf } from './protocol/common';
import type { HostToMarkdownWebview, MarkdownSettings, MarkdownWebviewToHost } from './protocol/markdown';
import { createExternalFileChangeWatcher } from './shared/fileExternalChangeWatcher';
import { isSheetmarkConfiguredAsDefault } from './shared/editorAssociationUtils';

function buildMdWebviewSettings(): MarkdownSettings {
    const cfg = vscode.workspace.getConfiguration('xlsxViewer');
    return {
        stickyToolbar: cfg.get('md.stickyToolbar', true),
        wordWrap: cfg.get('md.wordWrap', true),
        showOutline: cfg.get('md.showOutline', true),
        showLineNumbers: cfg.get('md.showLineNumbers', true),
        livePreviewReveal: cfg.get('md.livePreviewReveal', true),
        livePreviewLineNumbers: cfg.get('md.livePreviewLineNumbers', false),
        autoSave: cfg.get('md.autoSave', false),
        isDefaultEditor: isSheetmarkConfiguredAsDefault('md'),
        showStats: cfg.get('md.showStats', true),
        statsShowLines: cfg.get('md.statsShowLines', true),
        statsShowWords: cfg.get('md.statsShowWords', true),
        statsShowChars: cfg.get('md.statsShowChars', true),
        statsShowReadingTime: cfg.get('md.statsShowReadingTime', true),
        showCursorPosition: cfg.get('md.showCursorPosition', true),
        diffReviewEnabled: cfg.get('md.diffReviewEnabled', false),
        diffLayout: normalizeDiffLayout(cfg.get('md.diffLayout', 'inline')),
    };
}

/** Only 'sideBySide' and 'inline' are valid; anything else falls back to inline. */
function normalizeDiffLayout(value: unknown): 'inline' | 'sideBySide' {
    return value === 'sideBySide' ? 'sideBySide' : 'inline';
}

export class MDEditorProvider implements vscode.CustomReadonlyEditorProvider {
    private readonly prefs: MarkdownPreferences;
    // Backs the Accept All/Reject All Disk Changes commands (package.json
    // keybindings) — there's no API to ask "which custom editor is focused",
    // so this is kept in sync via onDidChangeViewState/onDidDispose below.
    private activePanel: vscode.WebviewPanel | null = null;
    /** Open panels, for the integration tests only (see editorTestHooks.ts). */
    readonly openEditors = new Set<OpenEditorHandle>();
    /** Each open panel's write queue, keyed by lowercased path (see flushWrites). */
    private readonly fileQueues = new Map<string, SerialQueue>();

    /** Resolves once saves already queued for `uri` have finished (used before a rename moves its state). */
    async flushWrites(uri: vscode.Uri): Promise<void> {
        await this.fileQueues.get(uri.fsPath.toLowerCase())?.run(async () => { });
    }

    constructor(private readonly context: vscode.ExtensionContext) {
        this.prefs = createMarkdownPreferences(context.workspaceState, context.globalState);
    }

    /** Used by the Accept All/Reject All Disk Changes commands. No-op if no Sheetmark Markdown editor is focused. */
    postCommandToActivePanel(command: 'acceptAllDiskChanges' | 'rejectAllDiskChanges'): void {
        if (this.activePanel?.active) {
            const message: HostToMarkdownWebview = { command };
            void this.activePanel.webview.postMessage(message);
        }
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
        // Typed send: the compiler checks every host-to-webview message against src/protocol/markdown.ts.
        const { post, sent } = recordSentInTests<HostToMarkdownWebview>(
            this.context.extensionMode === vscode.ExtensionMode.Test,
            (message) => webviewPanel.webview.postMessage(message),
        );
        try {
            let filePath = document.uri.fsPath;
            let currentUri = document.uri;
            let documentDirUri = vscode.Uri.file(path.dirname(filePath));
            let workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
            const workspaceFolderUri = () => vscode.workspace.getWorkspaceFolder(currentUri)?.uri.toString() || null;
            let markdownLocalResourceRoots = this.buildMarkdownLocalResourceRoots(
                filePath,
                documentDirUri,
                workspaceFolders,
            );

            const refreshMarkdownLocalResourceRoots = () => {
                markdownLocalResourceRoots = this.buildMarkdownLocalResourceRoots(
                    filePath,
                    documentDirUri,
                    workspaceFolders,
                );
                webviewPanel.webview.options = {
                    enableScripts: true,
                    localResourceRoots: markdownLocalResourceRoots,
                };
            };

            type VersionHistoryEntry = {
                id: string;
                timestamp: number;
                charCount: number;
                content: string;
            };

            let versionSnapshotDebounceTimer: NodeJS.Timeout | null = null;
            let currentContent = '';
            let previewVersionId: string | null = null;
            let restoredVersionId: string | null = null;
            // Save and restore write the file; run them one at a time (see serialQueue.ts).
            const fileQueue = createSerialQueue();
            const fileQueueKey = document.uri.fsPath.toLowerCase();
            this.fileQueues.set(fileQueueKey, fileQueue);
            webviewPanel.onDidDispose(() => this.fileQueues.delete(fileQueueKey));
            let lastSaveTime = 0;

            const getHistoryFilePath = () => {
                return getVersionHistoryFile(this.context.globalStorageUri.fsPath, filePath, 'md');
            };

            const ensureHistoryDir = async () => {
                await fs.promises.mkdir(path.dirname(getHistoryFilePath()), { recursive: true });
            };

            const parseHistoryFile = (raw: string): VersionHistoryEntry[] => {
                const trimmed = raw.trim();
                if (!trimmed) {
                    return [];
                }
                if (trimmed.startsWith('[')) {
                    const parsed = JSON.parse(trimmed);
                    return Array.isArray(parsed) ? parsed as VersionHistoryEntry[] : [];
                }
                return trimmed.split('\n')
                    .map(line => line.trim())
                    .filter(Boolean)
                    .map(line => JSON.parse(line) as VersionHistoryEntry);
            };

            const loadHistory = async (): Promise<VersionHistoryEntry[]> => {
                try {
                    const raw = await fs.promises.readFile(getHistoryFilePath(), 'utf8');
                    return parseHistoryFile(raw);
                } catch {
                    return [];
                }
            };

            const saveHistory = async (entries: VersionHistoryEntry[]) => {
                await ensureHistoryDir();
                const content = entries.length > 0
                    ? `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`
                    : '';
                await fs.promises.writeFile(getHistoryFilePath(), content, 'utf8');
            };

            const appendHistoryEntry = async (entry: VersionHistoryEntry) => {
                await ensureHistoryDir();
                const historyPath = getHistoryFilePath();
                let existing = '';
                try {
                    existing = await fs.promises.readFile(historyPath, 'utf8');
                } catch {
                    // New history file.
                }
                if (existing.trimStart().startsWith('[')) {
                    const history = parseHistoryFile(existing);
                    history.push(entry);
                    await saveHistory(history);
                    return;
                }
                await fs.promises.appendFile(historyPath, `${JSON.stringify(entry)}\n`, 'utf8');
            };

            const pruneHistory = async (entries?: VersionHistoryEntry[]) => {
                const now = Date.now();
                const source = entries ?? await loadHistory();
                const kept = source.filter(entry => now - entry.timestamp <= VERSION_HISTORY_RETENTION_MS);
                if (kept.length !== source.length) {
                    await saveHistory(kept);
                }
                return kept;
            };

            const persistVersionSnapshot = async (contentOverride?: string) => {
                const content = typeof contentOverride === 'string'
                    ? contentOverride
                    : await fs.promises.readFile(filePath, 'utf8');
                const history = await pruneHistory();
                const last = history.length ? history[history.length - 1] : null;
                if (last?.content === content) {
                    return;
                }

                const now = Date.now();
                const entry: VersionHistoryEntry = {
                    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
                    timestamp: now,
                    charCount: content.length,
                    content,
                };
                await appendHistoryEntry(entry);
            };

            const saveVersionSnapshot = (contentOverride?: string) => {
                if (versionSnapshotDebounceTimer) {
                    clearTimeout(versionSnapshotDebounceTimer);
                }

                versionSnapshotDebounceTimer = setTimeout(() => {
                    versionSnapshotDebounceTimer = null;
                    void persistVersionSnapshot(contentOverride);
                }, VERSION_HISTORY_SNAPSHOT_DEBOUNCE_MS);
            };

            const buildInitMarkdownPayload = (content: string): MessageOf<HostToMarkdownWebview, 'initMarkdown'> => ({
                command: 'initMarkdown',
                content,
                fileName: vscode.workspace.asRelativePath(currentUri),
                documentUri: currentUri.toString(),
                documentDirUri: documentDirUri.toString(),
                workspaceFolderUri: workspaceFolderUri(),
                tableColumnWidths: this.prefs.tableColumnWidths.get(currentUri),
                frontmatterPanelCollapsed: this.prefs.frontmatterPanelCollapsed.get(currentUri),
                mermaidPreviewMode: this.prefs.mermaidPreviewMode.get(),
                calloutDefaultType: this.prefs.calloutDefaultType.get(),
            });

            // Set up webview
            webviewPanel.webview.options = {
                enableScripts: true,
                localResourceRoots: markdownLocalResourceRoots,
            };
            webviewPanel.webview.html = this.getWebviewContent(webviewPanel);

            // Handle messages from webview
            // Pushes the VS Code theme now (on webviewReady) and on every theme change.
            const sendTheme = syncColorTheme(webviewPanel, post);

            const sharedContext: SharedHostContext = {
                post,
                associationType: () => 'md',
                sendSettings: () => { post({ command: 'settingsUpdated', settings: buildMdWebviewSettings() }); },
            };

            const handleMessage = async (message: MarkdownWebviewToHost) => {
                // Links, feedback and the default-editor toggle are shared with the spreadsheet editor.
                if (isSharedHostMessage(message)) {
                    await handleSharedHostMessage(message, sharedContext);
                    return;
                }

                switch (message.command) {
                    case 'webviewReady':
                        try {
                            // Read the markdown file
                            const content = await fs.promises.readFile(filePath, 'utf-8');
                            currentContent = content;
                            await pruneHistory();
                            await persistVersionSnapshot(content);

                            // Send content to webview
                            post(buildInitMarkdownPayload(content));

                            // Send settings
                            post({ command: 'initSettings', settings: buildMdWebviewSettings() });

                            sendTheme();
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error reading Markdown file: ${err}`);
                            try {
                                post({ command: 'reloadFromDiskError', message: String(err) });
                            } catch { /* panel disposed mid-flight */ }
                        }
                        break;

                    case 'resolveImageUris':
                        try {
                            const requestedSources = Array.isArray(message.sources) ? message.sources : [];
                            const resolved: Record<string, string> = {};

                            for (const source of requestedSources) {
                                if (typeof source !== 'string') {
                                    continue;
                                }

                                const trimmed = source.trim();
                                if (!trimmed) {
                                    continue;
                                }

                                const resolvedUri = this.resolveMarkdownImageUri(trimmed, currentUri, webviewPanel.webview);
                                if (resolvedUri) {
                                    resolved[trimmed] = resolvedUri;
                                }
                            }

                            post({
                                command: 'resolvedImageUris',
                                resolved
                            });
                        } catch (err) {
                            console.error('Failed resolving markdown image URIs:', err);
                        }
                        break;

                    case 'updateSettings':
                        try {
                            const s = message.settings || {};
                            const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                            await cfg.update('md.stickyToolbar', !!s.stickyToolbar, vscode.ConfigurationTarget.Global);
                            await cfg.update('md.wordWrap', !!s.wordWrap, vscode.ConfigurationTarget.Global);
                            if (typeof s.showOutline === 'boolean') {
                                await cfg.update('md.showOutline', !!s.showOutline, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.showLineNumbers === 'boolean') {
                                await cfg.update('md.showLineNumbers', !!s.showLineNumbers, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.livePreviewReveal === 'boolean') {
                                await cfg.update('md.livePreviewReveal', !!s.livePreviewReveal, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.livePreviewLineNumbers === 'boolean') {
                                await cfg.update('md.livePreviewLineNumbers', !!s.livePreviewLineNumbers, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.autoSave === 'boolean') {
                                await cfg.update('md.autoSave', !!s.autoSave, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.showStats === 'boolean') {
                                await cfg.update('md.showStats', !!s.showStats, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.statsShowLines === 'boolean') {
                                await cfg.update('md.statsShowLines', !!s.statsShowLines, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.statsShowWords === 'boolean') {
                                await cfg.update('md.statsShowWords', !!s.statsShowWords, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.statsShowChars === 'boolean') {
                                await cfg.update('md.statsShowChars', !!s.statsShowChars, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.statsShowReadingTime === 'boolean') {
                                await cfg.update('md.statsShowReadingTime', !!s.statsShowReadingTime, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.showCursorPosition === 'boolean') {
                                await cfg.update('md.showCursorPosition', !!s.showCursorPosition, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.diffReviewEnabled === 'boolean') {
                                await cfg.update('md.diffReviewEnabled', !!s.diffReviewEnabled, vscode.ConfigurationTarget.Global);
                            }
                            // Only non-boolean setting here — validate rather than coerce, so a
                            // stale webview can't write a bogus enum value into user config.
                            if (s.diffLayout === 'inline' || s.diffLayout === 'sideBySide') {
                                await cfg.update('md.diffLayout', s.diffLayout, vscode.ConfigurationTarget.Global);
                            }
                        } catch (err) {
                            console.error('Failed to persist settings:', err);
                        }
                        break;

                    case 'requestFreshData':
                        try {
                            const content = await fs.promises.readFile(filePath, 'utf-8');
                            currentContent = content;
                            lastSaveTime = Date.now();
                            post({ ...buildInitMarkdownPayload(content), command: 'diskChangedExternally' });
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error reading Markdown file: ${err}`);
                            try {
                                post({ command: 'reloadFromDiskError', message: String(err) });
                            } catch { /* panel disposed mid-flight */ }
                        }
                        break;


                    case 'saveMarkdown':
                        try {
                            const text = typeof message.text === 'string' ? message.text : '';
                            const isAutosave = !!message.isAutosave;

                            // Belt-and-suspenders conflict check: catches a disk change the
                            // webview doesn't know about yet (narrow race before the watcher
                            // fires). The webview's own pendingDiskContent check is primary.
                            if (!message.force) {
                                const freshDisk = await fs.promises.readFile(filePath, 'utf-8').catch(() => null);
                                if (freshDisk !== null && freshDisk !== currentContent) {
                                    currentContent = freshDisk;
                                    post({ command: 'saveConflict' });
                                    break;
                                }
                            }

                            await vscode.workspace.fs.writeFile(currentUri, Buffer.from(text, 'utf8'));
                            currentContent = text;
                            lastSaveTime = Date.now();
                            saveVersionSnapshot(text);
                            post({ command: 'saveResult', ok: true, isAutosave });
                        } catch (err) {
                            post({ command: 'saveResult', ok: false, error: String(err), isAutosave: !!message.isAutosave });
                        }
                        break;

                    case 'saveTableColumnWidths':
                        try {
                            const widths = message.widths && typeof message.widths === 'object' ? message.widths : {};
                            await this.prefs.tableColumnWidths.set(currentUri, widths);
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error saving table column widths: ${err}`);
                        }
                        break;

                    case 'saveFrontmatterPanelCollapsed':
                        try {
                            await this.prefs.frontmatterPanelCollapsed.set(currentUri, !!message.collapsed);
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error saving frontmatter panel state: ${err}`);
                        }
                        break;

                    case 'saveMermaidPreviewMode':
                        try {
                            await this.prefs.mermaidPreviewMode.set(message.mode);
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error saving Mermaid preview mode: ${err}`);
                        }
                        break;

                    case 'saveCalloutDefaultType':
                        try {
                            await this.prefs.calloutDefaultType.set(message.type);
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error saving callout default type: ${err}`);
                        }
                        break;

                    case 'showVersionHistory':
                        try {
                            if (fileQueue.busy) {
                                post({
                                    command: 'versionHistoryError',
                                    message: 'Wait for the current save to finish before opening version history',
                                });
                                break;
                            }

                            const history = await pruneHistory();
                            if (!history.length) {
                                post({
                                    command: 'versionHistoryError',
                                    message: 'No saved versions available'
                                });
                                break;
                            }

                            const pickedEntry = await pickVersionHistoryEntry(history, restoredVersionId, (entry) => `${entry.charCount} chars`);

                            if (!pickedEntry) {
                                break;
                            }

                            previewVersionId = pickedEntry.id;
                            currentContent = pickedEntry.content;

                            post(buildInitMarkdownPayload(currentContent));
                            post({
                                command: 'versionPreviewMd',
                                versionId: pickedEntry.id,
                                timestamp: pickedEntry.timestamp
                            });
                        } catch (err) {
                            post({
                                command: 'versionHistoryError',
                                message: `Version history failed: ${String(err)}`
                            });
                        }
                        break;

                            case 'cancelVersionPreview':
                                try {
                                    if (!previewVersionId) {
                                        break;
                                    }

                                    const content = await fs.promises.readFile(filePath, 'utf8');
                                    currentContent = content;
                                    previewVersionId = null;
                                    restoredVersionId = null;

                                    post(buildInitMarkdownPayload(currentContent));
                                    post({ command: 'versionPreviewCancelledMd' });
                                } catch (err) {
                                    post({
                                        command: 'versionHistoryError',
                                        message: `Version preview cancel failed: ${String(err)}`
                                    });
                                }
                                break;

                            case 'restoreVersion':
                                try {
                                    const versionId = typeof message.versionId === 'string' ? message.versionId : previewVersionId || '';
                                    if (!versionId) {
                                        break;
                                    }

                                    const history = await pruneHistory();
                                    const entry = history.find(item => item.id === versionId);
                                    if (!entry) {
                                        post({
                                            command: 'versionHistoryError',
                                            message: 'Selected version is no longer available'
                                        });
                                        break;
                                    }

                                    if (!message.force) {
                                        const freshDisk = await fs.promises.readFile(filePath, 'utf-8').catch(() => null);
                                        if (freshDisk !== null && freshDisk !== currentContent) {
                                            post({ command: 'restoreConflict', versionId });
                                            break;
                                        }
                                    }

                                    await vscode.workspace.fs.writeFile(currentUri, Buffer.from(entry.content, 'utf8'));
                                    currentContent = entry.content;
                                    lastSaveTime = Date.now();
                                    previewVersionId = null;
                                    restoredVersionId = entry.id;
                                    await persistVersionSnapshot(currentContent);

                                    post(buildInitMarkdownPayload(currentContent));
                                    post({
                                        command: 'versionRestoredMd',
                                        versionId: entry.id,
                                        timestamp: entry.timestamp
                                    });
                                } catch (err) {
                                    post({
                                        command: 'versionHistoryError',
                                        message: `Version history failed: ${String(err)}`
                                    });
                                }
                                break;

                    case 'openRelativeFile':
                        try {
                            const href = typeof message.href === 'string' ? message.href : '';
                            const docUri = typeof message.documentUri === 'string' ? message.documentUri : '';
                            
                            if (!href || !docUri) {
                                break;
                            }
                            
                            // Parse the document URI to get the file path
                            const currentDocUri = vscode.Uri.parse(docUri);
                            const currentDir = path.dirname(currentDocUri.fsPath);
                            
                            // Remove any anchor/hash from the href
                            const hrefWithoutAnchor = href.split('#')[0];
                            if (!hrefWithoutAnchor.trim()) {
                                break;
                            }
                            
                            // Resolve the relative path
                            const resolvedPath = path.resolve(currentDir, hrefWithoutAnchor);
                            const targetUri = vscode.Uri.file(resolvedPath);

                            try {
                                await vscode.workspace.fs.stat(targetUri);
                            } catch {
                                const fileName = path.basename(resolvedPath);
                                post({
                                    command: 'openRelativeFileFailed',
                                    message: `File not found: ${fileName}`,
                                });
                                break;
                            }
                            
                            // Open the file
                            await vscode.commands.executeCommand('vscode.open', targetUri);
                        } catch (err) {
                            post({
                                command: 'openRelativeFileFailed',
                                message: `Failed to open file: ${err}`,
                            });
                        }
                        break;

                    default: {
                        // Compile-time check that every MarkdownWebviewToHost command has a case.
                        const unhandled: never = message;
                        void unhandled;
                    }
                }
            };

            const dispatch = createMessageDispatcher({
                handle: handleMessage,
                queue: fileQueue,
                queuedCommands: MARKDOWN_FILE_WRITING_COMMANDS,
            });
            webviewPanel.webview.onDidReceiveMessage(dispatch);
            trackOpenEditor(this.openEditors, { panel: webviewPanel, uri: () => currentUri, dispatch, sent });

            // Forward settings changes
            const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(e => {
                if (
                    e.affectsConfiguration('xlsxViewer.md') ||
                    e.affectsConfiguration('xlsxViewer') ||
                    e.affectsConfiguration('workbench.editorAssociations')
                ) {
                    try {
                        post({ command: 'settingsUpdated', settings: buildMdWebviewSettings() });
                    } catch { }
                }
            });


            const externalFileWatcher = createExternalFileChangeWatcher({
                filePath,
                documentUri: currentUri,
                onChange: async () => {
                    if (fileQueue.busy || Date.now() - lastSaveTime < 1500) {
                        return;
                    }
                    try {
                        const content = await fs.promises.readFile(filePath, 'utf-8');
                        // Our own save (or a redundant watcher tick) — disk already matches
                        // what the host tracks; skip notifying the webview.
                        if (content === currentContent) {
                            return;
                        }
                        currentContent = content;
                        post({ ...buildInitMarkdownPayload(content), command: 'diskChangedExternally' });
                    } catch {
                        // ignore reload errors
                    }
                },
                onDelete: () => {
                    if (fileQueue.busy) {
                        return;
                    }
                    post({ command: 'diskDeletedExternally' });
                },
            });

            const workspaceFoldersDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
                workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
                refreshMarkdownLocalResourceRoots();
            });

            if (webviewPanel.active) {
                this.activePanel = webviewPanel;
            }
            const viewStateDisposable = webviewPanel.onDidChangeViewState(e => {
                if (e.webviewPanel.active) {
                    this.activePanel = e.webviewPanel;
                } else if (this.activePanel === e.webviewPanel) {
                    this.activePanel = null;
                }
            });

            webviewPanel.onDidDispose(() => {
                configChangeDisposable.dispose();
                workspaceFoldersDisposable.dispose();
                viewStateDisposable.dispose();
                externalFileWatcher.dispose();
                if (versionSnapshotDebounceTimer) {
                    clearTimeout(versionSnapshotDebounceTimer);
                    versionSnapshotDebounceTimer = null;
                }
                if (this.activePanel === webviewPanel) {
                    this.activePanel = null;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Error reading Markdown file: ${error}`);
        }
    }

    private getWebviewContent(webviewPanel: vscode.WebviewPanel): string {
        const webview = webviewPanel.webview;
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'md', 'mdWebview.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'md', 'mdWebview.css'));
        const themeUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'shared', 'theme.css'));
        const menuPanelStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'shared', 'menuPanel.css'));
        const highlightUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'md', 'highlight.css'));
        const feedbackStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'shared', 'feedback.css'));
        const spellAffUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'spell', 'en_US.aff'));
        const spellDicUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'spell', 'en_US.dic'));
        const cspSource = webview.cspSource;
        // Only scripts carrying this nonce (plus bundled files) may run: inline handlers smuggled in
        // through document content (<img onerror>, javascript: links) are blocked by the CSP.
        const nonce = createCspNonce();

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="${markdownCsp(cspSource, nonce)}">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Sheetmark</title>
            <link href="${themeUri}" rel="stylesheet" />
            <link href="${menuPanelStyleUri}" rel="stylesheet" />
            <link href="${styleUri}" rel="stylesheet" />
            <link href="${highlightUri}" rel="stylesheet" />
            <link href="${feedbackStyleUri}" rel="stylesheet" />
        </head>
        <body>
            <div id="readingProgressBar" class="reading-progress-bar"></div>
            <div class="header-background"></div>
            <div class="toolbar-wrapper"><div class="toolbar" id="toolbar"></div></div>

            <div id="formattingToolbar" class="formatting-toolbar hidden">
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="bold" title="Bold (Ctrl+B)"></button>
                    <button class="fmt-btn" data-format="italic" title="Italic (Ctrl+I)"></button>
                    <button class="fmt-btn" data-format="strikethrough" title="Strikethrough (Ctrl+Shift+X)"></button>
                    <button class="fmt-btn" data-format="inlineCode" title="Inline Code (Ctrl+E)"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="heading1" title="Heading 1 (Ctrl+1)"></button>
                    <button class="fmt-btn" data-format="heading2" title="Heading 2 (Ctrl+2)"></button>
                    <button class="fmt-btn" data-format="heading3" title="Heading 3 (Ctrl+3)"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="bulletList" title="Bullet List (Ctrl+L)"></button>
                    <button class="fmt-btn" data-format="orderedList" title="Ordered List (Ctrl+Shift+L)"></button>
                    <button class="fmt-btn" data-format="checkbox" title="Checkbox List"></button>
                    <button class="fmt-btn" data-format="blockquote" title="Blockquote"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="link" title="Insert Link (Ctrl+K)"></button>
                    <button class="fmt-btn" data-format="image" title="Insert Image"></button>
                    <button class="fmt-btn" data-format="table" title="Insert Table"></button>
                    <button class="fmt-btn" data-format="tableAddRowBelow" title="Add Row Below (WYSIWYG table)"></button>
                    <button class="fmt-btn" data-format="tableRemoveRow" title="Remove Current Row (WYSIWYG table)"></button>
                    <button class="fmt-btn" data-format="tableAddColumnRight" title="Add Column Right (WYSIWYG table)"></button>
                    <button class="fmt-btn" data-format="tableRemoveColumn" title="Remove Current Column (WYSIWYG table)"></button>
                    <button class="fmt-btn" data-format="codeBlock" title="Code Block (Ctrl+Shift+E)"></button>
                    <button class="fmt-btn" data-format="hr" title="Horizontal Rule"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="duplicateLine" title="Duplicate Line (Ctrl+Shift+D)"></button>
                    <button class="fmt-btn" data-format="deleteLine" title="Delete Line (Ctrl+Shift+K)"></button>
                    <button class="fmt-btn" data-format="moveUp" title="Move Line Up (Alt+&#x2191;)"></button>
                    <button class="fmt-btn" data-format="moveDown" title="Move Line Down (Alt+&#x2193;)"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="uppercase" title="UPPERCASE (Ctrl+Shift+U)"></button>
                    <button class="fmt-btn" data-format="lowercase" title="lowercase (Ctrl+U)"></button>
                    <button class="fmt-btn" data-format="titlecase" title="Title Case"></button>
                    <button class="fmt-btn" data-format="sortLines" title="Sort Lines A-Z"></button>
                    <button class="fmt-btn" data-format="trimWhitespace" title="Trim Trailing Whitespace"></button>
                    <button class="fmt-btn" data-format="jumpToLine" title="Go to Line (Ctrl+G)"></button>
                </div>
            </div>

            <div id="searchOverlay" class="search-overlay">
                <div class="search-bar">
                    <input type="text" id="searchInput" class="search-input" placeholder="Search in preview..." autocomplete="off" />
                    <span id="searchCount" class="search-count"></span>
                    <button id="searchPrev" class="search-nav-btn" title="Previous (Shift+Enter)">&#9650;</button>
                    <button id="searchNext" class="search-nav-btn" title="Next (Enter)">&#9660;</button>
                    <button id="searchClose" class="search-close-btn" title="Close (Esc)">&times;</button>
                </div>
            </div>

            <div id="diskDiffBulkActions" class="toast-notification disk-diff-bulk-actions">
                <div class="toast-header">
                    <div class="toast-icon-wrapper">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                    </div>
                    <span class="toast-text">File changed on disk</span>
                </div>
                <div class="toast-actions">
                    <span id="diskDiffChunkIndicator" class="disk-diff-chunk-indicator"></span>
                    <button id="diffPrevButton" class="disk-diff-nav-btn" type="button" title="Previous Change (Shift+F7)"></button>
                    <button id="diffNextButton" class="disk-diff-nav-btn" type="button" title="Next Change (F7)"></button>
                    <span class="disk-diff-sep"></span>
                    <div class="diff-badge hidden" id="diffBadge" aria-live="polite"></div>
                    <span class="disk-diff-sep hidden" id="diffBadgeSep"></span>
                    <button id="diffAcceptAllButton" class="toast-action disk-diff-bulk-btn accept" type="button">Accept All</button>
                    <button id="diffRejectAllButton" class="toast-action disk-diff-bulk-btn reject" type="button">Reject All</button>
                </div>
            </div>

            <div id="content" class="is-loading">
                <div id="loadingIndicator" class="loading-indicator">Loading Markdown...</div>
                <div class="markdown-container" id="markdownContainer">
                    <aside id="tocPanel" class="toc-panel hidden" aria-label="Outline">
                        <div class="toc-header">
                            <span class="toc-title">Outline</span>
                            <button id="tocCloseButton" class="toc-close" title="Hide outline">x</button>
                        </div>
                        <div id="tocBody" class="toc-body"></div>
                    </aside>
                    <div id="markdownPreview" class="markdown-preview"></div>
                    <div id="diskDiffChunkRuler" class="disk-diff-chunk-ruler hidden" aria-hidden="true"></div>
                </div>
            </div>

            <div class="status-bar" id="statusBar">
                <div class="status-info" id="statusInfo"></div>
            </div>

            <div id="lightboxOverlay" class="lightbox-overlay">
                <button id="lightboxClose" class="lightbox-close">&times;</button>
                <img id="lightboxImage" class="lightbox-image" />
            </div>

            <noscript>
                <div style="padding: 8px; margin-top: 10px; background: #fff3cd; border: 1px solid #ffeeba;">
                    JavaScript is disabled in this webview, so the Markdown preview cannot load.
                </div>
            </noscript>
            <script nonce="${nonce}">window.__SPELL_DICT__={aff:${JSON.stringify(spellAffUri.toString())},dic:${JSON.stringify(spellDicUri.toString())}};</script>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }

    private buildMarkdownLocalResourceRoots(
        filePath: string,
        documentDirUri: vscode.Uri,
        workspaceFolders: vscode.Uri[],
    ): vscode.Uri[] {
        const roots: vscode.Uri[] = [
            vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
            vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
            this.context.extensionUri,
            documentDirUri,
            ...workspaceFolders,
        ];

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        let currentDir = path.dirname(filePath);
        const stop = workspaceFolder?.uri.fsPath;
        while (stop && currentDir.length >= stop.length && currentDir.startsWith(stop)) {
            roots.push(vscode.Uri.file(currentDir));
            if (currentDir === stop) {
                break;
            }
            currentDir = path.dirname(currentDir);
        }

        return roots;
    }

    private resolveMarkdownImageUri(rawSource: string, documentUri: vscode.Uri, webview: vscode.Webview): string | null {
        if (!rawSource || /^https?:\/\//i.test(rawSource) || /^data:/i.test(rawSource) || /^#/.test(rawSource)) {
            return null;
        }

        // Keep query/hash on final URL after converting the base file URI.
        const match = rawSource.match(/^([^?#]*)([?#].*)?$/);
        const sourcePath = (match?.[1] || '').trim();
        const suffix = match?.[2] || '';
        if (!sourcePath) {
            return null;
        }

        const normalized = sourcePath.replace(/\\/g, '/');

        try {
            if (/^file:/i.test(normalized)) {
                return webview.asWebviewUri(vscode.Uri.parse(normalized)).toString() + suffix;
            }

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri)?.uri;

            if (/^\//.test(normalized) && workspaceFolder) {
                const rel = normalized.replace(/^\/+/, '');
                const absolute = path.join(workspaceFolder.fsPath, rel);
                return webview.asWebviewUri(vscode.Uri.file(absolute)).toString() + suffix;
            }

            if (path.isAbsolute(normalized)) {
                return webview.asWebviewUri(vscode.Uri.file(normalized)).toString() + suffix;
            }

            const absolute = path.resolve(path.dirname(documentUri.fsPath), normalized);
            if (!fs.existsSync(absolute)) {
                return null;
            }
            return webview.asWebviewUri(vscode.Uri.file(absolute)).toString() + suffix;
        } catch {
            return null;
        }
    }
}
