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

// @@F06
test('a table\'s box includes all of its spacing, so the next line starts right below it', async () => {
    // Space that escapes the widget box is invisible to CodeMirror's height map, which makes the
    // page jump by that amount whenever a table scrolls into view.
    await openDoc('Before.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter the table.\n');
    await webview.page.waitForSelector('.cm-md-table-widget', { timeout: 5000 });
    const gap = await webview.page.evaluate(() => {
        const widget = document.querySelector('.cm-md-table-widget')!;
        return widget.nextElementSibling!.getBoundingClientRect().top - widget.getBoundingClientRect().bottom;
    });
    assert.ok(Math.abs(gap) < 1, `the line after the table starts ${gap}px below the table's box`);
});

// @@F12
test('the / menu lists commands in their designed order, and Quote shows its own shortcut', async () => {
    await openDoc('Paragraph.\n\n');
    await webview.page.locator('.cm-content > .cm-line').last().click();
    await webview.page.keyboard.type('/');
    await webview.page.waitForSelector('.cm-tooltip-autocomplete.cm-slash-menu-tooltip li', { timeout: 5000 });
    const rows = await webview.page.evaluate(() => [...document.querySelectorAll('.cm-tooltip-autocomplete.cm-slash-menu-tooltip li')].map(li => ({
        label: li.querySelector('.cm-completionLabel')?.textContent ?? '',
        detail: li.querySelector('.cm-completionDetail')?.textContent ?? '',
    })));
    assert.deepEqual(rows.slice(0, 5).map(r => r.label), ['Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4']);
    assert.equal(rows.find(r => r.label === 'Quote')?.detail, '"');
    await webview.page.keyboard.press('Escape');
});

// @@F07
test('adding a toggle does not move the rest of the text, and its hover handle stays inside the editor', async () => {
    const textX = () => webview.page.evaluate(() => {
        const lineEl = [...document.querySelectorAll('.cm-content > .cm-line')].find(l => l.textContent?.includes('Plain paragraph'))!;
        const range = document.createRange();
        range.setStart(lineEl.firstChild!, 0);
        range.setEnd(lineEl.firstChild!, 1);
        return range.getBoundingClientRect().left;
    });
    await openDoc('Plain paragraph.\n\nAnother paragraph.\n');
    const withoutToggle = await textX();
    await openDoc('Plain paragraph.\n\n<details open>\n<summary>\n\nA toggle\n\n</summary>\n\nBody.\n\n</details>\n');
    const withToggle = await textX();
    assert.ok(Math.abs(withToggle - withoutToggle) < 0.5, `text moved from x=${withoutToggle} to x=${withToggle} when the file got a toggle`);
    await webview.page.locator('.cm-content > .cm-line', { hasText: 'A toggle' }).first().hover();
    const clipped = await webview.page.evaluate(() => {
        const handle = document.querySelector('.cm-md-details-handle')!.getBoundingClientRect();
        return handle.left < document.querySelector('.cm-scroller')!.getBoundingClientRect().left;
    });
    assert.equal(clipped, false, 'the toggle hover handle is cut off at the editor edge');
});

// @@F09
test('card edges (YAML, code, callout, table, image, rule) line up with the body text', async () => {
    const png = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjIwIiBmaWxsPSJyZWQiLz48L3N2Zz4=';
    await openDoc(`---\ntitle: Cards\n---\n\nPlain paragraph text.\n\n\`\`\`ts\nconst codeLine = 1;\n\`\`\`\n\n::: info\nFirst callout line.\nSecond callout line.\n:::\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![img](${png})\n\n---\n\nAfter.\n`);
    await webview.page.waitForSelector('.cm-md-table-scroll', { timeout: 5000 });
    const x = await webview.page.evaluate(() => {
        const glyph: Record<string, number> = {};
        for (const [key, text] of [['body', 'Plain paragraph'], ['code', 'const codeLine'], ['callout1', 'First callout'], ['callout2', 'Second callout']]) {
            const lineEl = [...document.querySelectorAll('.cm-content > .cm-line')].find(l => l.textContent?.includes(text))!;
            const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
            let node = walker.nextNode();
            while (node && !node.textContent?.trim()) { node = walker.nextNode(); }
            const range = document.createRange();
            const offset = node!.textContent!.search(/\S/);
            range.setStart(node!, offset);
            range.setEnd(node!, offset + 1);
            glyph[key] = range.getBoundingClientRect().left;
        }
        for (const [key, selector] of [['yaml', '.cm-md-frontmatter-widget > *'], ['codeCard', '.cm-md-fenced-code-line-first'],
            ['calloutCard', '.cm-md-callout-line-first'], ['table', '.cm-md-table-scroll'], ['image', '.cm-md-image-preview'], ['rule', '.cm-md-hr-widget']]) {
            glyph[key] = document.querySelector(selector)!.getBoundingClientRect().left;
        }
        return glyph;
    });
    for (const key of ['yaml', 'codeCard', 'calloutCard', 'table', 'image', 'rule'] as const) {
        assert.ok(Math.abs(x[key] - x.body) <= 1, `${key} edge at x=${x[key]}, body text at x=${x.body}`);
    }
    assert.ok(Math.abs(x.code - (x.body + 13)) <= 1, `code text at x=${x.code}, expected 13px inside the card (${x.body + 13})`);
    assert.ok(Math.abs(x.callout2 - x.callout1) <= 0.5, `callout lines start at x=${x.callout1} and x=${x.callout2}`);
});
