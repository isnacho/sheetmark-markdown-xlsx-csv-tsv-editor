// Links inside inactive Markdown table cells: a left click opens the link instead of editing the
// cell, and a right click does not start editing.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness, openWebview, type WebviewHarness } from './harness.mts';
import type { HostToMarkdownWebview, MarkdownSettings } from '../../protocol/markdown.ts';

const SETTINGS: MarkdownSettings = {
    stickyToolbar: true, wordWrap: true, showOutline: true, showLineNumbers: true, livePreviewReveal: true,
    livePreviewLineNumbers: false, autoSave: false, isDefaultEditor: false, showStats: true, statsShowLines: true,
    statsShowWords: true, statsShowChars: true, statsShowReadingTime: true, showCursorPosition: true,
    diffReviewEnabled: false, diffLayout: 'inline',
};

const DOC = [
    '# Top',
    '',
    '| name | link |',
    '| - | - |',
    '| web | [site](https://example.com/a) |',
    '| file | [notes](other.md) |',
    '',
    'after',
    '',
].join('\n');

let webview: WebviewHarness;

before(async () => {
    webview = await openWebview('markdown');
    await webview.waitForPosted('webviewReady');
    await webview.send({ command: 'initSettings', settings: SETTINGS } satisfies HostToMarkdownWebview);
});
after(closeHarness);

beforeEach(async () => {
    await webview.send({
        command: 'initMarkdown', content: DOC, fileName: 'test.md', documentUri: 'file:///tmp/test.md',
        documentDirUri: 'file:///tmp', workspaceFolderUri: null, tableColumnWidths: {},
        frontmatterPanelCollapsed: false, mermaidPreviewMode: 'diagram', calloutDefaultType: 'info',
    } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('.cm-md-table-scroll table.md-table a[href="other.md"]');
});

const editingCells = () => webview.page.locator('.cm-md-table-cell-editing').count();
const pageUrl = () => webview.page.evaluate(() => location.href);

test('clicking a web link in an inactive cell opens it once and does not edit the cell', async () => {
    const before = await pageUrl();
    await webview.page.click('table.md-table a[href="https://example.com/a"]');
    const opened = await webview.waitForPosted('openExternal');
    assert.equal(opened.url, 'https://example.com/a');
    await webview.page.waitForTimeout(200);
    assert.equal((await webview.postedOf('openExternal')).length, 1, 'opened once');
    assert.equal(await pageUrl(), before, 'the webview did not navigate');
    assert.equal(await editingCells(), 0);
    assert.deepEqual(await webview.problems(), []);
});

test('clicking a relative link asks the host to open the file', async () => {
    await webview.page.click('table.md-table a[href="other.md"]');
    const opened = await webview.waitForPosted('openRelativeFile');
    assert.equal(opened.href, 'other.md');
    assert.equal(await editingCells(), 0);
});

test('clicking cell text that is not a link still edits the cell', async () => {
    await webview.page.click('table.md-table td:has-text("web")');
    await webview.page.waitForSelector('.cm-md-table-cell-editing');
});

test('a right click on a cell opens the table menu without starting to edit any cell', async () => {
    await webview.page.click('table.md-table td:has-text("file")', { button: 'right' });
    await webview.page.waitForSelector('.cm-md-table-context-item');
    await webview.page.waitForTimeout(200);
    // Before the fix the browser moved the selection into the widget and the header cell started editing.
    assert.equal(await editingCells(), 0);
    await webview.page.keyboard.press('Escape');
});
