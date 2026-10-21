import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCspNonce, markdownCsp, parseCsp, spreadsheetCsp } from './webviewCsp.ts';

const SOURCE = 'https://webview.example';

function assertNoInlineScript(csp: string) {
    const policy = parseCsp(csp);
    assert.deepEqual(policy.get('default-src'), ["'none'"]);
    const scriptSrc = policy.get('script-src') ?? [];
    assert.ok(scriptSrc.includes(SOURCE), 'bundled scripts must be allowed');
    for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'data:']) {
        assert.ok(!scriptSrc.includes(forbidden), `script-src must not allow ${forbidden}`);
    }
}

test('spreadsheet CSP only runs bundled scripts', () => {
    assertNoInlineScript(spreadsheetCsp(SOURCE));
});

test('markdown CSP only runs bundled scripts and the nonce-tagged bootstrap', () => {
    const csp = markdownCsp(SOURCE, 'abc123');
    assertNoInlineScript(csp);
    assert.ok(parseCsp(csp).get('script-src')?.includes("'nonce-abc123'"));
});

test('createCspNonce is unpredictable per load', () => {
    const a = createCspNonce();
    assert.notEqual(a, createCspNonce());
    assert.ok(a.length >= 22);
});
