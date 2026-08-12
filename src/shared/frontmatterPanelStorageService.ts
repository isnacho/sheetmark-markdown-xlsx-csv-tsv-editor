import * as vscode from 'vscode';

const STORAGE_KEY_PREFIX = 'xlsxViewer.frontmatterPanel.';

export class FrontmatterPanelStorageService {
    constructor(private readonly context: vscode.ExtensionContext) { }

    private getStorageKey(uri: vscode.Uri): string {
        return `${STORAGE_KEY_PREFIX}${uri.fsPath.toLowerCase()}`;
    }

    public getCollapsed(uri: vscode.Uri): boolean {
        return this.context.workspaceState.get<boolean>(this.getStorageKey(uri)) ?? false;
    }

    public async saveCollapsed(uri: vscode.Uri, collapsed: boolean): Promise<void> {
        await this.context.workspaceState.update(this.getStorageKey(uri), collapsed);
    }
}
