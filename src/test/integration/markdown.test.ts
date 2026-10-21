// Markdown host behavior in a real VS Code: CSP nonce, image roots after a move.

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { parseCsp } from '../../shared/webviewCsp';
import { closeAllEditors, cspOf, fixtureDir, openInSheetmark, sheetmark, waitFor } from './helpers';

suite('Markdown editor (host)', () => {
    teardown(closeAllEditors);

    test('the webview bundle loads and asks for the document (module script runs)', async () => {
        const api = await sheetmark();
        const file = path.join(fixtureDir({ 'boot.md': '# Boot\n\n```mermaid\ngraph TD\n  A --> B\n```\n' }), 'boot.md');
        const editor = await openInSheetmark(api, file, 'xlsxViewer.md');
        // initMarkdown is only sent in reply to the webview's webviewReady, so this proves the
        // ES-module bundle loaded under the CSP and ran.
        await waitFor('initMarkdown reply to webviewReady', () => editor.sent().some((m: any) => m?.command === 'initMarkdown'));
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
