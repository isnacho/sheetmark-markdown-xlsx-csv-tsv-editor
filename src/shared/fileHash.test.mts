import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { changedSinceBaseline, hashFile, sha1Hex } from './fileHash.ts';

test('sha1Hex is the SHA-1 of the bytes', () => {
    assert.equal(sha1Hex(Buffer.from('abc')), 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

test('hashFile hashes what is on disk and returns null for a missing file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smk-hash-'));
    const file = path.join(dir, 'a.csv');
    fs.writeFileSync(file, 'abc');
    assert.equal(await hashFile(file), 'a9993e364706816aba3e25717850c26c9cd0d89d');
    assert.equal(await hashFile(path.join(dir, 'missing.csv')), null);
});

test('changedSinceBaseline: only two known, different hashes count as a change', () => {
    assert.equal(changedSinceBaseline('a', 'a'), false);
    assert.equal(changedSinceBaseline('a', 'b'), true);
    assert.equal(changedSinceBaseline(null, 'b'), false, 'no baseline yet');
    assert.equal(changedSinceBaseline('a', null), false, 'file unreadable');
});
