// Headless test: CM6 EditorState + a hand-built CompletionContext, no DOM /
// no EditorView / no VS Code host. CompletionContext's constructor is public
// for exactly this ("Mostly useful for testing completion sources").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { slashMenuSource, slashMenuCompletions, computeSlashApply, SLASH_OPTIONS, SLASH_ICON_BY_LABEL } from './slashMenu.ts';

function stateFor(doc: string): EditorState {
    return EditorState.create({ doc });
}

function option(name: string) {
    const found = SLASH_OPTIONS.find(o => o.label === name);
    assert.ok(found, `expected a "${name}" option`);
    return found!;
}

test('slashMenuSource: fires for a lone "/" on an otherwise-empty line', () => {
    const state = stateFor('/');
    const result = slashMenuSource(new CompletionContext(state, 1, false));
    assert.ok(result);
    assert.equal(result!.from, 1);
    assert.equal(result!.to, 1);
    assert.equal(result!.options.length, slashMenuCompletions.length);
});

test('slashMenuSource: fires while a filter word is being typed', () => {
    const state = stateFor('/head');
    const result = slashMenuSource(new CompletionContext(state, 5, false));
    assert.ok(result);
    assert.equal(result!.from, 1);
    assert.equal(result!.to, 5);
});

test('slashMenuSource: does not fire when "/" is not the first character of the line', () => {
    const state = stateFor('hi /');
    assert.equal(slashMenuSource(new CompletionContext(state, 4, false)), null);
});

test('slashMenuSource: does not fire when the cursor is not at the end of the line', () => {
    const state = stateFor('/foo bar');
    assert.equal(slashMenuSource(new CompletionContext(state, 4, false)), null);
});

test('slashMenuSource: does not fire on a line with no leading "/"', () => {
    const state = stateFor('plain text');
    assert.equal(slashMenuSource(new CompletionContext(state, 10, false)), null);
});

test('option table includes every block transform named in the plan', () => {
    const labels = slashMenuCompletions.map(c => c.label);
    assert.deepEqual(labels, [
        'Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4',
        'Bulleted List', 'Numbered List', 'To-do List', 'Callout', 'Quote', 'Table', 'Divider',
    ]);
});

test('computeSlashApply: "Heading 2" replaces "/head" with "## " and places the cursor after it', () => {
    const state = stateFor('/head');
    const tr = state.update(computeSlashApply({ label: 'Heading 2', insert: '## ', cursorOffset: 3 }, 1, 5));
    assert.equal(tr.state.doc.toString(), '## ');
    assert.equal(tr.state.selection.main.from, 3);
});

test('computeSlashApply: "Callout" inserts the container fence with the cursor on the blank body line', () => {
    const state = stateFor('/callout');
    const opt = option('Callout');
    const tr = state.update(computeSlashApply(opt, 1, 8));
    assert.equal(tr.state.doc.toString(), ':::info\n\n:::');
    assert.equal(tr.state.selection.main.from, 8);
});

test('computeSlashApply: "Table" inserts the fixed snippet with the cursor at its end', () => {
    const state = stateFor('/table');
    const opt = option('Table');
    const tr = state.update(computeSlashApply(opt, 1, 6));
    assert.ok(tr.state.doc.toString().includes('| Header 1 | Header 2 | Header 3 |'));
    assert.equal(tr.state.selection.main.from, opt.insert.length);
});

test('every slash option has a toolbar icon', () => {
    for (const option of SLASH_OPTIONS) {
        assert.ok(SLASH_ICON_BY_LABEL[option.label], `missing icon for "${option.label}"`);
        assert.match(SLASH_ICON_BY_LABEL[option.label], /^<svg/);
    }
});

test('slash completions expose Notion-style markdown hints except plain Text', () => {
    const byLabel = Object.fromEntries(slashMenuCompletions.map((c) => [c.label, c.detail]));
    assert.equal(byLabel['Text'], undefined);
    assert.equal(byLabel['Heading 1'], '#');
    assert.equal(byLabel['Heading 4'], '####');
    assert.equal(byLabel['Bulleted List'], '-');
    assert.equal(byLabel['Divider'], '---');
});

test('computeSlashApply: "Text" just removes the trigger, leaving an empty line', () => {
    const state = stateFor('/text');
    const tr = state.update(computeSlashApply(option('Text'), 1, 5));
    assert.equal(tr.state.doc.toString(), '');
    assert.equal(tr.state.selection.main.from, 0);
});
