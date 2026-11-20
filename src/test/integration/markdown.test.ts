// Markdown host behavior in a real VS Code: CSP nonce, image roots after a move.

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseCsp } from '../../shared/webviewCsp';
import { closeAllEditors, cspOf, fixtureDir, openInSheetmark, sheetmark, waitFor } from './helpers';

suite('Markdown editor (host)', () => {
    teardown(closeAllEditors);

    test('the document is embedded in the page and the webview renders it without asking again', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'boot.md': '# Boot\n\n```mermaid\ngraph TD\n  A --> B\n```\n' }), 'boot.md');
        const editor = await openInSheetmark(api, file, 'xlsxViewer.md');
        assert.ok(editor.panel.webview.html.includes('"content":"# Boot'), 'initMarkdown embedded in the HTML');
        // setTheme is only sent in reply to the webview's webviewReady, so this proves the
        // ES-module bundle loaded under the CSP and ran.
        await waitFor('setTheme reply to webviewReady', () => editor.sent().some((m: any) => m?.type === 'setTheme'));
        // sent() also lists the embedded messages: exactly one copy of each means no resend.
        const count = (command: string) => editor.sent().filter((m: any) => m?.command === command).length;
        assert.deepEqual([count('initMarkdown'), count('initSettings')], [1, 1], 'the webview applied the embedded messages, so the host sends no copy');
    });

    test('a later webviewReady (Retry, webview reload) gets the current file, settings and font again', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'again.md': '# First\n' }), 'again.md');
        const editor = await openInSheetmark(api, file, 'xlsxViewer.md');
        await waitFor('first webviewReady handled', () => editor.sent().some((m: any) => m?.type === 'setTheme'));

        // The page's HTML still embeds "# First": a reload would show stale text without a fresh copy.
        fs.writeFileSync(file, '# Second\n');
        const before = editor.sent().length;
        await editor.dispatch({ command: 'webviewReady', appliedInitialMessages: true });
        const reply = editor.sent().slice(before) as any[];
        const commands = reply.map(m => m?.command);
        const init = reply.find(m => m?.command === 'initMarkdown');
        assert.equal(init?.content, '# Second\n');
        assert.ok(commands.includes('initSettings') && commands.includes('fontFamilyChanged'), commands.join(', '));
    });

    test('every script tag carries the CSP nonce and inline script is otherwise blocked', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'doc.md': '# Hello\n' }), 'doc.md');
        const editor = await openInSheetmark(api, file, 'xlsxViewer.md');

        const html = editor.panel.webview.html;
        const scriptSrc = parseCsp(cspOf(html)).get('script-src') ?? [];
        assert.ok(!scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'unsafe-eval'"), scriptSrc.join(' '));
        const nonce = scriptSrc.find(source => source.startsWith("'nonce-"))?.slice(7, -1);
        assert.ok(nonce, 'script-src must carry a nonce');
        const scripts = html.match(/<script\b[^>]*>/g) ?? [];
        assert.ok(scripts.length >= 2, 'expected the bootstrap and bundle scripts');
        for (const tag of scripts) {
            assert.ok(tag.includes(`nonce="${nonce}"`), `script without nonce: ${tag}`);
        }
    });

    test('renaming an open file reopens it in Sheetmark with images allowed from the new folder', async () => {
        // VS Code disposes the panel on rename and opens a new editor at the new path, so this
        // exercises resolveCustomEditor's resource roots, not the in-panel move handling.
        const api = await sheetmark();
        const workbench = vscode.workspace.getConfiguration('workbench');
        await workbench.update('editorAssociations', { '*.md': 'xlsxViewer.md' }, vscode.ConfigurationTarget.Global);
        try {
            const dir = fixtureDir({ 'a/doc.md': '# Moved\n\n![pic](pic.png)\n' });
            const from = vscode.Uri.file(path.join(dir, 'a', 'doc.md'));
            const to = vscode.Uri.file(path.join(dir, 'b', 'doc.md'));
            await openInSheetmark(api, from.fsPath, 'xlsxViewer.md');

            const edit = new vscode.WorkspaceEdit();
            edit.renameFile(from, to, { overwrite: false });
            assert.ok(await vscode.workspace.applyEdit(edit), 'rename failed');

            const moved = await waitFor('Sheetmark editor at the new path', () => api.openEditors().find(editor => editor.uri().fsPath === to.fsPath));
            const roots = (moved.panel.webview.options.localResourceRoots ?? []).map(root => root.fsPath);
            assert.ok(roots.includes(path.dirname(to.fsPath)), roots.join(', '));
        } finally {
            await workbench.update('editorAssociations', undefined, vscode.ConfigurationTarget.Global);
        }
    });
});
