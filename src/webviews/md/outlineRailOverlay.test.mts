// Headless test: where the outline rail starts relative to the toolbars on screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outlineRailTop } from './outlineRailOverlay.ts';

test('outline rail starts 10px below the lowest toolbar bottom on screen', () => {
    assert.equal(outlineRailTop([37, 74]), 84);
    assert.equal(outlineRailTop([-23, 14]), 24);
});

test('outline rail sits 10px from the window top when no toolbar shows', () => {
    assert.equal(outlineRailTop([-37, 0]), 10);
    assert.equal(outlineRailTop([]), 10);
});
