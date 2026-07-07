// CodeMirror 6 theme for the Markdown Preview Edit editor.
//
// Runtime: WEBVIEW (browser). No Node / no `vscode` module here.
//
// The theme deliberately references the semantic CSS variables already defined
// in resources/shared/theme.css (--text-color, --bg-color, --border-color,
// --code-bg, --selection-bg, --link-color, --font-family, --font-mono). Those
// vars are remapped to --vscode-* tokens by theme.css itself, so the editor
// tracks the active VS Code / light / dark theme automatically. Referencing the
// vars *directly* (rather than snapshotting them with getComputedStyle) means a
// theme toggle re-resolves the colors with no need to rebuild the EditorView.

import { EditorView } from '@codemirror/view';

export function cm6Theme(): ReturnType<typeof EditorView.theme> {
    return EditorView.theme({
        '&': {
            color: 'var(--text-color)',
            backgroundColor: 'var(--bg-color)',
            height: '100%',
            fontSize: '15px',
        },
        '.cm-scroller': {
            fontFamily: 'var(--font-family)',
            lineHeight: '1.7',
            overflow: 'auto',
            padding: '8px 0',
        },
        '.cm-content': {
            caretColor: 'var(--text-color)',
            maxWidth: '900px',
            margin: '0 auto',
            padding: '0 16px',
        },
        '&.cm-focused': {
            outline: 'none',
        },
        '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: 'var(--text-color)',
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
            backgroundColor: 'var(--selection-bg)',
        },
        '.cm-activeLine': {
            backgroundColor: 'transparent',
        },
        '.cm-gutters': {
            backgroundColor: 'var(--bg-color)',
            color: 'var(--text-color)',
            border: 'none',
            opacity: '0.5',
        },
        '.cm-activeLineGutter': {
            backgroundColor: 'transparent',
        },
        '.cm-md-search-match': {
            backgroundColor: 'color-mix(in srgb, var(--warning-color) 35%, transparent)',
            borderRadius: '2px',
            boxShadow: '0 0 0 1px color-mix(in srgb, var(--warning-color) 55%, transparent)',
        },
        '.cm-md-search-current': {
            backgroundColor: 'color-mix(in srgb, var(--warning-color) 60%, transparent)',
            boxShadow: '0 0 0 2px var(--accent-color)',
        },
        // Reveal engine (Phase 4): dimmed marker shown while the cursor is in the
        // element; heading-size/bold/italic content styling shown while it isn't.
        '.cm-md-reveal-mark': {
            color: 'var(--text-muted)',
            opacity: '0.7',
        },
        '.cm-md-strong-content': {
            fontWeight: '700',
        },
        '.cm-md-em-content': {
            fontStyle: 'italic',
        },
        '.cm-md-heading-content': {
            fontWeight: '600',
        },
        '.cm-md-h1': { fontSize: '2em' },
        '.cm-md-h2': { fontSize: '1.5em' },
        '.cm-md-h3': { fontSize: '1.25em' },
        '.cm-md-h4': { fontSize: '1em' },
        '.cm-md-h5': { fontSize: '0.875em' },
        '.cm-md-h6': { fontSize: '0.85em', color: 'var(--text-muted)' },
        '.cm-md-inline-code': {
            fontFamily: 'var(--font-mono)',
            fontSize: '85%',
            backgroundColor: 'var(--code-bg)',
            color: 'var(--code-text)',
            borderRadius: '4px',
        },
        '.cm-md-fenced-code-line': {
            fontFamily: 'var(--font-mono)',
            backgroundColor: 'var(--code-bg)',
        },
        '.cm-md-table-widget': {
            display: 'block',
            cursor: 'text',
        },
    });
}
