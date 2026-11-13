// Notion-style block drag in the Markdown editor (blockDrag.ts, blockSelection.ts, blockModel.ts),
// driven with a real mouse in headless Chrome with the real bundle, HTML shell and CSP.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeHarness, openWebview, type WebviewHarness } from './harness.mts';
import type { HostToMarkdownWebview, MarkdownSettings } from '../../protocol/markdown.ts';

const SETTINGS: MarkdownSettings = {
    stickyToolbar: true, wordWrap: true, showOutline: false, showLineNumbers: true, livePreviewReveal: true,
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
        outlinePinned: false,
    } as HostToMarkdownWebview);
    await webview.page.waitForSelector('.cm-content .cm-line', { timeout: 10000 });
    await webview.page.waitForTimeout(200);
}

async function savedText(): Promise<string> {
    const before = (await webview.postedOf('saveMarkdown')).length;
    await webview.page.keyboard.press('Control+s');
    await webview.page.waitForFunction((n) => ((window as any).__posted as any[]).filter(m => m?.command === 'saveMarkdown').length > n, before);
    const all = await webview.postedOf('saveMarkdown');
    await webview.send({ command: 'saveResult', ok: true, isAutosave: false } satisfies HostToMarkdownWebview);
    return all[all.length - 1].text;
}

const line = (text: string) => webview.page.locator('.cm-content > .cm-line', { hasText: text }).first();

interface Box { x: number; y: number; width: number; height: number; }

/** Hover a line and return the grip's and the `+` button's boxes once the controls show. */
async function hoverControls(text: string): Promise<{ grip: Box; add: Box }> {
    const box = (await line(text).boundingBox())!;
    await webview.page.mouse.move(box.x + 20, box.y + box.height / 2);
    await webview.page.waitForSelector('.cm-md-block-controls.cm-md-block-controls-visible', { timeout: 2000 });
    const grip = (await webview.page.locator('.cm-md-block-grip').boundingBox())!;
    const add = (await webview.page.locator('.cm-md-block-add').boundingBox())!;
    return { grip, add };
}

const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Press on the grip of `text`'s block and release at (x, y), moving in steps. */
async function dragGrip(text: string, to: (lineBox: (t: string) => Promise<Box>) => Promise<{ x: number; y: number }>): Promise<void> {
    const { grip } = await hoverControls(text);
    const start = centre(grip);
    const page = webview.page;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const end = await to(async (t) => (await line(t).boundingBox())!);
    for (let i = 1; i <= 8; i++) {
        await page.mouse.move(start.x + (end.x - start.x) * i / 8, start.y + (end.y - start.y) * i / 8);
    }
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(100);
}

test('hovering a block shows + and the grip in the left margin; typing hides them', async () => {
    await openDoc('First paragraph.\n\nSecond paragraph.\n');
    const { grip, add } = await hoverControls('Second paragraph');
    const text = (await line('Second paragraph').boundingBox())!;
    assert.ok(grip.x + grip.width <= text.x + 1, `grip (right ${grip.x + grip.width}) overlaps the text (left ${text.x})`);
    assert.ok(add.x < grip.x, '+ sits left of the grip');
    assert.ok(Math.abs(centre(grip).y - centre(text).y) < 6, 'grip lines up with the line');
    await line('Second paragraph').click();
    await webview.page.keyboard.type('x');
    assert.equal(await webview.page.locator('.cm-md-block-controls-visible').count(), 0);
});

test('dragging a paragraph below another moves it', async () => {
    await openDoc('Alpha para.\n\nBeta para.\n\nGamma para.\n');
    await dragGrip('Alpha para', async (box) => {
        const g = await box('Gamma para');
        return { x: g.x - 20, y: g.y + g.height * 0.8 };
    });
    assert.equal(await savedText(), 'Beta para.\n\nGamma para.\n\nAlpha para.\n');
});

test('dragging a list item to the right nests it; to the left takes it back out', async () => {
    await openDoc('- one\n- two\n- three\n');
    await dragGrip('two', async (box) => {
        const one = await box('one');
        return { x: one.x + 40, y: one.y + one.height * 0.8 };
    });
    assert.equal(await savedText(), '- one\n  - two\n- three\n');
    await dragGrip('two', async (box) => {
        const three = await box('three');
        return { x: three.x - 30, y: three.y + three.height * 0.8 };
    });
    assert.equal(await savedText(), '- one\n- three\n- two\n');
});

test('clicking the grip selects the whole block; Delete removes it', async () => {
    await openDoc('Keep me.\n\nRemove me.\n\nKeep me too.\n');
    const { grip } = await hoverControls('Remove me');
    await webview.page.mouse.click(centre(grip).x, centre(grip).y);
    await webview.page.waitForSelector('.cm-md-block-selected', { timeout: 2000 });
    await webview.page.keyboard.press('Delete');
    assert.equal(await savedText(), 'Keep me.\n\n\n\nKeep me too.\n');
});

test('Shift-click selects a range of blocks, and dragging moves them all', async () => {
    await openDoc('- a\n- b\n- c\n- d\n');
    let { grip } = await hoverControls('a');
    await webview.page.mouse.click(centre(grip).x, centre(grip).y);
    ({ grip } = await hoverControls('b'));
    await webview.page.keyboard.down('Shift');
    await webview.page.mouse.click(centre(grip).x, centre(grip).y);
    await webview.page.keyboard.up('Shift');
    await dragGrip('b', async (box) => {
        const d = await box('d');
        return { x: d.x - 10, y: d.y + d.height * 0.8 };
    });
    assert.equal(await savedText(), '- c\n- d\n- a\n- b\n');
});

test('Escape during a drag cancels it', async () => {
    await openDoc('One.\n\nTwo.\n');
    const { grip } = await hoverControls('One');
    const page = webview.page;
    await page.mouse.move(centre(grip).x, centre(grip).y);
    await page.mouse.down();
    const two = (await line('Two').boundingBox())!;
    await page.mouse.move(two.x, two.y + two.height, { steps: 5 });
    await page.waitForSelector('.cm-md-block-drag-ghost', { timeout: 2000 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await page.locator('.cm-md-block-drag-ghost').count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('.cm-content')!.textContent), 'One.Two.');
});

test('one undo puts a moved block back', async () => {
    await openDoc('One.\n\nTwo.\n\nThree.\n');
    await dragGrip('One', async (box) => {
        const t = await box('Three');
        return { x: t.x - 10, y: t.y + t.height * 0.8 };
    });
    const text = () => webview.page.evaluate(() => [...document.querySelectorAll('.cm-content > .cm-line')].map(l => l.textContent).join('|'));
    assert.equal(await text(), '|Two.||Three.||One.|'.slice(1));
    await webview.page.keyboard.press('ControlOrMeta+z');
    assert.equal(await text(), 'One.||Two.||Three.|');
});

const TOGGLE = '<details open>\n<summary>\n\nA toggle title\n\n</summary>\n\nToggle body.\n\n</details>\n\nAfter the toggle.\n';

test('a toggle moves as a whole; right-click on its grip opens the toggle menu', async () => {
    await openDoc(TOGGLE);
    await dragGrip('A toggle title', async (box) => {
        const a = await box('After the toggle');
        return { x: a.x - 10, y: a.y + a.height * 0.8 };
    });
    assert.equal(await savedText(), 'After the toggle.\n\n<details open>\n<summary>\n\nA toggle title\n\n</summary>\n\nToggle body.\n\n</details>\n');
    const { grip } = await hoverControls('A toggle title');
    await webview.page.mouse.click(centre(grip).x, centre(grip).y, { button: 'right' });
    await webview.page.waitForSelector('.cm-md-details-menu:not(.hidden)', { timeout: 2000 });
    await webview.page.keyboard.press('Escape');
});

test('a table shows the block grip on its header row; body rows keep the row grip', async () => {
    await openDoc('Before.\n\n| H1 | H2 |\n| --- | --- |\n| c1 | c2 |\n| d1 | d2 |\n\nAfter.\n');
    await webview.page.waitForSelector('.cm-md-table-widget thead', { timeout: 5000 });
    const head = (await webview.page.locator('.cm-md-table-widget thead th').first().boundingBox())!;
    await webview.page.mouse.move(head.x + 10, head.y + head.height / 2);
    await webview.page.waitForSelector('.cm-md-block-controls-visible', { timeout: 2000 });
    const body = (await webview.page.locator('.cm-md-table-widget tbody td', { hasText: 'd1' }).first().boundingBox())!;
    await webview.page.mouse.move(body.x + 10, body.y + body.height / 2);
    await webview.page.waitForTimeout(100);
    assert.equal(await webview.page.locator('.cm-md-block-controls-visible').count(), 0);
});

test('+ on a paragraph adds a line below it and opens the slash menu there', async () => {
    await openDoc('A paragraph.\n\nNext paragraph.\n');
    const { add } = await hoverControls('A paragraph');
    await webview.page.mouse.click(centre(add).x, centre(add).y);
    await webview.page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 2000 });
    await webview.page.keyboard.type('quote');
    await webview.page.waitForFunction(() => document.querySelectorAll('.cm-tooltip-autocomplete li').length === 1, undefined, { timeout: 2000 });
    await webview.page.keyboard.press('ArrowDown');
    await webview.page.keyboard.press('Enter');
    await webview.page.keyboard.type('Quoted');
    assert.equal(await savedText(), 'A paragraph.\n\n> Quoted\n\nNext paragraph.\n');
});

test('+ on a list item adds an empty item below it', async () => {
    await openDoc('- item one\n- item three\n');
    const { add } = await hoverControls('item one');
    await webview.page.mouse.click(centre(add).x, centre(add).y);
    await webview.page.keyboard.type('item two');
    assert.equal(await savedText(), '- item one\n- item two\n- item three\n');
});

const LONG_DOC = Array.from({ length: 80 }, (_, i) => `Para ${i + 1}.`).join('\n\n') + '\n';

/** Scroll positions of the two elements that can scroll the editor. */
const scrollTops = () => webview.page.evaluate(() => ({
    scroller: document.querySelector('.cm-scroller')!.scrollTop,
    content: document.getElementById('content')!.scrollTop,
}));

/** Top and bottom of the visible editor, and the highest paragraph number whose line starts above the bottom. */
const visibleEditor = () => webview.page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')!.getBoundingClientRect();
    const content = document.getElementById('content')!.getBoundingClientRect();
    const top = Math.max(0, scroller.top, content.top);
    const bottom = Math.min(window.innerHeight, scroller.bottom, content.bottom);
    let lastVisible = 0;
    for (const l of document.querySelectorAll('.cm-content > .cm-line')) {
        const m = /^Para (\d+)\.$/.exec(l.textContent ?? '');
        if (m && l.getBoundingClientRect().top < bottom) { lastVisible = Math.max(lastVisible, Number(m[1])); }
    }
    return { top, bottom, lastVisible };
});

test('holding a dragged block near the bottom edge scrolls the page; moving away stops it, and the block lands further down', async () => {
    await openDoc(LONG_DOC);
    const page = webview.page;
    const area = await visibleEditor();
    assert.equal((await scrollTops()).scroller, 0);
    const { grip } = await hoverControls('Para 1.');
    const start = centre(grip);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, area.bottom - 8, { steps: 10 });
    // Held still at the edge: only the auto-scroll moves the page.
    await page.waitForFunction(() => document.querySelector('.cm-scroller')!.scrollTop > 1500, undefined, { timeout: 5000 });
    await page.mouse.move(start.x, (area.top + area.bottom) / 2, { steps: 3 });
    await page.waitForTimeout(50);
    const held = (await scrollTops()).scroller;
    await page.waitForTimeout(300);
    assert.equal((await scrollTops()).scroller, held, 'scrolling stops once the pointer leaves the edge');
    assert.equal(await page.locator('.cm-md-block-drop-line-visible').count(), 1, 'the drop line follows the scrolled page');
    await page.mouse.up();
    await page.waitForTimeout(100);
    const order = (await savedText()).trim().split('\n\n').map(p => Number(/^Para (\d+)\.$/.exec(p)![1]));
    const landed = order.indexOf(1);
    assert.ok(landed > area.lastVisible, `Para 1 landed at index ${landed}, not past the ${area.lastVisible} paragraphs visible at the start`);
    assert.equal(order.length, 80);
});

test('with a non-sticky toolbar the page (#content) auto-scrolls; Escape stops it', async () => {
    await webview.send({ command: 'initSettings', settings: { ...SETTINGS, stickyToolbar: false } } satisfies HostToMarkdownWebview);
    try {
        await openDoc(LONG_DOC);
        const page = webview.page;
        await page.evaluate(() => { document.getElementById('content')!.scrollTop = 0; });
        const area = await visibleEditor();
        const { grip } = await hoverControls('Para 1.');
        const start = centre(grip);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x, area.bottom - 4, { steps: 10 });
        await page.waitForFunction(() => document.getElementById('content')!.scrollTop > 300, undefined, { timeout: 5000 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
        const stopped = (await scrollTops()).content;
        await page.waitForTimeout(300);
        assert.equal((await scrollTops()).content, stopped, 'scrolling stops when the drag is cancelled');
        await page.mouse.up();
        assert.equal(await page.locator('.cm-md-block-drag-ghost').count(), 0);
        // Nothing moved (an unchanged document has nothing to save, so read the top lines).
        await page.evaluate(() => { document.getElementById('content')!.scrollTop = 0; });
        await page.waitForTimeout(100);
        const top = await page.evaluate(() => [...document.querySelectorAll('.cm-content > .cm-line')].slice(0, 3).map(l => l.textContent).join('|'));
        assert.equal(top, 'Para 1.||Para 2.');
    } finally {
        await webview.send({ command: 'initSettings', settings: SETTINGS } satisfies HostToMarkdownWebview);
    }
});

test('no CSP violations or page errors', async () => {
    assert.deepEqual(await webview.problems(), []);
});
