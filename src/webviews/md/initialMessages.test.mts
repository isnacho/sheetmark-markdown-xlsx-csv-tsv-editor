// The host's embedded first messages (renderMarkdownHtml) read back by the webview
// (readInitialMessages), including hostile document text that tries to break out of the block.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { renderMarkdownHtml, serializeInitialMessages } from '../../shared/webviewHtml.ts';
import type { HostToMarkdownWebview } from '../../protocol/markdown.ts';
import { readInitialMessages, revealAndApplyInitialMessages } from './initialMessages.ts';

const HOSTILE = '# Title\n\n</script><script>alert(1)</script><!-- <img src=x onerror=alert(2)>   & done';

function messages(content: string): HostToMarkdownWebview[] {
    return [
        {
            command: 'initMarkdown', content, fileName: 'a.md', documentUri: 'file:///a.md', documentDirUri: 'file:///',
            workspaceFolderUri: null, tableColumnWidths: {}, frontmatterPanelCollapsed: false, detailsOpenState: {},
            mermaidPreviewMode: 'diagram', calloutDefaultType: 'info', outlinePinned: false,
        },
        { command: 'fontFamilyChanged', font: 'inter' },
    ];
}

function shell(initialMessages?: HostToMarkdownWebview[]) {
    const html = renderMarkdownHtml({ asset: (p) => `https://res.example/${p}`, cspSource: 'https://res.example', nonce: 'n0nce', initialMessages });
    return { html, document: parseHTML(html).document as unknown as Document };
}

test('serialized messages contain no raw < or line separators', () => {
    const json = serializeInitialMessages(messages(HOSTILE));
    assert.ok(!json.includes('<'));
    assert.ok(!json.includes(' ') && !json.includes(' '));
    assert.deepEqual(JSON.parse(json), messages(HOSTILE));
});

test('hostile document text stays inside the data block and reads back unchanged', () => {
    const { html, document } = shell(messages(HOSTILE));
    // Only the shell's own three scripts: the data block, the bootstrap and the bundle.
    assert.equal(document.querySelectorAll('script').length, 3);
    assert.equal(document.querySelectorAll('img').length, 1, 'only the lightbox image');
    assert.ok(html.includes('id="sheetmarkInitialMessages" nonce="n0nce"'));
    assert.deepEqual(readInitialMessages(document), messages(HOSTILE));
    assert.equal(document.getElementById('sheetmarkInitialMessages'), null, 'block removed once read');
});

test('no data block without initial messages, and a malformed one is ignored', () => {
    const { html, document } = shell();
    assert.ok(!html.includes('sheetmarkInitialMessages'));
    assert.deepEqual(readInitialMessages(document), []);

    const broken = parseHTML('<script type="application/json" id="sheetmarkInitialMessages">{not json</script>').document as unknown as Document;
    assert.deepEqual(readInitialMessages(broken), []);
    const notMessages = parseHTML('<script type="application/json" id="sheetmarkInitialMessages">[1,"x",{"no":"command"}]</script>').document as unknown as Document;
    assert.deepEqual(readInitialMessages(notMessages), []);
});

test('reveal removes the boot style before delivering the messages in order', () => {
    const { document } = shell(messages('# A\n'));
    assert.ok(document.getElementById('sheetmarkBootStyle'), 'shell starts hidden');
    const seen: string[] = [];
    const applied = revealAndApplyInitialMessages(document, (m) => {
        assert.equal(document.getElementById('sheetmarkBootStyle'), null, 'visible before the first message');
        seen.push('command' in m ? m.command : m.type);
    });
    assert.equal(applied, true);
    assert.deepEqual(seen, ['initMarkdown', 'fontFamilyChanged']);
    assert.equal(revealAndApplyInitialMessages(shell().document, () => assert.fail('no messages')), false);
});
