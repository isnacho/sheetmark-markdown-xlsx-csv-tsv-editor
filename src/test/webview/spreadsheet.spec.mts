// Spreadsheet webview in headless Chrome: hostile cells, multi-line paste, listener leaks.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness, openWebview, type WebviewHarness } from './harness.mts';
import type { HostToSpreadsheetWebview, SpreadsheetSettings } from '../../protocol/spreadsheet.ts';

const SETTINGS: SpreadsheetSettings = {
    firstRowIsHeader: false, stickyToolbar: true, stickyHeader: true, autoSave: true, autoSaveMode: 'all',
    showManualSavePopup: false, allowInteractiveControlsOutsideEditMode: true, hyperlinkPreview: true,
    spaciousCells: false, mergeWarningEnabled: true, isDefaultEditor: false, textWrap: false,
};

const VALUES = [
    ['a1', 'b1'],
    ['<img src=x onerror="window.__pwned = true">', '<b>bold</b>'],
    ['a3', 'b3'],
];
const ROWS = VALUES.map((values, r) => ({
    rowNumber: r + 1,
    height: 21,
    cells: values.map((value, c) => ({ rowNumber: r + 1, colNumber: c + 1, value, style: {} })),
}));

// Counts document-level mousemove listeners, to catch listeners re-added on every re-render.
const COUNT_LISTENERS = `
(() => {
    window.__mousemoveListeners = 0;
    const add = Document.prototype.addEventListener;
    Document.prototype.addEventListener = function (type, ...rest) {
        if (type === 'mousemove') { window.__mousemoveListeners++; }
        return add.call(this, type, ...rest);
    };
})();
`;

let webview: WebviewHarness;
let rowsServer: ReturnType<typeof setInterval>;

async function initTable() {
    // Tag the current table so we can wait for the re-rendered one, not match the old DOM.
    await webview.page.evaluate(() => document.querySelectorAll('table').forEach(t => t.setAttribute('data-stale', '')));
    await webview.send({
        command: 'initVirtualTable',
        worksheets: [{ name: 'Sheet1', index: 0, totalRows: ROWS.length, columnCount: 2, columnWidths: [120, 120], mergedCells: [], rowHeights: ROWS.map(() => 21) }],
        rowHeaderWidth: 40, fileType: 'csv', isPlainView: false, previewMode: false, versionId: null, timestamp: null,
    } satisfies HostToSpreadsheetWebview);
    await webview.page.waitForSelector('table:not([data-stale]) td[data-row="2"][data-col="1"]', { timeout: 10000 });
}

before(async () => {
    webview = await openWebview('spreadsheet', { extraInitScript: COUNT_LISTENERS });
    await webview.waitForPosted('webviewReady');
    // Act as the host's getRows handler.
    let answered = 0;
    rowsServer = setInterval(async () => {
        try {
            const requests = (await webview.posted()).filter(m => m.command === 'getRows');
            for (const request of requests.slice(answered)) {
                answered++;
                await webview.send({ command: 'rowsData', requestId: request.requestId, start: request.start, end: request.end, rows: ROWS.slice(request.start, request.end) } satisfies HostToSpreadsheetWebview);
            }
        } catch { /* page closing */ }
    }, 25);
    await webview.send({ command: 'initSettings', settings: SETTINGS, plainSettings: SETTINGS, styledSettings: SETTINGS, settingsScope: 'styled' } satisfies HostToSpreadsheetWebview);
    await initTable();
});
after(async () => {
    clearInterval(rowsServer);
    await closeHarness();
});

test('hostile cell values render inert and rich text keeps formatting', async () => {
    await webview.page.waitForTimeout(300);
    assert.equal(await webview.page.evaluate(() => (window as any).__pwned), undefined);
    assert.equal(await webview.page.locator('td img[onerror]').count(), 0);
    assert.equal(await webview.page.locator('td[data-row="1"][data-col="1"] b').textContent(), 'bold');
    // Chrome 156+ reports a script-src-attr violation as soon as the sanitizer parses the hostile
    // <img onerror> in its inert <template> (DOMParser does the same). Nothing runs (checked above),
    // so only that report is ignored here.
    assert.deepEqual((await webview.problems()).filter(p => !p.includes('img-src') && p !== 'CSP blocked script-src-attr: inline'), []);
});

test('pasting a quoted multi-line cell writes it to one cell', async () => {
    await webview.page.click('td[data-row="2"][data-col="0"]');
    await webview.page.evaluate(() => {
        const data = new DataTransfer();
        data.setData('text/plain', '"line1\nline2"\tright\n');
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    const save = await webview.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.edits, [{ row: 3, col: 1, value: 'line1\nline2' }, { row: 3, col: 2, value: 'right' }]);
});

test('re-rendering the sheet does not stack document mousemove listeners', async () => {
    const before = await webview.page.evaluate(() => (window as any).__mousemoveListeners as number);
    await initTable();
    await initTable();
    const after = await webview.page.evaluate(() => (window as any).__mousemoveListeners as number);
    assert.equal(after, before);
});

async function openFontPicker() {
    if ((await webview.page.locator('#settingsPanel').getAttribute('aria-hidden')) !== 'false') {
        await webview.page.click('#openSettingsButton');
    }
    await webview.page.click('#fontSelect');
    await webview.page.waitForSelector('#fontSelectSearch', { state: 'visible' });
}
const fontOptions = () => webview.page.locator('#fontSelectList [role=option]').evaluateAll(options => options.map(o => o.textContent));
const activeFontOption = () => webview.page.evaluate(() => document.getElementById(document.getElementById('fontSelectSearch')!.getAttribute('aria-activedescendant') ?? '')?.textContent ?? null);
const fontButtonText = () => webview.page.locator('#fontSelect').innerText();
const rootFont = () => webview.page.evaluate(() => ({ data: document.documentElement.dataset.font, inline: document.documentElement.style.getPropertyValue('--font-family') }));
const cellFont = () => webview.page.locator('td[data-row="1"][data-col="1"]').evaluate(el => getComputedStyle(el).fontFamily);

// The hostile-cell test above makes Chrome report blocked inline handlers on purpose; only anything else counts.
const newProblems = async () => (await webview.problems()).filter(p => !p.includes('img-src') && p !== 'CSP blocked script-src-attr: inline');

test('the Font picker applies a font at once, saves it, and follows the host', async () => {
    // The earlier toolbar test leaves the toolbar as it found it; open the Settings panel from a visible gear.
    await webview.page.waitForSelector('#openSettingsButton', { state: 'visible' });
    await webview.send({ command: 'fontFamilyChanged', font: 'inter' } satisfies HostToSpreadsheetWebview);
    await webview.page.waitForFunction(() => document.documentElement.dataset.font === 'inter');

    // The row shows the font in use; the list opens from it with the three built-in fonts.
    assert.equal(await fontButtonText(), 'Inter');
    await openFontPicker();
    assert.equal(await webview.page.evaluate(() => document.activeElement?.id), 'fontSelectSearch');
    assert.equal(await webview.page.locator('#fontSelect').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await fontOptions(), ['Inter', 'System', 'Serif']);
    assert.equal(await activeFontOption(), 'Inter');

    // Choosing a font applies it, saves it and folds the list away.
    await webview.page.click('#fontSelectList [role=option]:has-text("Serif")');
    assert.equal((await rootFont()).data, 'serif');
    assert.match(await cellFont(), /Iowan|Georgia|serif/);
    assert.deepEqual((await webview.postedOf('setFontFamily')).at(-1), { command: 'setFontFamily', font: 'serif' });
    assert.equal(await webview.page.locator('#fontSelectPanel').isVisible(), false);
    assert.equal(await webview.page.locator('#settingsPanel').getAttribute('aria-hidden'), 'false', 'choosing a font closed the Settings panel');
    assert.equal(await fontButtonText(), 'Serif');

    // The host pushes the setting (another editor changed it, or Settings JSON was edited).
    await webview.send({ command: 'fontFamilyChanged', font: 'system' } satisfies HostToSpreadsheetWebview);
    await webview.page.waitForFunction(() => document.getElementById('fontSelect')!.textContent!.trim() === 'System');
    assert.equal((await rootFont()).data, 'system');

    // A value that cannot be a font name falls back to Inter instead of leaving a broken font.
    await webview.send({ command: 'fontFamilyChanged', font: '<b>' } satisfies HostToSpreadsheetWebview);
    await webview.page.waitForFunction(() => document.documentElement.dataset.font === 'inter');
    assert.equal(await fontButtonText(), 'Inter');
    assert.deepEqual(await newProblems(), []);
    await webview.page.click('#settingsCancelButton');
});

test('the Font picker searches the installed fonts, by mouse and keyboard', async () => {
    // The earlier toolbar test leaves the toolbar as it found it; open the Settings panel from a visible gear.
    await webview.page.waitForSelector('#openSettingsButton', { state: 'visible' });
    assert.ok((await webview.postedOf('requestLocalFonts')).length >= 1, 'the picker never asked the host for the installed fonts');
    // A hostile name in the list is dropped, not shown.
    await webview.send({ command: 'localFonts', fonts: ['Georgia', 'Helvetica', 'Helvetica Neue', 'Menlo', 'Bad";x'] } satisfies HostToSpreadsheetWebview);
    await openFontPicker();
    assert.deepEqual(await fontOptions(), ['Inter', 'System', 'Serif', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Menlo']);
    assert.deepEqual(await webview.page.locator('#fontSelectList .font-picker__group-label').allInnerTexts(), ['BUILT IN', 'INSTALLED ON THIS COMPUTER']);

    // Typing narrows the list, best match first and highlighted; every word has to match.
    await webview.page.keyboard.type('hel');
    assert.deepEqual(await fontOptions(), ['Helvetica', 'Helvetica Neue']);
    assert.equal(await activeFontOption(), 'Helvetica');
    await webview.page.keyboard.press('ArrowDown');
    assert.equal(await activeFontOption(), 'Helvetica Neue');
    await webview.page.keyboard.press('ArrowDown');
    assert.equal(await activeFontOption(), 'Helvetica Neue', 'the highlight ran past the end of the list');
    await webview.page.keyboard.press('ArrowUp');
    assert.equal(await activeFontOption(), 'Helvetica');
    await webview.page.keyboard.type(' neue');
    assert.deepEqual(await fontOptions(), ['Helvetica Neue']);

    // Enter chooses the highlighted font; it is saved and used with the system font behind it.
    await webview.page.keyboard.press('Enter');
    assert.deepEqual(await rootFont(), { data: 'custom', inline: '"Helvetica Neue", system-ui, -apple-system, sans-serif' });
    assert.match(await cellFont(), /^"Helvetica Neue", system-ui/);
    assert.deepEqual((await webview.postedOf('setFontFamily')).at(-1), { command: 'setFontFamily', font: 'Helvetica Neue' });
    assert.equal(await fontButtonText(), 'Helvetica Neue');
    assert.equal(await webview.page.evaluate(() => document.activeElement?.id), 'fontSelect', 'focus did not return to the Font button');

    // Reopened, the list starts unfiltered with the font in use highlighted. No match shows a message.
    await openFontPicker();
    assert.equal((await fontOptions()).length, 7);
    assert.equal(await activeFontOption(), 'Helvetica Neue');
    await webview.page.keyboard.type('zzzz');
    assert.deepEqual(await fontOptions(), []);
    assert.equal(await webview.page.locator('#fontSelectEmpty').isVisible(), true);
    await webview.page.keyboard.press('Enter');
    assert.equal(await webview.page.locator('#fontSelectPanel').isVisible(), true, 'Enter with no match should do nothing');

    // The first Escape folds the list away; only the second closes the Settings panel.
    await webview.page.keyboard.press('Escape');
    assert.equal(await webview.page.locator('#fontSelectPanel').isVisible(), false);
    assert.equal(await webview.page.locator('#settingsPanel').getAttribute('aria-hidden'), 'false');
    await webview.page.keyboard.press('Escape');
    assert.equal(await webview.page.locator('#settingsPanel').getAttribute('aria-hidden'), 'true');

    // Clicking outside the list folds it away without choosing anything.
    await openFontPicker();
    await webview.page.click('#settingsPanelTitle');
    assert.equal(await webview.page.locator('#fontSelectPanel').isVisible(), false);
    assert.equal(await fontButtonText(), 'Helvetica Neue');

    // Back to the default, for the tests after this one.
    await webview.send({ command: 'fontFamilyChanged', font: 'inter' } satisfies HostToSpreadsheetWebview);
    await webview.page.waitForFunction(() => document.documentElement.dataset.font === 'inter');
    await webview.page.click('#settingsCancelButton');
    assert.deepEqual(await newProblems(), []);
});
