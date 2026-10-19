// Handles that let the integration tests (src/test/integration) drive an open editor the way its
// webview would: post a message to the host and wait until it is handled. Product code never reads
// these; they exist so host behavior (saves, history, links, CSP) is tested in a real VS Code.

import type * as vscode from 'vscode';

export interface OpenEditorHandle {
    readonly panel: vscode.WebviewPanel;
    /** Current file URI (changes when the file is moved). */
    uri(): vscode.Uri;
    /** Deliver `message` as if the webview posted it; resolves once the host handled it. */
    dispatch(message: unknown): Promise<void>;
}

/** Registers `handle` in `registry` until the panel is disposed. */
export function trackOpenEditor(registry: Set<OpenEditorHandle>, handle: OpenEditorHandle): void {
    registry.add(handle);
    handle.panel.onDidDispose(() => registry.delete(handle));
}
