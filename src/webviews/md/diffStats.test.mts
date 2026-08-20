import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLineStats, formatDiffLineStats } from './diffStats.ts';

test('diffLineStats: identical text has no changes', () => {
    assert.deepEqual(diffLineStats('a\nb\nc', 'a\nb\nc'), { added: 0, removed: 0 });
    assert.deepEqual(diffLineStats('', ''), { added: 0, removed: 0 });
});

test('diffLineStats: pure line insertion', () => {
    assert.deepEqual(diffLineStats('a\nb', 'a\nnew\nb'), { added: 1, removed: 0 });
});

test('diffLineStats: pure line deletion', () => {
    assert.deepEqual(diffLineStats('a\ngone\nb', 'a\nb'), { added: 0, removed: 1 });
});

test('diffLineStats: modified line counts as one removed and one added', () => {
    assert.deepEqual(diffLineStats('a\nold\nb', 'a\nnew\nb'), { added: 1, removed: 1 });
});

test('diffLineStats: mid-line edit still counts the whole line', () => {
    assert.deepEqual(diffLineStats('the old text', 'the new text'), { added: 1, removed: 1 });
});

test('diffLineStats: multiple separated changes accumulate', () => {
    const baseline = 'h1\nkeep\nold2\nkeep\nkeep\nold3';
    const current = 'h1\nkeep\nnew2\nkeep\nkeep\nnew3';
    assert.deepEqual(diffLineStats(baseline, current), { added: 2, removed: 2 });
});

test('diffLineStats: unchanged head and tail are trimmed, not counted', () => {
    const baseline = 'a\nb\nc\nTARGET\nx\ny\nz';
    const current = 'a\nb\nc\nCHANGED\nx\ny\nz';
    assert.deepEqual(diffLineStats(baseline, current), { added: 1, removed: 1 });
});

test('diffLineStats: reordered lines are matched by subsequence', () => {
    // "b" survives as the common subsequence; "a" moving after it reads as
    // one removal plus one addition.
    assert.deepEqual(diffLineStats('a\nb', 'b\na'), { added: 1, removed: 1 });
});

test('diffLineStats: everything replaced', () => {
    assert.deepEqual(diffLineStats('a\nb\nc', 'x\ny'), { added: 2, removed: 3 });
});

test('diffLineStats: empty baseline is all additions', () => {
    assert.deepEqual(diffLineStats('', 'a\nb'), { added: 2, removed: 0 });
});

test('diffLineStats: empty current is all removals', () => {
    assert.deepEqual(diffLineStats('a\nb', ''), { added: 0, removed: 2 });
});

test('diffLineStats: trailing newline difference is one added line', () => {
    assert.deepEqual(diffLineStats('a', 'a\n'), { added: 1, removed: 0 });
});

test('diffLineStats: large divergent input stays bounded', () => {
    const baseline = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join('\n');
    const current = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join('\n');
    const stats = diffLineStats(baseline, current);
    assert.equal(stats.added, 3000);
    assert.equal(stats.removed, 3000);
});

test('formatDiffLineStats: renders counts, null when unchanged', () => {
    assert.equal(formatDiffLineStats({ added: 12, removed: 3 }), '+12 −3');
    assert.equal(formatDiffLineStats({ added: 0, removed: 0 }), null);
    assert.equal(formatDiffLineStats({ added: 1, removed: 0 }), '+1 −0');
});
