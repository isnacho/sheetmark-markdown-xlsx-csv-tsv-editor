// The Font picker's search.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterFontNames } from './fontSearch.ts';

const FONTS = ['Arial', 'Avenir Next', 'Courier New', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Menlo', 'New York', 'Palatino', 'Éclair Sans', 'Noto Sans CJK JP'];

test('an empty or blank query returns every name, in order', () => {
    assert.deepEqual(filterFontNames(FONTS, ''), FONTS);
    assert.deepEqual(filterFontNames(FONTS, '   '), FONTS);
});

test('matching ignores letter case and accents', () => {
    assert.deepEqual(filterFontNames(FONTS, 'GEORGIA'), ['Georgia']);
    assert.deepEqual(filterFontNames(FONTS, 'eclair'), ['Éclair Sans']);
    assert.deepEqual(filterFontNames(FONTS, 'éclair'), ['Éclair Sans']);
});

test('every typed word must appear, in any order', () => {
    assert.deepEqual(filterFontNames(FONTS, 'neue hel'), ['Helvetica Neue']);
    assert.deepEqual(filterFontNames(FONTS, 'new'), ['New York', 'Courier New']);
    assert.deepEqual(filterFontNames(FONTS, 'sans cjk'), ['Noto Sans CJK JP']);
    assert.deepEqual(filterFontNames(FONTS, 'zzz'), []);
});

test('names that start with the query come first, then word starts, then anywhere inside', () => {
    // "ne": Neue is a word start, New York starts with "ne", Avenir Next has a word start, Courier New has a word start.
    assert.deepEqual(filterFontNames(FONTS, 'ne'), ['New York', 'Avenir Next', 'Courier New', 'Helvetica Neue']);
    // "ia" is inside Arial and Georgia but starts no word, so both keep the list's order.
    assert.deepEqual(filterFontNames(FONTS, 'ia'), ['Arial', 'Georgia']);
    // A full prefix beats a word start: "hel" finds Helvetica and Helvetica Neue, in list order.
    assert.deepEqual(filterFontNames(FONTS, 'hel'), ['Helvetica', 'Helvetica Neue']);
});

test('searching does not change the list it is given', () => {
    const copy = [...FONTS];
    filterFontNames(copy, 'a');
    assert.deepEqual(copy, FONTS);
});
