import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSerialQueue } from './serialQueue.ts';
import { createMessageDispatcher, MARKDOWN_FILE_WRITING_COMMANDS, SPREADSHEET_FILE_WRITING_COMMANDS } from './messageDispatch.ts';

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('file-writing command lists cover every save and restore', () => {
    for (const command of ['saveXlsxEdits', 'restoreVersion']) { assert.ok(SPREADSHEET_FILE_WRITING_COMMANDS.has(command), command); }
    for (const command of ['saveMarkdown', 'restoreVersion']) { assert.ok(MARKDOWN_FILE_WRITING_COMMANDS.has(command), command); }
});

test('queued commands never overlap; others run immediately', async () => {
    const log: string[] = [];
    const dispatch = createMessageDispatcher({
        queue: createSerialQueue(),
        queuedCommands: SPREADSHEET_FILE_WRITING_COMMANDS,
        handle: async (message) => {
            log.push(`${message.id}:start`);
            await tick(message.ms);
            log.push(`${message.id}:end`);
        },
    });
    const first = dispatch({ command: 'saveXlsxEdits', id: 'save1', ms: 20 });
    const second = dispatch({ command: 'saveXlsxEdits', id: 'save2', ms: 0 });
    const other = dispatch({ command: 'getRows', id: 'rows', ms: 0 });
    await Promise.all([first, second, other]);
    // save2 waits for save1 to finish; getRows doesn't wait for either.
    assert.ok(log.indexOf('save1:end') < log.indexOf('save2:start'), log.join(' '));
    assert.ok(log.indexOf('rows:end') < log.indexOf('save1:end'), log.join(' '));
});

test('handler failures are reported, not thrown, and do not block the queue', async () => {
    const errors: unknown[] = [];
    const handled: string[] = [];
    const dispatch = createMessageDispatcher({
        queue: createSerialQueue(),
        queuedCommands: MARKDOWN_FILE_WRITING_COMMANDS,
        handle: async (message) => {
            if (message.fail) { throw new Error('boom'); }
            handled.push(message.command);
        },
        onError: (command, error) => errors.push([command, (error as Error).message]),
    });
    await dispatch({ command: 'saveMarkdown', fail: true });
    await dispatch({ command: 'saveMarkdown' });
    assert.deepEqual(errors, [['saveMarkdown', 'boom']]);
    assert.deepEqual(handled, ['saveMarkdown']);
});
