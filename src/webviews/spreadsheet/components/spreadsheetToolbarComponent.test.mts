// Headless test: the spreadsheet toolbar's first row, matched to the Markdown toolbar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createXlsxToolbarButtons, type CreateXlsxToolbarButtonsOptions } from './spreadsheetToolbarComponent.ts';

const options = new Proxy({}, { get: () => () => {} }) as CreateXlsxToolbarButtonsOptions;

test('spreadsheet toolbar: find, history, convert, help and settings sit at the right end, settings last', () => {
    const buttons = createXlsxToolbarButtons(options);
    assert.deepEqual(buttons.filter(b => b.section === 'end').map(b => b.id),
        ['findButton', 'versionHistoryButton', 'convertFileButton', 'helpButton', 'openSettingsButton']);
    assert.equal(buttons[buttons.length - 1].id, 'openSettingsButton');
});

test('spreadsheet toolbar row 1: Reload from Disk, Save, Undo, Redo, then Column widths', () => {
    const buttons = createXlsxToolbarButtons(options);
    assert.deepEqual(buttons.filter(b => b.section !== 'end').map(b => b.id),
        ['refreshButton', 'saveEditsButton', 'undoEditsButton', 'redoEditsButton', 'toggleExpandButton']);
    const byId = (id: string) => buttons.find(b => b.id === id)!;
    assert.equal(byId('refreshButton').tooltip, 'Reload from Disk');
    assert.equal(byId('saveEditsButton').tooltip, 'Save Changes (Ctrl/Cmd+S)');
    assert.equal(byId('undoEditsButton').tooltip, 'Undo (Ctrl/Cmd+Z)');
    assert.equal(byId('redoEditsButton').tooltip, 'Redo (Ctrl/Cmd+Shift+Z)');
});

test('spreadsheet toolbar has no mode buttons and no duplicated formatting buttons', () => {
    const ids = createXlsxToolbarButtons(options).map(b => b.id);
    for (const gone of ['toggleTableEditButton', 'cancelTableEditsButton', 'togglePlainViewButton', 'insertControlButton',
        'formatBoldButton', 'formatItalicButton', 'formatTextColorButton', 'formatBackgroundColorButton']) {
        assert.ok(!ids.includes(gone), `${gone} should not be in row 1`);
    }
});
