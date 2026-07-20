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
            color: 'var(--text-faint)',
            border: 'none',
            fontSize: '12px',
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
            fontWeight: '600',
            backgroundColor: 'var(--code-bg)',
            color: 'var(--code-text)',
            borderRadius: '4px',
        },
        '.cm-md-fenced-code-line': {
            fontFamily: 'var(--font-mono)',
            fontWeight: '600',
            backgroundColor: 'var(--code-bg)',
        },
        '.cm-md-table-widget': {
            display: 'block',
            cursor: 'text',
            overflowX: 'auto',
        },
        // Undoes the shared .markdown-preview table.md-table rule's
        // display:block/overflow:auto on the <table> itself (resources/md/
        // mdWebview.css) — that combo forces the browser to synthesize
        // anonymous table wrapper boxes around <thead>/<tbody> since the
        // table's own display is no longer `table`, which breaks
        // border-collapse and visibly splits the header row-group from the
        // body row-group. Reading mode doesn't hit this (same shared CSS,
        // but no visible symptom there), so scoped to the Live Preview
        // widget only rather than touching the shared CSS Reading mode
        // relies on. Scrolling now lives on the wrapper div above instead.
        '.cm-md-table-widget table.md-table': {
            display: 'table',
            overflow: 'visible',
        },
        // Phase 7: extended reveal set (strikethrough/inline-code marker hide/
        // dim reuses .cm-md-reveal-mark above; these are the new content classes).
        '.cm-md-strike-content': {
            textDecoration: 'line-through',
        },
        '.cm-md-link-content': {
            color: 'var(--link-color)',
            textDecoration: 'underline',
        },
        '.cm-md-blockquote-line': {
            backgroundColor: 'transparent',
            marginLeft: '4px',
            borderLeft: '2px solid var(--text-color)',
            paddingLeft: '8px',
            color: 'var(--text-muted)',
        },
        // Lists/tasks: always-on baseline styling, never hidden (see the
        // design note in revealDecorations.ts for why). Bullet dot: filled at
        // the outermost depth, outline-only (transparent fill + border) at
        // every nested depth — mirrors the browser's own disc/circle default
        // for nested <ul>s.
        '.cm-md-bullet-marker': {
            display: 'inline-block',
            width: '6px',
            height: '6px',
            marginRight: '4px',
            borderRadius: '50%',
            backgroundColor: 'var(--text-color)',
            verticalAlign: 'middle',
        },
        '.cm-md-bullet-marker-nested': {
            backgroundColor: 'transparent',
            border: '1.5px solid var(--text-color)',
        },
        '.cm-md-ordered-marker': {
            color: 'var(--text-color)',
            fontWeight: '600',
        },
        '.cm-md-checkbox-bullet-hidden': {
            display: 'none',
        },
        '.cm-md-task-checkbox': {
            marginRight: '8px',
            verticalAlign: 'middle',
            cursor: 'pointer',
            accentColor: 'var(--accent-color)',
        },
        '.cm-md-task-done-content': {
            textDecoration: 'line-through',
            color: 'var(--text-muted)',
        },
        '.cm-md-hr-content': {
            display: 'inline-block',
            width: '100%',
            color: 'transparent',
            lineHeight: '0',
            overflow: 'hidden',
            verticalAlign: 'middle',
            borderTop: '1px solid var(--text-muted)',
            opacity: '0.6',
        },
        // Slash menu (Phase 6): `autocompletion()` re-applies the view's theme
        // classes onto the tooltip's own container even though it isn't a DOM
        // descendant of `.cm-editor`, so these rules reach it like any other.
        '.cm-tooltip.cm-tooltip-autocomplete': {
            backgroundColor: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
        },
        '.cm-tooltip-autocomplete ul': {
            fontFamily: 'var(--font-family)',
            minWidth: '160px',
        },
        '.cm-tooltip-autocomplete ul li': {
            padding: '4px 10px',
            color: 'var(--text-color)',
        },
        '.cm-tooltip-autocomplete ul li[aria-selected]': {
            backgroundColor: 'var(--selection-bg)',
            color: 'var(--text-color)',
        },
    });
}
