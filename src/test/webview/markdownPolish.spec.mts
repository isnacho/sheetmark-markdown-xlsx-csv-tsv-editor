// Markdown editor polish fixes from the 2026-11-12 UI review (.docs/product/UI-REVIEW-2026-11-12.md),
// each pinned in headless Chrome with the real bundle, HTML shell and CSP.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness, openWebview, type WebviewHarness } from './harness.mts';
import type { HostToMarkdownWebview, MarkdownSettings } from '../../protocol/markdown.ts';

const SETTINGS: MarkdownSettings = {
    stickyToolbar: true, wordWrap: true, showOutline: true, showLineNumbers: true, livePreviewReveal: true,
    livePreviewLineNumbers: false, autoSave: false, isDefaultEditor: false, showStats: true, statsShowLines: true,
    statsShowWords: true, statsShowChars: true, statsShowReadingTime: true, showCursorPosition: true,
    diffReviewEnabled: false, diffLayout: 'inline',
};

let webview: WebviewHarness;

before(async () => {
    webview = await openWebview('markdown');
    await webview.page.setViewportSize({ width: 1000, height: 800 });
    await webview.waitForPosted('webviewReady');
    await webview.send({ command: 'initSettings', settings: SETTINGS } satisfies HostToMarkdownWebview);
});
after(closeHarness);

async function openDoc(content: string): Promise<void> {
    await webview.send({
        command: 'initMarkdown', content, fileName: 'test.md', documentUri: 'file:///tmp/test.md',
        documentDirUri: 'file:///tmp', workspaceFolderUri: null, tableColumnWidths: {},
        frontmatterPanelCollapsed: false, detailsOpenState: {}, mermaidPreviewMode: 'diagram', calloutDefaultType: 'info',
    } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('.cm-content .cm-line', { timeout: 10000 });
    await webview.page.waitForTimeout(200);
}

// @@F01
test('headings far down a long document get their heading style without any edit', async () => {
    // Long enough that CodeMirror cannot parse it all when the editor opens; the rest is parsed in
    // the background, which is not a text change.
    const section = (i: number) => `## Section ${i}\n\n${'Filler text for a long document. '.repeat(6)}\n\n- item\n- item\n`;
    await openDoc(Array.from({ length: 1500 }, (_, i) => section(i)).join('\n') + '\n## Final heading\n\nlast line\n');
    await webview.page.evaluate(() => { const s = document.querySelector('.cm-scroller')!; s.scrollTop = s.scrollHeight; });
    const styled = await webview.page.waitForFunction(() => {
        document.querySelector('.cm-scroller')!.scrollTop = 1e9;
        const heading = [...document.querySelectorAll('.cm-content > .cm-line')].find(l => l.textContent?.includes('Final heading'));
        return heading?.classList.contains('cm-md-heading-line') ?? false;
    }, undefined, { timeout: 8000, polling: 200 }).then(() => true, () => false);
    assert.ok(styled, 'the last heading never got the cm-md-heading-line class');
});
