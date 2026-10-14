import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    extractFrontmatter,
    parseFrontmatter,
    isEmptyFrontmatter,
    buildFieldRows,
    markdownBodyWithoutFrontmatter,
    resolveFrontmatterWidgetData,
    formatFrontmatterBlock,
    cursorPosAfterFrontmatter,
    frontmatterBodyStartLine,
} from './frontmatter.ts';

test('extractFrontmatter: valid block at doc start', () => {
    const raw = '---\ntitle: Hello\nstatus: draft\n---\n\n# Body\n';
    const extracted = extractFrontmatter(raw);
    assert.ok(extracted);
    assert.equal(extracted.yamlText, 'title: Hello\nstatus: draft');
    assert.equal(extracted.body, '\n# Body\n');
    assert.deepEqual(extracted.range, { from: 0, to: '---\ntitle: Hello\nstatus: draft\n---\n'.length });
    assert.equal(cursorPosAfterFrontmatter(raw), extracted.range.to);
});

test('cursorPosAfterFrontmatter: no block returns 0', () => {
    assert.equal(cursorPosAfterFrontmatter('# Hello\n'), 0);
});

test('frontmatterBodyStartLine: no block starts at line 1', () => {
    assert.equal(frontmatterBodyStartLine('# Hello\n'), 1);
});

test('frontmatterBodyStartLine: body starts after frontmatter block', () => {
    const raw = '---\ntitle: Hello\n---\n# Body\n';
    assert.equal(frontmatterBodyStartLine(raw), 4);
});

test('extractFrontmatter: ignores mid-document hr block', () => {
    const raw = '# Title\n\n---\n\nParagraph';
    assert.equal(extractFrontmatter(raw), null);
});

test('extractFrontmatter: optional BOM prefix', () => {
    const raw = '\uFEFF---\ntitle: BOM\n---\nbody';
    const extracted = extractFrontmatter(raw);
    assert.ok(extracted);
    assert.equal(extracted.yamlText, 'title: BOM');
    assert.equal(extracted.body, 'body');
});

test('isEmptyFrontmatter: whitespace-only', () => {
    assert.equal(isEmptyFrontmatter('   \n  '), true);
    assert.equal(isEmptyFrontmatter('title: x'), false);
});

test('parseFrontmatter: invalid yaml returns null', () => {
    assert.equal(parseFrontmatter('title: [unclosed'), null);
});

test('parseFrontmatter: rejects array root', () => {
    assert.equal(parseFrontmatter('- one\n- two'), null);
});

test('buildFieldRows: nested object and array chips', () => {
    const yamlText = 'title: Doc\ntags:\n  - a\n  - b\nmeta:\n  depth: 2';
    const parsed = parseFrontmatter(yamlText);
    assert.ok(parsed);
    const rows = buildFieldRows(parsed);
    assert.ok(rows.some((row) => row.key === 'title' && row.kind === 'scalar'));
    const tags = rows.find((row) => row.key === 'tags');
    assert.ok(tags);
    assert.equal(tags.kind, 'array');
    assert.deepEqual(tags.chips, ['a', 'b']);
    assert.ok(rows.some((row) => row.key === 'meta' && row.kind === 'object'));
    assert.ok(rows.some((row) => row.key === 'depth' && row.depth === 1));
});

test('resolveFrontmatterWidgetData: empty frontmatter returns null', () => {
    const raw = '---\n---\n# Heading\n';
    assert.equal(resolveFrontmatterWidgetData(raw), null);
    assert.equal(markdownBodyWithoutFrontmatter(raw), '# Heading\n');
});

test('resolveFrontmatterWidgetData: invalid yaml returns null', () => {
    const raw = '---\ntitle: [\n---\n# Heading\n';
    assert.equal(resolveFrontmatterWidgetData(raw), null);
    assert.equal(markdownBodyWithoutFrontmatter(raw), raw);
});

test('resolveFrontmatterWidgetData: returns card data when valid', () => {
    const raw = '---\ntitle: Hello\n---\n# Heading\n';
    const data = resolveFrontmatterWidgetData(raw);
    assert.ok(data);
    assert.equal(data.yamlText, 'title: Hello');
    assert.equal(markdownBodyWithoutFrontmatter(raw), '# Heading\n');
});

test('formatFrontmatterBlock round-trips simple yaml', () => {
    const block = formatFrontmatterBlock({ title: 'Hello', count: 2, published: false });
    assert.match(block, /^---\n/);
    const extracted = extractFrontmatter(block);
    assert.ok(extracted);
    const parsed = parseFrontmatter(extracted.yamlText);
    assert.deepEqual(parsed, { title: 'Hello', count: 2, published: false });
});

test('markdownBodyWithoutFrontmatter strips valid frontmatter only', () => {
    const raw = '---\ntitle: x\n---\nbody';
    assert.equal(markdownBodyWithoutFrontmatter(raw), 'body');
    assert.equal(markdownBodyWithoutFrontmatter('# no frontmatter'), '# no frontmatter');
});

test('resolveFrontmatterWidgetData returns range and yaml text', () => {
    const raw = '---\ntitle: Widget\n---\nbody';
    const data = resolveFrontmatterWidgetData(raw);
    assert.ok(data);
    assert.ok(data.range.to > data.range.from);
    assert.equal(data.yamlText, 'title: Widget');
});

test('buildFieldRows: circular YAML anchor/alias does not throw', () => {
    const yamlText = 'a: &x\n  b: *x';
    const parsed = parseFrontmatter(yamlText);
    assert.ok(parsed);
    assert.doesNotThrow(() => buildFieldRows(parsed!));
    const rows = buildFieldRows(parsed!);
    assert.ok(rows.some((row) => row.key === 'a'));
});

function assertNoObjectObjectChips(rows: ReturnType<typeof buildFieldRows>): void {
    assert.ok(!rows.some((row) => row.chips?.some((chip) => chip.includes('[object Object]'))));
}

test('buildFieldRows: array of multi-key objects expands indented rows', () => {
    const yamlText = 'external_partners:\n  - name: Massive Rocket\n    role: CRM agency';
    const parsed = parseFrontmatter(yamlText);
    assert.ok(parsed);
    const rows = buildFieldRows(parsed);
    assert.ok(rows.some((row) => row.key === 'external_partners' && row.kind === 'object'));
    const name = rows.find((row) => row.key === 'name');
    const role = rows.find((row) => row.key === 'role');
    assert.ok(name);
    assert.equal(name.kind, 'scalar');
    assert.equal(name.depth, 1);
    assert.equal(name.displayValue, 'Massive Rocket');
    assert.ok(role);
    assert.equal(role.displayValue, 'CRM agency');
    assertNoObjectObjectChips(rows);
});

test('buildFieldRows: array of single-key objects expands rows', () => {
    const yamlText = 'tooling:\n  - braze: dedicated workspace';
    const parsed = parseFrontmatter(yamlText);
    assert.ok(parsed);
    const rows = buildFieldRows(parsed);
    assert.ok(rows.some((row) => row.key === 'tooling' && row.kind === 'object'));
    const braze = rows.find((row) => row.key === 'braze');
    assert.ok(braze);
    assert.equal(braze.kind, 'scalar');
    assert.equal(braze.depth, 1);
    assert.equal(braze.displayValue, 'dedicated workspace');
    assertNoObjectObjectChips(rows);
});

test('buildFieldRows: multiple single-key objects get index prefix on first key', () => {
    const yamlText = 'targets:\n  - braze: canvas a\n  - gsheet: sheet-id';
    const parsed = parseFrontmatter(yamlText);
    assert.ok(parsed);
    const rows = buildFieldRows(parsed);
    assert.ok(rows.some((row) => row.key === '[1] braze' && row.displayValue === 'canvas a'));
    assert.ok(rows.some((row) => row.key === '[2] gsheet' && row.displayValue === 'sheet-id'));
    assertNoObjectObjectChips(rows);
});

test('buildFieldRows: scalar string arrays still render as chips', () => {
    const yamlText = 'platforms:\n  - ios\n  - android';
    const parsed = parseFrontmatter(yamlText);
    assert.ok(parsed);
    const rows = buildFieldRows(parsed);
    const platforms = rows.find((row) => row.key === 'platforms');
    assert.ok(platforms);
    assert.equal(platforms.kind, 'array');
    assert.deepEqual(platforms.chips, ['ios', 'android']);
});

test('buildFieldRows: nested string arrays under object maps unchanged', () => {
    const yamlText = 'related:\n  depends_on:\n    - alpha\n    - beta';
    const parsed = parseFrontmatter(yamlText);
    assert.ok(parsed);
    const rows = buildFieldRows(parsed);
    assert.ok(rows.some((row) => row.key === 'related' && row.kind === 'object'));
    const dependsOn = rows.find((row) => row.key === 'depends_on');
    assert.ok(dependsOn);
    assert.equal(dependsOn.kind, 'array');
    assert.deepEqual(dependsOn.chips, ['alpha', 'beta']);
});

test('buildFieldRows: mixed scalar and object array shows chips and expanded rows', () => {
    const yamlText = 'mixed:\n  - foo\n  - bar: baz';
    const parsed = parseFrontmatter(yamlText);
    assert.ok(parsed);
    const rows = buildFieldRows(parsed);
    assert.ok(rows.some((row) => row.key === 'mixed' && row.kind === 'object'));
    assert.ok(rows.some((row) => row.key === '' && row.kind === 'array' && row.chips?.includes('foo')));
    assert.ok(rows.some((row) => row.key === 'bar' && row.displayValue === 'baz'));
    assertNoObjectObjectChips(rows);
});

test('buildFieldRows: push-notifications frontmatter shapes', () => {
    const yamlText = [
        'id: push-notifications',
        'platforms: [ios, android]',
        'external_partners:',
        '  - name: Massive Rocket',
        '    role: CRM agency',
        'tooling:',
        '  - braze: dedicated institutional workspace',
        'verification:',
        '  method: manual-attestation',
        '  targets:',
        '    - braze: institutional workspace / canvases',
        '    - gsheet: sheet-id',
        'related:',
        '  depends_on: [repetition-learning-unit, end-of-lesson-screens]',
    ].join('\n');
    const parsed = parseFrontmatter(yamlText);
    assert.ok(parsed);
    const rows = buildFieldRows(parsed);
    assert.ok(rows.some((row) => row.key === 'platforms' && row.chips?.join(',') === 'ios,android'));
    assert.ok(rows.some((row) => row.key === 'name' && row.displayValue === 'Massive Rocket'));
    assert.ok(rows.some((row) => row.key === 'braze' && row.displayValue === 'dedicated institutional workspace'));
    assert.ok(rows.some((row) => row.key === '[1] braze' && row.displayValue === 'institutional workspace / canvases'));
    assert.ok(rows.some((row) => row.key === '[2] gsheet' && row.displayValue === 'sheet-id'));
    const dependsOn = rows.find((row) => row.key === 'depends_on');
    assert.ok(dependsOn);
    assert.equal(dependsOn.kind, 'array');
    assertNoObjectObjectChips(rows);
});

test('resolveFrontmatterWidgetData: circular YAML does not throw', () => {
    const raw = '---\na: &x\n  b: *x\n---\nbody';
    let data: ReturnType<typeof resolveFrontmatterWidgetData> | undefined;
    assert.doesNotThrow(() => { data = resolveFrontmatterWidgetData(raw); });
    assert.ok(data);
});
