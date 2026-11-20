import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextMenuIndex, tabWrapTarget } from './popupFocus.ts';

test('nextMenuIndex: arrows wrap at both ends, Home and End jump', () => {
    assert.equal(nextMenuIndex(0, 3, 'ArrowDown'), 1);
    assert.equal(nextMenuIndex(2, 3, 'ArrowDown'), 0);
    assert.equal(nextMenuIndex(0, 3, 'ArrowUp'), 2);
    assert.equal(nextMenuIndex(1, 3, 'Home'), 0);
    assert.equal(nextMenuIndex(1, 3, 'End'), 2);
});

test('nextMenuIndex: from the menu itself (no item focused) Down goes to the first item, Up to the last', () => {
    assert.equal(nextMenuIndex(-1, 3, 'ArrowDown'), 0);
    assert.equal(nextMenuIndex(-1, 3, 'ArrowUp'), 2);
});

test('nextMenuIndex: other keys and empty menus do nothing', () => {
    assert.equal(nextMenuIndex(0, 3, 'a'), null);
    assert.equal(nextMenuIndex(0, 3, 'Enter'), null);
    assert.equal(nextMenuIndex(-1, 0, 'ArrowDown'), null);
});

test('tabWrapTarget: Tab wraps from the last control, Shift+Tab from the first', () => {
    assert.equal(tabWrapTarget(2, 3, false), 'first');
    assert.equal(tabWrapTarget(1, 3, false), null);
    assert.equal(tabWrapTarget(0, 3, true), 'last');
    assert.equal(tabWrapTarget(1, 3, true), null);
});

test('tabWrapTarget: from the dialog itself, Tab goes to the first control and Shift+Tab to the last', () => {
    assert.equal(tabWrapTarget(-1, 3, false), 'first');
    assert.equal(tabWrapTarget(-1, 3, true), 'last');
    assert.equal(tabWrapTarget(-1, 0, false), null);
});
