import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { applyStoredMetadataToWorksheet, applyStoredStylesToWorksheet, applyStyleEditToCell, normalizeStoredStyle, parseStyleKey, toARGB } from './excelStyle.ts';

function sheet() {
    return new ExcelJS.Workbook().addWorksheet('Sheet1');
}

test('applyStoredStylesToWorksheet applies CSS-form styles as saved by StyleStorageService', () => {
    // CSV/TSV styles are persisted already normalized (fontSize "11pt", whiteSpace "pre-wrap").
    const ws = sheet();
    applyStoredStylesToWorksheet(ws, {
        '1:1': normalizeStoredStyle({ fontSize: 14, wrapMode: 'wrap', bold: true, textColor: '#FF0000', bgColor: '#00FF00' }),
    });
    const cell = ws.getRow(1).getCell(1);
    assert.equal(cell.font.size, 14);
    assert.equal(cell.font.bold, true);
    assert.equal(cell.font.color?.argb, 'FFFF0000');
    assert.equal(cell.alignment.wrapText, true);
    assert.equal((cell.fill as ExcelJS.FillPattern).fgColor?.argb, 'FF00FF00');
});

test('applyStoredStylesToWorksheet also accepts the raw webview style format', () => {
    const ws = sheet();
    applyStoredStylesToWorksheet(ws, { '2:3': { italic: true, horizontalAlign: 'center', border: { top: true, style: 'medium', color: '#000000' } } });
    const cell = ws.getRow(2).getCell(3);
    assert.equal(cell.font.italic, true);
    assert.equal(cell.alignment.horizontal, 'center');
    assert.equal(cell.border.top?.style, 'medium');
});

test('parseStyleKey and toARGB', () => {
    assert.deepEqual(parseStyleKey('3:4'), { row: 3, col: 4 });
    assert.equal(parseStyleKey('0:4'), null);
    assert.equal(toARGB('#abcdef'), 'FFABCDEF');
    assert.equal(toARGB('rgb(255, 0, 16)'), 'FFFF0010');
    assert.equal(toARGB('red'), undefined);
});

test('applyStyleEditToCell applies live webview edits (colors, font, alignment, wrap)', () => {
    const cell = sheet().getRow(1).getCell(1);
    applyStyleEditToCell(cell, {
        bgColor: '#112233', textColor: 'rgb(255, 0, 0)', fontSize: 12, fontFamily: ' Arial ', bold: true, italic: false,
        horizontalAlign: 'right', verticalAlign: 'middle', wrapMode: 'wrap', indent: 2.4,
    });
    assert.equal((cell.fill as ExcelJS.FillPattern).fgColor?.argb, 'FF112233');
    assert.equal(cell.font.color?.argb, 'FFFF0000');
    assert.equal(cell.font.size, 12);
    assert.equal(cell.font.name, 'Arial');
    assert.equal(cell.font.bold, true);
    assert.equal(cell.font.italic, false);
    assert.deepEqual([cell.alignment.horizontal, cell.alignment.vertical, cell.alignment.wrapText, cell.alignment.indent], ['right', 'middle', true, 2]);
});

test('applyStyleEditToCell maps border styles and clears formatting', () => {
    const cell = sheet().getRow(1).getCell(1);
    applyStyleEditToCell(cell, { border: { top: true, left: true, style: 'thick dashed', color: '#000000' } });
    assert.equal(cell.border.top?.style, 'mediumDashed');
    assert.equal(cell.border.left?.color?.argb, 'FF000000');
    assert.equal(cell.border.right, undefined);
    applyStyleEditToCell(cell, { border: { top: true, style: 'double' } });
    assert.equal(cell.border.top?.style, 'double');
    assert.equal(cell.border.top?.color?.argb, 'FF202124');
    applyStyleEditToCell(cell, { bold: true });
    applyStyleEditToCell(cell, { clearFormatting: true });
    assert.equal(cell.font?.bold, undefined);
    assert.equal(cell.border?.top, undefined);
});

test('applyStoredMetadataToWorksheet keeps styles, merges and controls when a CSV is converted', () => {
    const ws = sheet();
    ws.getRow(1).getCell(1).value = 'Title';
    applyStoredMetadataToWorksheet(ws, {
        cells: {
            '1:1': { style: normalizeStoredStyle({ bold: true }) },
            '2:1': { control: { controlType: 'checkbox' } },
            '2:2': { control: { controlType: 'dropdown', dropdownOptions: ['a', 'b'] } },
            '2:3': { control: { controlType: 'rating' } },
        },
        merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 3 }],
    });
    assert.equal(ws.getRow(1).getCell(1).font.bold, true);
    assert.equal(ws.getRow(1).getCell(3).isMerged, true);
    assert.equal(ws.getRow(1).getCell(1).value, 'Title');
    assert.deepEqual(ws.getRow(2).getCell(1).dataValidation.formulae, ['"TRUE,FALSE"']);
    assert.deepEqual(ws.getRow(2).getCell(2).dataValidation.formulae, ['"a,b"']);
    assert.deepEqual(ws.getRow(2).getCell(3).dataValidation.formulae, ['"1,2,3,4,5"']);
});

test('applyStoredMetadataToWorksheet skips an invalid merge instead of failing the conversion', () => {
    const ws = sheet();
    applyStoredMetadataToWorksheet(ws, { merges: [
        { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
        { startRow: 2, startCol: 2, endRow: 3, endCol: 3 },
    ] });
    assert.equal(ws.getRow(1).getCell(2).isMerged, true);
});
