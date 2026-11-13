// Headless test: pure geometry for the text-column selection layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampToColumn } from './selectionColumn.ts';

test('selection boxes are trimmed to the text column', () => {
    // Column 40..960, like a 1000px editor with 40px gutters.
    assert.deepEqual(clampToColumn({ left: 0, top: 10, width: 1000, height: 20 }, 40, 960), { left: 40, top: 10, width: 920, height: 20 });
    assert.deepEqual(clampToColumn({ left: 100, top: 0, width: 50, height: 20 }, 40, 960), { left: 100, top: 0, width: 50, height: 20 });
    assert.deepEqual(clampToColumn({ left: 500, top: 0, width: 900, height: 20 }, 40, 960), { left: 500, top: 0, width: 460, height: 20 });
});

test('a box that lies wholly in a gutter is dropped', () => {
    // CodeMirror's piece for "selection ends at the start of a line": from the content edge to the text.
    assert.equal(clampToColumn({ left: 0, top: 0, width: 40, height: 20 }, 40, 960), null);
    assert.equal(clampToColumn({ left: 960, top: 0, width: 40, height: 20 }, 40, 960), null);
});
