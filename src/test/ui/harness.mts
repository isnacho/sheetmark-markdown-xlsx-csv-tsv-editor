// Helpers to drive the real Sheetmark Markdown editor inside a real VS Code window (Electron,
// through playwright-core), with the real theme, webview sandbox and CSP. Used by the UI specs
// (`npm run test:ui`) and by `npm run shot` (shot.mts). Needs a display and a built `dist/`
// (`node esbuild.js`); the first run downloads VS Code into .vscode-test/. Set
// SHEETMARK_VSCODE_PATH to use a specific VS Code executable.
//
// Gotcha: inside `frame.evaluate(...)` do not define named inner functions or `const f = () =>`;
// the test runner's transpiler injects a `__name` helper that the page does not have.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Frame, type Page } from 'playwright-core';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

export const ROOT = process.cwd();
export const SHOTS = join(ROOT, '.vscode-test', 'ui-shots');
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
export const LIGHT = 'Default Light Modern';
export const DARK = 'Default Dark Modern';
export const HIGH_CONTRAST = 'Default High Contrast';
export const HIGH_CONTRAST_LIGHT = 'Default High Contrast Light';

/** Short theme names accepted by `npm run shot -- --theme`. Any full VS Code theme name works too. */
export const THEME_ALIASES: Record<string, string> = {
    light: LIGHT, dark: DARK, hc: HIGH_CONTRAST, 'hc-light': HIGH_CONTRAST_LIGHT,
};

export interface Editor {
    app: ElectronApplication;
    page: Page;
    frame: Frame;
    file: string;
    /** The file's bytes on disk (save first to see edits). */
    raw(): string;
    /** Screenshot of the whole VS Code window to .vscode-test/ui-shots/<name>.png; returns the path. */
    shot(name: string): Promise<string>;
    /** Text the editor shows (hidden markup is not in the DOM). */
    visible(): Promise<string>;
    save(): Promise<void>;
    /** First element in the document (not the outline) whose text matches. */
    title(text: string): ReturnType<Frame['locator']>;
}

export interface EditorOptions {
    /** Window size in CSS pixels. VS Code's default is about 1200 x 800. */
    width?: number;
    height?: number;
    /** Extra VS Code user settings, e.g. `{ 'xlsxViewer.md.wordWrap': false }`. */
    settings?: Record<string, unknown>;
}

/** Open `content` in a temp file, or an existing file in place with `{ file }` (it is only read). */
export type EditorSource = string | { file: string };

let vscodePath: string | undefined;
export async function vscodeExecutable(): Promise<string> {
    vscodePath ??= process.env.SHEETMARK_VSCODE_PATH ?? await downloadAndUnzipVSCode('stable');
    return vscodePath;
}

/** The webview iframe that hosts the CM6 editor, or undefined if it does not appear in `timeoutMs`. */
export async function findEditorFrame(page: Page, timeoutMs = 30000): Promise<Frame | undefined> {
    for (let waited = 0; waited < timeoutMs; waited += 500) {
        await page.waitForTimeout(500);
        for (const candidate of page.frames()) {
            if (await candidate.locator('.cm-content').count().catch(() => 0)) { return candidate; }
        }
    }
    return undefined;
}

export function shotPath(name: string): string {
    mkdirSync(SHOTS, { recursive: true });
    return join(SHOTS, `${name}.png`);
}

export async function withEditor(source: EditorSource, theme: string, run: (editor: Editor) => Promise<void>, options: EditorOptions = {}): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'smk-ui-'));
    let file: string;
    if (typeof source === 'string') {
        file = join(dir, 'doc.md');
        writeFileSync(file, source);
    } else {
        file = source.file;
    }
    mkdirSync(join(dir, 'User'), { recursive: true });
    writeFileSync(join(dir, 'User', 'settings.json'), JSON.stringify({
        'workbench.editorAssociations': { '*.md': 'xlsxViewer.md' },
        'workbench.colorTheme': theme,
        'workbench.startupEditor': 'none',
        'security.workspace.trust.enabled': false,
        'update.mode': 'none',
        'telemetry.telemetryLevel': 'off',
        'chat.disableAIFeatures': true,
        ...options.settings,
    }));
    const app: ElectronApplication = await electron.launch({
        executablePath: await vscodeExecutable(),
        // An empty extensions folder instead of --disable-extensions, which shows a notification
        // ("All installed extensions are temporarily disabled") over the bottom right of every screenshot.
        args: [`--extensionDevelopmentPath=${ROOT}`, `--extensions-dir=${join(dir, 'extensions')}`, `--user-data-dir=${dir}`,
            '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--new-window', file],
        timeout: 60000,
    });
    try {
        const page = await app.firstWindow();
        if (options.width || options.height) {
            const window = await app.browserWindow(page);
            await window.evaluate((win, size) => {
                const [w, h] = win.getSize();
                win.setSize(size.width ?? w, size.height ?? h);
            }, { width: options.width, height: options.height });
        }
        const frame = await findEditorFrame(page);
        assert.ok(frame, 'the Sheetmark Markdown editor did not open');
        await page.waitForTimeout(1000);
        const editor: Editor = {
            app, page, frame, file,
            raw: () => readFileSync(file, 'utf8'),
            shot: async name => { const path = shotPath(name); await page.screenshot({ path }); return path; },
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
export async function typeAtLineStart(editor: Editor, lineText: string, typed: string, stepsRight = 0): Promise<void> {
    await editor.title(lineText).click();
    await editor.page.keyboard.press('Home');
    for (let i = 0; i < stepsRight; i++) { await editor.page.keyboard.press('ArrowRight'); }
    await editor.page.keyboard.type(typed);
    await editor.page.waitForTimeout(400);
}

/** Vertical gap in px between the bottom of the line containing `above` and the top of the line containing `below`. */
export async function lineGap(editor: Editor, above: string, below: string): Promise<number> {
    return editor.frame.evaluate(([a, b]) => {
        const lines = [...document.querySelectorAll('.cm-content .cm-line')];
        return lines.find(l => l.textContent?.includes(b))!.getBoundingClientRect().top
            - lines.find(l => l.textContent?.includes(a))!.getBoundingClientRect().bottom;
    }, [above, below] as const);
}
