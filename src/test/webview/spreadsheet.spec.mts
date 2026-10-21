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
