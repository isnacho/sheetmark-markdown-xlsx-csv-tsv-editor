import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    collectTocItems,
    OUTLINE_RAIL_WIDTH_PX_BY_LEVEL,
    renderRailLinesHtml,
    renderTocListHtml,
} from './outlineToc.ts';

test('OUTLINE_RAIL_WIDTH_PX_BY_LEVEL: H1–H6 tick widths (px)', () => {
    assert.deepEqual(OUTLINE_RAIL_WIDTH_PX_BY_LEVEL, [32, 24, 16, 8, 8, 8]);
});

test('collectTocItems walks heading tokens', () => {
    const tokens = [
        { type: 'heading_open', tag: 'h1', map: [0, 1], attrGet: (n: string) => (n === 'id' ? 'intro' : null) },
        { type: 'inline', content: 'Intro' },
        { type: 'heading_close', tag: 'h1' },
        { type: 'heading_open', tag: 'h2', map: [2, 3], attrGet: (n: string) => (n === 'id' ? 'details' : null) },
        { type: 'inline', content: 'Details' },
    ];
    const items = collectTocItems(tokens, 5, (s) => s);
    assert.deepEqual(items, [
        { id: 'intro', level: 1, text: 'Intro', line: 5 },
        { id: 'details', level: 2, text: 'Details', line: 7 },
    ]);
});

test('renderRailLinesHtml marks active heading', () => {
    const html = renderRailLinesHtml(
        [{ id: 'a', level: 1, text: 'A', line: 1 }, { id: 'b', level: 2, text: 'B', line: 2 }],
        'b',
    );
    assert.match(html, /data-target="b"/);
    assert.match(html, /data-level="2"/);
    assert.match(html, /outline-rail-line active/);
    assert.doesNotMatch(html, /data-target="a"[^>]*\bactive\b/);
});

test('renderTocListHtml escapes text', () => {
    const html = renderTocListHtml([{ id: 'x', level: 1, text: '<script>', line: 1 }]);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
});
