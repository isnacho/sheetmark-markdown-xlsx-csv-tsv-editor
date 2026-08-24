import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripMarkdownToPlainText, computeTextStats } from './markdownStats.ts';

test('stripMarkdownToPlainText: bold', () => {
    assert.equal(stripMarkdownToPlainText('**bold**'), 'bold');
    assert.equal(stripMarkdownToPlainText('__bold__'), 'bold');
});

test('stripMarkdownToPlainText: italic', () => {
    assert.equal(stripMarkdownToPlainText('*italic*'), 'italic');
    assert.equal(stripMarkdownToPlainText('_italic_'), 'italic');
});

test('stripMarkdownToPlainText: inline code', () => {
    assert.equal(stripMarkdownToPlainText('`code`'), 'code');
});

test('stripMarkdownToPlainText: strikethrough', () => {
    assert.equal(stripMarkdownToPlainText('~~gone~~'), 'gone');
});

test('stripMarkdownToPlainText: link keeps text, drops url', () => {
    assert.equal(stripMarkdownToPlainText('[text](https://example.com)'), 'text');
});

test('stripMarkdownToPlainText: image keeps alt text', () => {
    assert.equal(stripMarkdownToPlainText('![alt](https://example.com/img.png)'), 'alt');
});

test('stripMarkdownToPlainText: heading markers', () => {
    assert.equal(stripMarkdownToPlainText('## Heading'), 'Heading');
});

test('stripMarkdownToPlainText: blockquote marker', () => {
    assert.equal(stripMarkdownToPlainText('> quoted'), 'quoted');
});

test('stripMarkdownToPlainText: list markers', () => {
    assert.equal(stripMarkdownToPlainText('- item'), 'item');
    assert.equal(stripMarkdownToPlainText('1. item'), 'item');
});

test('stripMarkdownToPlainText: horizontal rule collapses to empty', () => {
    assert.equal(stripMarkdownToPlainText('---'), '');
    assert.equal(stripMarkdownToPlainText('***'), '');
});

test('stripMarkdownToPlainText: combined multi-line', () => {
    const raw = '# Title\n\nThis is **bold** and _italic_ with a [link](url).';
    assert.equal(stripMarkdownToPlainText(raw), 'Title\n\nThis is bold and italic with a link.');
});

test('stripMarkdownToPlainText: unterminated fragment degrades gracefully', () => {
    assert.doesNotThrow(() => stripMarkdownToPlainText('bold** rest'));
});

test('computeTextStats: basic counts', () => {
    const stats = computeTextStats('two words');
    assert.equal(stats.words, 2);
    assert.equal(stats.chars, 9);
    assert.equal(stats.lines, 1);
});

test('computeTextStats: empty string has zero words', () => {
    const stats = computeTextStats('');
    assert.equal(stats.words, 0);
    assert.equal(stats.chars, 0);
    assert.equal(stats.lines, 1);
});

test('computeTextStats: whitespace-only has zero words', () => {
    const stats = computeTextStats('   \n  ');
    assert.equal(stats.words, 0);
});

test('computeTextStats: multi-line', () => {
    const stats = computeTextStats('line one\nline two\nline three');
    assert.equal(stats.lines, 3);
    assert.equal(stats.words, 6);
});
