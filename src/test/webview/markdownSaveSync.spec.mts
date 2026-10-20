// Characterization tests for the Markdown webview's save / disk-sync / version-preview flows,
// written before moving that code out of mdWebview.ts. They pin current behavior: messages posted
// to the host, toasts and dialogs shown, editor content after each decision.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness, openWebview, type WebviewHarness } from './harness.mts';
import type { HostToMarkdownWebview, MarkdownSettings } from '../../protocol/markdown.ts';

const SETTINGS: MarkdownSettings = {
    stickyToolbar: true, wordWrap: true, showOutline: true, showLineNumbers: true, livePreviewReveal: true,
    livePreviewLineNumbers: false, autoSave: false, isDefaultEditor: false, showStats: true, statsShowLines: true,
    statsShowWords: true, statsShowChars: true, statsShowReadingTime: true, showCursorPosition: true,
    diffReviewEnabled: false, diffLayout: 'inline',
};

function payload(content: string) {
    return {
        content, fileName: 'test.md', documentUri: 'file:///tmp/test.md', documentDirUri: 'file:///tmp',
        workspaceFolderUri: null, tableColumnWidths: {}, frontmatterPanelCollapsed: false,
        mermaidPreviewMode: 'diagram' as const, calloutDefaultType: 'info',
    };
}

/** Boot like the host does on webviewReady: initMarkdown, then initSettings. */
async function boot(content: string, settings: Partial<MarkdownSettings> = {}): Promise<WebviewHarness> {
    const webview = await openWebview('markdown');
    await webview.waitForPosted('webviewReady');
    await webview.send({ command: 'initMarkdown', ...payload(content) } satisfies HostToMarkdownWebview);
    await webview.send({ command: 'initSettings', settings: { ...SETTINGS, ...settings } } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('.cm-content');
    return webview;
}

async function typeAtEndOfFirstLine(webview: WebviewHarness, text: string) {
    await webview.page.click('.cm-line');
    await webview.page.keyboard.press('End');
    await webview.page.keyboard.type(text);
}

const editorText = async (webview: WebviewHarness) => (await webview.page.locator('.cm-content').textContent()) ?? '';
const toastText = (webview: WebviewHarness) => webview.page.locator('#toastNotification.show .toast-text').innerText();
const clickToastAction = (webview: WebviewHarness, label: string) => webview.page.click(`#toastNotification .toast-action:has-text("${label}")`);
const confirmDialog = (webview: WebviewHarness) => webview.page.click('.feedback-modal .reload-confirm-ok');

after(closeHarness);

test('Ctrl+S posts the edited text, and a successful saveResult clears the dirty state', async () => {
    const webview = await boot('hello\n');
    await typeAtEndOfFirstLine(webview, ' world');
    await webview.page.keyboard.press('Control+s');
    const save = await webview.waitForPosted('saveMarkdown');
    assert.deepEqual(save, { command: 'saveMarkdown', text: 'hello world\n', force: false, isAutosave: false });

    await webview.send({ command: 'saveResult', ok: true, isAutosave: false } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('#saveEditsButton:disabled');
    assert.equal(await toastText(webview), 'Saved');
    await webview.close();
});

test('autosave posts an autosave after an edit when enabled', async () => {
    const webview = await boot('hello\n', { autoSave: true });
    await typeAtEndOfFirstLine(webview, '!');
    const save = await webview.waitForPosted('saveMarkdown', 5000);
    assert.equal(save.isAutosave, true);
    assert.equal(save.text, 'hello!\n');
    await webview.close();
});

test('an external change to a clean editor asks first; Load disk changes applies without a confirm', async () => {
    // Per .docs/flow.md the toast always comes first in edit mode; only unsaved edits add a confirm.
    const webview = await boot('one\n');
    await webview.send({ command: 'diskChangedExternally', ...payload('two\n') } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('#toastNotification.show');
    assert.match(await toastText(webview), /^File changed on disk/);
    assert.equal(await editorText(webview), 'one');
    await clickToastAction(webview, 'Load disk changes');
    await webview.page.waitForFunction(() => document.querySelector('.cm-content')?.textContent === 'two');
    assert.equal(await webview.page.locator('.feedback-modal').count(), 0);
    assert.match(await toastText(webview), /^Reloaded from disk/);
    await webview.close();
});

test('an external change to a dirty editor asks; Load disk changes then Discard replaces local edits', async () => {
    const webview = await boot('one\n');
    await typeAtEndOfFirstLine(webview, ' local');
    await webview.send({ command: 'diskChangedExternally', ...payload('two\n') } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('#toastNotification.show');
    assert.match(await toastText(webview), /^File changed on disk/);
    assert.equal(await editorText(webview), 'one local');

    await clickToastAction(webview, 'Load disk changes');
    await confirmDialog(webview);
    await webview.page.waitForFunction(() => document.querySelector('.cm-content')?.textContent === 'two');
    assert.deepEqual(await webview.postedOf('saveMarkdown'), []);
    await webview.close();
});

test('Keep local version writes the local text with force', async () => {
    const webview = await boot('one\n');
    await typeAtEndOfFirstLine(webview, ' local');
    await webview.send({ command: 'diskChangedExternally', ...payload('two\n') } satisfies HostToMarkdownWebview);
    await clickToastAction(webview, 'Keep local version');
    await confirmDialog(webview);
    const save = await webview.waitForPosted('saveMarkdown');
    assert.deepEqual(save, { command: 'saveMarkdown', text: 'one local\n', force: true, isAutosave: false });
    await webview.close();
});

test('with diff review on, an external change opens a diff instead of the decision toast', async () => {
    const webview = await boot('one\n', { diffReviewEnabled: true });
    await typeAtEndOfFirstLine(webview, ' local');
    await webview.send({ command: 'diskChangedExternally', ...payload('two\n') } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('.cm-deletedChunk, .cm-changedLine, .cm-insertedLine', { timeout: 5000 });
    assert.equal(await editorText(webview).then(t => t.includes('two')), true);
    await webview.close();
});

test('a save conflict on a manual save asks, then re-sends with force', async () => {
    const webview = await boot('hello\n');
    await typeAtEndOfFirstLine(webview, ' there');
    await webview.page.keyboard.press('Control+s');
    await webview.waitForPosted('saveMarkdown');
    await webview.send({ command: 'saveConflict' } satisfies HostToMarkdownWebview);
    await confirmDialog(webview);
    await webview.page.waitForFunction(() => (window as any).__posted.filter((m: any) => m.command === 'saveMarkdown').length === 2);
    const [, retry] = await webview.postedOf('saveMarkdown');
    assert.deepEqual(retry, { command: 'saveMarkdown', text: 'hello there\n', force: true, isAutosave: false });
    await webview.close();
});

test('version preview: Restore asks the host, and a restore conflict re-sends with force after confirming', async () => {
    const webview = await boot('current\n');
    await webview.send({ command: 'initMarkdown', ...payload('old version\n') } satisfies HostToMarkdownWebview);
    await webview.send({ command: 'versionPreviewMd', versionId: 'v1', timestamp: 1 } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('#versionPreviewBanner:not(.hidden)');
    await webview.page.click('#restoreVersionButton');
    assert.deepEqual(await webview.waitForPosted('restoreVersion'), { command: 'restoreVersion' });

    await webview.send({ command: 'restoreConflict', versionId: 'v1' } satisfies HostToMarkdownWebview);
    await confirmDialog(webview);
    await webview.page.waitForFunction(() => (window as any).__posted.filter((m: any) => m.command === 'restoreVersion').length === 2);
    const [, forced] = await webview.postedOf('restoreVersion');
    assert.deepEqual(forced, { command: 'restoreVersion', versionId: 'v1', force: true });

    await webview.send({ command: 'versionRestoredMd', versionId: 'v1', timestamp: 1 } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('#versionPreviewBanner.hidden', { state: 'attached' });
    await webview.close();
});

test('a load error before the first document shows Retry, which asks again', async () => {
    const webview = await openWebview('markdown');
    await webview.waitForPosted('webviewReady');
    await webview.send({ command: 'reloadFromDiskError', message: 'EACCES: permission denied' } satisfies HostToMarkdownWebview);
    await webview.page.click('#loadingIndicator button:has-text("Retry")');
    await webview.page.waitForFunction(() => (window as any).__posted.filter((m: any) => m.command === 'webviewReady').length === 2);
    await webview.close();
});
