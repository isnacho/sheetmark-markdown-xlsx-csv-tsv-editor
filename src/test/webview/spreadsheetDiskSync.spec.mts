// What the spreadsheet does when its file changes on disk (diskSync.ts): a persistent toast instead of a
// silent reload, confirms before anything is thrown away or written over, and autosave that pauses.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness } from './harness.mts';
import { bootSpreadsheet, type SpreadsheetFixture } from './spreadsheetFixture.mts';
import type { HostToSpreadsheetWebview } from '../../protocol/spreadsheet.ts';

const VALUES = [['a1', 'b1'], ['a2', 'b2']];

after(closeHarness);

async function editCell(sheet: SpreadsheetFixture, row: number, col: number, appended: string) {
    await sheet.page.dblclick(sheet.cell(row, col));
    await sheet.page.keyboard.press('End');
    await sheet.page.keyboard.type(appended);
    await sheet.page.keyboard.press('Enter');
}

const toast = (sheet: SpreadsheetFixture) => sheet.page.locator('#toastNotification.show .toast-text');
const toastAction = (sheet: SpreadsheetFixture, label: string) => sheet.page.locator(`#toastNotification.show .toast-action:has-text("${label}")`);
const dialogTitle = (sheet: SpreadsheetFixture) => sheet.page.locator('.feedback-modal.active h2');
const diskChanged = (sheet: SpreadsheetFixture) => sheet.send({ command: 'diskChangedExternally' } satisfies HostToSpreadsheetWebview);

test('a clean sheet: the toast offers only Load disk changes, which reloads at once', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await diskChanged(sheet);
    await sheet.page.waitForSelector('#toastNotification.show');
    assert.equal(await toast(sheet).textContent(), 'File changed on disk');
    assert.equal(await toastAction(sheet, 'Load disk changes').count(), 1);
    assert.equal(await toastAction(sheet, 'Keep my edits').count(), 0, 'nothing to keep');
    assert.equal(await sheet.page.locator('#toastNotification .toast-close:visible').count(), 0, 'no close button');

    await toastAction(sheet, 'Load disk changes').click();
    await sheet.waitForPosted('requestFreshData');
    assert.equal(await sheet.page.locator('.feedback-modal.active').count(), 0, 'no confirm without unsaved edits');
    await sheet.reinit({ reason: 'reload' });
    await sheet.page.waitForFunction(() => document.querySelector('#toastNotification .toast-text')?.textContent === 'Reloaded from disk');
    await sheet.stop();
});

test('nothing is reloaded silently: a host message alone changes no cell', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await editCell(sheet, 0, 0, 'mine');
    await diskChanged(sheet);
    await sheet.page.waitForSelector('#toastNotification.show');
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).textContent(), 'a1mine');
    assert.deepEqual(await sheet.postedOf('requestFreshData'), []);
    await sheet.stop();
});

test('with unsaved edits, Load disk changes asks to discard them first', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await editCell(sheet, 0, 0, 'mine');
    await diskChanged(sheet);
    assert.equal(await toastAction(sheet, 'Keep my edits').count(), 1);
    await toastAction(sheet, 'Load disk changes').click();
    await sheet.page.waitForSelector('.feedback-modal.active');
    assert.equal(await dialogTitle(sheet).textContent(), 'Reload from Disk');
    await sheet.page.click('.reload-confirm-cancel');
    assert.deepEqual(await sheet.postedOf('requestFreshData'), [], 'Cancel keeps everything');
    assert.equal(await sheet.page.locator('#saveEditsButton').isDisabled(), false, 'the edit is still unsaved');

    await toastAction(sheet, 'Load disk changes').click();
    await sheet.page.waitForSelector('.feedback-modal.active');
    await sheet.page.click('.reload-confirm-ok');
    await sheet.waitForPosted('requestFreshData');
    await sheet.reinit({ reason: 'reload' });
    await sheet.page.waitForFunction(() => (document.getElementById('saveEditsButton') as HTMLButtonElement).disabled);
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).textContent(), 'a1', 'the loaded file replaces the edit');
    await sheet.stop();
});

test('the toast starts offering Keep my edits when an edit is made after it appeared', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await diskChanged(sheet);
    assert.equal(await toastAction(sheet, 'Keep my edits').count(), 0);
    await editCell(sheet, 1, 1, '!');
    await sheet.page.waitForSelector('#toastNotification.show .toast-action:has-text("Keep my edits")');
    await sheet.stop();
});

test('Keep my edits asks, then saves into the changed file with force', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await editCell(sheet, 0, 1, 'K');
    await diskChanged(sheet);
    await toastAction(sheet, 'Keep my edits').click();
    await sheet.page.waitForSelector('.feedback-modal.active');
    assert.equal(await dialogTitle(sheet).textContent(), 'Save your edits into the changed file?');
    assert.match(await sheet.page.locator('.feedback-modal.active p').textContent() ?? '', /Cells you edited get your values; other changes on disk are kept\./);
    await sheet.page.click('.reload-confirm-ok');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.equal(save.force, true);
    assert.deepEqual(save.edits, [{ row: 1, col: 2, value: 'b1K' }]);
    await sheet.stop();
});

test('a manual save over a changed file asks, then sends the same save again with force', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await editCell(sheet, 1, 0, 'S');
    await sheet.page.click('#saveEditsButton');
    const first = await sheet.waitForPosted('saveXlsxEdits');
    assert.equal(first.force, undefined);

    await sheet.send({ command: 'saveConflict' } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForSelector('.feedback-modal.active');
    assert.equal(await dialogTitle(sheet).textContent(), 'Save your edits into the changed file?');
    assert.equal(await sheet.page.locator('#saveEditsButton').isDisabled(), false, 'the refused save left the edit pending');
    await sheet.page.click('.reload-confirm-ok');
    await sheet.page.waitForFunction(() => true);
    await sheet.page.waitForTimeout(300);
    const saves = await sheet.postedOf('saveXlsxEdits');
    assert.equal(saves.length, 2);
    assert.equal(saves[1].force, true);
    assert.deepEqual(saves[1].edits, [{ row: 2, col: 1, value: 'a2S' }]);
    await sheet.stop();
});

test('declining the conflict dialog saves nothing and keeps the toast', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await editCell(sheet, 1, 0, 'S');
    await sheet.page.click('#saveEditsButton');
    await sheet.waitForPosted('saveXlsxEdits');
    await sheet.send({ command: 'saveConflict' } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForSelector('.feedback-modal.active');
    await sheet.page.click('.reload-confirm-cancel');
    await sheet.page.waitForSelector('#toastNotification.show');
    assert.equal(await toast(sheet).textContent(), 'File changed on disk');
    assert.equal((await sheet.postedOf('saveXlsxEdits')).length, 1);
    await sheet.stop();
});

test('autosave never shows a dialog on a conflict: it shows the toast and pauses', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, settings: { autoSave: true } });
    await editCell(sheet, 0, 0, '1');
    await sheet.waitForPosted('saveXlsxEdits', 5000);
    await sheet.send({ command: 'saveConflict' } satisfies HostToSpreadsheetWebview);
    await sheet.page.waitForSelector('#toastNotification.show');
    assert.equal(await toast(sheet).textContent(), 'File changed on disk');
    assert.equal(await sheet.page.locator('.feedback-modal.active').count(), 0, 'no dialog');

    await editCell(sheet, 1, 1, '2');
    await sheet.page.waitForTimeout(1800);
    assert.equal((await sheet.postedOf('saveXlsxEdits')).length, 1, 'autosave waits for the user');
    await sheet.stop();
});

test('Restore from a version preview asks first when there are unsaved edits', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    await editCell(sheet, 0, 0, 'x');
    await sheet.reinit({ previewMode: true, versionId: 'v1', timestamp: 1, reason: 'preview' });
    await sheet.page.click('#restoreVersionButton');
    await sheet.page.waitForSelector('.feedback-modal.active');
    assert.equal(await dialogTitle(sheet).textContent(), 'Restore Version');
    assert.deepEqual(await sheet.postedOf('restoreVersion'), []);
    await sheet.page.click('.reload-confirm-ok');
    await sheet.waitForPosted('restoreVersion');
    await sheet.stop();
});
