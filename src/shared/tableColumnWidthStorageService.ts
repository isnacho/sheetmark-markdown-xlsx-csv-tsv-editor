import * as vscode from 'vscode';

// Persists Markdown live-preview table column widths, keyed by table order-of-
// appearance in the document (0-indexed) -> px width per column. Raw GFM
// pipe-table syntax has no field for column width, so this can't live in the
// .md file itself — mirrors StyleStorageService's approach to the same problem
// for CSV/TSV cell styles (see CLAUDE.md §6), but simpler: unlike that
// service's 48h-TTL "styles" family, this is modeled on its `viewMode` family
// (permanent, no expiry) since a resized column is a deliberate, durable
// preference, not an ephemeral edit.
//
// Table identity is positional (order of appearance), not content-addressed —
// reordering/inserting/removing tables above a resized one can misattribute
// stored widths. Accepted limitation, same class of imprecision this codebase
// already lives with for StyleStorageService's `row:col` keys.

const STORAGE_KEY_PREFIX = 'xlsxViewer.tableColumnWidths.';

export class TableColumnWidthStorageService {
    constructor(private readonly context: vscode.ExtensionContext) { }

    private getStorageKey(uri: vscode.Uri): string {
        // Lowercased fsPath, same rationale as StyleStorageService: avoid
        // case-sensitivity mismatches on Windows/macOS.
        return `${STORAGE_KEY_PREFIX}${uri.fsPath.toLowerCase()}`;
    }

    public getWidths(uri: vscode.Uri): Record<number, number[]> {
        return this.context.workspaceState.get<Record<number, number[]>>(this.getStorageKey(uri)) ?? {};
    }

    public async saveWidths(uri: vscode.Uri, widths: Record<number, number[]>): Promise<void> {
        await this.context.workspaceState.update(this.getStorageKey(uri), widths);
    }

    public async clearWidths(uri: vscode.Uri): Promise<void> {
        await this.context.workspaceState.update(this.getStorageKey(uri), undefined);
    }

    public async migrateUri(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
        const oldKey = this.getStorageKey(oldUri);
        const newKey = this.getStorageKey(newUri);
        if (oldKey === newKey) {
            return;
        }
        const value = this.context.workspaceState.get<Record<number, number[]>>(oldKey);
        if (value === undefined) {
            return;
        }
        await this.context.workspaceState.update(newKey, value);
        await this.context.workspaceState.update(oldKey, undefined);
    }
}
