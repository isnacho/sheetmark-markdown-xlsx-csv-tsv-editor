import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage } from 'http';
import { VERSION_HISTORY_RETENTION_MS, VERSION_HISTORY_SNAPSHOT_DEBOUNCE_MS, buildGroupedVersionHistoryItems, formatVersionHistoryTimestamp, getVersionHistoryFile } from './shared/versionHistory';
import { TableColumnWidthStorageService } from './shared/tableColumnWidthStorageService';
import { FrontmatterPanelStorageService } from './shared/frontmatterPanelStorageService';
import { MermaidPreviewModeStorageService } from './shared/mermaidPreviewModeStorageService';
import { CalloutDefaultTypeStorageService } from './shared/calloutDefaultTypeStorageService';

export class MDEditorProvider implements vscode.CustomReadonlyEditorProvider {
    private readonly tableColumnWidthStorage: TableColumnWidthStorageService;
    private readonly frontmatterPanelStorage: FrontmatterPanelStorageService;
    private readonly mermaidPreviewModeStorage: MermaidPreviewModeStorageService;
    private readonly calloutDefaultTypeStorage: CalloutDefaultTypeStorageService;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.tableColumnWidthStorage = new TableColumnWidthStorageService(context);
        this.frontmatterPanelStorage = new FrontmatterPanelStorageService(context);
        this.mermaidPreviewModeStorage = new MermaidPreviewModeStorageService(context);
        this.calloutDefaultTypeStorage = new CalloutDefaultTypeStorageService(context);
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
        try {
            const filePath = document.uri.fsPath;
            const documentDirUri = vscode.Uri.file(path.dirname(filePath));
            const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
            const workspaceFolderUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() || null;
            const markdownLocalResourceRoots = this.buildMarkdownLocalResourceRoots(
                filePath,
                documentDirUri,
                workspaceFolders,
            );

            type VersionHistoryEntry = {
                id: string;
                timestamp: number;
                charCount: number;
                content: string;
            };

            let versionSnapshotDebounceTimer: NodeJS.Timeout | null = null;
            let currentContent = '';
            let previewVersionId: string | null = null;
            let previewVersionTimestamp: number | null = null;
            let previewVersionContent: string | null = null;
            let restoredVersionId: string | null = null;
            let isSaving = false;
            let lastSaveTime = 0;

            const getHistoryFilePath = () => {
                return getVersionHistoryFile(this.context.globalStorageUri.fsPath, filePath, 'md');
            };

            const ensureHistoryDir = async () => {
                await fs.promises.mkdir(path.dirname(getHistoryFilePath()), { recursive: true });
            };

            const loadHistory = async (): Promise<VersionHistoryEntry[]> => {
                try {
                    const raw = await fs.promises.readFile(getHistoryFilePath(), 'utf8');
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
                await fs.promises.writeFile(getHistoryFilePath(), JSON.stringify(entries), 'utf8');
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
                history.push({
                    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
                    timestamp: now,
                    charCount: content.length,
                    content
                });
                await saveHistory(history);
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

            const buildInitMarkdownPayload = (content: string) => ({
                command: 'initMarkdown',
                content,
                fileName: vscode.workspace.asRelativePath(document.uri),
                documentUri: document.uri.toString(),
                documentDirUri: documentDirUri.toString(),
                workspaceFolderUri,
                tableColumnWidths: this.tableColumnWidthStorage.getWidths(document.uri),
                frontmatterPanelCollapsed: this.frontmatterPanelStorage.getCollapsed(document.uri),
                mermaidPreviewMode: this.mermaidPreviewModeStorage.getMode(),
                calloutDefaultType: this.calloutDefaultTypeStorage.getType(),
            });

            // Set up webview
            webviewPanel.webview.options = {
                enableScripts: true,
                localResourceRoots: markdownLocalResourceRoots,
            };
            webviewPanel.webview.html = this.getWebviewContent(webviewPanel);

            // Handle messages from webview
            webviewPanel.webview.onDidReceiveMessage(async message => {
                switch (message.command) {
                    case 'webviewReady':
                        try {
                            // Read the markdown file
                            const content = await fs.promises.readFile(filePath, 'utf-8');
                            currentContent = content;
                            await pruneHistory();
                            await persistVersionSnapshot(content);

                            // Send content to webview
                            webviewPanel.webview.postMessage(buildInitMarkdownPayload(content));

                            // Send settings
                            const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                            const settings = {
                                stickyToolbar: cfg.get('md.stickyToolbar', true),
                                wordWrap: cfg.get('md.wordWrap', true),
                                showOutline: cfg.get('md.showOutline', true),
                                showLineNumbers: cfg.get('md.showLineNumbers', true),
                                livePreviewReveal: cfg.get('md.livePreviewReveal', true),
                                livePreviewLineNumbers: cfg.get('md.livePreviewLineNumbers', false),
                                autoSave: cfg.get('md.autoSave', false)
                            };
                            webviewPanel.webview.postMessage({ command: 'initSettings', settings });

                            // Send theme
                            webviewPanel.webview.postMessage({
                                type: 'setTheme',
                                kind: vscode.window.activeColorTheme.kind
                            });
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error reading Markdown file: ${err}`);
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

                                const resolvedUri = this.resolveMarkdownImageUri(trimmed, document.uri, webviewPanel.webview);
                                if (resolvedUri) {
                                    resolved[trimmed] = resolvedUri;
                                }
                            }

                            webviewPanel.webview.postMessage({
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
                        } catch (err) {
                            console.error('Failed to persist settings:', err);
                        }
                        break;

                    case 'requestFreshData':
                        try {
                            const content = await fs.promises.readFile(filePath, 'utf-8');
                            currentContent = content;
                            webviewPanel.webview.postMessage({ ...buildInitMarkdownPayload(content), command: 'diskChangedExternally' });
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error reading Markdown file: ${err}`);
                            try {
                                webviewPanel.webview.postMessage({ command: 'reloadFromDiskError', message: String(err) });
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
                                    webviewPanel.webview.postMessage({ command: 'saveConflict' });
                                    break;
                                }
                            }

                            isSaving = true;
                            await vscode.workspace.fs.writeFile(document.uri, Buffer.from(text, 'utf8'));
                            currentContent = text;
                            lastSaveTime = Date.now();
                            saveVersionSnapshot(text);
                            webviewPanel.webview.postMessage({ command: 'saveResult', ok: true, isAutosave });
                        } catch (err) {
                            webviewPanel.webview.postMessage({ command: 'saveResult', ok: false, error: String(err), isAutosave: !!message.isAutosave });
                        } finally {
                            isSaving = false;
                        }
                        break;

                    case 'saveTableColumnWidths':
                        try {
                            const widths = message.widths && typeof message.widths === 'object' ? message.widths : {};
                            await this.tableColumnWidthStorage.saveWidths(document.uri, widths);
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error saving table column widths: ${err}`);
                        }
                        break;

                    case 'saveFrontmatterPanelCollapsed':
                        try {
                            await this.frontmatterPanelStorage.saveCollapsed(document.uri, !!message.collapsed);
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error saving frontmatter panel state: ${err}`);
                        }
                        break;

                    case 'saveMermaidPreviewMode':
                        try {
                            const mode = message.mode === 'code' ? 'code' : 'diagram';
                            await this.mermaidPreviewModeStorage.saveMode(mode);
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error saving Mermaid preview mode: ${err}`);
                        }
                        break;

                    case 'saveCalloutDefaultType':
                        try {
                            const type = typeof message.type === 'string' ? message.type : '';
                            await this.calloutDefaultTypeStorage.saveType(type);
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error saving callout default type: ${err}`);
                        }
                        break;

                    case 'showVersionHistory':
                        try {
                            const history = await pruneHistory();
                            if (!history.length) {
                                webviewPanel.webview.postMessage({
                                    command: 'versionHistoryError',
                                    message: 'No saved versions available'
                                });
                                break;
                            }

                            const sorted = [...history].sort((a, b) => b.timestamp - a.timestamp);
                            const oldestVersionId = sorted.length ? sorted[sorted.length - 1].id : null;
                            const picked = await vscode.window.showQuickPick(
                                buildGroupedVersionHistoryItems(sorted, (entry) => ({
                                    label: entry.id === oldestVersionId && entry.id === restoredVersionId
                                        ? 'Original File (Restored)'
                                        : entry.id === oldestVersionId
                                            ? 'Original File'
                                        : entry.id === restoredVersionId
                                            ? 'Restored'
                                            : formatVersionHistoryTimestamp(entry.timestamp),
                                    description: entry.id === oldestVersionId || entry.id === restoredVersionId
                                        ? formatVersionHistoryTimestamp(entry.timestamp)
                                        : `${entry.charCount} chars`,
                                    detail: `Saved ${Math.max(1, Math.round((Date.now() - entry.timestamp) / 60000))} min ago`,
                                    entry
                                })),
                                {
                                    placeHolder: `Version history (${sorted.length} versions)`
                                }
                            );

                            if (!picked?.entry) {
                                break;
                            }

                            previewVersionId = picked.entry.id;
                            previewVersionTimestamp = picked.entry.timestamp;
                            previewVersionContent = picked.entry.content;
                            currentContent = picked.entry.content;

                            webviewPanel.webview.postMessage(buildInitMarkdownPayload(currentContent));
                            webviewPanel.webview.postMessage({
                                command: 'versionPreviewMd',
                                versionId: picked.entry.id,
                                timestamp: picked.entry.timestamp
                            });
                        } catch (err) {
                            webviewPanel.webview.postMessage({
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
                                    previewVersionTimestamp = null;
                                    previewVersionContent = null;
                                    restoredVersionId = null;

                                    webviewPanel.webview.postMessage(buildInitMarkdownPayload(currentContent));
                                    webviewPanel.webview.postMessage({ command: 'versionPreviewCancelledMd' });
                                } catch (err) {
                                    webviewPanel.webview.postMessage({
                                        command: 'versionHistoryError',
                                        message: `Version preview cancel failed: ${String(err)}`
                                    });
                                }
                                break;

                            case 'restoreVersion':
                                try {
                                    isSaving = true;
                                    const versionId = typeof message.versionId === 'string' ? message.versionId : previewVersionId || '';
                                    if (!versionId) {
                                        break;
                                    }

                                    const history = await pruneHistory();
                                    const entry = history.find(item => item.id === versionId);
                                    if (!entry) {
                                        webviewPanel.webview.postMessage({
                                            command: 'versionHistoryError',
                                            message: 'Selected version is no longer available'
                                        });
                                        break;
                                    }

                                    await vscode.workspace.fs.writeFile(document.uri, Buffer.from(entry.content, 'utf8'));
                                    currentContent = entry.content;
                                    lastSaveTime = Date.now();
                                    previewVersionId = null;
                                    previewVersionTimestamp = null;
                                    previewVersionContent = null;
                                    restoredVersionId = entry.id;
                                    await persistVersionSnapshot(currentContent);

                                    webviewPanel.webview.postMessage(buildInitMarkdownPayload(currentContent));
                                    webviewPanel.webview.postMessage({
                                        command: 'versionRestoredMd',
                                        versionId: entry.id,
                                        timestamp: entry.timestamp
                                    });
                                } catch (err) {
                                    webviewPanel.webview.postMessage({
                                        command: 'versionHistoryError',
                                        message: `Version history failed: ${String(err)}`
                                    });
                                } finally {
                                    isSaving = false;
                                }
                                break;

                    case 'openExternal':
                        try {
                            const url = typeof message.url === 'string' ? message.url : '';
                            if (url) {
                                await vscode.env.openExternal(vscode.Uri.parse(url));
                            }
                        } catch {
                            // ignore
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
                            
                            // Resolve the relative path
                            const resolvedPath = path.resolve(currentDir, hrefWithoutAnchor);
                            const targetUri = vscode.Uri.file(resolvedPath);
                            
                            // Open the file
                            await vscode.commands.executeCommand('vscode.open', targetUri);
                        } catch (err) {
                            vscode.window.showErrorMessage(`Failed to open file: ${err}`);
                        }
                        break;

                    case 'getSystemDetails': {
                        const ext = vscode.extensions.getExtension('nacho-allendesalazar.super-file-viewer');
                        const editorName = vscode.env.appName || 'VS Code';
                        webviewPanel.webview.postMessage({
                            command: 'systemDetails',
                            vscodeVersion: vscode.version,
                            extensionVersion: ext?.packageJSON?.version ?? 'unknown',
                            osInfo: `${process.platform} ${process.arch}`,
                            editorName: editorName
                        });
                        break;
                    }

                    case 'submitFeedback': {
                        try {
                            const https = await import('https');
                            const formData = message.data as Record<string, string>;
                            const body = Object.entries(formData)
                                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
                                .join('&');
                            const result = await new Promise<boolean>((resolve) => {
                                const req = https.request({
                                    hostname: 'docs.google.com',
                                    path: '/forms/d/e/1FAIpQLSe5AqE_f1-WqUlQmvuPn1as3Mkn4oLjA0EDhNssetzt63ONzA/formResponse',
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
                                }, (res: IncomingMessage) => resolve((res.statusCode ?? 0) < 400));
                                req.on('error', () => resolve(false));
                                req.write(body);
                                req.end();
                            });
                            webviewPanel.webview.postMessage({ command: 'feedbackResult', ok: result });
                        } catch {
                            webviewPanel.webview.postMessage({ command: 'feedbackResult', ok: false });
                        }
                        break;
                    }
                }
            });

            // Forward settings changes
            const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('xlsxViewer.md') || e.affectsConfiguration('xlsxViewer')) {
                    const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                    const settings = {
                        stickyToolbar: cfg.get('md.stickyToolbar', true),
                        wordWrap: cfg.get('md.wordWrap', true),
                        showOutline: cfg.get('md.showOutline', true),
                        showLineNumbers: cfg.get('md.showLineNumbers', true),
                        livePreviewReveal: cfg.get('md.livePreviewReveal', true),
                        livePreviewLineNumbers: cfg.get('md.livePreviewLineNumbers', false),
                        autoSave: cfg.get('md.autoSave', false)
                    };
                    try {
                        webviewPanel.webview.postMessage({ command: 'settingsUpdated', settings });
                    } catch { }
                }
            });

            // Theme change listener
            const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
                try {
                    webviewPanel.webview.postMessage({
                        type: 'setTheme',
                        kind: vscode.window.activeColorTheme.kind
                    });
                } catch { }
            });

            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(path.dirname(filePath)), path.basename(filePath))
            );
            const watcherDisposable = watcher.onDidChange(async () => {
                if (isSaving || Date.now() - lastSaveTime < 1000) {
                    return;
                }
                try {
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    currentContent = content;
                    webviewPanel.webview.postMessage({ ...buildInitMarkdownPayload(content), command: 'diskChangedExternally' });
                } catch {
                    // ignore reload errors
                }
            });
            const deleteWatcherDisposable = watcher.onDidDelete(() => {
                if (isSaving) {
                    return;
                }
                webviewPanel.webview.postMessage({ command: 'diskDeletedExternally' });
            });

            webviewPanel.onDidDispose(() => {
                configChangeDisposable.dispose();
                themeChangeDisposable.dispose();
                watcherDisposable.dispose();
                deleteWatcherDisposable.dispose();
                watcher.dispose();
                if (versionSnapshotDebounceTimer) {
                    clearTimeout(versionSnapshotDebounceTimer);
                    versionSnapshotDebounceTimer = null;
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
        const highlightUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'md', 'highlight.css'));
        const feedbackStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'shared', 'feedback.css'));
        const spellAffUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'spell', 'en_US.aff'));
        const spellDicUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'spell', 'en_US.dic'));
        const cspSource = webview.cspSource;

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} https: 'unsafe-inline'; font-src ${cspSource} https:; script-src ${cspSource} 'unsafe-inline';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Markdown Viewer</title>
            <link href="${themeUri}" rel="stylesheet" />
            <link href="${styleUri}" rel="stylesheet" />
            <link href="${highlightUri}" rel="stylesheet" />
            <link href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.6.0/katex.min.css" rel="stylesheet" />
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

            <div id="content">
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
                </div>
            </div>

            <div class="status-info" id="statusInfo"></div>

            <div id="lightboxOverlay" class="lightbox-overlay">
                <button id="lightboxClose" class="lightbox-close">&times;</button>
                <img id="lightboxImage" class="lightbox-image" />
            </div>

            <noscript>
                <div style="padding: 8px; margin-top: 10px; background: #fff3cd; border: 1px solid #ffeeba;">
                    JavaScript is disabled in this webview, so the Markdown preview cannot load.
                </div>
            </noscript>
            <script>window.__SPELL_DICT__={aff:${JSON.stringify(spellAffUri.toString())},dic:${JSON.stringify(spellDicUri.toString())}};</script>
            <script src="${scriptUri}"></script>
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