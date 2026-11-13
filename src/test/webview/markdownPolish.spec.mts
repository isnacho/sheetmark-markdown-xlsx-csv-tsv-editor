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
    // An assertion, not `satisfies`: `outlinePinned` is new (uncommitted outline work at the time of
    // writing), and this has to compile both with and without it.
    await webview.send({
        command: 'initMarkdown', content, fileName: 'test.md', documentUri: 'file:///tmp/test.md',
        documentDirUri: 'file:///tmp', workspaceFolderUri: null, tableColumnWidths: {},
        frontmatterPanelCollapsed: false, detailsOpenState: {}, mermaidPreviewMode: 'diagram', calloutDefaultType: 'info',
        outlinePinned: false,
    } as HostToMarkdownWebview);
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
    // A short window, so even the committed 10em menu (the WIP raises it to 12+ rows) has more
    // room above the cursor than below and, measured against the whole window, opens upward.
    await webview.page.setViewportSize({ width: 1000, height: 320 });
    try {
        await openDoc(Array.from({ length: 60 }, (_, i) => `Line ${i}`).join('\n\n') + '\n');
        // A line a little below the toolbar: the new line under it (where "/" is typed) has more
        // room above than below, and the room above measured from the window top fits the menu,
        // so without a tooltip space that excludes the toolbar the menu opens upward under it.
        const target = await webview.page.evaluate(() => {
            const scroller = document.querySelector('.cm-scroller')!.getBoundingClientRect();
            const lines = [...document.querySelectorAll('.cm-content > .cm-line')];
            return lines.find(l => { const r = l.getBoundingClientRect(); return r.top > scroller.top + 52 && r.top < scroller.top + 107 && l.textContent; })?.textContent ?? null;
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

// @@F10
test('lists and quotes use one 20px step: markers on the text edge, text one step in, nested one more', async () => {
    const ordered = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'].map((w, i) => `${i + 1}. ${w} item`).join('\n');
    await openDoc(`Body paragraph.\n\n- Bullet one\n  - Nested bullet\n- [ ] Task item\n\n${ordered}\n\n> Quote text here\n\nEnd.\n`);
    const x = await webview.page.evaluate(() => {
        const out: Record<string, number> = {};
        for (const [key, text] of [['body', 'Body paragraph'], ['bullet', 'Bullet one'], ['nested', 'Nested bullet'], ['task', 'Task item'],
            ['nine', 'Nine item'], ['ten', 'Ten item'], ['one', 'One item'], ['quote', 'Quote text']]) {
            const lineEl = [...document.querySelectorAll('.cm-content > .cm-line')].find(l => l.textContent?.includes(text))!;
            const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
            let node = walker.nextNode();
            while (node && !node.textContent?.includes(text)) { node = walker.nextNode(); }
            const range = document.createRange();
            const offset = node!.textContent!.indexOf(text);
            range.setStart(node!, offset);
            range.setEnd(node!, offset + 1);
            out[key] = range.getBoundingClientRect().left;
        }
        const dots = [...document.querySelectorAll('.cm-md-bullet-marker')];
        out.dot = dots.find(d => !d.classList.contains('cm-md-bullet-marker-nested'))!.getBoundingClientRect().left;
        out.nestedDot = dots.find(d => d.classList.contains('cm-md-bullet-marker-nested'))!.getBoundingClientRect().left;
        out.checkbox = document.querySelector('.cm-md-task-checkbox')!.getBoundingClientRect().left;
        out.quoteBar = document.querySelector('.cm-md-blockquote-line')!.getBoundingClientRect().left;
        return out;
    });
    const expect = (key: string, want: number) => assert.ok(Math.abs(x[key] - want) <= 1, `${key} at x=${x[key]}, expected ${want} (body text at ${x.body})`);
    for (const key of ['dot', 'checkbox', 'quoteBar']) { expect(key, x.body); }
    for (const key of ['bullet', 'task', 'one', 'quote', 'nestedDot']) { expect(key, x.body + 20); }
    expect('nested', x.body + 40);
    assert.ok(Math.abs(x.ten - x.nine) <= 0.5, `"10." pushed its text to x=${x.ten}, "9." text is at x=${x.nine}`);
});

// @@F08
test('blocks are spaced like paragraphs: no hidden extra space around cards, the rule is centred', async () => {
    const svg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjIwIiBmaWxsPSJyZWQiLz48L3N2Zz4=';
    await openDoc(`---\ntitle: Rhythm\n---\n\nP1 first.\n\nP2 second.\n\n\`\`\`ts\nconst gapCode = 1;\n\`\`\`\n\nP3 after code.\n\n::: info\nCallout body.\n:::\n\nP4 after callout.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nP5 after table.\n\n![img](${svg})\n\nP6 after image.\n\n---\n\nP7 after rule.\n`);
    await webview.page.waitForSelector('.cm-md-image-block img', { timeout: 5000 });
    await webview.page.waitForTimeout(300);
    const m = await webview.page.evaluate((): Record<string, { top: number; bottom: number }> => {
        const rect: Record<string, DOMRect> = {};
        for (const p of ['P1 first', 'P2 second', 'P3 after code', 'P4 after callout', 'P5 after table', 'P6 after image', 'P7 after rule', 'Callout body']) {
            rect[p] = [...document.querySelectorAll('.cm-content > .cm-line')].find(l => l.textContent?.includes(p))!.getBoundingClientRect();
        }
        for (const [key, selector] of [['yaml', '.cm-md-frontmatter-widget > *'], ['codeTop', '.cm-md-fenced-code-line-first'], ['codeBottom', '.cm-md-fenced-code-line-last'],
            ['calloutTop', '.cm-md-callout-line-first'], ['calloutBottom', '.cm-md-callout-line-last'], ['table', '.cm-md-table-scroll'], ['image', '.cm-md-image-preview'], ['rule', '.cm-md-hr-widget']]) {
            rect[key] = document.querySelector(selector)!.getBoundingClientRect();
        }
        // Where the rule is drawn: a top border paints at the box top, a centred background at its middle.
        const ruleEl = document.querySelector('.cm-md-hr-widget')!;
        const ruleLineY = parseFloat(getComputedStyle(ruleEl).borderTopWidth) > 0 ? rect.rule.top + 0.5 : (rect.rule.top + rect.rule.bottom) / 2;
        return { ...Object.fromEntries(Object.entries(rect).map(([k, r]) => [k, { top: r.top, bottom: r.bottom }])), ruleLine: { top: ruleLineY, bottom: ruleLineY } };
    });
    const paragraphGap = m['P2 second'].top - m['P1 first'].bottom;
    const gaps: Record<string, number> = {
        'YAML card to text': m['P1 first'].top - m.yaml.bottom,
        'text to code': m.codeTop.top - m['P2 second'].bottom,
        'code to text': m['P3 after code'].top - m.codeBottom.bottom,
        'text to callout': m.calloutTop.top - m['P3 after code'].bottom,
        'callout to text': m['P4 after callout'].top - m.calloutBottom.bottom,
        'text to table': m.table.top - m['P4 after callout'].bottom,
        'table to text': m['P5 after table'].top - m.table.bottom,
        'text to image': m.image.top - m['P5 after table'].bottom,
        'image to text': m['P6 after image'].top - m.image.bottom,
    };
    for (const [pair, gap] of Object.entries(gaps)) {
        assert.ok(Math.abs(gap - paragraphGap) <= 6, `${pair}: ${gap.toFixed(1)}px, paragraphs are ${paragraphGap.toFixed(1)}px apart`);
    }
    const above = m.ruleLine.top - m['P6 after image'].bottom;
    const below = m['P7 after rule'].top - m.ruleLine.top;
    assert.ok(Math.abs(above - below) <= 2, `rule is ${above.toFixed(1)}px below the text above and ${below.toFixed(1)}px above the text below`);
    const padTop = m['Callout body'].top - m.calloutTop.top;
    const padBottom = m.calloutBottom.bottom - m['Callout body'].bottom;
    assert.ok(Math.abs(padTop - padBottom) <= 1 && padTop <= 20, `callout inner padding ${padTop.toFixed(1)}px top, ${padBottom.toFixed(1)}px bottom`);
});

// @@F05b
test('an image whose file is not resolved shows only its placeholder, no broken-picture box', async () => {
    await openDoc('Intro paragraph.\n\n![Missing picture](missing-file.png)\n\nAfter.\n');
    await webview.page.waitForSelector('.cm-md-image-block .cm-md-image-placeholder', { timeout: 5000 });
    const state = await webview.page.evaluate(() => {
        const img = document.querySelector('.cm-md-image-block img') as HTMLImageElement | null;
        const placeholder = document.querySelector('.cm-md-image-block .cm-md-image-placeholder') as HTMLElement;
        return { imgHidden: img?.hidden ?? true, imgDisplay: img ? getComputedStyle(img).display : 'none', placeholderShown: placeholder.getBoundingClientRect().height > 0 };
    });
    assert.equal(state.imgHidden, true, 'the widget should hide an image it has no source for yet');
    assert.equal(state.imgDisplay, 'none');
    assert.equal(state.placeholderShown, true);
});

// @@F14
test('a heading\'s text stays put when the cursor reveals its # marker, which hangs in the margin', async () => {
    await openDoc('Intro paragraph.\n\n## Heading two\n\n### Heading three\n\nBody.\n');
    const measure = () => webview.page.evaluate(() => {
        const out: Record<string, number> = {};
        for (const [key, text] of [['h2', 'Heading two'], ['h3', 'Heading three']]) {
            const lineEl = [...document.querySelectorAll('.cm-content > .cm-line')].find(l => l.textContent?.includes(text))!;
            const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
            let node = walker.nextNode();
            while (node && !node.textContent?.includes(text)) { node = walker.nextNode(); }
            const range = document.createRange();
            const offset = node!.textContent!.indexOf(text);
            range.setStart(node!, offset);
            range.setEnd(node!, offset + 1);
            out[key] = range.getBoundingClientRect().left;
            out[key + 'Height'] = lineEl.getBoundingClientRect().height;
        }
        const marker = document.querySelector('.cm-md-heading-marker');
        if (marker) { const r = marker.getBoundingClientRect(); out.markerLeft = r.left; out.markerRight = r.right; }
        return out;
    });
    const before = await measure();
    await webview.page.locator('.cm-content > .cm-line', { hasText: 'Heading two' }).first().click();
    await webview.page.keyboard.press('End');
    await webview.page.waitForTimeout(150);
    const after = await measure();
    assert.ok(after.markerRight !== undefined, 'the # marker is not revealed on the cursor line');
    assert.ok(Math.abs(after.h2 - before.h2) <= 0.5, `heading text moved from x=${before.h2} to x=${after.h2}`);
    assert.ok(Math.abs(after.h2Height - before.h2Height) <= 0.5, 'the heading line changed height');
    assert.ok(after.markerRight! <= after.h2 + 1 && after.markerRight! - after.markerLeft! > 5, `marker spans x=${after.markerLeft}..${after.markerRight}, text starts at ${after.h2}`);
    // Typing at the end still edits the heading, and Home goes before the marker.
    await webview.page.keyboard.type(' edited');
    await webview.page.keyboard.press('Home');
    await webview.page.keyboard.type('#');
    const text = await webview.page.locator('.cm-content').textContent();
    assert.ok(text?.includes('### Heading two edited'), `unexpected editor text: ${text}`);
});

// @@F11
test('a code block shows a language label instead of its ``` markers, and reveals them only on their own line', async () => {
    await openDoc('Para.\n\n```ts\nconst fenceBody = 1;\n```\n\nAfter.\n');
    await webview.page.waitForSelector('.cm-md-fence-lang', { timeout: 5000 });
    const read = () => webview.page.evaluate(() => {
        const lines = [...document.querySelectorAll('.cm-content > .cm-md-fenced-code-line')];
        return {
            label: document.querySelector('.cm-md-fence-lang')?.textContent ?? null,
            text: lines.map(l => l.textContent).join('|'),
            openerHeight: lines[0].getBoundingClientRect().height,
            closerHeight: lines[lines.length - 1].getBoundingClientRect().height,
        };
    });
    const idle = await read();
    assert.equal(idle.label, 'ts');
    assert.ok(!idle.text.includes('```'), `fence markers are visible: ${idle.text}`);
    await webview.page.locator('.cm-content > .cm-line', { hasText: 'const fenceBody' }).first().click();
    const editingCode = await read();
    assert.equal(editingCode.label, 'ts', 'the label should stay while the cursor is in the code');
    await webview.page.locator('.cm-md-fence-lang').click();
    await webview.page.waitForTimeout(100);
    const onOpener = await read();
    assert.ok(onOpener.text.startsWith('```ts'), `the opener should show its raw marker for editing: ${onOpener.text}`);
    assert.ok(Math.abs(onOpener.openerHeight - idle.openerHeight) <= 0.5, `opener line height changed ${idle.openerHeight} -> ${onOpener.openerHeight}`);
    assert.ok(Math.abs(onOpener.closerHeight - idle.closerHeight) <= 0.5, `closer line height changed ${idle.closerHeight} -> ${onOpener.closerHeight}`);
});

// @@F24
test('the search box says what it does: find in this document', async () => {
    await openDoc('Some text.\n');
    assert.equal(await webview.page.getAttribute('#searchInput', 'placeholder'), 'Find in document');
    assert.equal(await webview.page.getAttribute('#searchInput', 'aria-label'), 'Find in document');
});

// @@F27
test('a toggle\'s hover handle is drawn dots, centred on the title like the arrow', async () => {
    await openDoc('Para.\n\n<details open>\n<summary>\n\nA toggle title\n\n</summary>\n\nBody.\n\n</details>\n');
    await webview.page.locator('.cm-content > .cm-line', { hasText: 'A toggle title' }).first().hover();
    const centres = await webview.page.evaluate(() => {
        const arrow = document.querySelector('.cm-md-details-chevron svg')!.getBoundingClientRect();
        const grip = document.querySelector('.cm-md-details-handle svg')?.getBoundingClientRect();
        return { arrow: (arrow.top + arrow.bottom) / 2, grip: grip ? (grip.top + grip.bottom) / 2 : null };
    });
    assert.ok(centres.grip !== null, 'the handle is a text glyph, not drawn dots');
    assert.ok(Math.abs(centres.grip - centres.arrow) <= 1, `handle centre ${centres.grip} vs arrow centre ${centres.arrow}`);
});
