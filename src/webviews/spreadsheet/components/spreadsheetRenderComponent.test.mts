// Headless test: renders spreadsheet rows from hostile cell data and parses the HTML with linkedom
// to prove nothing executable survives (event handlers, scripts, attribute break-outs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document } = parseHTML('<!doctype html><html><body></body></html>');
(globalThis as any).document = document;

const { createXlsxRowHtml } = await import('./spreadsheetRenderComponent.ts');

const ATTACKS = [
    '<img src=x onerror="alert(1)">',
    '<svg onload=alert(1)><circle/></svg>',
    '<script>alert(1)</script>',
    '<a href="javascript:alert(1)">link</a>',
    '"><img src=x onerror=alert(1)>',
];

function renderRow(cell: Record<string, unknown>, isPlainView = false): Element {
    const html = createXlsxRowHtml({
        rowData: { rowNumber: 1, cells: [{ colNumber: 1, rowNumber: 1, ...cell }] },
        rowIndex: 1,
        rowHeight: 20,
        columnCount: 1,
        columnWidths: [80],
        isPlainView,
        isEditMode: false,
        allowInteractiveControls: true,
    });
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    tbody.innerHTML = html;
    return tbody;
}

function assertInert(root: Element, label: string) {
    assert.equal(root.querySelectorAll('script, svg, iframe, object, embed').length, 0, `${label}: dangerous element survived`);
    for (const el of Array.from(root.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
            assert.ok(!attr.name.toLowerCase().startsWith('on'), `${label}: ${el.tagName} kept ${attr.name}`);
            assert.ok(!/^\s*javascript:/i.test(attr.value), `${label}: ${el.tagName} ${attr.name}=${attr.value}`);
        }
    }
}

test('hostile cell values render inert in styled and plain view', () => {
    for (const value of ATTACKS) {
        assertInert(renderRow({ value }), `styled ${value}`);
        assertInert(renderRow({ value }, true), `plain ${value}`);
    }
});

test('hostile image-cell labels render inert', () => {
    for (const value of ATTACKS) {
        assertInert(renderRow({ value, cellType: 'image' }), `image ${value}`);
    }
});

test('style and color values cannot break out of their attributes', () => {
    const breakout = 'red;" onmouseover="alert(1)';
    const root = renderRow({
        value: 'x',
        style: { color: breakout, fontFamily: "'Calibri'\" onclick=\"alert(1)" },
        originalColor: '"><img src=x onerror=alert(1)>',
    });
    assertInert(root, 'style breakout');
    const td = root.querySelector('td');
    assert.ok(td);
    assert.equal(td.querySelectorAll('img').length, 0);
});

test('legitimate rich text keeps its formatting', () => {
    const root = renderRow({ value: '<b>bold</b> and <span style="color: #FF0000;">red</span><br>next' });
    const content = root.querySelector('.cell-content');
    assert.ok(content);
    assert.equal(content.querySelector('b')?.textContent, 'bold');
    assert.equal(content.querySelector('span')?.getAttribute('style'), 'color: #FF0000');
    assert.equal(content.querySelectorAll('br').length, 1);
});
