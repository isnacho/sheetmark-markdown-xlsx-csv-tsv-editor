// Headless test: the spreadsheet toolbar's button order, matched to the Markdown toolbar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createXlsxToolbarButtons, type CreateXlsxToolbarButtonsOptions } from './spreadsheetToolbarComponent.ts';

const options = new Proxy({}, { get: (_, key) => (key === 'textColorIcon' || key === 'bgColorIcon' ? '' : () => {}) }) as CreateXlsxToolbarButtonsOptions;

test('spreadsheet toolbar: find, history, convert, help and settings sit at the right end, settings last', () => {
    const buttons = createXlsxToolbarButtons(options);
    assert.deepEqual(buttons.filter(b => b.section === 'end').map(b => b.id),
        ['findButton', 'versionHistoryButton', 'convertFileButton', 'helpButton', 'openSettingsButton']);
    assert.equal(buttons[buttons.length - 1].id, 'openSettingsButton');
    assert.equal(buttons[0].id, 'refreshButton');
});
