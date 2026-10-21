// Headless test: linkedom provides `document` (inert HTML parsing for rich-text cells); no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document } = parseHTML('<!doctype html><html><body></body></html>');
(globalThis as any).document = document;

const { buildSelectionClipboard, cellValueText } = await import('./spreadsheetCopyComponent.ts');
const { parseTsv } = await import('./tsvClipboard.ts');

const normalize = (text: string | null | undefined) => (text ? String(text).replace(/\r\n?/g, '\n').trimEnd() : '');

function row(...values: string[]) {
    return { cells: values.map((value, i) => ({ colNumber: i + 1, value })) };
}

function ctx(overrides: Record<string, unknown>) {
    return {
        selectedCells: new Set<HTMLElement>(),
        selectedColumnIndices: new Set<number>(),
        selectedRowIndices: new Set<number>(),
        columnCount: 2,
        totalRows: 2,
        rowCache: new Map<number, any>(),
        isCopying: false,
        setIsCopying: () => {},
        showToast: () => {},
        requestAllRows: async () => [],
        normalizeCellText: normalize,
        ...overrides,
    } as any;
}

function fakeCell(r: number, c: number) {
    return { dataset: { row: String(r), col: String(c) } } as unknown as HTMLElement;
}

test('cellValueText turns rich-text HTML into plain text with real line breaks', () => {
    assert.equal(cellValueText('<b>bold</b><br>next &amp; more'), 'bold\nnext & more');
    assert.equal(cellValueText('plain'), 'plain');
    assert.equal(cellValueText(undefined), '');
});

test('copying a multi-line cell produces TSV that pastes back as one cell', async () => {
    const rowCache = new Map([[0, row('line1\nline2', 'x')], [1, row('y', '<i>z</i>')]]);
    const selectedCells = new Set([fakeCell(0, 0), fakeCell(0, 1), fakeCell(1, 0), fakeCell(1, 1)]);
    const result = await buildSelectionClipboard(ctx({ rowCache, selectedCells }));
    assert.ok(result);
    assert.equal(result.cellCount, 4);
    assert.deepEqual(parseTsv(result.text), [['line1\nline2', 'x'], ['y', 'z']]);
});

test('copying whole columns fetches all rows and quotes multi-line cells', async () => {
    const rows = [row('a1', 'b1'), row('a\n2', 'b2')];
    const result = await buildSelectionClipboard(ctx({
        selectedColumnIndices: new Set([0]),
        requestAllRows: async () => rows,
    }));
    assert.ok(result);
    assert.equal(result.text, 'a1\n"a\n2"');
    assert.equal(result.cellCount, 2);
});

test('copying whole rows covers every column; a failed fetch returns null', async () => {
    const rows = [row('a1', 'b1'), row('a2', 'b\t2')];
    const result = await buildSelectionClipboard(ctx({ selectedRowIndices: new Set([1]), requestAllRows: async () => rows }));
    assert.deepEqual(result && parseTsv(result.text), [['a2', 'b\t2']]);
    assert.equal(await buildSelectionClipboard(ctx({ selectedRowIndices: new Set([0]) })), null);
});
