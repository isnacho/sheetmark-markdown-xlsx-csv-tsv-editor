// Markdown webview in headless Chrome: boot, lazy mermaid chunk, sanitizing and CSP in a real browser.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { closeHarness, openWebview, type WebviewHarness } from './harness.mts';
import type { HostToMarkdownWebview, MarkdownSettings } from '../../protocol/markdown.ts';

const SETTINGS: MarkdownSettings = {
    stickyToolbar: true, wordWrap: true, showOutline: true, showLineNumbers: true, livePreviewReveal: true,
    livePreviewLineNumbers: false, autoSave: false, isDefaultEditor: false, showStats: true, statsShowLines: true,
    statsShowWords: true, statsShowChars: true, statsShowReadingTime: true, showCursorPosition: true,
    diffReviewEnabled: false, diffLayout: 'inline',
};

function markdownDocument(content: string): HostToMarkdownWebview {
    return {
        command: 'initMarkdown', content, fileName: 'test.md', documentUri: 'file:///tmp/test.md',
        documentDirUri: 'file:///tmp', workspaceFolderUri: null, tableColumnWidths: {},
        frontmatterPanelCollapsed: false, detailsOpenState: {}, mermaidPreviewMode: 'diagram', calloutDefaultType: 'info',
    };
}

let webview: WebviewHarness;

before(async () => {
    webview = await openWebview('markdown');
    await webview.waitForPosted('webviewReady');
    await webview.send({ command: 'initSettings', settings: SETTINGS } satisfies HostToMarkdownWebview);
});
after(closeHarness);

/** Bytes the browser must load before the editor runs: the entry plus its static chunk imports. */
function initialLoadBytes(file: string, seen = new Set<string>()): number {
    if (seen.has(file)) { return 0; }
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    let total = statSync(file).size;
    // Static imports only (`from "./chunks/x.js"` / `import "./chunks/x.js"`); `import("...")` is lazy.
    for (const match of source.matchAll(/(?:from|import)\s*"(\.\/[^"]+\.js)"/g)) {
        total += initialLoadBytes(join(dirname(file), match[1]), seen);
    }
    return total;
}

test('mermaid is not part of the initial load', () => {
    // Eager mermaid made the initial load about 10 MB (dev build); lazy-loaded it is about 2 MB.
    const bytes = initialLoadBytes('dist/md/mdWebview.js');
    assert.ok(bytes < 3_000_000, `initial Markdown webview load is ${(bytes / 1e6).toFixed(1)} MB; did mermaid get imported statically?`);
});

test('renders a document and loads the mermaid chunk on demand', async () => {
    await webview.send(markdownDocument('# Title\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nafter\n'));
    await webview.page.waitForSelector('.cm-md-mermaid-diagram svg', { timeout: 15000 });
    assert.deepEqual(await webview.problems(), []);
});

test('body text uses the bundled Inter font, with the system font as fallback', async () => {
    await webview.send(markdownDocument('# Title\n\nHello world\n'));
    await webview.page.waitForSelector('.cm-content');
    const { family, loaded } = await webview.page.evaluate(async () => {
        // Variable weights: a bold request must still resolve to the one bundled face.
        const faces = [...await document.fonts.load('400 14px Inter', 'Hello'), ...await document.fonts.load('600 14px Inter', 'Hello')];
        return {
            family: getComputedStyle(document.querySelector('.cm-content')!).fontFamily,
            loaded: faces.length > 0 && faces.every(face => face.status === 'loaded'),
        };
    });
    assert.match(family, /^"?Inter"?, system-ui/, `font stack is "${family}"`);
    assert.ok(loaded, 'Inter did not load: wrong path in theme.css, or the CSP blocked it');
    assert.deepEqual(await webview.problems(), []);
});

async function openFontPicker() {
    if ((await webview.page.locator('#settingsPanel').getAttribute('aria-hidden')) !== 'false') {
        await webview.page.click('#openSettingsButton');
    }
    await webview.page.click('#fontSelect');
    await webview.page.waitForSelector('#fontSelectSearch', { state: 'visible' });
}
const fontOptions = () => webview.page.locator('#fontSelectList [role=option]').evaluateAll(options => options.map(o => o.textContent));
const activeFontOption = () => webview.page.evaluate(() => document.getElementById(document.getElementById('fontSelectSearch')!.getAttribute('aria-activedescendant') ?? '')?.textContent ?? null);
const fontButtonText = () => webview.page.locator('#fontSelect').innerText();
const rootFont = () => webview.page.evaluate(() => ({ data: document.documentElement.dataset.font, inline: document.documentElement.style.getPropertyValue('--font-family') }));
const bodyFont = () => webview.page.locator('.cm-content').evaluate(el => getComputedStyle(el).fontFamily);

test('the Font picker applies a font at once, saves it, and follows the host', async () => {
    await webview.send(markdownDocument('# Title\n\nHello world\n'));
    await webview.page.waitForSelector('.cm-content');
    await webview.send({ command: 'fontFamilyChanged', font: 'inter' });
    await webview.page.waitForFunction(() => document.documentElement.dataset.font === 'inter');

    // The row shows the font in use; the list opens from it with the three built-in fonts.
    assert.equal(await fontButtonText(), 'Inter');
    await openFontPicker();
    assert.equal(await webview.page.evaluate(() => document.activeElement?.id), 'fontSelectSearch');
    assert.equal(await webview.page.locator('#fontSelect').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await fontOptions(), ['Inter', 'System', 'Serif']);
    assert.equal(await activeFontOption(), 'Inter');

    // Choosing a font applies it, saves it and folds the list away.
    await webview.page.click('#fontSelectList [role=option]:has-text("Serif")');
    assert.equal((await rootFont()).data, 'serif');
    assert.match(await bodyFont(), /Iowan|Georgia|serif/);
    assert.deepEqual((await webview.postedOf('setFontFamily')).at(-1), { command: 'setFontFamily', font: 'serif' });
    assert.equal(await webview.page.locator('#fontSelectPanel').isVisible(), false);
    assert.equal(await webview.page.locator('#settingsPanel').getAttribute('aria-hidden'), 'false', 'choosing a font closed the Settings panel');
    assert.equal(await fontButtonText(), 'Serif');

    // The host pushes the setting (another editor changed it, or Settings JSON was edited).
    await webview.send({ command: 'fontFamilyChanged', font: 'system' });
    await webview.page.waitForFunction(() => document.getElementById('fontSelect')!.textContent!.trim() === 'System');
    assert.equal((await rootFont()).data, 'system');

    // A value that cannot be a font name falls back to Inter instead of leaving a broken font.
    await webview.send({ command: 'fontFamilyChanged', font: '<b>' });
    await webview.page.waitForFunction(() => document.documentElement.dataset.font === 'inter');
    assert.equal(await fontButtonText(), 'Inter');
    assert.deepEqual(await webview.problems(), []);
    await webview.page.click('#settingsCancelButton');
});

test('the Font picker searches the installed fonts, by mouse and keyboard', async () => {
    await webview.send(markdownDocument('# Title\n\nHello world\n'));
    await webview.page.waitForSelector('.cm-content');
    assert.ok((await webview.postedOf('requestLocalFonts')).length >= 1, 'the picker never asked the host for the installed fonts');
    // A hostile name in the list is dropped, not shown.
    await webview.send({ command: 'localFonts', fonts: ['Georgia', 'Helvetica', 'Helvetica Neue', 'Menlo', 'Bad";x'] });
    await openFontPicker();
    assert.deepEqual(await fontOptions(), ['Inter', 'System', 'Serif', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Menlo']);
    assert.deepEqual(await webview.page.locator('#fontSelectList .font-picker__group-label').allInnerTexts(), ['BUILT IN', 'INSTALLED ON THIS COMPUTER']);

    // Typing narrows the list, best match first and highlighted; every word has to match.
    await webview.page.keyboard.type('hel');
    assert.deepEqual(await fontOptions(), ['Helvetica', 'Helvetica Neue']);
    assert.equal(await activeFontOption(), 'Helvetica');
    await webview.page.keyboard.press('ArrowDown');
    assert.equal(await activeFontOption(), 'Helvetica Neue');
    await webview.page.keyboard.press('ArrowDown');
    assert.equal(await activeFontOption(), 'Helvetica Neue', 'the highlight ran past the end of the list');
    await webview.page.keyboard.press('ArrowUp');
    assert.equal(await activeFontOption(), 'Helvetica');
    await webview.page.keyboard.type(' neue');
    assert.deepEqual(await fontOptions(), ['Helvetica Neue']);

    // Enter chooses the highlighted font; it is saved and used with the system font behind it.
    await webview.page.keyboard.press('Enter');
    assert.deepEqual(await rootFont(), { data: 'custom', inline: '"Helvetica Neue", system-ui, -apple-system, sans-serif' });
    assert.match(await bodyFont(), /^"Helvetica Neue", system-ui/);
    assert.deepEqual((await webview.postedOf('setFontFamily')).at(-1), { command: 'setFontFamily', font: 'Helvetica Neue' });
    assert.equal(await fontButtonText(), 'Helvetica Neue');
    assert.equal(await webview.page.evaluate(() => document.activeElement?.id), 'fontSelect', 'focus did not return to the Font button');

    // Reopened, the list starts unfiltered with the font in use highlighted. No match shows a message.
    await openFontPicker();
    assert.equal((await fontOptions()).length, 7);
    assert.equal(await activeFontOption(), 'Helvetica Neue');
    await webview.page.keyboard.type('zzzz');
    assert.deepEqual(await fontOptions(), []);
    assert.equal(await webview.page.locator('#fontSelectEmpty').isVisible(), true);
    await webview.page.keyboard.press('Enter');
    assert.equal(await webview.page.locator('#fontSelectPanel').isVisible(), true, 'Enter with no match should do nothing');

    // The first Escape folds the list away; only the second closes the Settings panel.
    await webview.page.keyboard.press('Escape');
    assert.equal(await webview.page.locator('#fontSelectPanel').isVisible(), false);
    assert.equal(await webview.page.locator('#settingsPanel').getAttribute('aria-hidden'), 'false');
    await webview.page.keyboard.press('Escape');
    assert.equal(await webview.page.locator('#settingsPanel').getAttribute('aria-hidden'), 'true');

    // Clicking outside the list folds it away without choosing anything.
    await openFontPicker();
    await webview.page.click('#settingsPanelTitle');
    assert.equal(await webview.page.locator('#fontSelectPanel').isVisible(), false);
    assert.equal(await fontButtonText(), 'Helvetica Neue');

    // Back to the default, for the tests after this one.
    await webview.send({ command: 'fontFamilyChanged', font: 'inter' });
    await webview.page.waitForFunction(() => document.documentElement.dataset.font === 'inter');
    await webview.page.click('#settingsCancelButton');
    assert.deepEqual(await webview.problems(), []);
});

test('hostile HTML in a table cell does not run', async () => {
    await webview.send(markdownDocument('| a |\n| - |\n| <img src=x onerror="window.__pwned = true"> |\n\nplain\n'));
    await webview.page.waitForSelector('.cm-md-table-scroll table', { timeout: 10000 });
    await webview.page.waitForTimeout(300);
    assert.equal(await webview.page.evaluate(() => (window as any).__pwned), undefined);
    assert.equal(await webview.page.locator('.cm-md-table-scroll img[onerror]').count(), 0);
});

test('the CSP blocks inline handlers even if markup gets past sanitizing', async () => {
    await webview.page.evaluate(() => {
        const img = document.createElement('img');
        img.setAttribute('onerror', 'window.__pwnedByCsp = true');
        img.src = 'data:image/png;base64,broken';
        document.body.appendChild(img);
    });
    await webview.page.waitForTimeout(300);
    assert.equal(await webview.page.evaluate(() => (window as any).__pwnedByCsp), undefined);
    assert.ok((await webview.problems()).some(p => p.includes('script-src')), 'expected a CSP script-src violation');
});

test('toggle: a closed <details> hides its body, the chevron opens it and posts the choice', async () => {
    const doc = 'intro\n\n<details>\n<summary>Guide</summary>\n\nsecret body line\n\n</details>\n\nafter\n';
    await webview.send(markdownDocument(doc));
    await webview.page.waitForSelector('.cm-md-details-chevron', { timeout: 10000 });
    assert.equal(await webview.page.locator('.cm-md-details-chevron.is-open').count(), 0);
    assert.equal(await webview.page.locator('.cm-content', { hasText: 'secret body line' }).count(), 0);

    await webview.page.locator('.cm-md-details-chevron').dispatchEvent('mousedown');
    await webview.page.waitForSelector('.cm-md-details-body', { timeout: 5000 });
    assert.equal(await webview.page.locator('.cm-md-details-chevron.is-open').count(), 1);
    const posted = await webview.waitForPosted('saveDetailsOpenState');
    assert.deepEqual(posted.state, { 'Guide#0': true });
});

test('toggle: a persisted open choice from the host is applied on load', async () => {
    const doc = '<details>\n<summary>Guide</summary>\n\nvisible body\n\n</details>\n';
    await webview.send({ ...markdownDocument(doc), detailsOpenState: { 'Guide#0': true } } as HostToMarkdownWebview);
    await webview.page.waitForSelector('.cm-md-details-body', { timeout: 10000 });
    assert.equal(await webview.page.locator('.cm-md-details-chevron.is-open').count(), 1);
});

// ----- Notion-style toggles: markup hidden, typed shortcuts -----

const NEW_TOGGLE = '<details open>\n<summary>\n\nTitle\n\n</summary>\n\nbody\n\n</details>\n';

async function savedText(): Promise<string> {
    const before = (await webview.postedOf('saveMarkdown')).length;
    await webview.page.keyboard.press('Control+s');
    await webview.page.waitForFunction((n) => ((window as any).__posted as any[]).filter(m => m?.command === 'saveMarkdown').length > n, before);
    const all = await webview.postedOf('saveMarkdown');
    // The webview waits for the host's answer before it will save again.
    await webview.send({ command: 'saveResult', ok: true, isAutosave: false } satisfies HostToMarkdownWebview);
    return all[all.length - 1].text;
}

async function openDoc(content: string): Promise<void> {
    await webview.send(markdownDocument(content));
    await webview.page.waitForSelector('.cm-content .cm-line', { timeout: 10000 });
}

test('toggle: the tag lines are never visible, only the title and body', async () => {
    await openDoc(NEW_TOGGLE);
    await webview.page.waitForSelector('.cm-md-details-chevron', { timeout: 10000 });
    const text = (await webview.page.locator('.cm-content').textContent()) ?? '';
    assert.ok(!/details|summary/i.test(text), `markup leaked into the editor: ${text}`);
    assert.ok(text.includes('Title') && text.includes('body'));
});

test('toggle: typing "> " on a paragraph converts it, and Undo restores the literal marker', async () => {
    await openDoc('hello world\n\nafter\n');
    await webview.page.click('.cm-line');
    await webview.page.keyboard.press('Home');
    await webview.page.keyboard.type('> ');
    await webview.page.waitForSelector('.cm-md-details-chevron', { timeout: 5000 });
    assert.equal(await webview.page.locator('.cm-content').textContent().then(t => t?.includes('hello world')), true);

    await webview.page.keyboard.press('ControlOrMeta+z');
    await webview.page.waitForFunction(() => document.querySelectorAll('.cm-md-details-chevron').length === 0);
    assert.equal(await savedText(), '> hello world\n\nafter\n');
});

test('toggle: typing "> " on a heading, before the #, takes its whole section', async () => {
    await openDoc('## Guide\n\nbody\n\n### Sub\n\nsub body\n\n## Next\n\nother\n');
    await webview.page.click('.cm-line');
    await webview.page.keyboard.press('Home');
    await webview.page.keyboard.type('> ');
    await webview.page.waitForSelector('.cm-md-details-chevron', { timeout: 5000 });
    assert.equal(await savedText(),
        '<details open>\n<summary>\n\n## Guide\n\n</summary>\n\nbody\n\n### Sub\n\nsub body\n\n</details>\n\n## Next\n\nother\n');
});

test('toggle: typing "> " after the ## of a heading works the same', async () => {
    await openDoc('## Guide\n\nbody\n');
    await webview.page.click('.cm-line');
    await webview.page.keyboard.press('Home');
    await webview.page.keyboard.press('ArrowRight');
    await webview.page.keyboard.press('ArrowRight');
    await webview.page.keyboard.press('ArrowRight');
    await webview.page.keyboard.type('> ');
    await webview.page.waitForSelector('.cm-md-details-chevron', { timeout: 5000 });
    assert.equal(await savedText(), '<details open>\n<summary>\n\n## Guide\n\n</summary>\n\nbody\n\n</details>\n');
});

test('quote: typing a double quote and a space makes a Markdown quote', async () => {
    await openDoc('quote me\n');
    await webview.page.click('.cm-line');
    await webview.page.keyboard.press('Home');
    await webview.page.keyboard.type('" ');
    assert.equal(await savedText(), '> quote me\n');
});

test('toggle: Enter in the title opens a new line at the top of the body', async () => {
    await openDoc(NEW_TOGGLE);
    await webview.page.waitForSelector('.cm-md-details-title-line', { timeout: 10000 });
    await webview.page.click('.cm-md-details-title-line');
    await webview.page.keyboard.press('End');
    await webview.page.keyboard.press('Enter');
    await webview.page.keyboard.type('X');
    assert.equal(await savedText(), '<details open>\n<summary>\n\nTitle\n\n</summary>\n\nX\n\nbody\n\n</details>\n');
});

test('toggle: Backspace at the start of the title unwraps it', async () => {
    await openDoc(NEW_TOGGLE);
    await webview.page.waitForSelector('.cm-md-details-title-line', { timeout: 10000 });
    await webview.page.click('.cm-md-details-title-line');
    await webview.page.keyboard.press('Home');
    await webview.page.keyboard.press('Backspace');
    assert.equal(await savedText(), 'Title\n\nbody\n');
});

test('toggle: Delete and Backspace next to a hidden run step over it and never delete the markup', async () => {
    await openDoc(NEW_TOGGLE);
    await webview.page.waitForSelector('.cm-md-details-title-line', { timeout: 10000 });
    await webview.page.click('.cm-md-details-title-line');
    await webview.page.keyboard.press('End');
    await webview.page.keyboard.press('Delete');
    await webview.page.keyboard.type('Z');
    await webview.page.keyboard.press('Home');
    await webview.page.keyboard.press('Backspace');
    await webview.page.keyboard.type('Y');
    assert.equal(await savedText(), '<details open>\n<summary>\n\nTitleY\n\n</summary>\n\nZbody\n\n</details>\n');
});

test('toggle: a closed toggle written without the open attribute hides its body and shows no hidden-line count', async () => {
    await openDoc(NEW_TOGGLE.replace('<details open>', '<details>'));
    // Wait for the NEW document: the previous test's chevron may still be on screen.
    await webview.page.waitForSelector('.cm-md-details-chevron:not(.is-open)', { timeout: 10000 });
    const text = (await webview.page.locator('.cm-content').textContent()) ?? '';
    assert.ok(text.includes('Title') && !text.includes('body') && !/details|summary|hidden/i.test(text));
    await webview.page.locator('.cm-md-details-chevron').dispatchEvent('mousedown');
    await webview.page.waitForSelector('.cm-md-details-body', { timeout: 5000 });
    assert.equal(await webview.page.locator('.cm-md-details-chevron.is-open').count(), 1);
});

test('toggle: the arrow is flush with normal text, the title and the body start at the same x, and bullets are indented with them', async () => {
    await openDoc('<details open>\n<summary>\n\n## Big title\n\n</summary>\n\n- one\n- two\n\nbody paragraph\n\n</details>\n\nplain\n');
    await webview.page.waitForSelector('.cm-md-details-body', { timeout: 10000 });
    // No inner helper functions: tsx injects a __name helper that does not exist in the page.
    const g = await webview.page.evaluate(() => {
        const lines = [...document.querySelectorAll('.cm-line')];
        const plain = lines.find(l => l.textContent === 'plain') as HTMLElement;
        const para = lines.find(l => l.textContent === 'body paragraph') as HTMLElement;
        const title = document.querySelector('.cm-md-details-title-line') as HTMLElement;
        const chevron = document.querySelector('.cm-md-details-chevron') as HTMLElement;
        const svg = chevron.querySelector('svg') as SVGElement;
        const bullet = document.querySelector('.cm-md-details-body .cm-md-list-marker-slot');
        return {
            plainLeft: plain.getBoundingClientRect().left,
            // the arrow lines up with the plain TEXT, which starts after the line's own left padding
            arrowBoxLeft: chevron.getBoundingClientRect().left - parseFloat(getComputedStyle(plain).paddingLeft),
            titleLeft: title.getBoundingClientRect().left,
            paraLeft: para.getBoundingClientRect().left,
            bulletLeft: bullet ? bullet.getBoundingClientRect().left : NaN,
            arrowWidth: parseFloat(getComputedStyle(svg).width),
            arrowHeight: parseFloat(getComputedStyle(svg).height),
            titleFont: parseFloat(getComputedStyle(title).fontSize),
            bodyFont: parseFloat(getComputedStyle(para).fontSize),
            padding: parseFloat(getComputedStyle(title).paddingLeft),
        };
    });
    assert.ok(Math.abs(g.arrowBoxLeft - g.plainLeft) <= 1, `arrow starts ${g.arrowBoxLeft - g.plainLeft}px from normal text`);
    assert.ok(Math.abs(g.titleLeft - g.paraLeft) <= 1, `title is ${g.titleLeft - g.paraLeft}px from the body text`);
    assert.ok(g.bulletLeft - g.plainLeft >= 16, `bullet is only ${g.bulletLeft - g.plainLeft}px right of normal text`);
    assert.ok(g.arrowHeight >= g.titleFont * 0.45 && g.arrowHeight <= g.titleFont * 0.7, `arrow ${g.arrowHeight}px for a ${g.titleFont}px title`);
    assert.ok(g.titleLeft + g.padding - (g.arrowBoxLeft + g.arrowWidth) <= 16, 'gap between arrow and title is too wide');
});

test('toggle: the arrow is centred on the title text and does not move when it turns', async () => {
    for (const title of ['## Big title', '### Mid title', 'Plain title']) {
        await openDoc(`<details open>\n<summary>\n\n${title}\n\n</summary>\n\nbody\n\n</details>\n\n${title.replace(/#/g, '')} marker\n`);
        // Wait for THIS document: the previous test's toggle may still be on screen.
        await webview.page.waitForFunction((word) => !!document.querySelector('.cm-md-details-chevron.is-open')
            && (document.querySelector('.cm-md-details-title-line')?.textContent ?? '').includes(word), title.replace(/#/g, '').trim().split(' ')[0]);
        // No inner helper functions: tsx injects a __name helper that does not exist in the page.
        const measure = () => webview.page.evaluate(() => {
            const line = document.querySelector('.cm-md-details-title-line') as HTMLElement;
            const arrow = document.querySelector('.cm-md-details-chevron svg')!.getBoundingClientRect();
            // The text's visual middle: the middle of a capital letter above the baseline. The baseline comes
            // from a zero-size probe on the same line; the capital height from the line's own font.
            const probe = document.createElement('span');
            probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
            line.appendChild(probe);
            const baseline = probe.getBoundingClientRect().bottom;
            probe.remove();
            const cs = getComputedStyle(line);
            const ctx = document.createElement('canvas').getContext('2d')!;
            ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            const textMiddle = baseline - ctx.measureText('H').actualBoundingBoxAscent / 2;
            return { x: arrow.left + arrow.width / 2, y: arrow.top + arrow.height / 2, textMiddle };
        });
        await webview.page.waitForTimeout(300);
        const open = await measure();
        assert.ok(Math.abs(open.y - open.textMiddle) <= 2, `"${title}": arrow middle is ${open.y - open.textMiddle}px from the text middle ${JSON.stringify(open)}`);
        await webview.page.locator('.cm-md-details-chevron').dispatchEvent('mousedown');
        await webview.page.waitForSelector('.cm-md-details-chevron:not(.is-open)', { timeout: 5000 });
        await webview.page.waitForTimeout(250);
        const closed = await measure();
        assert.ok(Math.abs(closed.x - open.x) < 0.5 && Math.abs(closed.y - open.y) < 0.5,
            `"${title}": arrow moved from (${open.x}, ${open.y}) to (${closed.x}, ${closed.y})`);
    }
});
