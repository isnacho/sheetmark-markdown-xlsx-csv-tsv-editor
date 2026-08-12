import * as vscode from 'vscode';

const STORAGE_KEY = 'xlsxViewer.mermaidPreviewMode';

export type MermaidPreviewMode = 'diagram' | 'code';

export class MermaidPreviewModeStorageService {
    constructor(private readonly context: vscode.ExtensionContext) { }

    public getMode(): MermaidPreviewMode {
        const stored = this.context.globalState.get<MermaidPreviewMode>(STORAGE_KEY);
        return stored === 'code' ? 'code' : 'diagram';
    }

    public async saveMode(mode: MermaidPreviewMode): Promise<void> {
        await this.context.globalState.update(STORAGE_KEY, mode === 'code' ? 'code' : 'diagram');
    }
}
