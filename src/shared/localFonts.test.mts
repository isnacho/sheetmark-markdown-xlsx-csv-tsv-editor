// Turning each platform's font listing into the Font picker's list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFontNames, parseFcList, parseJsonFamilies, parseLineFamilies } from './localFonts.ts';

test('cleanFontNames drops unsafe, hidden, blank, duplicate and built-in names, and sorts for people', () => {
    assert.deepEqual(
        cleanFontNames(['zapfino', 'Arial', 'arial', '  Georgia ', '.SF NS', '', 7, null, 'Bad";name', 'Inter', 'System', 'Serif', 'Éclair', 'Helvetica Neue']),
        ['Arial', 'Éclair', 'Georgia', 'Helvetica Neue', 'zapfino'],
    );
});

test('macOS output (a JSON array) is parsed, and anything else gives an empty list', () => {
    assert.deepEqual(parseJsonFamilies('["Helvetica Neue","Georgia",".AppleSystemUIFont"]\n'), ['Georgia', 'Helvetica Neue']);
    for (const bad of ['', 'not json', '{"a":1}', 'null', '"Arial"']) { assert.deepEqual(parseJsonFamilies(bad), [], bad); }
});

test('Windows output (one family per line, CRLF) is parsed', () => {
    assert.deepEqual(parseLineFamilies('Segoe UI\r\nArial\r\nSegoe UI\r\n\r\nCalibri\r\n'), ['Arial', 'Calibri', 'Segoe UI']);
});

test('fc-list output keeps the first family name of each line', () => {
    assert.deepEqual(
        parseFcList('DejaVu Sans,DejaVu Sans Bold\nNoto Sans CJK JP,Noto Sans CJK JP Regular\nDejaVu Sans\n'),
        ['DejaVu Sans', 'Noto Sans CJK JP'],
    );
});
