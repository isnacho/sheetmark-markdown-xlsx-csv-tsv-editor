// Headless test of the style conversions the toolbar's style edits go through before saving.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStyleForStorage, styleToRendererCss } from './styleEdits.ts';

test('styleToRendererCss maps toolbar flags to CSS properties', () => {
    assert.deepEqual(styleToRendererCss({ bold: true, italic: false, strike: true, fontSize: 12, indent: 2, bgColor: '#ff0000', textColor: '#00ff00', horizontalAlign: 'center' }), {
        backgroundColor: '#ff0000',
        color: '#00ff00',
        fontWeight: 'bold',
        fontStyle: 'normal',
        fontSize: '12pt',
        textDecorationLine: 'line-through',
        textAlign: 'center',
        paddingLeft: '16px',
    });
});

test('styleToRendererCss prefers explicit CSS values over flags', () => {
    assert.deepEqual(styleToRendererCss({ fontWeight: '600', bold: false, textAlign: 'right', horizontalAlign: 'left', paddingLeft: '3px', indent: 5 }), {
        fontWeight: '600', textAlign: 'right', paddingLeft: '3px',
    });
});

test('styleToRendererCss keeps borders unless they are being cleared, and ignores junk', () => {
    const border = { top: true, right: false, bottom: true, left: false, color: '#000', style: 'thin' };
    assert.deepEqual(styleToRendererCss({ border }), { border });
    assert.deepEqual(styleToRendererCss({ border: { ...border, clear: true } }), {});
    assert.deepEqual(styleToRendererCss({ fontWeight: 7, color: null, fontSize: '  ' }), {});
});

test('normalizeStyleForStorage keeps the cell address and the CSS form', () => {
    assert.deepEqual(normalizeStyleForStorage({ row: 2, col: 3, bold: true }), { row: 2, col: 3, fontWeight: 'bold' });
    assert.deepEqual(normalizeStyleForStorage({ row: 1, col: 1, bold: true, clearFormatting: true }), {
        row: 1, col: 1, clearFormatting: true, border: { clear: true, top: false, right: false, bottom: false, left: false },
    });
    assert.deepEqual(normalizeStyleForStorage(null as any), {});
});
