// Keyboard and focus behaviour of the Markdown webview's menus and dialogs (popupFocus.ts):
// focus moves in on open, arrows move between menu items, Escape closes, Tab stays inside a
// modal dialog, and focus goes back where it was. Real bundle, HTML shell and CSP in headless Chrome.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness, openWebview, type WebviewHarness } from './harness.mts';
import type { HostToMarkdownWebview, MarkdownSettings } from '../../protocol/markdown.ts';

const SETTINGS: MarkdownSettings = {
    stickyToolbar: true, wordWrap: true, showOutline: false, showLineNumbers: true, livePreviewReveal: true,
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
        outlinePinned: false,
    } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('.cm-content .cm-line', { timeout: 10000 });
}

/** Text, id and class of the focused element, enough to tell which control has focus. */
const focused = () => webview.page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
        id: el?.id ?? '',
        text: el?.textContent?.trim() ?? '',
        role: el?.getAttribute('role') ?? '',
        inEditor: !!el?.closest('.cm-editor'),
    };
});

test('table menu: opens with focus, arrows move between items, Escape closes and returns focus', async () => {
    await openDoc('Before.\n\n| H1 | H2 |\n| --- | --- |\n| c1 | c2 |\n\nAfter.\n');
    await webview.page.waitForSelector('.cm-md-table-widget tbody td', { timeout: 5000 });
    const cell = webview.page.locator('.cm-md-table-widget tbody td', { hasText: 'c1' }).first();
    await cell.click();
    await cell.click({ button: 'right' });
    await webview.page.waitForSelector('.cm-md-table-context-menu:not(.hidden)', { timeout: 2000 });

    const menu = webview.page.locator('.cm-md-table-context-menu');
    assert.equal(await menu.getAttribute('role'), 'menu');
    assert.equal((await focused()).role, 'menu');

    const enabled = await webview.page.$$eval('.cm-md-table-context-item:not(:disabled)', els => els.map(el => el.textContent?.trim()));
    await webview.page.keyboard.press('ArrowDown');
    assert.deepEqual(await focused().then(f => [f.role, f.text]), ['menuitem', enabled[0]]);
    await webview.page.keyboard.press('ArrowUp');
    assert.equal((await focused()).text, enabled[enabled.length - 1], 'ArrowUp from the first item wraps to the last');
    await webview.page.keyboard.press('Home');
    assert.equal((await focused()).text, enabled[0]);

    await webview.page.keyboard.press('Escape');
    await webview.page.waitForSelector('.cm-md-table-context-menu.hidden', { state: 'attached' });
    assert.equal((await focused()).inEditor, true, 'focus goes back to the editor');
});

test('settings panel: keyboard open moves focus in; Escape closes it, returns focus to the gear, and keeps edits', async () => {
    await openDoc('Hello.\n');
    await webview.page.click('.cm-line');
    await webview.page.keyboard.press('End');
    await webview.page.keyboard.type(' Edited');
    const gear = webview.page.locator('#openSettingsButton');
    assert.equal(await gear.getAttribute('aria-expanded'), 'false');
    assert.equal(await gear.getAttribute('aria-controls'), 'settingsPanel');

    await gear.focus();
    await webview.page.keyboard.press('Enter');
    await webview.page.waitForSelector('#settingsPanel:not(.hidden)');
    assert.equal(await gear.getAttribute('aria-expanded'), 'true');
    assert.equal((await focused()).id, 'settingsPanel');

    await webview.page.keyboard.press('Tab');
    assert.equal(await webview.page.evaluate(() => !!document.activeElement?.closest('#settingsPanel')), true, 'Tab reaches the first control in the panel');

    await webview.page.keyboard.press('Escape');
    await webview.page.waitForSelector('#settingsPanel.hidden', { state: 'attached' });
    assert.equal(await gear.getAttribute('aria-expanded'), 'false');
    assert.equal((await focused()).id, 'openSettingsButton');
    // The page-wide Escape (cancel the edit) must not also run for a key the panel handled.
    assert.equal(await webview.page.locator('.cm-content').textContent(), 'Hello. Edited');
});

test('feedback dialog: is a labelled modal, keeps Tab inside, and Escape closes it', async () => {
    await openDoc('Hello.\n');
    await webview.page.click('#helpButton');
    const dialog = webview.page.locator('.feedback-modal:has(#feedbackForm)');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await dialog.getAttribute('role'), 'dialog');
    assert.equal(await dialog.getAttribute('aria-modal'), 'true');
    assert.equal(await dialog.getAttribute('aria-labelledby'), 'feedbackTitle');
    assert.equal(await webview.page.evaluate(() => document.activeElement?.classList.contains('feedback-modal')), true);

    await webview.page.keyboard.press('Shift+Tab');
    assert.equal((await focused()).id, 'feedbackSubmitBtn', 'Shift+Tab from the dialog wraps to its last control');
    await webview.page.keyboard.press('Tab');
    assert.equal(await webview.page.evaluate(() => document.activeElement?.classList.contains('feedback-close')), true, 'Tab from the last control wraps to the first');

    // Labels name their fields.
    assert.equal(await webview.page.getByLabel('Please describe your issue or suggestion *').count(), 1);
    assert.equal(await webview.page.getByLabel('Okay if I follow up?').count(), 1);

    await webview.page.keyboard.press('Escape');
    await webview.page.waitForSelector('.feedback-modal.hidden:has(#feedbackForm)', { state: 'attached' });
    assert.equal((await focused()).id, 'helpButton', 'focus goes back to the button that opened it');
    assert.deepEqual(await webview.problems(), []);
});

test('Escape in the editor keeps unsaved edits (it used to revert to the saved text, with no undo)', async () => {
    await openDoc('Hello.\n');
    await webview.page.click('.cm-line');
    await webview.page.keyboard.press('End');
    await webview.page.keyboard.type(' Kept');
    await webview.page.keyboard.press('Escape');
    assert.equal(await webview.page.locator('.cm-content').textContent(), 'Hello. Kept');
    assert.equal((await focused()).inEditor, true);
});

test('Escape in the Settings panel closes only the panel, not the find bar behind it', async () => {
    await openDoc('Hello.\n');
    await webview.page.click('.cm-line');
    await webview.page.keyboard.press('Control+f');
    await webview.page.waitForSelector('#searchOverlay.active');
    await webview.page.click('#openSettingsButton');
    await webview.page.waitForSelector('#settingsPanel:not(.hidden)');
    await webview.page.keyboard.press('Escape');
    await webview.page.waitForSelector('#settingsPanel.hidden', { state: 'attached' });
    assert.equal(await webview.page.locator('#searchOverlay.active').count(), 1);
    await webview.page.keyboard.press('Escape');
});
