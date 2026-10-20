// Characterization tests for the spreadsheet webview's edit / save / autosave / version-preview
// flows, written before moving that code out of spreadsheetWebview.ts.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness } from './harness.mts';
import { bootSpreadsheet, type SpreadsheetFixture } from './spreadsheetFixture.mts';
import type { HostToSpreadsheetWebview } from '../../protocol/spreadsheet.ts';

const VALUES = [['a1', 'b1'], ['a2', 'b2'], ['a3', 'b3']];

after(closeHarness);

async function editCell(sheet: SpreadsheetFixture, row: number, col: number, appended: string) {
    await sheet.page.dblclick(sheet.cell(row, col));
    await sheet.page.keyboard.press('End');
    await sheet.page.keyboard.type(appended);
    await sheet.page.keyboard.press('Enter');
}

const toastText = (sheet: SpreadsheetFixture) => sheet.page.locator('#saveToast .toast-text').textContent();

test('edit mode: Save posts the changed cell, and a successful result leaves edit mode', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await sheet.page.click('#toggleTableEditButton');
    await sheet.page.waitForSelector('td.editable-cell');
    await editCell(sheet, 1, 0, 'X');
    assert.equal(await sheet.page.locator(sheet.cell(1, 0)).textContent(), 'a2X');

    await sheet.page.click('#saveTableEditsButton');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.edits, [{ row: 2, col: 1, value: 'a2X' }]);
    assert.equal(save.isAutosave, false);
    assert.equal(save.sheetIndex, 0);
    assert.deepEqual(save.operations, []);

    await sheet.send({ command: 'saveResult', ok: true, isAutosave: false } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForFunction(() => document.querySelectorAll('td.editable-cell').length === 0);
    assert.equal(await toastText(sheet), 'Saved');
    await sheet.stop();
});

test('edit mode with autosave on: an edit autosaves and edit mode stays on', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, settings: { autoSave: true } });
    await sheet.page.click('#toggleTableEditButton');
    await sheet.page.waitForSelector('td.editable-cell');
    await editCell(sheet, 0, 1, '!');
    const save = await sheet.waitForPosted('saveXlsxEdits', 5000);
    assert.deepEqual(save.edits, [{ row: 1, col: 2, value: 'b1!' }]);
    assert.equal(save.isAutosave, true);

    await sheet.send({ command: 'saveResult', ok: true, isAutosave: true } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForTimeout(200);
    assert.ok(await sheet.page.locator('td.editable-cell').count() > 0, 'still in edit mode');
    await sheet.stop();
});

test('formatting a selected cell is saved as a style edit', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await sheet.page.click('#toggleTableEditButton');
    await sheet.page.waitForSelector('td.editable-cell');
    await sheet.page.click(sheet.cell(0, 0));
    await sheet.page.keyboard.press('Control+b');
    await sheet.page.click('#saveTableEditsButton');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.styleEdits, [{ row: 1, col: 1, fontWeight: 'bold' }]);
    assert.deepEqual(save.richEdits, [{ row: 1, col: 1, runs: [{ text: 'a1', bold: true, italic: false }] }]);
    assert.deepEqual(save.edits, []);
    await sheet.stop();
});

test('Cancel restores the original cell text and posts nothing', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await sheet.page.click('#toggleTableEditButton');
    await sheet.page.waitForSelector('td.editable-cell');
    await editCell(sheet, 2, 0, 'Z');
    await sheet.page.click('#cancelTableEditsButton');
    // Cancel leaves edit mode and re-renders the sheet from the cached rows.
    await sheet.page.waitForFunction(() => document.querySelector('td[data-row="2"][data-col="0"]')?.textContent === 'a3');
    assert.equal(await sheet.page.locator('td.editable-cell').count(), 0);
    assert.deepEqual(await sheet.postedOf('saveXlsxEdits'), []);
    await sheet.stop();
});

test('a failed save shows an error and stays in edit mode', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await sheet.page.click('#toggleTableEditButton');
    await sheet.page.waitForSelector('td.editable-cell');
    await editCell(sheet, 1, 1, '?');
    await sheet.page.click('#saveTableEditsButton');
    await sheet.waitForPosted('saveXlsxEdits');
    await sheet.send({ command: 'saveResult', ok: false, error: 'disk full', isAutosave: false } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForFunction(() => document.querySelector('#saveToast .toast-text')?.textContent === 'Error saving');
    assert.ok(await sheet.page.locator('td.editable-cell').count() > 0);
    await sheet.stop();
});

test('version preview: the banner offers Restore and Cancel, and Escape also cancels', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, initVirtualTable: { previewMode: true, versionId: 'v7', timestamp: 1 } });
    await sheet.page.waitForSelector('text=Restore');
    await sheet.page.click('button:has-text("Restore")');
    assert.deepEqual(await sheet.waitForPosted('restoreVersion'), { command: 'restoreVersion', versionId: 'v7' });

    await sheet.page.keyboard.press('Escape');
    await sheet.waitForPosted('cancelVersionPreview');

    // The host answers by re-sending the live table without previewMode.
    await sheet.send({ command: 'versionPreviewCancelledXlsx' } satisfies HostToSpreadsheetWebview);
    await sheet.reinit({ previewMode: false, versionId: null, timestamp: null });
    await sheet.page.waitForSelector('#versionPreviewBanner.hidden', { state: 'attached' });
    await sheet.stop();
});

test('header menu Sort A to Z reorders rows (requestAllRows + filterAndSortRows)', async () => {
    const sheet = await bootSpreadsheet({ values: [['pear', '1'], ['Apple', '2'], ['banana', '3']] });
    await sheet.page.click('th.col-header[data-col="0"]', { button: 'right' });
    await sheet.page.click('text=Sort A to Z');
    await sheet.page.waitForFunction(() => document.querySelector('td[data-row="0"][data-col="0"]')?.textContent === 'Apple');
    const column = await sheet.page.$$eval('td[data-col="0"]', tds => tds.map(td => td.textContent));
    assert.deepEqual(column, ['Apple', 'banana', 'pear']);
    await sheet.stop();
});
