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
    /** Messages the host posted to this webview, oldest first (recorded in test mode only). */
    sent(): readonly unknown[];
}

/**
 * Wraps a provider's typed `post` so test runs can read back what the webview was sent. Outside
 * test mode it returns `post` unchanged and records nothing. `noteEmbedded` records messages the
 * host delivers inside the page's HTML instead (Markdown's first messages), so tests see what the
 * webview received whichever way it travelled.
 */
export function recordSentInTests<M>(isTestMode: boolean, post: (message: M) => Thenable<boolean>): {
    post: (message: M) => Thenable<boolean>;
    noteEmbedded: (messages: readonly M[]) => void;
    sent: () => readonly M[];
} {
    if (!isTestMode) { return { post, noteEmbedded: () => { /* not recorded */ }, sent: () => [] }; }
    const log: M[] = [];
    return {
        post: (message) => { log.push(message); return post(message); },
        noteEmbedded: (messages) => { log.push(...messages); },
        sent: () => log,
    };
}

/** Registers `handle` in `registry` until the panel is disposed. */
export function trackOpenEditor(registry: Set<OpenEditorHandle>, handle: OpenEditorHandle): void {
    registry.add(handle);
    handle.panel.onDidDispose(() => registry.delete(handle));
}
