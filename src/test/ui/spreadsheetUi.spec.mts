// Drives the real Sheetmark spreadsheet editor inside a real VS Code window: types into cells,
// saves, and asserts the file bytes; writes light and dark screenshots to .vscode-test/ui-shots/.
// Run with `npm run test:ui` (needs a display; not part of `npm run verify`). Open the PNGs after a
// visual change: the assertions do not see layout or colour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { DARK, LIGHT, MOD, cell, withEditor, type Editor } from './harness.mts';

async function buildXlsx(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['Name', 'Qty', 'Notes']);
    sheet.addRow(['Apple', 3, 'fresh']);
    sheet.addRow(['Pear', 5, 'ripe']);
    sheet.getCell('A1').font = { bold: true };
    sheet.getCell('B2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

const CSV = 'Name,Qty,Notes\nApple,3,fresh\nPear,5,ripe\n';
const TSV = 'Name\tQty\tNotes\nApple\t3\tfresh\nPear\t5\tripe\n';

/** Click a cell, type a replacement value and commit it with Enter. */
async function typeInto(editor: Editor, row: number, col: number, text: string): Promise<void> {
    await cell(editor, row, col).click();
    await editor.page.keyboard.type(text);
    await editor.page.keyboard.press('Enter');
    await editor.page.waitForTimeout(400);
}

test('xlsx: typing into a cell and saving writes the value into the file', { timeout: 120000 }, async () => {
    await withEditor({ content: await buildXlsx(), ext: 'xlsx' }, LIGHT, async editor => {
        await typeInto(editor, 1, 2, 'edited');
        await editor.page.keyboard.press(`${MOD}+s`);
        await editor.page.waitForTimeout(1500);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(editor.bytes() as unknown as ArrayBuffer);
        assert.equal(workbook.getWorksheet('Sheet1')!.getCell('C2').value, 'edited');
        assert.equal(workbook.getWorksheet('Sheet1')!.getCell('A2').value, 'Apple');
    });
});

for (const [ext, source] of [['csv', CSV], ['tsv', TSV]] as const) {
    test(`${ext}: typing into a cell and saving writes the value into the file`, { timeout: 120000 }, async () => {
        await withEditor({ content: source, ext }, LIGHT, async editor => {
            await typeInto(editor, 2, 0, 'Plum');
            await editor.page.keyboard.press(`${MOD}+s`);
            await editor.page.waitForTimeout(1500);
            const sep = ext === 'csv' ? ',' : '\t';
            assert.match(editor.raw(), new RegExp(`^Plum${sep}5${sep}ripe$`, 'm'));
            assert.match(editor.raw(), new RegExp(`^Apple${sep}3${sep}fresh$`, 'm'));
        });
    });
}

for (const [name, theme] of [['light', LIGHT], ['dark', DARK]] as const) {
    test(`spreadsheet screenshots (${name} theme)`, { timeout: 120000 }, async () => {
        await withEditor({ content: await buildXlsx(), ext: 'xlsx' }, theme, async editor => {
            await cell(editor, 1, 1).click();
            await editor.shot(`spreadsheet-xlsx-${name}`);
        });
        await withEditor({ content: CSV, ext: 'csv' }, theme, async editor => {
            await cell(editor, 1, 1).click();
            await editor.shot(`spreadsheet-csv-${name}`);
        });
    });
}
