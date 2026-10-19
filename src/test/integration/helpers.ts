// Shared setup for integration tests: activate the extension, open files in Sheetmark editors, and
// drive the host the way a webview would (OpenEditorHandle.dispatch).

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SheetmarkTestApi } from '../../extension';
import type { OpenEditorHandle } from '../../shared/editorTestHooks';

export async function sheetmark(): Promise<SheetmarkTestApi> {
    const extension = vscode.extensions.getExtension('iggyinc.sheetmark');
    if (!extension) { throw new Error('Sheetmark extension not found'); }
    return (await extension.activate()) as SheetmarkTestApi;
}

/** A fresh temp directory with `files` written into it. */
export function fixtureDir(files: Record<string, string | Buffer>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheetmark-it-'));
    for (const [name, content] of Object.entries(files)) {
        const target = path.join(dir, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return dir;
}

export async function waitFor<T>(what: string, probe: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 15000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await probe();
        if (value) { return value; }
        if (Date.now() > deadline) { throw new Error(`Timed out waiting for ${what}`); }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

/** Open `filePath` in the given Sheetmark viewType and return its host handle. */
export async function openInSheetmark(api: SheetmarkTestApi, filePath: string, viewType: string): Promise<OpenEditorHandle> {
    const uri = vscode.Uri.file(filePath);
    await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
    return waitFor(`${viewType} editor for ${path.basename(filePath)}`, () =>
        api.openEditors().find(editor => editor.uri().fsPath === uri.fsPath));
}

export async function closeAllEditors(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/** Replace `obj[key]` for the duration of a test; returns a restore function. */
export function stub<T extends object, K extends keyof T>(obj: T, key: K, replacement: T[K]): () => void {
    const original = obj[key];
    (obj as any)[key] = replacement;
    return () => { (obj as any)[key] = original; };
}

/** The Content-Security-Policy meta content of a webview's HTML. */
export function cspOf(html: string): string {
    const match = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
    if (!match) { throw new Error('No CSP meta tag in webview HTML'); }
    return match[1];
}
