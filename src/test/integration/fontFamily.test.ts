// The shared font setting (xlsxViewer.fontFamily) in a real VS Code: both editors get it on load,
// and a pick in one editor is saved and reaches the other.

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { closeAllEditors, fixtureDir, openInSheetmark, sheetmark, waitFor } from './helpers';

const config = () => vscode.workspace.getConfiguration('xlsxViewer');
const fontMessages = (editor: { sent(): readonly unknown[] }) =>
    editor.sent().filter((m): m is { command: string; font: string } => (m as { command?: string })?.command === 'fontFamilyChanged');

suite('Font setting (host)', () => {
    teardown(async () => {
        await config().update('fontFamily', undefined, vscode.ConfigurationTarget.Global);
        await closeAllEditors();
    });

    test('both editors load the saved font, and picking one saves it and reaches the other editor', async () => {
        await config().update('fontFamily', 'serif', vscode.ConfigurationTarget.Global);
        const api = await sheetmark();
        const dir = fixtureDir({ 'a.csv': 'name,score\nada,1\n', 'b.md': '# Hello\n' });
        const csv = await openInSheetmark(api, path.join(dir, 'a.csv'), 'xlsxViewer.csv');
        const md = await openInSheetmark(api, path.join(dir, 'b.md'), 'xlsxViewer.md');

        // Each real webview announces itself, and the host answers with the font.
        await waitFor('the spreadsheet to get the saved font', () => fontMessages(csv).some(m => m.font === 'serif'));
        await waitFor('the Markdown editor to get the saved font', () => fontMessages(md).some(m => m.font === 'serif'));

        await md.dispatch({ command: 'setFontFamily', font: 'system' });
        assert.strictEqual(config().get('fontFamily'), 'system');
        await waitFor('the spreadsheet to hear about the change', () => fontMessages(csv).at(-1)?.font === 'system');
    });

    test('picking an installed font saves its name, and a value that cannot be a font name is never written', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'b.md': '# Hello\n' }), 'b.md');
        const md = await openInSheetmark(api, file, 'xlsxViewer.md');

        await md.dispatch({ command: 'setFontFamily', font: 'Helvetica Neue' });
        assert.strictEqual(config().get('fontFamily'), 'Helvetica Neue');

        // Webview input is untrusted: none of these reaches the user's settings.
        for (const font of ['', '   ', null, 7, { toString: 1 }, 'a";b', 'a\\b', '<script>', 'x'.repeat(200), '.SF NS']) {
            await md.dispatch({ command: 'setFontFamily', font });
        }
        assert.strictEqual(config().get('fontFamily'), 'Helvetica Neue');
    });

    test('a setting that cannot be a font name falls back to Inter', async () => {
        const api = await sheetmark();
        // Settings JSON can hold anything, even though the editors only write good values.
        await config().update('fontFamily', 'Arial"; background: red', vscode.ConfigurationTarget.Global);
        const file = path.join(fixtureDir({ 'b.md': '# Hello\n' }), 'b.md');
        const md = await openInSheetmark(api, file, 'xlsxViewer.md');
        await waitFor('the Markdown editor to get a font', () => fontMessages(md).at(-1));
        assert.strictEqual(fontMessages(md).at(-1)?.font, 'inter');
    });

    test('requestLocalFonts answers with the installed font families, never a built-in name or a hidden font', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'b.md': '# Hello\n' }), 'b.md');
        const md = await openInSheetmark(api, file, 'xlsxViewer.md');

        await md.dispatch({ command: 'requestLocalFonts' });
        const reply = await waitFor('the font list', () =>
            md.sent().find((m): m is { command: 'localFonts'; fonts: string[] } => (m as { command?: string })?.command === 'localFonts'));

        assert.ok(Array.isArray(reply.fonts) && reply.fonts.every(name => typeof name === 'string' && name.length > 0));
        assert.ok(!reply.fonts.some(name => name.startsWith('.') || ['inter', 'system', 'serif'].includes(name.toLowerCase())));
        if (process.platform === 'darwin') {
            // macOS always has fonts to list; an empty list would mean the osascript route broke.
            assert.ok(reply.fonts.length > 20, `only ${reply.fonts.length} fonts listed`);
            assert.ok(reply.fonts.includes('Helvetica Neue'));
        }
    });
});
