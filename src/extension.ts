import * as vscode from 'vscode';
import * as path from 'path';
import * as Excel from 'exceljs';
import { SpreadsheetEditorProvider } from './spreadsheetEditorProvider';
import { MDEditorProvider } from './mdEditorProvider';
import { StyleStorageService } from './shared/styleStorageService';
import { applyStoredStylesToWorksheet } from './spreadsheet/excelStyle';
import {
    convertTabularFile,
    detectTabularFileType,
    getTabularFileTypeInfo,
    getTargetTabularFileTypes,
    TabularFileType
} from './shared/fileConversionService';
import {
    reconcileAllOpenByDefaultSettings,
    setEditorAssociation,
    SHEETMARK_ASSOCIATION_TYPES,
    SheetmarkAssociationType,
    syncOpenByDefaultFromSetting,
} from './shared/editorAssociationUtils';

function resolveDocumentUri(uri?: vscode.Uri): vscode.Uri | undefined {
    if (uri instanceof vscode.Uri) {
        return uri;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        return activeEditor.document.uri;
    }

    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab?.input instanceof (vscode as any).TabInputCustom || activeTab?.input instanceof (vscode as any).TabInputText) {
        return (activeTab.input as any).uri;
    }

    return undefined;
}

function getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
    const input = tab.input;
    if (input instanceof (vscode as any).TabInputText || input instanceof (vscode as any).TabInputCustom) {
        return (input as { uri: vscode.Uri }).uri;
    }
    return undefined;
}

async function closeEditorsForUri(uri: vscode.Uri): Promise<void> {
    const tabsToClose: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const tabUri = getTabUri(tab);
            if (tabUri && tabUri.toString() === uri.toString()) {
                tabsToClose.push(tab);
            }
        }
    }
    if (tabsToClose.length > 0) {
        await vscode.window.tabGroups.close(tabsToClose);
    }
}

async function reopenWithCustomEditor(uri: vscode.Uri, viewType: string): Promise<void> {
    await closeEditorsForUri(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
}

function getViewTypeForFileType(fileType: TabularFileType): string | undefined {
    if (fileType === 'csv') {
        return 'xlsxViewer.csv';
    }
    if (fileType === 'tsv') {
        return 'xlsxViewer.tsv';
    }
    if (fileType === 'xlsx') {
        return 'xlsxViewer.xlsx';
    }
    return undefined;
}

async function applyStoredStylesToXlsxFile(filePath: string, storedStyles: Record<string, any>): Promise<void> {
    if (!storedStyles || typeof storedStyles !== 'object' || !Object.keys(storedStyles).length) {
        return;
    }

    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
        return;
    }

    // Same code path as the toolbar Convert, so both produce identical styling.
    applyStoredStylesToWorksheet(worksheet, storedStyles);

    await workbook.xlsx.writeFile(filePath);
}

export function activate(context: vscode.ExtensionContext) {
    const spreadsheetProvider = new SpreadsheetEditorProvider(context);
    const mdProvider = new MDEditorProvider(context);
    const styleStorage = new StyleStorageService(context);
    const stylePruneIntervalMs = 24 * 60 * 60 * 1000;

    void styleStorage.pruneAllExpiredStyles().catch(() => {
        // Ignore cleanup failures so extension activation is never blocked.
    });

    const stylePruneTimer = setInterval(() => {
        void styleStorage.pruneAllExpiredStyles().catch(() => {
            // Ignore cleanup failures so background maintenance never interrupts editing.
        });
    }, stylePruneIntervalMs);

    context.subscriptions.push(new vscode.Disposable(() => {
        clearInterval(stylePruneTimer);
    }));

    void reconcileAllOpenByDefaultSettings().catch(() => {
        // Ignore reconciliation failures so extension activation is never blocked.
    });

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            for (const type of SHEETMARK_ASSOCIATION_TYPES) {
                if (e.affectsConfiguration(`xlsxViewer.${type}.openByDefault`)) {
                    try {
                        await syncOpenByDefaultFromSetting(type);
                    } catch {
                        // ignore
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('xlsxViewer.xlsx', spreadsheetProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        }),
        vscode.window.registerCustomEditorProvider('xlsxViewer.csv', spreadsheetProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        }),
        vscode.window.registerCustomEditorProvider('xlsxViewer.tsv', spreadsheetProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        }),
        vscode.window.registerCustomEditorProvider('xlsxViewer.md', mdProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.goBackToTableView', async (uri?: vscode.Uri) => {
            if (uri instanceof vscode.Uri) {
                const path = uri.fsPath.toLowerCase();
                const viewType = path.endsWith('.tsv') ? 'xlsxViewer.tsv' : 'xlsxViewer.csv';
                await reopenWithCustomEditor(uri, viewType);
                return;
            }

            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const docUri = activeEditor.document.uri;
                const path = docUri.fsPath.toLowerCase();
                if (path.endsWith('.csv')) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await vscode.commands.executeCommand('vscode.openWith', docUri, 'xlsxViewer.csv');
                } else if (path.endsWith('.tsv')) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await vscode.commands.executeCommand('vscode.openWith', docUri, 'xlsxViewer.tsv');
                }
            } else {
                // Try to get URI from active tab if not a text editor
                const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
                if (activeTab?.input instanceof (vscode as any).TabInputCustom || activeTab?.input instanceof (vscode as any).TabInputText) {
                    const tabUri = (activeTab.input as any).uri;
                    if (tabUri) {
                        const path = tabUri.fsPath.toLowerCase();
                        if (path.endsWith('.csv')) {
                            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                            await vscode.commands.executeCommand('vscode.openWith', tabUri, 'xlsxViewer.csv');
                        } else if (path.endsWith('.tsv')) {
                            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                            await vscode.commands.executeCommand('vscode.openWith', tabUri, 'xlsxViewer.tsv');
                        }
                    }
                }
            }
        }),

        vscode.commands.registerCommand('xlsx-viewer.goBackToXlsxView', async (uri?: vscode.Uri) => {
            if (uri instanceof vscode.Uri) {
                await reopenWithCustomEditor(uri, 'xlsxViewer.xlsx');
                return;
            }

            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const docUri = activeEditor.document.uri;
                if (docUri.fsPath.toLowerCase().endsWith('.xlsx')) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await vscode.commands.executeCommand('vscode.openWith', docUri, 'xlsxViewer.xlsx');
                }
            } else {
                // Try to get URI from active tab if not a text editor
                const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
                if (activeTab?.input instanceof (vscode as any).TabInputCustom || activeTab?.input instanceof (vscode as any).TabInputText) {
                    const tabUri = (activeTab.input as any).uri;
                    if (tabUri && tabUri.fsPath.toLowerCase().endsWith('.xlsx')) {
                        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                        await vscode.commands.executeCommand('vscode.openWith', tabUri, 'xlsxViewer.xlsx');
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.openWithXlsx', async (uri?: vscode.Uri) => {
            const target = resolveDocumentUri(uri);
            if (target) {
                await reopenWithCustomEditor(target, 'xlsxViewer.xlsx');
            }
        }),
        vscode.commands.registerCommand('xlsx-viewer.openWithCsv', async (uri?: vscode.Uri) => {
            const target = resolveDocumentUri(uri);
            if (target) {
                await reopenWithCustomEditor(target, 'xlsxViewer.csv');
            }
        }),
        vscode.commands.registerCommand('xlsx-viewer.openWithTsv', async (uri?: vscode.Uri) => {
            const target = resolveDocumentUri(uri);
            if (target) {
                await reopenWithCustomEditor(target, 'xlsxViewer.tsv');
            }
        }),
        vscode.commands.registerCommand('xlsx-viewer.openWithMd', async (uri?: vscode.Uri) => {
            const target = resolveDocumentUri(uri);
            if (target) {
                await reopenWithCustomEditor(target, 'xlsxViewer.md');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.goBackToMdPreview', async (uri?: vscode.Uri) => {
            const target = uri instanceof vscode.Uri ? uri : resolveDocumentUri();
            if (target) {
                await reopenWithCustomEditor(target, 'xlsxViewer.md');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.md.acceptAllDiskChanges', () => {
            mdProvider.postCommandToActivePanel('acceptAllDiskChanges');
        }),
        vscode.commands.registerCommand('xlsx-viewer.md.rejectAllDiskChanges', () => {
            mdProvider.postCommandToActivePanel('rejectAllDiskChanges');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.toggleAssociation', async (params: { type: SheetmarkAssociationType, enable: boolean }) => {
            try {
                await setEditorAssociation(params.type, params.enable, { showToast: true });
            } catch (err) {
                vscode.window.showErrorMessage(`Error updating association: ${err}`);
            }
        })
    );

    // Keep the old command for backward compatibility if needed, but point it to the new one
    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.toggleMdAssociation', async (enable: boolean) => {
            await vscode.commands.executeCommand('xlsx-viewer.toggleAssociation', { type: 'md', enable });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.convertFile', async (uri?: vscode.Uri) => {
            const sourceUri = resolveDocumentUri(uri);
            if (!sourceUri) {
                vscode.window.showWarningMessage('No file is selected for conversion.');
                return;
            }

            if (sourceUri.scheme !== 'file') {
                vscode.window.showErrorMessage('Only local files can be converted.');
                return;
            }

            const sourceType = detectTabularFileType(sourceUri.fsPath);
            if (!sourceType) {
                vscode.window.showErrorMessage('Supported source formats are CSV, TSV, and XLSX.');
                return;
            }

            const targetTypes = getTargetTabularFileTypes(sourceType);
            if (!targetTypes.length) {
                vscode.window.showErrorMessage('No target formats are available for conversion.');
                return;
            }

            const picked = await vscode.window.showQuickPick(
                targetTypes.map(type => {
                    const info = getTabularFileTypeInfo(type);
                    return {
                        label: info.label,
                        description: `.${info.extension}`,
                        type
                    };
                }),
                {
                    title: 'Convert File To',
                    placeHolder: `Choose target format for ${path.basename(sourceUri.fsPath)}`
                }
            );

            if (!picked) {
                return;
            }

            const targetInfo = getTabularFileTypeInfo(picked.type);
            const sourceFilePath = sourceUri.fsPath;
            const parsedSourcePath = path.parse(sourceFilePath);
            const defaultTargetUri = vscode.Uri.file(
                path.join(parsedSourcePath.dir, `${parsedSourcePath.name}.${targetInfo.extension}`)
            );

            const targetUri = await vscode.window.showSaveDialog({
                defaultUri: defaultTargetUri,
                filters: {
                    [targetInfo.label]: [targetInfo.extension]
                }
            });

            if (!targetUri) {
                return;
            }

            const requiredExtension = `.${targetInfo.extension.toLowerCase()}`;
            const requestedPath = targetUri.fsPath;
            const finalTargetPath = path.extname(requestedPath).toLowerCase() === requiredExtension
                ? requestedPath
                : `${requestedPath}${requiredExtension}`;
            const finalTargetUri = vscode.Uri.file(finalTargetPath);

            try {
                const result = await convertTabularFile({
                    sourcePath: sourceFilePath,
                    targetPath: finalTargetPath,
                    sourceType,
                    targetType: picked.type
                });

                if ((sourceType === 'csv' || sourceType === 'tsv') && result.targetType === 'xlsx') {
                    const storedStyles = await styleStorage.getStyles(sourceUri);
                    if (storedStyles) {
                        await applyStoredStylesToXlsxFile(finalTargetPath, storedStyles);
                        await styleStorage.clearStyles(sourceUri);
                    }
                }

                const message = result.droppedSheets
                    ? `Converted to ${targetInfo.label}. Only the first worksheet was kept because ${targetInfo.label} supports a single sheet.`
                    : `Converted to ${targetInfo.label}.`;
                vscode.window.showInformationMessage(message);

                const targetViewType = getViewTypeForFileType(result.targetType);
                if (targetViewType) {
                    await vscode.commands.executeCommand('vscode.openWith', finalTargetUri, targetViewType);
                } else {
                    await vscode.commands.executeCommand('vscode.open', finalTargetUri);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Conversion failed: ${String(error)}`);
            }
        })
    );
}

export function deactivate() { }
