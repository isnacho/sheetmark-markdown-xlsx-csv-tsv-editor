// Markdown webview in headless Chrome: boot, lazy mermaid chunk, sanitizing and CSP in a real browser.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { closeHarness, openWebview, type WebviewHarness } from './harness.mts';
import type { HostToMarkdownWebview, MarkdownSettings } from '../../protocol/markdown.ts';

const SETTINGS: MarkdownSettings = {
    stickyToolbar: true, wordWrap: true, showOutline: true, showLineNumbers: true, livePreviewReveal: true,
    livePreviewLineNumbers: false, autoSave: false, isDefaultEditor: false, showStats: true, statsShowLines: true,
    statsShowWords: true, statsShowChars: true, statsShowReadingTime: true, showCursorPosition: true,
    diffReviewEnabled: false, diffLayout: 'inline',
};

function markdownDocument(content: string): HostToMarkdownWebview {
    return {
        command: 'initMarkdown', content, fileName: 'test.md', documentUri: 'file:///tmp/test.md',
        documentDirUri: 'file:///tmp', workspaceFolderUri: null, tableColumnWidths: {},
        frontmatterPanelCollapsed: false, mermaidPreviewMode: 'diagram', calloutDefaultType: 'info',
    };
}

let webview: WebviewHarness;

before(async () => {
    webview = await openWebview('markdown');
    await webview.waitForPosted('webviewReady');
    await webview.send({ command: 'initSettings', settings: SETTINGS } satisfies HostToMarkdownWebview);
});
after(closeHarness);

test('mermaid is not in the initial bundle', () => {
    // Eager mermaid made this file about 10 MB (dev build); lazy-loaded it is under 2 MB.
    const size = statSync('dist/md/mdWebview.js').size;
    assert.ok(size < 3_000_000, `dist/md/mdWebview.js is ${(size / 1e6).toFixed(1)} MB; did mermaid get imported statically?`);
});

test('renders a document and loads the mermaid chunk on demand', async () => {
    await webview.send(markdownDocument('# Title\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nafter\n'));
    await webview.page.waitForSelector('.cm-md-mermaid-diagram svg', { timeout: 15000 });
    assert.deepEqual(await webview.problems(), []);
});

test('hostile HTML in a table cell does not run', async () => {
    await webview.send(markdownDocument('| a |\n| - |\n| <img src=x onerror="window.__pwned = true"> |\n\nplain\n'));
    await webview.page.waitForSelector('.cm-md-table-scroll table', { timeout: 10000 });
    await webview.page.waitForTimeout(300);
    assert.equal(await webview.page.evaluate(() => (window as any).__pwned), undefined);
    assert.equal(await webview.page.locator('.cm-md-table-scroll img[onerror]').count(), 0);
});

test('the CSP blocks inline handlers even if markup gets past sanitizing', async () => {
    await webview.page.evaluate(() => {
        const img = document.createElement('img');
        img.setAttribute('onerror', 'window.__pwnedByCsp = true');
        img.src = 'data:image/png;base64,broken';
        document.body.appendChild(img);
    });
    await webview.page.waitForTimeout(300);
    assert.equal(await webview.page.evaluate(() => (window as any).__pwnedByCsp), undefined);
    assert.ok((await webview.problems()).some(p => p.includes('script-src')), 'expected a CSP script-src violation');
});
