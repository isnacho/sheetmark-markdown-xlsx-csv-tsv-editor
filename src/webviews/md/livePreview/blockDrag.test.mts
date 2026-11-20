import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeScrollVelocity } from './blockDrag.ts';

// Visible editor from y=100 to y=700: the edge zones are 100-140 and 660-700.

test('edgeScrollVelocity is zero away from the edges', () => {
    assert.equal(edgeScrollVelocity(400, 100, 700), 0);
    assert.equal(edgeScrollVelocity(141, 100, 700), 0);
    assert.equal(edgeScrollVelocity(659, 100, 700), 0);
});

test('edgeScrollVelocity scrolls up near the top and down near the bottom', () => {
    assert.ok(edgeScrollVelocity(130, 100, 700) < 0);
    assert.ok(edgeScrollVelocity(670, 100, 700) > 0);
});

test('edgeScrollVelocity is faster closer to the edge and capped past it', () => {
    const near = edgeScrollVelocity(690, 100, 700);
    const far = edgeScrollVelocity(665, 100, 700);
    assert.ok(near > far, `${near} > ${far}`);
    assert.equal(edgeScrollVelocity(700, 100, 700), edgeScrollVelocity(900, 100, 700));
    assert.equal(edgeScrollVelocity(100, 100, 700), -edgeScrollVelocity(700, 100, 700));
    assert.equal(edgeScrollVelocity(-50, 100, 700), edgeScrollVelocity(100, 100, 700));
});

test('edgeScrollVelocity shrinks the zone in a short editor and ignores an empty one', () => {
    // 80px tall: the zone is 20px, so the middle does not scroll.
    assert.equal(edgeScrollVelocity(140, 100, 180), 0);
    assert.ok(edgeScrollVelocity(175, 100, 180) > 0);
    assert.equal(edgeScrollVelocity(100, 100, 100), 0);
});
