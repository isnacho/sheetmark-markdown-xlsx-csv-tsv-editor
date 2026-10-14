import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { applyStoredStylesToWorksheet, normalizeStoredStyle, parseStyleKey, toARGB } from './excelStyle.ts';

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
