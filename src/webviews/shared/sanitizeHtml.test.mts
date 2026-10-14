// Headless test: linkedom supplies a DOM (template parsing + serialization); no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { sanitizeHtml, htmlToPlainText, isSafeUrl, sanitizeStyle } from './sanitizeHtml.ts';

const { document } = parseHTML('<!doctype html><html><head></head><body></body></html>');
const clean = (html: string) => sanitizeHtml(html, document as unknown as Document);

test('sanitizeHtml strips event handlers but keeps the element', () => {
    assert.equal(clean('<b onclick="alert(1)">hi</b>'), '<b>hi</b>');
    assert.equal(clean('<img src="x.png" onerror="alert(1)">'), '<img src="x.png">');
});

test('sanitizeHtml drops script-capable elements with their content', () => {
    assert.equal(clean('a<script>alert(1)</script>b'), 'ab');
    assert.equal(clean('<svg onload="alert(1)"><circle/></svg>ok'), 'ok');
    assert.equal(clean('<iframe src="https://x"></iframe>'), '');
    assert.equal(clean('<style>body{display:none}</style>t'), 't');
});

test('sanitizeHtml unwraps unknown tags and keeps their text', () => {
    assert.equal(clean('<custom-el>keep <b>me</b></custom-el>'), 'keep <b>me</b>');
});

test('sanitizeHtml removes unsafe URLs', () => {
    assert.equal(clean('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
    assert.equal(clean('<a href="java\tscript:alert(1)">x</a>'), '<a>x</a>');
    assert.equal(clean('<a href="https://example.com">x</a>'), '<a href="https://example.com">x</a>');
    assert.equal(clean('<a href="./other.md#h">x</a>'), '<a href="./other.md#h">x</a>');
    assert.equal(clean('<img src="data:text/html,<script>">'), '<img>');
});

test('sanitizeHtml keeps rich-text formatting the host produces', () => {
    const rich = '<b><span style="color: #FF0000;">red</span></b> plain &amp; <i>it</i>';
    assert.equal(clean(rich), '<b><span style="color: #FF0000">red</span></b> plain &amp; <i>it</i>');
    assert.equal(clean('line1<br>line2'), 'line1<br>line2');
});

test('sanitizeHtml escapes text that only looks like markup', () => {
    assert.equal(clean('a < b && c'), 'a &lt; b &amp;&amp; c');
    assert.equal(clean('R&D'), 'R&amp;D');
});

test('sanitizeStyle keeps allowlisted properties without url() or expressions', () => {
    assert.equal(sanitizeStyle('color: red; position: fixed; width: 40px'), 'color: red; width: 40px');
    assert.equal(sanitizeStyle('background-color: url(https://x)'), '');
    assert.equal(sanitizeStyle('color: expression(alert(1))'), '');
});

test('isSafeUrl allows relative, http(s), mailto; data images only when asked', () => {
    assert.equal(isSafeUrl('notes/a.md'), true);
    assert.equal(isSafeUrl('#section'), true);
    assert.equal(isSafeUrl('mailto:a@b.c'), true);
    assert.equal(isSafeUrl('vbscript:x'), false);
    assert.equal(isSafeUrl('data:image/png;base64,AAAA'), false);
    assert.equal(isSafeUrl('data:image/png;base64,AAAA', true), true);
    assert.equal(isSafeUrl('data:image/svg+xml;base64,AAAA', true), false);
});

test('htmlToPlainText reads text without executing anything', () => {
    assert.equal(htmlToPlainText('<b>bold</b> &amp; <img src=x onerror="throw 1">done', document as unknown as Document), 'bold & done');
});
