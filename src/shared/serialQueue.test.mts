import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSerialQueue } from './serialQueue.ts';

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('createSerialQueue runs tasks one at a time in order', async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    const slow = queue.run(async () => { log.push('a:start'); await tick(20); log.push('a:end'); return 'a'; });
    const fast = queue.run(async () => { log.push('b:start'); log.push('b:end'); return 'b'; });
    assert.equal(queue.busy, true);
    assert.deepEqual(await Promise.all([slow, fast]), ['a', 'b']);
    assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end']);
    await tick(0);
    assert.equal(queue.busy, false);
});

test('createSerialQueue keeps going after a task fails', async () => {
    const queue = createSerialQueue();
    const failed = queue.run(async () => { throw new Error('boom'); });
    const next = queue.run(async () => 'ok');
    await assert.rejects(failed, /boom/);
    assert.equal(await next, 'ok');
    await tick(0);
    assert.equal(queue.busy, false);
});
