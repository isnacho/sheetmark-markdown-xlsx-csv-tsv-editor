// The font setting: which values are accepted, and that its copies (package.json, theme.css) agree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILT_IN_FONT_IDS, DEFAULT_FONT_CHOICE, isFontChoice, isSafeFontName, normalizeFontChoice } from './fontChoice.ts';

test('normalizeFontChoice keeps built-in ids, accepts installed font names, and falls back to Inter otherwise', () => {
    for (const id of BUILT_IN_FONT_IDS) { assert.equal(normalizeFontChoice(id), id); }
    // Letter case does not matter for the built-in ids (Settings JSON is typed by hand).
    assert.equal(normalizeFontChoice('Serif'), 'serif');
    assert.equal(normalizeFontChoice(' SYSTEM '), 'system');
    // Anything else that is a plausible family name is an installed font.
    assert.equal(normalizeFontChoice('Helvetica Neue'), 'Helvetica Neue');
    assert.equal(normalizeFontChoice(' Georgia '), 'Georgia');
    assert.equal(normalizeFontChoice('Hiragino Kaku Gothic ProN'), 'Hiragino Kaku Gothic ProN');
    assert.equal(normalizeFontChoice('游ゴシック'), '游ゴシック');
    for (const bad of ['', '   ', 7, null, undefined, {}, ['serif'], '.SF NS', 'x'.repeat(101)]) {
        assert.equal(normalizeFontChoice(bad), DEFAULT_FONT_CHOICE, `for ${JSON.stringify(bad)}`);
    }
});

test('a name that could break out of the quoted CSS font-family is never a font choice', () => {
    const hostile = [
        'Arial", sans-serif; background: url(//evil)', 'Arial"', 'Arial\\', 'a;b', 'a{b}', '</style><script>', 'a\nb', 'a\u0000b', 'a\u007fb',
    ];
    for (const name of hostile) {
        assert.equal(isSafeFontName(name), false, JSON.stringify(name));
        assert.equal(isFontChoice(name), false, JSON.stringify(name));
        assert.equal(normalizeFontChoice(name), DEFAULT_FONT_CHOICE, JSON.stringify(name));
    }
});

test('package.json defaults the setting to Inter, and theme.css has a stack for every built-in font but the default', () => {
    const setting = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties['xlsxViewer.fontFamily'];
    assert.equal(setting.type, 'string');
    assert.equal(setting.default, DEFAULT_FONT_CHOICE);
    for (const id of BUILT_IN_FONT_IDS) { assert.ok(setting.examples.includes(id), `${id} missing from the setting's examples`); }

    const css = readFileSync('resources/shared/theme.css', 'utf8');
    for (const id of BUILT_IN_FONT_IDS.filter(font => font !== DEFAULT_FONT_CHOICE)) {
        assert.match(css, new RegExp(`:root\\[data-font='${id}'\\]\\s*\\{\\s*--font-family:`), `no rule for ${id}`);
    }
});
