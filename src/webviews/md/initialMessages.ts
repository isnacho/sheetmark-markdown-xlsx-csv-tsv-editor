// First paint without a host round trip. The host embeds its first messages (initMarkdown,
// initSettings, font) in the page as a JSON data block (`renderMarkdownHtml` in
// src/shared/webviewHtml.ts); the bootstrap delivers them through the normal message listeners,
// then tells the host it did so in `webviewReady`.

import type { HostToMarkdownWebview } from '../../protocol/markdown';

// Must match INITIAL_MESSAGES_ELEMENT_ID / BOOT_STYLE_ELEMENT_ID in src/shared/webviewHtml.ts
// (webviews cannot import host code). The webview tests fail if they drift.
const INITIAL_MESSAGES_ELEMENT_ID = 'sheetmarkInitialMessages';
const BOOT_STYLE_ELEMENT_ID = 'sheetmarkBootStyle';

/** Messages embedded in the page, oldest first; [] when there are none or the block is malformed. */
export function readInitialMessages(doc: Document): HostToMarkdownWebview[] {
    const element = doc.getElementById(INITIAL_MESSAGES_ELEMENT_ID);
    if (!element) { return []; }
    const text = element.textContent ?? '';
    // The document text can be large: don't keep a second copy in the DOM.
    element.remove();
    try {
        const parsed: unknown = JSON.parse(text);
        if (!Array.isArray(parsed)) { return []; }
        return parsed.filter((m): m is HostToMarkdownWebview =>
            !!m && typeof m === 'object' && typeof (m as { command?: unknown }).command === 'string');
    } catch {
        return [];
    }
}

/**
 * Show the page (hidden by the shell's boot style until the bundle runs, so VS Code never shows
 * it before its stylesheets apply), then apply the embedded messages. Returns whether any were
 * applied. Reveal comes first: focus can't move into a `visibility: hidden` page.
 */
export function revealAndApplyInitialMessages(doc: Document, deliver: (message: HostToMarkdownWebview) => void): boolean {
    doc.getElementById(BOOT_STYLE_ELEMENT_ID)?.remove();
    const messages = readInitialMessages(doc);
    for (const message of messages) {
        deliver(message);
    }
    return messages.length > 0;
}
