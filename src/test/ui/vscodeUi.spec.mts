// Drives the real Sheetmark Markdown editor inside a real VS Code window (Electron, through
// playwright-core): typing, keys, menus and screenshots, with the real theme and webview sandbox.
// Slower than the headless webview tests and needs a display, so it is NOT part of `npm run verify`.
// Run it with `npm run test:ui`; screenshots land in .vscode-test/ui-shots/ (open them to look at
// the result: layout and colour regressions are not caught by the assertions).
//
// Needs `node esbuild.js` first (the npm script does it) and a VS Code download (the first run
// fetches it into .vscode-test/, like the integration tests). Set SHEETMARK_VSCODE_PATH to use a
// specific VS Code executable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Frame, type Page } from 'playwright-core';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const ROOT = process.cwd();
const SHOTS = join(ROOT, '.vscode-test', 'ui-shots');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const LIGHT = 'Default Light Modern';
const DARK = 'Default Dark Modern';

const SECTIONS = `Para one

## Heading A

text under A

### Sub A1

text under A1

## Heading B

text under B
`;

const TOGGLES = `Normal paragraph above, for alignment.

<details open>
<summary>

# Heading 1 toggle

</summary>

Body text under H1.

- bullet one
- bullet two

</details>

<details open>
<summary>

## Heading 2 toggle

</summary>

Body text under H2.

<details open>
<summary>

### Nested H3 toggle

</summary>

Nested body with **bold**.

</details>

</details>

<details>
<summary>

### Closed H3 toggle

</summary>

Hidden body line.

</details>

<details open>
<summary>

Plain title toggle

</summary>

Plain body.

</details>

Normal paragraph below.
`;

interface Editor { page: Page; frame: Frame; file: string; raw(): string; shot(name: string): Promise<void>; visible(): Promise<string>; save(): Promise<void>; title(text: string): ReturnType<Frame['locator']> }

let vscodePath: string | undefined;
async function vscodeExecutable(): Promise<string> {
    vscodePath ??= process.env.SHEETMARK_VSCODE_PATH ?? await downloadAndUnzipVSCode('stable');
    return vscodePath;
}

async function withEditor(content: string, theme: string, run: (editor: Editor) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'smk-ui-'));
    const file = join(dir, 'doc.md');
    writeFileSync(file, content);
    mkdirSync(join(dir, 'User'), { recursive: true });
    writeFileSync(join(dir, 'User', 'settings.json'), JSON.stringify({
        'workbench.editorAssociations': { '*.md': 'xlsxViewer.md' },
        'workbench.colorTheme': theme,
        'workbench.startupEditor': 'none',
        'security.workspace.trust.enabled': false,
        'update.mode': 'none',
        'telemetry.telemetryLevel': 'off',
        'chat.disableAIFeatures': true,
    }));
    mkdirSync(SHOTS, { recursive: true });
    const app: ElectronApplication = await electron.launch({
        executablePath: await vscodeExecutable(),
        args: [`--extensionDevelopmentPath=${ROOT}`, '--disable-extensions', `--user-data-dir=${dir}`,
            '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--new-window', file],
        timeout: 60000,
    });
    try {
        const page = await app.firstWindow();
        let frame: Frame | undefined;
        for (let i = 0; i < 60 && !frame; i++) {
            await page.waitForTimeout(500);
            for (const candidate of page.frames()) {
                if (await candidate.locator('.cm-content').count().catch(() => 0)) { frame = candidate; break; }
            }
        }
        assert.ok(frame, 'the Sheetmark Markdown editor did not open');
        await page.waitForTimeout(1000);
        const editor: Editor = {
            page, frame, file,
            raw: () => readFileSync(file, 'utf8'),
            shot: async name => { await page.screenshot({ path: join(SHOTS, `${name}.png`) }); },
            visible: () => frame.locator('.cm-content').innerText(),
            save: async () => { await page.keyboard.press(`${MOD}+s`); await page.waitForTimeout(800); },
            title: text => frame.locator('.cm-content').getByText(text).first(),
        };
        await run(editor);
    } finally {
        await app.close();
    }
}

/** Click the line with `text`, move to its start, optionally step right, then type. */
async function typeAtLineStart(editor: Editor, lineText: string, typed: string, stepsRight = 0): Promise<void> {
    await editor.title(lineText).click();
    await editor.page.keyboard.press('Home');
    for (let i = 0; i < stepsRight; i++) { await editor.page.keyboard.press('ArrowRight'); }
    await editor.page.keyboard.type(typed);
    await editor.page.waitForTimeout(400);
}

const HEADING_A_TOGGLE = `Para one

<details open>
<summary>

## Heading A

</summary>

text under A

### Sub A1

text under A1

</details>

## Heading B

text under B
`;

test('typing "> " on a paragraph makes a toggle with no tag text visible, and Cmd+Z restores it', { timeout: 120000 }, async () => {
    await withEditor(SECTIONS, LIGHT, async editor => {
        await typeAtLineStart(editor, 'Para one', '> ');
        await editor.shot('paragraph-converted');
        assert.doesNotMatch(await editor.visible(), /details|summary/);
        await editor.save();
        assert.match(editor.raw(), /^<details open>\n<summary>\n\nPara one\n\n<\/summary>\n/);
        await editor.page.keyboard.press(`${MOD}+z`);
        await editor.page.waitForTimeout(400);
        await editor.save();
        assert.ok(editor.raw().startsWith('> Para one\n'), 'undo should restore the literal "> "');
    });
});

test('"> " before or after the ## marker gives the same toggle, holding the section up to the next same-level heading', { timeout: 120000 }, async () => {
    await withEditor(SECTIONS, LIGHT, async editor => {
        await typeAtLineStart(editor, 'Heading A', '> ');
        await editor.shot('heading-converted-before-marker');
        await editor.save();
        assert.equal(editor.raw(), HEADING_A_TOGGLE);
    });
    await withEditor(SECTIONS, LIGHT, async editor => {
        await typeAtLineStart(editor, 'Heading A', '> ', 3);
        await editor.save();
        assert.equal(editor.raw(), HEADING_A_TOGGLE);
    });
});

test('Enter at the end of a title moves into the body; Backspace at the title start unwraps the toggle', { timeout: 120000 }, async () => {
    await withEditor(SECTIONS, LIGHT, async editor => {
        await typeAtLineStart(editor, 'Heading A', '> ');
        await editor.page.keyboard.press('End');
        await editor.page.keyboard.press('Enter');
        await editor.page.keyboard.type('NEWBODY');
        await editor.save();
        const raw = editor.raw();
        assert.match(raw, /<\/summary>\n\nNEWBODY\n\ntext under A/, 'typed text lands on its own line at the top of the body');
        await editor.title('Heading A').click();
        await editor.page.keyboard.press('Home');
        await editor.page.keyboard.press('Backspace');
        await editor.page.waitForTimeout(400);
        await editor.save();
        assert.doesNotMatch(editor.raw(), /details|summary/);
        assert.match(editor.raw(), /## Heading A\n\nNEWBODY\n\ntext under A/, 'Enter opens a new line instead of joining the first body line');
    });
});

test('the hover handle opens a menu; "Start closed" drops the open attribute', { timeout: 120000 }, async () => {
    await withEditor(SECTIONS, LIGHT, async editor => {
        await typeAtLineStart(editor, 'Heading A', '> ');
        await editor.title('Heading A').hover();
        await editor.frame.locator('.cm-md-details-handle').first().click({ force: true });
        await editor.page.waitForTimeout(300);
        await editor.shot('toggle-menu');
        for (const label of ['Turn into text', 'Start closed', 'Delete toggle']) {
            assert.ok(await editor.frame.getByText(label).first().isVisible(), `menu item "${label}" is visible`);
        }
        await editor.frame.getByText('Start closed').first().click();
        await editor.save();
        assert.match(editor.raw(), /^Para one\n\n<details>\n<summary>/);
    });
});

test('typing a double quote and a space makes a quote', { timeout: 120000 }, async () => {
    await withEditor(SECTIONS, LIGHT, async editor => {
        await typeAtLineStart(editor, 'Para one', '" ');
        await editor.save();
        assert.ok(editor.raw().startsWith('> Para one\n'));
    });
});

/** Vertical gap in px between the bottom of the line containing `above` and the top of the line containing `below`. */
async function lineGap(editor: Editor, above: string, below: string): Promise<number> {
    return editor.frame.evaluate(([a, b]) => {
        // No inner named functions: the test runner's transpiler would inject a helper the page does not have.
        const lines = [...document.querySelectorAll('.cm-content .cm-line')];
        return lines.find(l => l.textContent?.includes(b))!.getBoundingClientRect().top
            - lines.find(l => l.textContent?.includes(a))!.getBoundingClientRect().bottom;
    }, [above, below] as const);
}

test('a toggle adds no extra empty space after its last body line', { timeout: 120000 }, async () => {
    // The same two blocks as ordinary Markdown, with the single blank line normal paragraphs have between them.
    const plain = '- bullet one\n- bullet two\n\n## Heading 2 toggle\n\nBody text under H2.\n';
    let toggleGap = 0;
    let plainGap = 0;
    await withEditor(TOGGLES, LIGHT, async editor => { toggleGap = await lineGap(editor, 'bullet two', 'Heading 2 toggle'); });
    await withEditor(plain, LIGHT, async editor => { plainGap = await lineGap(editor, 'bullet two', 'Heading 2 toggle'); });
    assert.ok(toggleGap - plainGap < 12, `gap after a toggle body is ${toggleGap}px, the same text without toggles has ${plainGap}px`);
});

for (const [name, theme] of [['light', LIGHT], ['dark', DARK]] as const) {
    test(`a closed toggle shows only its title until its arrow is clicked (${name} theme, screenshot)`, { timeout: 120000 }, async () => {
        await withEditor(TOGGLES, theme, async editor => {
            await editor.shot(`toggles-${name}`);
            const visible = await editor.visible();
            assert.doesNotMatch(visible, /details|summary/);
            assert.ok(!visible.includes('Hidden body line'), 'closed body is hidden');
            await editor.frame.locator('.cm-md-details-chevron').nth(3).click();
            await editor.page.waitForTimeout(400);
            assert.ok((await editor.visible()).includes('Hidden body line'), 'clicking the arrow opens the body');
            await editor.shot(`toggles-${name}-opened`);
        });
    });
}
