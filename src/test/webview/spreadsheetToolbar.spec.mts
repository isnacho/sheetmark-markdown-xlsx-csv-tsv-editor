// The spreadsheet toolbar's two rows: file actions on top, formatting under it (XLSX only).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness } from './harness.mts';
import { bootSpreadsheet } from './spreadsheetFixture.mts';

const VALUES = [['a1', 'b1'], ['a2', 'b2']];

after(closeHarness);

test('XLSX: the formatting row sits under the main toolbar, outside it, and ends with Insert', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    const layout = await sheet.page.evaluate(() => {
        const main = document.getElementById('toolbar')!;
        const row = document.getElementById('formattingToolbar')!;
        const mainRect = main.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const buttons = [...row.querySelectorAll('button')].map(b => b.id);
        return {
            inside: main.contains(row),
            sibling: row.parentElement === main.parentElement,
            rowTop: Math.round(rowRect.top),
            mainBottom: Math.round(mainRect.bottom),
            hidden: row.classList.contains('hidden'),
            lastButton: buttons[buttons.length - 1],
            hasFont: !!row.querySelector('#editFontFamily'),
            headerHeight: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height'), 10),
            mainHeight: Math.round(mainRect.height),
        };
    });
    assert.equal(layout.inside, false, 'the row is not part of the main toolbar');
    assert.equal(layout.sibling, true);
    assert.equal(layout.hidden, false);
    assert.ok(Math.abs(layout.rowTop - layout.mainBottom) <= 2, `row 2 starts under row 1 (${layout.rowTop} vs ${layout.mainBottom})`);
    assert.equal(layout.lastButton, 'insertControlButton');
    assert.equal(layout.hasFont, true);
    assert.ok(layout.headerHeight > layout.mainHeight, 'the sticky header height counts both rows');
    await sheet.stop();
});

test('CSV and TSV have no second row', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES, fileType: 'tsv' });
    assert.equal(await sheet.page.locator('#formattingToolbar:visible').count(), 0);
    await sheet.stop();
});

test('Save, Undo and Redo are enabled only when there is something to do', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    const enabled = () => sheet.page.evaluate(() => ['saveEditsButton', 'undoEditsButton', 'redoEditsButton', 'refreshButton'].map(id => !(document.getElementById(id) as HTMLButtonElement).disabled));
    assert.deepEqual(await enabled(), [false, false, false, true]);

    await sheet.page.dblclick(sheet.cell(0, 0));
    await sheet.page.keyboard.press('End');
    await sheet.page.keyboard.type('x');
    await sheet.page.keyboard.press('Enter');
    assert.deepEqual(await enabled(), [true, true, false, true]);

    await sheet.page.click('#undoEditsButton');
    assert.deepEqual(await enabled(), [false, false, true, true]);
    await sheet.page.click('#redoEditsButton');
    assert.equal(await sheet.page.locator(sheet.cell(0, 0)).textContent(), 'a1x');

    await sheet.page.click('#saveEditsButton');
    await sheet.waitForPosted('saveXlsxEdits');
    assert.equal(await sheet.page.locator('#saveEditsButton').isDisabled(), true, 'Save waits while the save runs');
    assert.equal(await sheet.page.locator('#refreshButton').isDisabled(), true, 'Reload waits while the save runs');
    await sheet.stop();
});

test('there are no mode buttons', async () => {
    const sheet = await bootSpreadsheet({ values: VALUES });
    for (const id of ['toggleTableEditButton', 'cancelTableEditsButton', 'togglePlainViewButton']) {
        assert.equal(await sheet.page.locator('#' + id).count(), 0, id);
    }
    await sheet.stop();
});
