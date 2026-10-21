// Headless test: inactive Markdown tables render through markdown-it with `html: true`; linkedom
// parses the result to prove hostile cell HTML is neutralized while normal cell markup survives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document } = parseHTML('<!doctype html><html><body></body></html>');
(globalThis as any).document = document;

const { renderTableHtml } = await import('./tableWidget.ts');

function render(source: string): Element {
    const holder = document.createElement('div');
    holder.innerHTML = renderTableHtml(source, 2, null);
    return holder;
}

test('hostile HTML in table cells renders inert', () => {
    const root = render([
        '| a | b |',
        '| - | - |',
        '| <img src=x onerror="alert(1)"> | <script>alert(1)</script> |',
        '| [x](javascript:alert(1)) | <a href="javascript:alert(1)">y</a> |',
    ].join('\n'));
    assert.equal(root.querySelectorAll('script').length, 0);
    for (const el of Array.from(root.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
            assert.ok(!attr.name.startsWith('on'), `${el.tagName} kept ${attr.name}`);
            assert.ok(!/^\s*javascript:/i.test(attr.value), `${el.tagName} ${attr.name}=${attr.value}`);
        }
    }
});

test('normal cell markup, alignment and colgroup survive', () => {
    const root = render('| a | b |\n| :-: | - |\n| **bold**<br>next | [link](https://example.com) |');
    assert.ok(root.querySelector('table.md-table'));
    assert.equal(root.querySelectorAll('colgroup col').length, 2);
    assert.equal(root.querySelector('th')?.getAttribute('style'), 'text-align: center');
    assert.equal(root.querySelector('strong')?.textContent, 'bold');
    assert.equal(root.querySelectorAll('td br').length, 1);
    assert.equal(root.querySelector('a')?.getAttribute('href'), 'https://example.com');
});
