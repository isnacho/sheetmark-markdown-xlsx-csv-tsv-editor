import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv, serializeTsv } from './tsvClipboard.ts';

test('serializeTsv quotes only cells that need it', () => {
    assert.equal(serializeTsv([['a', 'b'], ['c', 'd']]), 'a\tb\nc\td');
    assert.equal(serializeTsv([['line1\nline2', 'x']]), '"line1\nline2"\tx');
    assert.equal(serializeTsv([['say "hi"']]), '"say ""hi"""');
    assert.equal(serializeTsv([['a\tb']]), '"a\tb"');
});

test('parseTsv reads plain grids and drops one trailing newline', () => {
    assert.deepEqual(parseTsv('a\tb\nc\td\n'), [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(parseTsv('a\tb\r\nc\td'), [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(parseTsv('a\t\tc'), [['a', '', 'c']]);
});

test('parseTsv keeps a quoted multi-line cell as one cell', () => {
    assert.deepEqual(parseTsv('"line1\nline2"\tx\ny\tz'), [['line1\nline2', 'x'], ['y', 'z']]);
    assert.deepEqual(parseTsv('"say ""hi"""\t"a\tb"'), [['say "hi"', 'a\tb']]);
});

test('parseTsv treats quotes inside a field, or an unclosed quote, literally', () => {
    assert.deepEqual(parseTsv('5" screen\tok'), [['5" screen', 'ok']]);
    assert.deepEqual(parseTsv('"unclosed\nnext'), [['"unclosed'], ['next']]);
});

test('serializeTsv and parseTsv round-trip', () => {
    const rows = [['plain', 'multi\nline', ''], ['tab\there', 'quote "q"', 'end']];
    assert.deepEqual(parseTsv(serializeTsv(rows)), rows);
});
