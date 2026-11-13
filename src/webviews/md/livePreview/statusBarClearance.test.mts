// Headless test: the room kept under the cursor for the floating stats pill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bottomClearance } from './statusBarClearance.ts';

const rect = (top: number, height: number, width = 120) => ({ top, height, width, bottom: top + height } as DOMRect);

test('the cursor keeps clear of the stats pill: pill top to editor bottom, plus a gap', () => {
    // Editor bottom at 800; a 24px pill 12px above it starts at 764.
    assert.equal(bottomClearance(rect(764, 24), 800), 44);
});

test('no extra room when the pill is hidden or empty', () => {
    assert.equal(bottomClearance(null, 800), 0);
    assert.equal(bottomClearance(rect(0, 0, 0), 800), 0);
});
