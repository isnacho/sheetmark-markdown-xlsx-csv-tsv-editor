// The spreadsheet webview's one editing surface: typing, save, autosave, undo, version preview. There is
// no Edit Table mode: every cell is editable, every change goes through the edit ledger, and the
// "bug:" tests pin the data-loss bugs the one-mode rewrite fixed.

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

const toastText = (sheet: SpreadsheetFixture) => sheet.page.locator('#toastNotification .toast-text').textContent();
const saveDisabled = (sheet: SpreadsheetFixture) => sheet.page.locator('#saveEditsButton').isDisabled();

test('Save posts the changed cell and stays disabled until there is something to save', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    assert.equal(await saveDisabled(sheet), true, 'nothing to save yet');
    await editCell(sheet, 1, 0, 'X');
    assert.equal(await sheet.page.locator(sheet.cell(1, 0)).textContent(), 'a2X');
    assert.equal(await saveDisabled(sheet), false);

    await sheet.page.click('#saveEditsButton');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.edits, [{ row: 2, col: 1, value: 'a2X' }]);
    assert.equal(save.isAutosave, false);
    assert.equal(save.sheetIndex, 0);
    assert.deepEqual(save.operations, []);

    await sheet.send({ command: 'saveResult', ok: true, isAutosave: false } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForFunction(() => (document.getElementById('saveEditsButton') as HTMLButtonElement).disabled);
    assert.equal(await toastText(sheet), 'Saved');
    assert.equal(await sheet.page.locator(sheet.cell(1, 0)).textContent(), 'a2X', 'the grid keeps the saved value');
    await sheet.stop();
});

test('typing on a selected cell edits it with no Edit Table step', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    assert.equal(await sheet.page.locator('#toggleTableEditButton').count(), 0, 'there is no Edit Table button');
    await sheet.page.click(sheet.cell(0, 0));
    await sheet.page.keyboard.type('new');
    await sheet.page.keyboard.press('Enter');
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).textContent(), 'new');
    await sheet.page.keyboard.press('Control+s');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.edits, [{ row: 1, col: 1, value: 'new' }]);
    await sheet.stop();
});

test('with autosave on an edit autosaves', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, settings: { autoSave: true } });
    await editCell(sheet, 0, 1, '!');
    const save = await sheet.waitForPosted('saveXlsxEdits', 5000);
    assert.deepEqual(save.edits, [{ row: 1, col: 2, value: 'b1!' }]);
    assert.equal(save.isAutosave, true);

    await sheet.send({ command: 'saveResult', ok: true, isAutosave: true } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForTimeout(200);
    assert.equal(await sheet.page.locator(sheet.cell(0, 1)).textContent(), 'b1!');
    await sheet.stop();
});

test('formatting a selected cell is saved as a style edit', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await sheet.page.click(sheet.cell(0, 0));
    await sheet.page.keyboard.press('Control+b');
    await sheet.page.click('#saveEditsButton');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.styleEdits, [{ row: 1, col: 1, fontWeight: 'bold' }]);
    assert.deepEqual(save.edits, []);
    await sheet.stop();
});

test('CSV has no formatting: Ctrl+B changes nothing', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, fileType: 'csv' });
    await sheet.page.click(sheet.cell(0, 0));
    await sheet.page.keyboard.press('Control+b');
    assert.equal(await saveDisabled(sheet), true);
    assert.equal(await sheet.page.locator('#formattingToolbar:visible').count(), 0);
    assert.equal(await sheet.page.locator('#insertControlButton:visible').count(), 0);
    await sheet.stop();
});

test('a failed save shows an error and keeps the edit pending', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await editCell(sheet, 1, 1, '?');
    await sheet.page.click('#saveEditsButton');
    await sheet.waitForPosted('saveXlsxEdits');
    await sheet.send({ command: 'saveResult', ok: false, error: 'disk full', isAutosave: false } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForFunction(() => document.querySelector('#toastNotification .toast-text')?.textContent === 'Error saving');
    assert.equal(await saveDisabled(sheet), false, 'Save can be tried again');
    assert.equal(await sheet.page.locator(sheet.cell(1, 1)).textContent(), 'b2?');
    await sheet.stop();
});

// --- The bugs the one-mode rewrite fixes (each fails without its fix) ---------------------------

test('bug: an edited cell scrolled out of view and back is still saved', async () => {
    const many = Array.from({ length: 400 }, (_, i) => [`r${i + 1}a`, `r${i + 1}b`]);
    const sheet = await bootSpreadsheet({ values: many });
    await sheet.page.waitForTimeout(600); // a big sheet keeps loading rows for a moment
    await sheet.page.click(sheet.cell(1, 0));
    await sheet.page.keyboard.press('F2');
    await sheet.page.keyboard.press('ArrowRight'); // collapses the selected text to its end
    await sheet.page.keyboard.type('X');
    await sheet.page.keyboard.press('Enter');
    assert.equal(await sheet.page.locator(sheet.cell(1, 0)).textContent(), 'r2aX');
    const scrollTo = (top: number) => sheet.page.evaluate((y) => {
        const scroller = (document.querySelector('#tableContainer .table-scroll') || document.getElementById('content')) as HTMLElement;
        scroller.scrollTop = y;
    }, top);
    await scrollTo(99999);
    await sheet.page.waitForFunction(() => !document.querySelector('td[data-row="1"][data-col="0"]') && !!document.querySelector('td[data-row="399"][data-col="0"]'));
    await sheet.page.waitForTimeout(600); // let the window of rows finish rendering before scrolling back
    await scrollTo(0);
    await sheet.page.waitForSelector(sheet.cell(1, 0), { state: 'attached' });
    assert.equal(await sheet.page.locator(sheet.cell(1, 0)).textContent(), 'r2aX');

    // Entering the cell again and leaving it without a change must not forget the edit either.
    await sheet.page.dblclick(sheet.cell(1, 0));
    await sheet.page.keyboard.press('Escape');

    await sheet.page.click('#saveEditsButton');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.edits, [{ row: 2, col: 1, value: 'r2aX' }]);
    await sheet.stop();
});

test('bug: a save result keeps the edits made while the save was in flight', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, settings: { autoSave: true } });
    await editCell(sheet, 0, 0, '1');
    const first = await sheet.waitForPosted('saveXlsxEdits', 5000);
    assert.deepEqual(first.edits, [{ row: 1, col: 1, value: 'a11' }]);

    await editCell(sheet, 2, 1, '2'); // made while the first autosave is still in flight
    await sheet.send({ command: 'saveResult', ok: true, isAutosave: true } satisfies HostToSpreadsheetWebview);

    await sheet.page.waitForTimeout(1800);
    const saves = await sheet.postedOf('saveXlsxEdits');
    assert.equal(saves.length, 2, 'the edit made during the first save is saved next');
    assert.deepEqual(saves[1].edits, [{ row: 3, col: 2, value: 'b32' }]);
    await sheet.stop();
});

test('bug: edits stay with their sheet when the user switches sheets before saving', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await sheet.reinit({ worksheets: [
        { name: 'One', index: 0, totalRows: 3, columnCount: 2, columnWidths: [120, 120], mergedCells: [], rowHeights: [21, 21, 21] },
        { name: 'Two', index: 1, totalRows: 3, columnCount: 2, columnWidths: [120, 120], mergedCells: [], rowHeights: [21, 21, 21] },
    ] });
    await editCell(sheet, 0, 0, 'A');
    await sheet.page.selectOption('#sheetSelector', '1');
    await sheet.page.waitForFunction(() => document.querySelector('td[data-row="0"][data-col="0"]')?.textContent === 'a1');
    await editCell(sheet, 1, 1, 'B');

    // Back on the first sheet the edit is still there (the rows came from the host again).
    await sheet.page.selectOption('#sheetSelector', '0');
    await sheet.page.waitForFunction(() => document.querySelector('td[data-row="0"][data-col="0"]')?.textContent === 'a1A');

    await sheet.page.click('#saveEditsButton');
    const first = await sheet.waitForPosted('saveXlsxEdits');
    assert.equal(first.sheetIndex, 0);
    assert.deepEqual(first.edits, [{ row: 1, col: 1, value: 'a1A' }]);

    await sheet.send({ command: 'saveResult', ok: true, isAutosave: false } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForTimeout(300);
    const saves = await sheet.postedOf('saveXlsxEdits');
    assert.equal(saves.length, 2, 'the other sheet is saved too');
    assert.equal(saves[1].sheetIndex, 1);
    assert.deepEqual(saves[1].edits, [{ row: 2, col: 2, value: 'b2B' }]);
    await sheet.stop();
});

test('bug: undo is saved, even after the edit it undoes was already saved', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, settings: { autoSave: true } });
    await editCell(sheet, 0, 0, 'Q');
    const first = await sheet.waitForPosted('saveXlsxEdits', 5000);
    assert.deepEqual(first.edits, [{ row: 1, col: 1, value: 'a1Q' }]);
    await sheet.send({ command: 'saveResult', ok: true, isAutosave: true } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForTimeout(100);

    await sheet.page.keyboard.press('Control+z');
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).textContent(), 'a1');
    await sheet.page.waitForTimeout(1600);
    const saves = await sheet.postedOf('saveXlsxEdits');
    assert.equal(saves.length, 2, 'the undo was autosaved');
    assert.deepEqual(saves[1].edits, [{ row: 1, col: 1, value: 'a1' }]);
    await sheet.stop();
});

test('bug: a value typed back to the original while its save is in flight is saved again', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, settings: { autoSave: true } });
    await editCell(sheet, 0, 0, 'Q');
    const first = await sheet.waitForPosted('saveXlsxEdits', 5000);
    assert.deepEqual(first.edits, [{ row: 1, col: 1, value: 'a1Q' }]);

    await sheet.page.keyboard.press('Control+z'); // back to a1 before the host answers
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).textContent(), 'a1');
    await sheet.send({ command: 'saveResult', ok: true, isAutosave: true } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForFunction(() => !(document.getElementById('saveEditsButton') as HTMLButtonElement).disabled);
    await sheet.page.waitForTimeout(1800);
    const saves = await sheet.postedOf('saveXlsxEdits');
    assert.equal(saves.length, 2, 'the file got a1Q, so a1 is sent next');
    assert.deepEqual(saves[1].edits, [{ row: 1, col: 1, value: 'a1' }]);
    await sheet.stop();
});

test('bug: Escape inside a cell cancels only that cell, never the other unsaved edits', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await editCell(sheet, 0, 0, 'kept');
    await sheet.page.dblclick(sheet.cell(2, 1));
    await sheet.page.keyboard.press('End');
    await sheet.page.keyboard.type('typed then cancelled');
    await sheet.page.keyboard.press('Escape');
    assert.equal(await sheet.page.locator(sheet.cell(2, 1)).textContent(), 'b3');
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).textContent(), 'a1kept');

    await sheet.page.click('#saveEditsButton');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.edits, [{ row: 1, col: 1, value: 'a1kept' }]);
    await sheet.stop();
});

test('a cell that is still being typed in is not saved by autosave until it is committed', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, settings: { autoSave: true } });
    await sheet.page.dblclick(sheet.cell(1, 0));
    await sheet.page.keyboard.press('End');
    await sheet.page.keyboard.type('half');
    await sheet.page.waitForTimeout(1500);
    assert.deepEqual(await sheet.postedOf('saveXlsxEdits'), []);
    await sheet.page.keyboard.press('Escape');
    await sheet.page.waitForTimeout(1500);
    assert.deepEqual(await sheet.postedOf('saveXlsxEdits'), []);
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

test('header menu: arrow keys move between its items, not the grid selection; Escape closes it', async () => {
    const sheet = await bootSpreadsheet({ values: [['a', '1'], ['b', '2'], ['c', '3']] });
    await sheet.page.click('th.col-header[data-col="0"]', { button: 'right' });
    await sheet.page.waitForSelector('#headerContextMenu:not(.hidden)');
    assert.equal(await sheet.page.locator('#headerContextMenu').getAttribute('role'), 'menu');
    const selection = () => sheet.page.evaluate(() => [...document.querySelectorAll('td.selected, td.active-cell')].map(td => `${td.getAttribute('data-row')}:${td.getAttribute('data-col')}`).join(','));
    const before = await selection();
    const items = await sheet.page.$$eval('#headerContextMenu .header-context-item', els => els.map(el => el.textContent?.trim()));
    const active = () => sheet.page.evaluate(() => document.activeElement?.textContent?.trim());

    await sheet.page.keyboard.press('ArrowDown');
    assert.equal(await active(), items[0]);
    await sheet.page.keyboard.press('ArrowDown');
    assert.equal(await active(), items[1]);
    assert.equal(await selection(), before, 'the grid selection did not move');

    await sheet.page.keyboard.press('Escape');
    await sheet.page.waitForSelector('#headerContextMenu.hidden', { state: 'attached' });
    await sheet.stop();
});

test('undo and redo a text edit (Ctrl+Z / Ctrl+Y), and Save sends the redone value', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await editCell(sheet, 0, 0, 'Q');
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).textContent(), 'a1Q');

    await sheet.page.keyboard.press('Control+z');
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).textContent(), 'a1');
    await sheet.page.keyboard.press('Control+y');
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).textContent(), 'a1Q');

    await sheet.page.click('#saveEditsButton');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.edits, [{ row: 1, col: 1, value: 'a1Q' }]);
    await sheet.stop();
});

test('undoing a style edit drops it from the save and keeps earlier ones', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await sheet.page.click(sheet.cell(1, 1));
    await sheet.page.keyboard.press('Control+b');
    await sheet.page.click(sheet.cell(0, 0));
    await sheet.page.keyboard.press('Control+b');
    await sheet.page.keyboard.press('Control+z');
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).evaluate(td => (td as HTMLElement).style.fontWeight), '');
    await sheet.page.click('#saveEditsButton');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.styleEdits, [{ row: 2, col: 2, fontWeight: 'bold' }]);
    await sheet.stop();
});

test('undo and redo an inserted row from the row header menu', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    const column = () => sheet.page.$$eval('td[data-col="0"]', tds => tds.map(td => td.textContent));
    await sheet.page.click('th.row-header[data-row="0"]', { button: 'right' });
    await sheet.page.click('text=Insert row below');
    await sheet.page.waitForFunction(() => document.querySelectorAll('td[data-col="0"]').length === 4);
    assert.deepEqual((await column()).map(t => t?.trim()), ['a1', '', 'a2', 'a3']);

    await sheet.page.click(sheet.cell(0, 1));
    await sheet.page.keyboard.press('Control+z');
    await sheet.page.waitForFunction(() => document.querySelectorAll('td[data-col="0"]').length === 3);
    assert.deepEqual(await column(), ['a1', 'a2', 'a3']);

    await sheet.page.click(sheet.cell(0, 1));
    await sheet.page.keyboard.press('Control+y');
    await sheet.page.waitForFunction(() => document.querySelectorAll('td[data-col="0"]').length === 4);
    await sheet.stop();
});

test('undoing a structure edit that was never saved leaves nothing to save', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await sheet.page.click('th.row-header[data-row="0"]', { button: 'right' });
    await sheet.page.click('text=Insert row below');
    await sheet.page.waitForFunction(() => document.querySelectorAll('td[data-col="0"]').length === 4);
    assert.equal(await saveDisabled(sheet), false);
    await sheet.page.click(sheet.cell(0, 1));
    await sheet.page.keyboard.press('Control+z');
    await sheet.page.waitForFunction(() => document.querySelectorAll('td[data-col="0"]').length === 3);
    assert.equal(await saveDisabled(sheet), true);
    await sheet.stop();
});

test('a structure edit that is already saved cannot be undone (Undo does nothing instead of lying)', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, settings: { autoSave: true } });
    await sheet.page.click('th.row-header[data-row="0"]', { button: 'right' });
    await sheet.page.click('text=Insert row below');
    await sheet.page.waitForFunction(() => document.querySelectorAll('td[data-col="0"]').length === 4);
    const save = await sheet.waitForPosted('saveXlsxEdits', 5000);
    assert.deepEqual(save.operations, [{ type: 'insertRowBelow', index: 1 }]);
    await sheet.send({ command: 'saveResult', ok: true, isAutosave: true } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForTimeout(150);

    await sheet.page.click(sheet.cell(0, 1));
    await sheet.page.keyboard.press('Control+z');
    await sheet.page.waitForTimeout(1500);
    assert.equal(await sheet.page.locator('td[data-col="0"]').count(), 4, 'the saved row is still there');
    assert.equal((await sheet.postedOf('saveXlsxEdits')).length, 1, 'nothing more was saved');
    await sheet.stop();
});

test('bug: after a structure edit is saved, Undo does not write an old value into a shifted cell', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => [`a${i + 1}`, `b${i + 1}`]);
    const sheet = await bootSpreadsheet({ values: rows, fileType: 'csv', settings: { autoSave: true } });
    await editCell(sheet, 4, 1, 'X'); // B5
    await sheet.page.click('th.row-header[data-row="2"]', { button: 'right' });
    await sheet.page.click('text=Insert row above');
    await sheet.page.waitForFunction(() => document.querySelectorAll('td[data-col="0"]').length === 7);
    const save = await sheet.waitForPosted('saveXlsxEdits', 5000);
    assert.deepEqual(save.operations, [{ type: 'insertRowAbove', index: 3 }]);
    assert.deepEqual(save.edits, [{ row: 6, col: 2, value: 'b5X' }], 'the edit moved down with the inserted row');
    await sheet.send({ command: 'saveResult', ok: true, isAutosave: true } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForTimeout(150);

    await sheet.page.click(sheet.cell(0, 0));
    await sheet.page.keyboard.press('Control+z');
    await sheet.page.keyboard.press('Control+y');
    await sheet.page.waitForTimeout(1600);
    assert.equal((await sheet.postedOf('saveXlsxEdits')).length, 1, 'neither Undo nor Redo wrote anything');
    assert.equal(await sheet.page.locator(sheet.cell(4, 1)).textContent(), 'b4', 'the cell that now sits at row 5 is untouched');
    assert.equal(await sheet.page.locator(sheet.cell(5, 1)).textContent(), 'b5X');
    await sheet.stop();
});

test('hovering a hyperlink cell shows the link tooltip, and Open posts openExternal', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, cellProps: { '0:1': { hyperlink: 'https://example.com/a' } } });
    await sheet.page.hover(sheet.cell(0, 1));
    await sheet.page.waitForSelector('#linkTooltip:not(.hidden)');
    assert.equal(await sheet.page.locator('#linkTooltipUrl').textContent(), 'https://example.com/a');
    await sheet.page.click('#linkTooltipOpen');
    assert.deepEqual(await sheet.waitForPosted('openExternal'), { command: 'openExternal', url: 'https://example.com/a' });
    await sheet.page.waitForSelector('#linkTooltip.hidden', { state: 'attached' });
    await sheet.stop();
});
