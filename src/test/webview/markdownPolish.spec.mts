// Markdown editor polish fixes from the 2026-11-12 UI review (.docs/product/UI-REVIEW-2026-11-12.md),
// each pinned in headless Chrome with the real bundle, HTML shell and CSP.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness, openWebview, type WebviewHarness } from './harness.mts';
import type { HostToMarkdownWebview, MarkdownSettings } from '../../protocol/markdown.ts';

const SETTINGS: MarkdownSettings = {
    stickyToolbar: true, wordWrap: true, showOutline: true, showLineNumbers: true, livePreviewReveal: true,
    livePreviewLineNumbers: false, autoSave: false, isDefaultEditor: false, showStats: true, statsShowLines: true,
    statsShowWords: true, statsShowChars: true, statsShowReadingTime: true, showCursorPosition: true,
    diffReviewEnabled: false, diffLayout: 'inline',
};

let webview: WebviewHarness;

before(async () => {
    webview = await openWebview('markdown');
    await webview.page.setViewportSize({ width: 1000, height: 800 });
    await webview.waitForPosted('webviewReady');
    await webview.send({ command: 'initSettings', settings: SETTINGS } satisfies HostToMarkdownWebview);
});
after(closeHarness);

async function openDoc(content: string): Promise<void> {
    await webview.send({
        command: 'initMarkdown', content, fileName: 'test.md', documentUri: 'file:///tmp/test.md',
        documentDirUri: 'file:///tmp', workspaceFolderUri: null, tableColumnWidths: {},
        frontmatterPanelCollapsed: false, detailsOpenState: {}, mermaidPreviewMode: 'diagram', calloutDefaultType: 'info',
    } satisfies HostToMarkdownWebview);
    await webview.page.waitForSelector('.cm-content .cm-line', { timeout: 10000 });
    await webview.page.waitForTimeout(200);
}

// @@F01
test('headings far down a long document get their heading style without any edit', async () => {
    // Long enough that CodeMirror cannot parse it all when the editor opens; the rest is parsed in
    // the background, which is not a text change.
    const section = (i: number) => `## Section ${i}\n\n${'Filler text for a long document. '.repeat(6)}\n\n- item\n- item\n`;
    await openDoc(Array.from({ length: 1500 }, (_, i) => section(i)).join('\n') + '\n## Final heading\n\nlast line\n');
    await webview.page.evaluate(() => { const s = document.querySelector('.cm-scroller')!; s.scrollTop = s.scrollHeight; });
    const styled = await webview.page.waitForFunction(() => {
        document.querySelector('.cm-scroller')!.scrollTop = 1e9;
        const heading = [...document.querySelectorAll('.cm-content > .cm-line')].find(l => l.textContent?.includes('Final heading'));
        return heading?.classList.contains('cm-md-heading-line') ?? false;
    }, undefined, { timeout: 8000, polling: 200 }).then(() => true, () => false);
    assert.ok(styled, 'the last heading never got the cm-md-heading-line class');
});

// @@F02
const line = (text: string) => webview.page.locator('.cm-content > .cm-line', { hasText: text }).first();

test('Cmd/Ctrl+F moves focus into the search box, so typing searches instead of editing', async () => {
    await openDoc('First paragraph.\n\nSecond paragraph with words.\n');
    await line('Second paragraph').click();
    await webview.page.keyboard.press('Control+f');
    assert.equal(await webview.page.evaluate(() => document.activeElement?.id), 'searchInput');
    await webview.page.keyboard.type('words');
    assert.equal(await webview.page.inputValue('#searchInput'), 'words');
    assert.ok(!(await line('Second paragraph').textContent())?.includes('wordswords'), 'the query was typed into the document');
    await webview.page.keyboard.press('Escape');
});

// @@F03
test('the / menu stays below the toolbar when it opens upward', async () => {
    await webview.page.setViewportSize({ width: 1000, height: 560 });
    try {
        await openDoc(Array.from({ length: 60 }, (_, i) => `Line ${i}`).join('\n\n') + '\n');
        // A line in the lower part of the window, so the menu has more room above than below.
        const target = await webview.page.evaluate(() => {
            const lines = [...document.querySelectorAll('.cm-content > .cm-line')];
            return lines.find(l => { const r = l.getBoundingClientRect(); return r.top > 400 && r.top < 460 && l.textContent; })?.textContent ?? null;
        });
        assert.ok(target, 'no line in the lower part of the window');
        await line(target!).click();
        await webview.page.keyboard.press('End');
        await webview.page.keyboard.press('Enter');
        await webview.page.keyboard.type('/');
        await webview.page.waitForSelector('.cm-tooltip-autocomplete.cm-slash-menu-tooltip li', { timeout: 5000 });
        await webview.page.waitForTimeout(150);
        const geometry = await webview.page.evaluate(() => {
            const tip = document.querySelector('.cm-tooltip-autocomplete.cm-slash-menu-tooltip')!.getBoundingClientRect();
            const first = document.querySelector('.cm-tooltip-autocomplete.cm-slash-menu-tooltip li')!.getBoundingClientRect();
            const scroller = document.querySelector('.cm-scroller')!.getBoundingClientRect();
            return { tipTop: tip.top, tipBottom: tip.bottom, firstTop: first.top, scrollerTop: scroller.top, viewport: innerHeight };
        });
        assert.ok(geometry.scrollerTop > 20, `expected a toolbar above the editor, scroller top is ${geometry.scrollerTop}`);
        assert.ok(geometry.tipTop >= geometry.scrollerTop - 1, `menu top ${geometry.tipTop} is under the toolbar (editor starts at ${geometry.scrollerTop})`);
        assert.ok(geometry.firstTop >= geometry.scrollerTop - 1, 'the first command is hidden under the toolbar');
        assert.ok(geometry.tipBottom <= geometry.viewport + 1, 'the menu runs off the bottom of the window');
        await webview.page.keyboard.press('Escape');
    } finally {
        await webview.page.setViewportSize({ width: 1000, height: 800 });
    }
});

// @@F04
test('the focused selection uses the theme selection colour, not CodeMirror\'s built-in light one', async () => {
    await openDoc('Select this paragraph.\n\nAnother one.\n');
    await webview.page.evaluate(() => document.body.style.setProperty('--color-selection-bg', 'rgb(1, 2, 3)'));
    await line('Select this').click();
    await webview.page.keyboard.press('Home');
    await webview.page.keyboard.press('Shift+End');
    await webview.page.waitForTimeout(100);
    const background = await webview.page.evaluate(() => {
        const layer = document.querySelector('.cm-editor.cm-focused .cm-selectionBackground');
        return layer ? getComputedStyle(layer).backgroundColor : null;
    });
    assert.equal(background, 'rgb(1, 2, 3)');
});

// @@F05
test('an image\'s alt-text placeholder is not shown once the image is there', async () => {
    const svg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjIwIiBmaWxsPSJyZWQiLz48L3N2Zz4=';
    await openDoc(`Intro paragraph.\n\n![Alt text bar](${svg})\n\nAfter.\n`);
    await webview.page.waitForSelector('.cm-md-image-block img', { timeout: 5000 });
    const placeholder = await webview.page.evaluate(() => {
        const el = document.querySelector('.cm-md-image-block .cm-md-image-placeholder') as HTMLElement | null;
        return el ? { hidden: el.hidden, display: getComputedStyle(el).display, height: el.getBoundingClientRect().height } : null;
    });
    assert.ok(placeholder, 'no placeholder element');
    assert.equal(placeholder!.hidden, true, 'the widget should mark the placeholder hidden for a loaded image');
    assert.equal(placeholder!.display, 'none');
    assert.equal(placeholder!.height, 0);
});
