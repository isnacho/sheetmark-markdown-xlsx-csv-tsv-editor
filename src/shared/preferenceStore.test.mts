import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownPreferences, filePreference, globalPreference } from './preferenceStore.ts';

function fakeMemento(initial: Record<string, unknown> = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        get: <T,>(key: string, fallback?: T) => (data.has(key) ? data.get(key) as T : fallback) as T,
        update: async (key: string, value: unknown) => { if (value === undefined) { data.delete(key); } else { data.set(key, value); } },
    };
}

const file = (fsPath: string) => ({ fsPath });

test('filePreference keys by lowercased path and migrates on move', async () => {
    const memento = fakeMemento();
    const pref = filePreference<number>(memento, 'p.', () => 0);
    await pref.set(file('/Docs/A.md'), 3);
    assert.equal(pref.get(file('/docs/a.md')), 3);
    assert.equal(pref.get(file('/docs/b.md')), 0);
    await pref.migrate(file('/docs/a.md'), file('/moved/a.md'));
    assert.equal(pref.get(file('/moved/a.md')), 3);
    assert.deepEqual([...memento.data.keys()], ['p./moved/a.md']);
});

test('globalPreference normalizes reads and rejects invalid writes', async () => {
    const memento = fakeMemento({ g: 'bogus' });
    const pref = globalPreference<'a' | 'b'>(memento, 'g', 'a', (raw) => (raw === 'a' || raw === 'b' ? raw : undefined));
    assert.equal(pref.get(), 'a');
    await pref.set('b');
    assert.equal(pref.get(), 'b');
    await pref.set('nope' as 'a');
    assert.equal(pref.get(), 'b');
});

test('Markdown preferences keep their persisted storage keys and rules', async () => {
    const workspace = fakeMemento({ 'xlsxViewer.tableColumnWidths./notes/a.md': { 0: [120, 80] } });
    const global = fakeMemento({ 'xlsxViewer.mermaidPreviewMode': 'code', 'xlsxViewer.calloutDefaultType': 'Warning' });
    const prefs = createMarkdownPreferences(workspace, global);

    assert.deepEqual(prefs.tableColumnWidths.get(file('/notes/A.md')), { 0: [120, 80] });
    assert.equal(prefs.frontmatterPanelCollapsed.get(file('/notes/a.md')), false);
    assert.equal(prefs.mermaidPreviewMode.get(), 'code');
    assert.equal(prefs.calloutDefaultType.get(), 'warning');

    await prefs.frontmatterPanelCollapsed.set(file('/notes/a.md'), true);
    assert.equal(workspace.data.get('xlsxViewer.frontmatterPanel./notes/a.md'), true);

    await prefs.calloutDefaultType.set('not a slug!');
    assert.equal(prefs.calloutDefaultType.get(), 'warning');
    await prefs.calloutDefaultType.set('');
    assert.equal(prefs.calloutDefaultType.get(), 'info');

    for (const pref of prefs.perFile) { await pref.migrate(file('/notes/a.md'), file('/archive/a.md')); }
    assert.deepEqual(prefs.tableColumnWidths.get(file('/archive/a.md')), { 0: [120, 80] });
    assert.equal(prefs.frontmatterPanelCollapsed.get(file('/archive/a.md')), true);
});
