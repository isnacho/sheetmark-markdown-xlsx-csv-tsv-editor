import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertARGBToRGBA, excelFillColor } from './spreadsheetUtilities.ts';

test('convertARGBToRGBA ignores the alpha byte, as Excel does (bug: openpyxl headers had invisible fill and text)', () => {
    assert.equal(convertARGBToRGBA('001F3864'), 'rgba(31, 56, 100, 1)');
    assert.equal(convertARGBToRGBA('00FFFFFF'), 'rgba(255, 255, 255, 1)');
    assert.equal(convertARGBToRGBA('80CCCCCC'), 'rgba(204, 204, 204, 1)');
    assert.equal(convertARGBToRGBA('FFCCCCCC'), 'rgba(204, 204, 204, 1)');
});

test('convertARGBToRGBA falls back to black for a value that is not 8 characters', () => {
    assert.equal(convertARGBToRGBA(''), 'rgba(0, 0, 0, 1)');
    assert.equal(convertARGBToRGBA('FFF'), 'rgba(0, 0, 0, 1)');
});

test('excelFillColor gives the colour of a real pattern fill', () => {
    assert.equal(excelFillColor({ type: 'pattern', pattern: 'solid', fgColor: { argb: '001F3864' } }), 'rgba(31, 56, 100, 1)');
    assert.equal(excelFillColor({ type: 'pattern', pattern: 'darkGray', fgColor: { argb: 'FFFF0000' } }), 'rgba(255, 0, 0, 1)');
});

test('excelFillColor draws nothing for a fill with no pattern, pattern none, or no colour', () => {
    // A "00000000" colour on a fill with no pattern must not turn into a black cell now that alpha is ignored.
    assert.equal(excelFillColor({ type: 'pattern', fgColor: { argb: '00000000' } }), undefined);
    assert.equal(excelFillColor({ type: 'pattern', pattern: 'none', fgColor: { argb: '00000000' } }), undefined);
    assert.equal(excelFillColor({ type: 'pattern', pattern: 'solid' }), undefined);
    assert.equal(excelFillColor({ type: 'gradient', gradient: 'angle' }), undefined);
    assert.equal(excelFillColor(undefined), undefined);
});
