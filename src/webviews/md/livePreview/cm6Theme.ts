// CodeMirror 6 theme for the Markdown Preview Edit editor.
//
// Runtime: WEBVIEW (browser). No Node / no `vscode` module here.
//
// The theme deliberately references the semantic CSS variables already defined
// in resources/shared/theme.css (--text-color, --bg-color, --border-color,
// --code-bg, --selection-bg, --link-color, --font-family, --font-mono,
// --surface-radius). Those
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
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '0',
            position: 'relative',
        },
        '.cm-content': {
            caretColor: 'var(--text-color)',
            maxWidth: '900px',
            minWidth: '0',
            margin: '0 auto',
            paddingTop: '8px',
            paddingRight: '16px',
            paddingBottom: '64px',
            paddingLeft: '16px',
        },
        '.cm-editor': {
            position: 'relative',
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
            lineHeight: '1.7',
        },
        '.cm-lineNumbers .cm-gutterElement': {
            minWidth: '2.5em',
            padding: '0 8px 0 4px',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
            fontSize: '12px',
            // First-row alignment (not vertical center): centering drifts on
            // wrapped/tall lines and fights CM6's gutter click midpoint routing.
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-end',
            lineHeight: '1.7',
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
        // element (ATX headings: anywhere on the heading line); heading-size/bold/
        // italic content styling always on.
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
        '.cm-md-heading-line': {
            fontWeight: '600',
        },
        // Preview Edit: smaller than static-render h1–h3 defaults in mdWebview.css
        // so headings stay hierarchical without dominating the editor canvas.
        '.cm-content .cm-md-h1': { fontSize: '1.6em' },
        '.cm-content .cm-md-h2': { fontSize: '1.4em' },
        '.cm-content .cm-md-h3': { fontSize: '1.2em' },
        '.cm-content .cm-md-h4': { fontSize: '1.1em' },
        '.cm-content .cm-md-h5': { fontSize: '1em' },
        '.cm-content .cm-md-h6': { fontSize: '1em', color: 'var(--text-muted)' },
        '.cm-md-inline-code': {
            fontFamily: 'var(--font-mono)',
            fontSize: '100%',
            backgroundColor: 'var(--code-bg)',
            color: 'var(--code-text)',
            borderRadius: 'var(--surface-radius)',
        },
        '.cm-md-fenced-code-line': {
            fontFamily: 'var(--font-mono)',
            backgroundColor: 'var(--pre-bg)',
            borderLeft: '1px solid var(--pre-border)',
            borderRight: '1px solid var(--pre-border)',
        },
        '.cm-md-fenced-code-line-first': {
            borderTop: '1px solid var(--pre-border)',
            borderRadius: 'var(--surface-radius) var(--surface-radius) 0 0',
            paddingTop: '16px',
            marginTop: '16px',
        },
        '.cm-md-fenced-code-line-last': {
            borderBottom: '1px solid var(--pre-border)',
            borderRadius: '0 0 var(--surface-radius) var(--surface-radius)',
            paddingBottom: '16px',
            marginBottom: '16px',
        },
        '.cm-md-fenced-code-line-first.cm-md-fenced-code-line-last': {
            borderRadius: 'var(--surface-radius)',
        },
        '.cm-md-mermaid-block': {
            display: 'block',
            margin: '0',
            paddingTop: '16px',
            paddingBottom: '16px',
            border: '1px solid var(--pre-border)',
            borderRadius: 'var(--surface-radius)',
            overflow: 'hidden',
            background: 'var(--pre-bg)',
            maxWidth: '100%',
            boxSizing: 'border-box',
        },
        '.cm-md-mermaid-toolbar': {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '6px 10px',
            border: '1px solid var(--pre-border)',
            borderBottom: '1px solid var(--pre-border)',
            borderRadius: 'var(--surface-radius) var(--surface-radius) 0 0',
            marginTop: '0',
            background: 'color-mix(in srgb, var(--pre-bg) 85%, var(--header-bg) 15%)',
        },
        '.cm-md-mermaid-block .cm-md-mermaid-toolbar': {
            marginTop: '0',
            borderRadius: '0',
            border: 'none',
            borderBottom: '1px solid var(--pre-border)',
        },
        '.cm-md-mermaid-lang': {
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
        },
        '.cm-md-mermaid-mode-select': {
            fontSize: '11px',
            fontFamily: 'var(--font-family)',
            color: 'var(--text-color)',
            background: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--surface-radius)',
            padding: '2px 6px',
            cursor: 'pointer',
        },
        '.cm-md-mermaid-diagram': {
            padding: '12px 16px',
            overflowX: 'auto',
            overflowY: 'hidden',
            maxWidth: '100%',
            boxSizing: 'border-box',
        },
        '.cm-md-mermaid-diagram .mermaid': {
            display: 'flex',
            justifyContent: 'center',
            maxWidth: '100%',
        },
        '.cm-md-mermaid-diagram .mermaid svg': {
            maxWidth: '100%',
            height: 'auto',
        },
        '.cm-md-mermaid-error': {
            fontSize: '13px',
            color: 'var(--text-muted)',
            padding: '8px 0',
        },
        '.cm-md-table-widget': {
            display: 'block',
            cursor: 'text',
            overflow: 'visible',
            boxSizing: 'border-box',
            width: 'calc(100% + var(--cm-md-row-grip-gutter, 20px))',
            maxWidth: 'calc(100% + var(--cm-md-row-grip-gutter, 20px))',
        },
        '.cm-md-table-scroll': {
            width: 'fit-content',
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflowX: 'hidden',
            overflowY: 'hidden',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--surface-radius)',
            lineHeight: '0',
        },
        '.cm-md-table-scroll.cm-md-table-overflow-x': {
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
        // relies on. Horizontal scroll lives on `.cm-md-table-scroll` so row
        // grips can sit left of the table without being clipped.
        '.cm-md-table-widget table.md-table': {
            display: 'table',
            overflow: 'visible',
            lineHeight: '1.5',
        },
        '.cm-md-frontmatter-widget': {
            display: 'block',
            margin: '0',
        },
        // Block replace widgets can't reserve space via padding/margin; pad the
        // first body line instead (same pattern as fenced-code-line-first).
        '.cm-md-after-frontmatter-line': {
            paddingTop: '32px',
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
        '.cm-md-image-alt-content': {
            color: 'var(--text-muted)',
        },
        '.cm-md-image-block': {
            display: 'block',
            margin: '0',
            paddingTop: '16px',
            paddingBottom: '16px',
        },
        '.cm-md-image-inline': {
            display: 'inline-block',
            verticalAlign: 'middle',
        },
        '.cm-md-image-preview': {
            maxWidth: '100%',
            height: 'auto',
            borderRadius: 'var(--surface-radius)',
            display: 'block',
        },
        '.cm-md-image-placeholder': {
            display: 'block',
            padding: '12px 16px',
            borderRadius: 'var(--surface-radius)',
            background: 'color-mix(in srgb, var(--text-color) 6%, transparent)',
            color: 'var(--text-muted)',
            fontSize: '13px',
            lineHeight: '1.4',
        },
        '.cm-md-image-placeholder.cm-md-image-error': {
            color: 'var(--error-color)',
            background: 'color-mix(in srgb, var(--error-color) 8%, transparent)',
        },
        '.cm-md-blockquote-line': {
            backgroundColor: 'transparent',
            marginLeft: '4px',
            borderLeft: '2px solid var(--text-color)',
            paddingLeft: '8px',
            color: 'var(--text-muted)',
        },
        '.cm-md-callout-line': {
            margin: '0',
            padding: '0 12px 0 16px',
            borderLeft: 'none',
        },
        '.cm-md-callout-line-first': {
            borderRadius: 'var(--surface-radius) var(--surface-radius) 0 0',
            paddingTop: '4px',
        },
        '.cm-md-callout-line-last': {
            borderRadius: '0 0 var(--surface-radius) var(--surface-radius)',
            paddingBottom: '4px',
        },
        '.cm-md-callout-line-first.cm-md-callout-line-last': {
            borderRadius: 'var(--surface-radius)',
            paddingTop: '4px',
            paddingBottom: '4px',
        },
        '.cm-md-callout-content-first': {
            position: 'relative',
            paddingLeft: '36px',
        },
        '.cm-md-callout-empty': {
            minHeight: '0.75em',
        },
        '.cm-md-callout-info': {
            backgroundColor: 'color-mix(in srgb, var(--info-bg) 45%, var(--bg-color))',
        },
        '.cm-md-callout-warning': {
            backgroundColor: 'color-mix(in srgb, var(--warning-bg) 45%, var(--bg-color))',
        },
        '.cm-md-callout-error': {
            backgroundColor: 'color-mix(in srgb, var(--error-bg) 45%, var(--bg-color))',
        },
        '.cm-md-callout-success': {
            backgroundColor: 'color-mix(in srgb, var(--success-bg) 45%, var(--bg-color))',
        },
        '.cm-md-callout-neutral': {
            backgroundColor: 'color-mix(in srgb, var(--panel-bg) 70%, var(--bg-color))',
        },
        '.cm-md-callout-content-first.cm-md-callout-warning::before': {
            content: '"\\26A0"',
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '15px',
            lineHeight: '1',
        },
        '.cm-md-callout-content-first.cm-md-callout-info::before': {
            content: '"\\2139"',
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '15px',
            lineHeight: '1',
            color: 'var(--info-color)',
        },
        '.cm-md-callout-content-first.cm-md-callout-error::before': {
            content: '"\\2717"',
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '15px',
            lineHeight: '1',
            color: 'var(--error-color)',
            fontWeight: '700',
        },
        '.cm-md-callout-content-first.cm-md-callout-success::before': {
            content: '"\\2713"',
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '15px',
            lineHeight: '1',
            color: 'var(--success-color)',
            fontWeight: '700',
        },
        '.cm-md-callout-type-toolbar': {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            float: 'right',
            marginLeft: '8px',
            position: 'relative',
            zIndex: 2,
        },
        '.cm-md-callout-type-select': {
            fontSize: '11px',
            fontFamily: 'var(--font-family)',
            color: 'var(--text-color)',
            background: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--surface-radius)',
            padding: '2px 6px',
            cursor: 'pointer',
            maxWidth: '140px',
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
        '.cm-md-hr-widget': {
            display: 'inline-block',
            width: '100%',
            height: '0',
            boxSizing: 'content-box',
            padding: '6px 0',
            border: 'none',
            borderTop: '1px solid var(--text-muted)',
            opacity: '0.6',
            cursor: 'text',
            verticalAlign: 'middle',
        },
        // Slash menu: glass panel + icon/label rows (slashMenu.ts + shared Icons).
        // Notion-style: tight container, no inter-item gap — each row's own padding
        // creates separation; highlight fills the full row including that inset.
        '.cm-tooltip.cm-tooltip-autocomplete.cm-slash-menu-tooltip': {
            background: 'var(--glass-bg-strong)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            boxShadow: 'var(--shadow-lg)',
            backdropFilter: 'blur(12px) saturate(160%)',
            WebkitBackdropFilter: 'blur(12px) saturate(160%)',
            padding: '4px',
            overflow: 'hidden',
        },
        '.cm-tooltip-autocomplete.cm-slash-menu-tooltip ul': {
            fontFamily: 'var(--font-family)',
            fontSize: '14px',
            lineHeight: '1.35',
            minWidth: '224px',
            maxHeight: '360px',
            margin: '0',
            padding: '0',
            gap: '0',
        },
        '.cm-tooltip-autocomplete.cm-slash-menu-tooltip ul li.cm-slash-menu-option': {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            margin: '0',
            padding: '7px 10px',
            color: 'var(--text-color)',
            borderRadius: 'var(--surface-radius)',
            cursor: 'pointer',
        },
        '.cm-tooltip-autocomplete.cm-slash-menu-tooltip ul li.cm-slash-menu-option[aria-selected]': {
            backgroundColor: 'color-mix(in srgb, var(--text-color) 8%, transparent)',
            color: 'var(--text-color)',
        },
        '.cm-slash-menu-icon': {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: '0',
            width: '20px',
            height: '20px',
            color: 'var(--text-muted)',
        },
        '.cm-slash-menu-icon svg': {
            width: '18px',
            height: '18px',
        },
        'li[aria-selected] .cm-slash-menu-icon': {
            color: 'var(--text-color)',
        },
        '.cm-tooltip-autocomplete.cm-slash-menu-tooltip .cm-completionLabel': {
            flex: '1',
            minWidth: '0',
        },
        '.cm-tooltip-autocomplete.cm-slash-menu-tooltip .cm-completionDetail': {
            marginLeft: 'auto',
            paddingLeft: '10px',
            color: 'var(--text-muted)',
            fontStyle: 'normal',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            letterSpacing: '0.02em',
            opacity: '0.9',
            flexShrink: '0',
        },
        '.cm-lintRange-error': {
            backgroundImage: 'url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'6\' height=\'3\'><path d=\'m0 3 l2 -2 l1 0 l2 2\' fill=\'none\' stroke=\'%23e51400\' stroke-width=\'1\'/></svg>")',
            backgroundRepeat: 'repeat-x',
            backgroundPosition: 'left bottom',
            paddingBottom: '2px',
        },
        '.cm-spell-context-menu': {
            position: 'fixed',
            zIndex: '1000',
            minWidth: '120px',
            padding: '4px 0',
            backgroundColor: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
        },
        '.cm-spell-context-item': {
            display: 'block',
            width: '100%',
            padding: '6px 12px',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-color)',
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
        },
        '.cm-spell-context-item:hover': {
            backgroundColor: 'var(--selection-bg)',
        },
    });
}
