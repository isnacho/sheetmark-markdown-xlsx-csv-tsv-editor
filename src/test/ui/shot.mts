// `npm run shot -- <file.md> [--theme light|dark|hc|hc-light|"<VS Code theme>"] [--width N] [--height N]
//                  [--out name] [--set key=value ...] [--wait ms]`
//
// Opens a Markdown file in the real Sheetmark editor inside a real VS Code window, waits for the
// editor, writes a screenshot of the window to .vscode-test/ui-shots/<name>.png and exits. The
// file is opened in place (so relative images resolve) and never edited. `--set` adds a VS Code
// user setting; the value is parsed as JSON when it can be (`--set xlsxViewer.md.wordWrap=false`).

import { basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { LIGHT, THEME_ALIASES, withEditor } from './harness.mts';

const USAGE = 'usage: npm run shot -- <file.md> [--theme light|dark|hc|hc-light|"<theme>"] [--width N] [--height N] [--out name] [--set key=value] [--wait ms]';

function parseValue(text: string): unknown {
    try { return JSON.parse(text); } catch { return text; }
}

const args = process.argv.slice(2);
let file: string | undefined;
let theme = LIGHT;
let width: number | undefined;
let height: number | undefined;
let out: string | undefined;
let wait = 0;
const settings: Record<string, unknown> = {};
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = (): string => {
        const value = args[++i];
        if (value === undefined) { throw new Error(`${arg} needs a value\n${USAGE}`); }
        return value;
    };
    if (arg === '--theme') { const t = next(); theme = THEME_ALIASES[t] ?? t; }
    else if (arg === '--width') { width = Number(next()); }
    else if (arg === '--height') { height = Number(next()); }
    else if (arg === '--out') { out = next(); }
    else if (arg === '--wait') { wait = Number(next()); }
    else if (arg === '--set') {
        const pair = next();
        const eq = pair.indexOf('=');
        if (eq < 1) { throw new Error(`--set expects key=value, got "${pair}"`); }
        settings[pair.slice(0, eq)] = parseValue(pair.slice(eq + 1));
    }
    else if (arg.startsWith('--')) { throw new Error(`unknown option ${arg}\n${USAGE}`); }
    else { file = arg; }
}
if (!file) { throw new Error(USAGE); }
const path = resolve(file);
if (!existsSync(path)) { throw new Error(`no such file: ${path}`); }
const name = out ?? `${basename(path).replace(/\.md$/i, '')}-${Object.entries(THEME_ALIASES).find(([, full]) => full === theme)?.[0] ?? 'theme'}${width ? `-${width}` : ''}`;

await withEditor({ file: path }, theme, async editor => {
    if (wait) { await editor.page.waitForTimeout(wait); }
    console.log(await editor.shot(name));
}, { width, height, settings });
