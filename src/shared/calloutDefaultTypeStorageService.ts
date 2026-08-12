import * as vscode from 'vscode';

const STORAGE_KEY = 'xlsxViewer.calloutDefaultType';
const FALLBACK = 'info';

export class CalloutDefaultTypeStorageService {
    constructor(private readonly context: vscode.ExtensionContext) { }

    public getType(): string {
        const stored = this.context.globalState.get<string>(STORAGE_KEY);
        if (stored === undefined || stored === null || stored === '') {
            return FALLBACK;
        }
        if (!/^[\w-]*$/.test(stored)) {
            return FALLBACK;
        }
        return stored.toLowerCase();
    }

    public async saveType(type: string): Promise<void> {
        const slug = type.trim().toLowerCase();
        if (!/^[\w-]*$/.test(slug)) {
            return;
        }
        await this.context.globalState.update(STORAGE_KEY, slug);
    }
}
