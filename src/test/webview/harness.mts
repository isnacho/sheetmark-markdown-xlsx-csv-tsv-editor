// Runs the real built webview bundles (dist/) in headless Chrome, with the same HTML shell and
// CSP the providers produce, and a stub of the VS Code webview API. Tests drive a webview the way
// the extension host does: send host messages in, read the messages it posts out.
//
// Needs `node esbuild.js` first and a Chrome or Edge install (playwright-core drives the installed
// browser; set SHEETMARK_CHROME_PATH to use another Chromium binary).

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { renderMarkdownHtml, renderSpreadsheetHtml } from '../../shared/webviewHtml.ts';

const ROOT = process.cwd();
const SERVED_DIRS = ['dist', 'resources'];
const MIME: Record<string, string> = {
    '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.woff2': 'font/woff2', '.aff': 'text/plain', '.dic': 'text/plain', '.html': 'text/html',
};

export type WebviewKind = 'spreadsheet' | 'markdown';

export interface WebviewHarness {
    page: Page;
    /** Messages the webview posted to the "host", oldest first. */
    posted(): Promise<any[]>;
    waitForPosted(command: string, timeoutMs?: number): Promise<any>;
    /** Deliver a host-to-webview message. */
    send(message: unknown): Promise<void>;
    /** CSP violations and uncaught page errors seen so far. */
    problems(): Promise<string[]>;
}

let server: Server | undefined;
let origin = '';
let browser: Browser | undefined;

async function startServer(): Promise<void> {
    if (server) { return; }
    if (!existsSync(join(ROOT, 'dist', 'md', 'mdWebview.js'))) {
        throw new Error('dist/ is missing: run `node esbuild.js` before the webview tests');
    }
    server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const kind = url.pathname === '/__shell/spreadsheet' ? 'spreadsheet' : url.pathname === '/__shell/markdown' ? 'markdown' : null;
        if (kind) {
            const asset = (relativePath: string) => `${origin}/${relativePath}`;
            const html = kind === 'spreadsheet'
                ? renderSpreadsheetHtml({ asset, cspSource: origin })
                : renderMarkdownHtml({ asset, cspSource: origin, nonce: 'testnonce' });
            res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
            return;
        }
        const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
        if (!SERVED_DIRS.some(dir => relative === dir || relative.startsWith(dir + sep))) {
            res.writeHead(404).end();
            return;
        }
        try {
            const body = await readFile(join(ROOT, relative));
            res.writeHead(200, { 'Content-Type': MIME[extname(relative)] ?? 'application/octet-stream' }).end(body);
        } catch {
            res.writeHead(404).end();
        }
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

async function launch(): Promise<Browser> {
    if (browser) { return browser; }
    const executablePath = process.env.SHEETMARK_CHROME_PATH;
    const attempts = executablePath ? [{ executablePath }] : [{ channel: 'chrome' }, { channel: 'msedge' }];
    const errors: string[] = [];
    for (const options of attempts) {
        try {
            browser = await chromium.launch({ headless: true, ...options });
            return browser;
        } catch (err) {
            errors.push(String(err).split('\n')[0]);
        }
    }
    throw new Error(`No Chrome/Edge found for webview tests. Install Chrome or set SHEETMARK_CHROME_PATH.\n${errors.join('\n')}`);
}

/**
 * Stub of acquireVsCodeApi, plus CSP-violation capture. Runs before any page script. Kept as a
 * string: tsx would otherwise inject helpers (__name) into a serialized function.
 */
const INIT_SCRIPT = `
(() => {
    window.__posted = [];
    window.__problems = [];
    let state;
    window.acquireVsCodeApi = () => ({
        postMessage: (message) => { window.__posted.push(JSON.parse(JSON.stringify(message))); },
        getState: () => state,
        setState: (next) => { state = next; },
    });
    document.addEventListener('securitypolicyviolation', (e) => {
        window.__problems.push('CSP blocked ' + e.violatedDirective + ': ' + (e.blockedURI || e.sample || 'inline'));
    });
    window.addEventListener('error', (e) => { window.__problems.push('page error: ' + e.message); });
})();
`;

export async function openWebview(kind: WebviewKind, options: { extraInitScript?: string } = {}): Promise<WebviewHarness> {
    await startServer();
    const page = await (await launch()).newPage();
    await page.addInitScript({ content: INIT_SCRIPT + (options.extraInitScript ?? '') });
    await page.goto(`${origin}/__shell/${kind}`);

    const posted = () => page.evaluate(() => (window as any).__posted as any[]);
    return {
        page,
        posted,
        async waitForPosted(command, timeoutMs = 10000) {
            const handle = await page.waitForFunction(
                (c) => ((window as any).__posted as any[]).find(m => m?.command === c),
                command,
                { timeout: timeoutMs },
            );
            return handle.jsonValue();
        },
        send: (message) => page.evaluate((m) => { window.postMessage(m, '*'); }, message),
        problems: () => page.evaluate(() => (window as any).__problems as string[]),
    };
}

export async function closeHarness(): Promise<void> {
    await browser?.close();
    browser = undefined;
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
}
