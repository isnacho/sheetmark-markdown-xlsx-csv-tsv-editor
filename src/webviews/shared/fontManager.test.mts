// How an installed font becomes a CSS font stack (the browser parts of fontManager are tested in src/test/webview).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installedFontStack } from './fontManager.ts';

test('an installed font is quoted and falls back to the system font', () => {
    assert.equal(installedFontStack('Helvetica Neue'), '"Helvetica Neue", system-ui, -apple-system, sans-serif');
    assert.equal(installedFontStack(' Georgia '), '"Georgia", system-ui, -apple-system, sans-serif');
    assert.equal(installedFontStack('游ゴシック'), '"游ゴシック", system-ui, -apple-system, sans-serif');
});

test('built-in fonts have no installed-font stack (theme.css owns theirs)', () => {
    for (const id of ['inter', 'system', 'serif']) { assert.equal(installedFontStack(id), null); }
});

test('a name that could break out of the quoted family, or is not a name, gives no stack', () => {
    for (const bad of ['Arial", sans-serif; x: y', 'Arial\\', 'a{b}', '</style>', 'a\nb', '', '   ', 'x'.repeat(101), 7, null, undefined, {}]) {
        assert.equal(installedFontStack(bad), null, JSON.stringify(bad));
    }
});
