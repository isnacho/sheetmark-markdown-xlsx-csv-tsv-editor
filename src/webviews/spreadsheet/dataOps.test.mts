// Headless test: linkedom provides `document` for rich-text cell values; no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

(globalThis as any).document = parseHTML('<!doctype html><html><body></body></html>').document;
const { compareDataOpValues, filterAndSortRows, parseSortableDate, parseSortableNumber, readCellTextForDataOps } = await import('./dataOps.ts');

const row = (...values: unknown[]) => ({ cells: values.map((value, i) => ({ colNumber: i + 1, value })) });
const col0 = (rows: any[]) => rows.map(r => readCellTextForDataOps(r, 0));

test('readCellTextForDataOps reads plain, rich-text HTML, numbers and hyperlink objects', () => {
    assert.equal(readCellTextForDataOps(row('<b>Bold</b> &amp; plain'), 0), 'Bold & plain');
    assert.equal(readCellTextForDataOps(row(42), 0), '42');
    assert.equal(readCellTextForDataOps(row({ text: 'link' }), 0), 'link');
    assert.equal(readCellTextForDataOps(row({ richText: [{ text: 'a' }, { text: 'b' }] }), 0), 'ab');
    assert.equal(readCellTextForDataOps(row(), 0), '');
});

test('parseSortableNumber handles currency, percents, thousands and accounting negatives', () => {
    assert.equal(parseSortableNumber('$1,200'), 1200);
    assert.equal(parseSortableNumber('(15)'), -15);
    assert.equal(parseSortableNumber('12%'), 12);
    assert.equal(parseSortableNumber('abc'), null);
    assert.equal(parseSortableDate('2026-01-02') !== null, true);
    assert.equal(parseSortableDate('soon'), null);
});

test('compareDataOpValues sorts empties last in both directions, then booleans, numbers, dates, text', () => {
    assert.ok(compareDataOpValues('', 'a', 'asc') > 0);
    assert.ok(compareDataOpValues('', 'a', 'desc') > 0);
    assert.ok(compareDataOpValues('2', '10', 'asc') < 0);
    assert.ok(compareDataOpValues('item 2', 'item 10', 'asc') < 0);
    assert.ok(compareDataOpValues('no', 'yes', 'asc') < 0);
    assert.ok(compareDataOpValues('2026-01-02', '2025-12-31', 'desc') < 0);
});

test('filterAndSortRows applies every filter, then sorts', () => {
    const rows = [row('Banana', 'x'), row('apple', ''), row('Cherry', 'y'), row('avocado', 'z')];
    const contains = filterAndSortRows(rows, [{ columnIndex: 0, mode: 'contains', query: 'a', caseSensitive: false }], { columnIndex: 0, direction: 'asc' });
    assert.deepEqual(col0(contains), ['apple', 'avocado', 'Banana']);
    const caseSensitive = filterAndSortRows(rows, [{ columnIndex: 0, mode: 'startsWith', query: 'a', caseSensitive: true }], null);
    assert.deepEqual(col0(caseSensitive), ['apple', 'avocado']);
    const nonEmpty = filterAndSortRows(rows, [{ columnIndex: 1, mode: 'nonEmpty', query: '', caseSensitive: false }], { columnIndex: 0, direction: 'desc' });
    assert.deepEqual(col0(nonEmpty), ['Cherry', 'Banana', 'avocado']);
    assert.equal(filterAndSortRows(rows, [], null), rows, 'no filters and no sort returns the same array');
});
