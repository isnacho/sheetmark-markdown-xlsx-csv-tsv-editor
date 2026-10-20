import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRowOffsetPrefix, rowIndexAtOffset, rowRangeHeight, rowTopOffset } from './rowMetrics.ts';

const heights = [20, 30, 10, 40];
const prefix = buildRowOffsetPrefix(heights.length, i => heights[i]);

test('buildRowOffsetPrefix sums heights', () => {
    assert.deepEqual(prefix, [0, 20, 50, 60, 100]);
});

test('rowTopOffset and rowRangeHeight clamp to the grid', () => {
    assert.equal(rowTopOffset(prefix, 4, 2), 50);
    assert.equal(rowTopOffset(prefix, 4, 99), 100);
    assert.equal(rowTopOffset(prefix, 0, 2), 0);
    assert.equal(rowRangeHeight(prefix, 4, 1, 3), 40);
    assert.equal(rowRangeHeight(prefix, 4, 3, 1), 0);
    assert.equal(rowRangeHeight(prefix, 4, -5, 99), 100);
});

test('rowIndexAtOffset finds the row under a scroll offset', () => {
    assert.equal(rowIndexAtOffset(prefix, 4, 0), 0);
    assert.equal(rowIndexAtOffset(prefix, 4, 19), 0);
    assert.equal(rowIndexAtOffset(prefix, 4, 20), 1);
    assert.equal(rowIndexAtOffset(prefix, 4, 55), 2);
    assert.equal(rowIndexAtOffset(prefix, 4, 1000), 3);
    assert.equal(rowIndexAtOffset(prefix, 4, -10), 0);
    assert.equal(rowIndexAtOffset([0], 0, 10), 0);
});
