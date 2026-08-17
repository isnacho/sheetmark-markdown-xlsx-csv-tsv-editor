import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, Text } from '@codemirror/state';
import {
    findCalloutBlocks,
    calloutTypeClass,
    parseCalloutOpener,
    normalizeCalloutTypeSlug,
    formatCalloutOpener,
    isCustomCalloutType,
} from './calloutTypes.ts';

test('findCalloutBlocks: parses open/close fences and content line range', () => {
    const doc = Text.of([
        'before',
        ':::info',
        'line one',
        'line two',
        ':::',
        'after',
    ]);
    const blocks = findCalloutBlocks(doc);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'info');
    assert.equal(blocks[0].contentStartLine, 3);
    assert.equal(blocks[0].contentEndLine, 4);
});

test('findCalloutBlocks: blank opener is a custom callout', () => {
    const doc = Text.of([':::', 'body', ':::']);
    const blocks = findCalloutBlocks(doc);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, '');
    assert.equal(isCustomCalloutType(blocks[0].type), true);
});

test('findCalloutBlocks: optional space and title on the opener', () => {
    const doc = Text.of(['::: info Note title', 'body', ':::']);
    const blocks = findCalloutBlocks(doc);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'info');
});

test('findCalloutBlocks: unclosed block runs content through EOF', () => {
    const doc = Text.of([':::warning', 'tail']);
    const blocks = findCalloutBlocks(doc);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'warning');
    assert.equal(blocks[0].closeFrom, null);
    assert.equal(blocks[0].contentEndLine, 2);
});

test('calloutTypeClass: known types map to semantic classes, unknown to neutral', () => {
    assert.equal(calloutTypeClass('info'), 'cm-md-callout-info');
    assert.equal(calloutTypeClass('note'), 'cm-md-callout-neutral');
    assert.equal(calloutTypeClass(''), 'cm-md-callout-neutral');
});

test('parseCalloutOpener preserves title suffix', () => {
    assert.deepEqual(parseCalloutOpener(':::warning Watch out'), {
        leading: '',
        type: 'warning',
        titleSuffix: ' Watch out',
    });
});

test('parseCalloutOpener: bare ::: has empty type', () => {
    assert.deepEqual(parseCalloutOpener(':::'), {
        leading: '',
        type: '',
        titleSuffix: '',
    });
});

test('normalizeCalloutTypeSlug accepts blank and custom slugs', () => {
    assert.equal(normalizeCalloutTypeSlug(''), '');
    assert.equal(normalizeCalloutTypeSlug('my-tip'), 'my-tip');
});

test('formatCalloutOpener: empty type becomes :::custom', () => {
    assert.equal(formatCalloutOpener(''), ':::custom');
});

test('callout opener rewrite preserves optional title suffix for built-ins', () => {
    const doc = ':::info Title\nbody\n:::';
    const state = EditorState.create({ doc });
    const block = findCalloutBlocks(state.doc)[0];
    const parsed = parseCalloutOpener(state.doc.line(block.openLine).text);
    assert.ok(parsed);
    assert.equal(formatCalloutOpener('warning', parsed.leading, parsed.titleSuffix), ':::warning Title');
});
