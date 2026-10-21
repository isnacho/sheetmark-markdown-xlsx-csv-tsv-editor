// Characterization tests for interactive cell controls and the merge warning, written while moving
// that code out of spreadsheetWebview.ts (interactiveControls.ts, notices.ts).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness } from './harness.mts';
import { bootSpreadsheet, type SpreadsheetFixture } from './spreadsheetFixture.mts';

after(closeHarness);

async function enterEditMode(sheet: SpreadsheetFixture) {
    await sheet.page.click('#toggleTableEditButton');
    await sheet.page.waitForSelector('td.editable-cell');
}

test('Insert Control > Checkbox turns the selected cell into a checkbox, and Save sends the insertControl op', async () => {
    const sheet = await bootSpreadsheet({ values: [['a1', 'b1'], ['a2', 'b2']] });
    await enterEditMode(sheet);
    await sheet.page.click(sheet.cell(1, 1));
    await sheet.page.click('#insertControlButton');
    await sheet.page.click('.insert-control-item[data-control-type="checkbox"]');
    await sheet.page.waitForSelector(sheet.cell(1, 1) + ' input.xlsx-cell-checkbox');
    assert.equal(await sheet.page.locator(sheet.cell(1, 1)).getAttribute('data-cell-type'), 'checkbox');

    await sheet.page.click('#saveTableEditsButton');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.edits, [{ row: 2, col: 2, value: 'FALSE' }]);
    assert.deepEqual(save.operations, [{ type: 'insertControl', row: 2, col: 2, controlType: 'checkbox', defaultValue: 'FALSE' }]);
    assert.deepEqual(await sheet.problems(), []);
    await sheet.stop();
});

test('toggling a checkbox outside edit mode autosaves the new value', async () => {
    const sheet = await bootSpreadsheet({ values: [['a1', 'FALSE']], cellProps: { '0:1': { cellType: 'checkbox' } }, settings: { autoSave: true } });
    await sheet.page.click(sheet.cell(0, 1) + ' input.xlsx-cell-checkbox');
    const save = await sheet.waitForPosted('saveXlsxEdits', 5000);
    assert.deepEqual(save.edits, [{ row: 1, col: 2, value: 'TRUE' }]);
    assert.equal(save.isAutosave, true);
    await sheet.stop();
});

test('merging asks first; Cancel queues nothing and Merge queues a mergeRange op', async () => {
    const sheet = await bootSpreadsheet({ values: [['a1', 'b1'], ['a2', 'b2']] });
    await enterEditMode(sheet);
    await sheet.page.click(sheet.cell(0, 0));
    await sheet.page.click(sheet.cell(0, 1), { modifiers: ['Shift'] });

    await sheet.page.click('#mergeCellsButton');
    await sheet.page.waitForSelector('#xlsxMergeWarningPopup:not(.hidden)');
    await sheet.page.click('#mergeWarningCancel');
    await sheet.page.waitForSelector('#xlsxMergeWarningPopup.hidden', { state: 'attached' });

    await sheet.page.click('#mergeCellsButton');
    await sheet.page.click('#mergeWarningConfirm');
    await sheet.page.click('#saveTableEditsButton');
    const save = await sheet.waitForPosted('saveXlsxEdits');
    assert.deepEqual(save.operations.map((op: any) => op.type), ['mergeRange']);
    await sheet.stop();
});
