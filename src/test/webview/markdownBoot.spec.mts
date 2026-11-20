// Markdown webview boot: the document embedded in the page renders without a host reply, and the
// page stays hidden until its stylesheets have applied (no flash of unstyled buttons and icons).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness, openWebview } from './harness.mts';
import type { HostToMarkdownWebview, MarkdownSettings } from '../../protocol/markdown.ts';

const SETTINGS: MarkdownSettings = {
    stickyToolbar: true, wordWrap: true, showOutline: true, showLineNumbers: true, livePreviewReveal: true,
    livePreviewLineNumbers: false, autoSave: false, isDefaultEditor: false, showStats: true, statsShowLines: true,
    statsShowWords: true, statsShowChars: true, statsShowReadingTime: true, showCursorPosition: true,
    diffReviewEnabled: false, diffLayout: 'inline',
};

function initialMessages(content: string): HostToMarkdownWebview[] {
    return [
        {
            command: 'initMarkdown', content, fileName: 'boot.md', documentUri: 'file:///tmp/boot.md',
            documentDirUri: 'file:///tmp', workspaceFolderUri: null, tableColumnWidths: {},
            frontmatterPanelCollapsed: false, detailsOpenState: {}, mermaidPreviewMode: 'diagram', calloutDefaultType: 'info', outlinePinned: false,
        },
        { command: 'initSettings', settings: SETTINGS },
        { command: 'fontFamilyChanged', font: 'inter' },
    ];
}

after(closeHarness);

test('a document embedded in the page renders before any host message, and webviewReady says so', async () => {
    // Content that would close the data block if the host did not escape it.
    const content = '# Embedded heading\n\nText with </script><img src=x onerror="window.__pwned=1"> inside.\n';
    const webview = await openWebview('markdown', { initialMessages: initialMessages(content) });
    try {
        const ready = await webview.waitForPosted('webviewReady');
        assert.equal(ready.appliedInitialMessages, true);
        // Nothing was sent to the page, yet the editor holds the document.
        const text = await webview.page.locator('.cm-content').textContent();
        assert.match(text ?? '', /Embedded heading/);
        assert.match(text ?? '', /<\/script><img src=x/, 'the escaped content round-trips as text');
        assert.equal(await webview.page.evaluate(() => (window as any).__pwned), undefined);
        assert.equal(await webview.page.evaluate(() => document.getElementById('sheetmarkInitialMessages')), null, 'data block removed after reading');
        assert.deepEqual(await webview.problems(), []);
    } finally {
        await webview.close();
    }
});

test('without embedded messages the webview asks the host as before', async () => {
    const webview = await openWebview('markdown');
    try {
        const ready = await webview.waitForPosted('webviewReady');
        assert.equal(ready.appliedInitialMessages, false);
        assert.equal(await webview.page.evaluate(() => getComputedStyle(document.body).visibility), 'visible');
    } finally {
        await webview.close();
    }
});

test('the page stays hidden while its stylesheet loads, then shows', async () => {
    let releaseCss!: () => void;
    const cssHeld = new Promise<void>(resolve => { releaseCss = resolve; });
    const webview = await openWebview('markdown', {
        waitUntil: 'commit',
        initialMessages: initialMessages('# Styled\n'),
        beforeGoto: async (page) => {
            await page.route('**/resources/md/mdWebview.css', async (route) => {
                await cssHeld;
                await route.continue();
            });
        },
    });
    try {
        await webview.page.waitForFunction(() => !!document.getElementById('toolbar'));
        // Longer than VS Code's reveal timeout: the body must still be hidden.
        await webview.page.waitForTimeout(400);
        assert.equal(await webview.page.evaluate(() => getComputedStyle(document.body).visibility), 'hidden');
        releaseCss();
        await webview.waitForPosted('webviewReady');
        assert.equal(await webview.page.evaluate(() => getComputedStyle(document.body).visibility), 'visible');
    } finally {
        releaseCss();
        await webview.close();
    }
});
