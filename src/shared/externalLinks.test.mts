import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedExternalUrl } from './externalLinks.ts';

test('isAllowedExternalUrl accepts web and email links', () => {
    assert.equal(isAllowedExternalUrl('https://example.com/a?b=c'), true);
    assert.equal(isAllowedExternalUrl('HTTP://example.com'), true);
    assert.equal(isAllowedExternalUrl('mailto:a@b.c'), true);
    assert.equal(isAllowedExternalUrl('  https://example.com'), true);
});

test('isAllowedExternalUrl rejects local, command and relative links', () => {
    for (const url of ['file:///etc/passwd', 'command:workbench.action.terminal.new', 'vscode://x', 'javascript:alert(1)', 'ms-msdt:foo', 'notes.md', '']) {
        assert.equal(isAllowedExternalUrl(url), false, url);
    }
});
