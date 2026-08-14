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

    public async migrateUri(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
        const oldKey = this.getStorageKey(oldUri);
        const newKey = this.getStorageKey(newUri);
        if (oldKey === newKey) {
            return;
        }
        const value = this.context.workspaceState.get<boolean>(oldKey);
        if (value === undefined) {
            return;
        }
        await this.context.workspaceState.update(newKey, value);
        await this.context.workspaceState.update(oldKey, undefined);
    }
}
