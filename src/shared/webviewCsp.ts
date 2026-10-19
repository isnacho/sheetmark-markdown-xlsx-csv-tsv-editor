// Content-Security-Policy for both webviews. Pure (no `vscode` import) so the policy is unit-tested.
//
// Scripts may only come from the extension's own files (cspSource), plus, in Markdown, the one
// inline bootstrap tag carrying the per-load nonce. Never add 'unsafe-inline' or 'unsafe-eval' to
// script-src: file content (cells, Markdown) is untrusted, and the CSP is what stops an
// <img onerror> or javascript: link that slips past sanitizing from running.

import { randomBytes } from 'crypto';

/** Fresh nonce for one webview load. */
export function createCspNonce(): string {
    return randomBytes(16).toString('base64');
}

export function spreadsheetCsp(cspSource: string): string {
    return [
        "default-src 'none'",
        `img-src ${cspSource} https: data:`,
        `style-src ${cspSource} 'unsafe-inline'`,
        `font-src ${cspSource}`,
        `script-src ${cspSource}`,
    ].join('; ') + ';';
}

export function markdownCsp(cspSource: string, nonce: string): string {
    return [
        "default-src 'none'",
        `connect-src ${cspSource}`,
        `img-src ${cspSource} https: data:`,
        `style-src ${cspSource} https: 'unsafe-inline'`,
        `font-src ${cspSource} https:`,
        `script-src ${cspSource} 'nonce-${nonce}'`,
    ].join('; ') + ';';
}

/** Parse a CSP string into directive -> sources (used by tests). */
export function parseCsp(csp: string): Map<string, string[]> {
    const directives = new Map<string, string[]>();
    for (const part of csp.split(';')) {
        const [name, ...sources] = part.trim().split(/\s+/);
        if (name) { directives.set(name, sources); }
    }
    return directives;
}
