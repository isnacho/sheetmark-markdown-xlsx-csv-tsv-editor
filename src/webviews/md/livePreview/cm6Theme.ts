// CodeMirror 6 theme for the Markdown Preview Edit editor.
//
// Runtime: WEBVIEW (browser). No Node / no `vscode` module here.
//
// The theme deliberately references the semantic CSS variables already defined
// in resources/shared/theme.css (--color-text-primary, --color-surface-default, --color-border-default,
// --color-surface-sunken, --color-selection-bg, --color-text-link, --font-family, --font-mono, --font-mono-weight, --font-mono-size,
// --surface-radius). Those
// vars are remapped to --vscode-* tokens by theme.css itself, so the editor
// tracks the active VS Code / light / dark theme automatically. Referencing the
// vars *directly* (rather than snapshotting them with getComputedStyle) means a
// theme toggle re-resolves the colors with no need to rebuild the EditorView.

import { EditorView } from '@codemirror/view';

export function cm6Theme(): ReturnType<typeof EditorView.theme> {
    return EditorView.theme({
        '&': {
            color: 'var(--color-text-primary)',
            backgroundColor: 'var(--color-surface-default)',
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
            caretColor: 'var(--color-text-primary)',
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
            borderLeftColor: 'var(--color-text-primary)',
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
            backgroundColor: 'var(--color-selection-bg)',
        },
        '.cm-activeLine': {
            backgroundColor: 'transparent',
        },
        '.cm-gutters': {
            backgroundColor: 'var(--color-surface-default)',
            color: 'var(--color-text-tertiary)',
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
            // Positioning context for both the active-line and hover
            // left-edge bars below, unconditionally (the hover bar's
            // `::before` exists on every row — see note below).
            position: 'relative',
        },
        '.cm-activeLineGutter': {
            backgroundColor: 'transparent',
        },
        '&.cm-focused .cm-activeLineGutter': {
            color: 'var(--color-text-primary)',
            fontWeight: '700',
            position: 'relative',
        },
        '&.cm-focused .cm-activeLineGutter::before': {
            content: '""',
            position: 'absolute',
            left: '0',
            top: '0',
            bottom: '0',
            width: '2px',
            backgroundColor: 'var(--color-text-primary)',
        },
        // Hover sibling to the active-line bar above (hoverLineGutter.ts
        // toggles the `cm-md-hover-line-gutter` class): same left-edge
        // geometry as the active line, but the bar color matches the
        // inactive line number's own color (`.cm-gutters` color above)
        // rather than the active line's `--color-text-primary` — and never
        // applied to the active line itself (suppressed at the data layer
        // in hoverLineGutter.ts). The fade-in/out transition is what keeps
        // it reading as the secondary, mouse-driven cue.
        //
        // The `::before` itself is created unconditionally on every
        // non-active gutter row (opacity 0 baseline) rather than only when
        // the hover class is present — a pseudo-element whose very
        // existence is gated by a class can only ever snap in/out, since
        // there's nothing for the browser to transition to/from. Keeping it
        // always-present and only toggling `opacity` lets both the fade-in
        // and fade-out genuinely animate.
        //
        // `:not(.cm-activeLineGutter)` isn't just belt-and-suspenders: this
        // selector and the active-line `::before` above compile (via CM6's
        // `&`-theme mechanism) to selectors of EQUAL specificity, so without
        // it, this rule — being declared later — would win the cascade tie
        // on the active line's element too and blank out its bar/opacity.
        '.cm-lineNumbers .cm-gutterElement:not(.cm-activeLineGutter)::before': {
            content: '""',
            position: 'absolute',
            left: '0',
            top: '0',
            bottom: '0',
            width: '2px',
            backgroundColor: 'var(--color-text-tertiary)',
            opacity: '0',
            transition: 'opacity 120ms ease',
        },
        '.cm-lineNumbers .cm-gutterElement.cm-md-hover-line-gutter:not(.cm-activeLineGutter)::before': {
            opacity: '1',
        },
        '.cm-lineNumbers .cm-gutterElement.cm-md-hover-line-gutter:not(.cm-activeLineGutter)': {
            fontWeight: '700',
        },
        '.cm-md-search-match': {
            backgroundColor: 'color-mix(in srgb, var(--color-status-warning) 35%, transparent)',
            borderRadius: '2px',
            boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-status-warning) 55%, transparent)',
        },
        '.cm-md-search-current': {
            backgroundColor: 'color-mix(in srgb, var(--color-status-warning) 60%, transparent)',
            boxShadow: '0 0 0 2px var(--color-action)',
        },
        // Reveal engine (Phase 4): dimmed marker shown while the cursor is in the
        // element (ATX headings: anywhere on the heading line); heading-size/bold/
        // italic content styling always on.
        '.cm-md-reveal-mark': {
            color: 'var(--color-text-secondary)',
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
        '.cm-content .cm-md-h6': { fontSize: '1em', color: 'var(--color-text-secondary)' },
        '.cm-md-inline-code': {
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-mono-weight)',
            fontSize: 'var(--font-mono-size)',
            backgroundColor: 'var(--color-surface-sunken)',
            color: 'var(--color-text-code)',
            borderRadius: 'var(--surface-radius)',
        },
        '.cm-md-fenced-code-line': {
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-mono-weight)',
            fontSize: 'var(--font-mono-size)',
            backgroundColor: 'var(--color-surface-sunken)',
            borderLeft: '1px solid var(--color-border-subtle)',
            borderRight: '1px solid var(--color-border-subtle)',
        },
        '.cm-md-fenced-code-line-first': {
            borderTop: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--surface-radius) var(--surface-radius) 0 0',
            paddingTop: '16px',
        },
        '.cm-md-fenced-code-line-first.cm-md-fenced-code-line-gap-before': {
            // External gap above a fence — padding only (margins desync CM6 clicks).
            paddingTop: '32px',
        },
        '.cm-md-fenced-code-line-last': {
            borderBottom: '1px solid var(--color-border-subtle)',
            borderRadius: '0 0 var(--surface-radius) var(--surface-radius)',
            paddingBottom: '16px',
        },
        '.cm-md-fenced-code-line-last.cm-md-fenced-code-line-gap-after': {
            paddingBottom: '32px',
        },
        '.cm-md-fenced-code-line-first.cm-md-fenced-code-line-last': {
            borderRadius: 'var(--surface-radius)',
        },
        '.cm-md-mermaid-block': {
            display: 'block',
            margin: '0',
            paddingTop: '16px',
            paddingBottom: '16px',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--surface-radius)',
            overflow: 'hidden',
            background: 'var(--color-surface-sunken)',
            maxWidth: '100%',
            boxSizing: 'border-box',
        },
        '.cm-md-mermaid-toolbar': {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '6px 10px',
            border: '1px solid var(--color-border-subtle)',
            borderBottom: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--surface-radius) var(--surface-radius) 0 0',
            marginTop: '0',
            background: 'color-mix(in srgb, var(--color-surface-sunken) 85%, var(--color-surface-raised) 15%)',
        },
        '.cm-md-mermaid-block .cm-md-mermaid-toolbar': {
            marginTop: '0',
            borderRadius: '0',
            border: 'none',
            borderBottom: '1px solid var(--color-border-subtle)',
        },
        '.cm-md-mermaid-lang': {
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-mono-weight)',
            color: 'var(--color-text-secondary)',
        },
        '.cm-md-mermaid-mode-select': {
            fontSize: '11px',
            fontFamily: 'var(--font-family)',
            color: 'var(--color-text-primary)',
            background: 'var(--color-surface-default)',
            border: '1px solid var(--color-border-default)',
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
            color: 'var(--color-text-secondary)',
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
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflowX: 'hidden',
            overflowY: 'hidden',
            border: '1px solid var(--color-border-default)',
            borderRadius: 'var(--surface-radius)',
            lineHeight: '0',
        },
        '.cm-md-table-scroll.cm-md-table-overflow-x': {
            overflowX: 'auto',
            position: 'relative',
        },
        '.cm-md-table-scroll.cm-md-table-overflow-x table.md-table.cm-md-table-resized th, .cm-md-table-scroll.cm-md-table-overflow-x table.md-table.cm-md-table-resized td:not(.cm-md-table-cell-editing)': {
            whiteSpace: 'nowrap',
        },
        '.cm-md-table-scroll.cm-md-table-hug-content': {
            width: 'fit-content',
            maxWidth: '100%',
        },
        // Undoes shared `.markdown-preview table.md-table` rules in
        // resources/md/mdWebview.css (`display: block` / `overflow: auto` on
        // the <table>) — that combo breaks border-collapse in the widget.
        // Horizontal scroll lives on `.cm-md-table-scroll` so row grips can sit
        // left of the table without being clipped.
        '.cm-md-table-widget table.md-table': {
            display: 'table',
            overflow: 'visible',
            lineHeight: '1.5',
        },
        '.cm-md-table-widget table.md-table:not(.cm-md-table-resized)': {
            width: '100%',
            maxWidth: '100%',
            tableLayout: 'fixed',
        },
        '.cm-md-table-widget table.md-table:not(.cm-md-table-resized) th, .cm-md-table-widget table.md-table:not(.cm-md-table-resized) td': {
            overflowWrap: 'anywhere',
            wordWrap: 'break-word',
            whiteSpace: 'normal',
        },
        '.cm-md-table-widget table.md-table.cm-md-table-resized': {
            width: 'auto',
            maxWidth: 'none',
            tableLayout: 'fixed',
        },
        '.cm-md-frontmatter-widget': {
            display: 'block',
            margin: '0',
        },
        '.yaml-frontmatter-tail-spacer': {
            display: 'block',
            height: '40px',
            pointerEvents: 'none',
        },
        // Phase 7: extended reveal set (strikethrough/inline-code marker hide/
        // dim reuses .cm-md-reveal-mark above; these are the new content classes).
        '.cm-md-strike-content': {
            textDecoration: 'line-through',
        },
        '.cm-md-link-content': {
            color: 'var(--color-text-link)',
            textDecoration: 'underline',
        },
        '.cm-md-image-alt-content': {
            color: 'var(--color-text-secondary)',
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
            background: 'color-mix(in srgb, var(--color-text-primary) 6%, transparent)',
            color: 'var(--color-text-secondary)',
            fontSize: '13px',
            lineHeight: '1.4',
        },
        '.cm-md-image-placeholder.cm-md-image-error': {
            color: 'var(--color-status-error)',
            background: 'color-mix(in srgb, var(--color-status-error) 8%, transparent)',
        },
        '.cm-md-blockquote-line': {
            backgroundColor: 'transparent',
            marginLeft: '4px',
            borderLeft: '2px solid var(--color-text-primary)',
            paddingLeft: '8px',
            color: 'var(--color-text-secondary)',
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
            backgroundColor: 'color-mix(in srgb, var(--color-status-info-subtle) 45%, var(--color-surface-default))',
        },
        '.cm-md-callout-warning': {
            backgroundColor: 'color-mix(in srgb, var(--color-status-warning-subtle) 45%, var(--color-surface-default))',
        },
        '.cm-md-callout-error': {
            backgroundColor: 'color-mix(in srgb, var(--color-status-error-subtle) 45%, var(--color-surface-default))',
        },
        '.cm-md-callout-success': {
            backgroundColor: 'color-mix(in srgb, var(--color-status-success-subtle) 45%, var(--color-surface-default))',
        },
        '.cm-md-callout-neutral': {
            backgroundColor: 'color-mix(in srgb, var(--color-surface-panel) 70%, var(--color-surface-default))',
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
            color: 'var(--color-status-info)',
        },
        '.cm-md-callout-content-first.cm-md-callout-error::before': {
            content: '"\\2717"',
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '15px',
            lineHeight: '1',
            color: 'var(--color-status-error)',
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
            color: 'var(--color-status-success)',
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
            color: 'var(--color-text-primary)',
            background: 'var(--color-surface-default)',
            border: '1px solid var(--color-border-default)',
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
            marginLeft: '4px',
            marginRight: '6px',
            borderRadius: '50%',
            backgroundColor: 'var(--color-text-primary)',
            verticalAlign: 'middle',
        },
        '.cm-md-bullet-marker-nested': {
            backgroundColor: 'transparent',
            border: '1.5px solid var(--color-text-primary)',
        },
        '.cm-md-ordered-marker': {
            color: 'var(--color-text-primary)',
            fontWeight: '600',
            marginLeft: '4px',
            marginRight: '6px',
        },
        '.cm-md-checkbox-bullet-hidden': {
            display: 'none',
        },
        '.cm-md-task-checkbox': {
            marginLeft: '4px',
            marginRight: '6px',
            verticalAlign: 'middle',
            cursor: 'pointer',
            accentColor: 'var(--color-action)',
        },
        '.cm-md-task-done-content': {
            textDecoration: 'line-through',
            color: 'var(--color-text-secondary)',
        },
        '.cm-md-hr-widget': {
            display: 'inline-block',
            width: '100%',
            height: '0',
            boxSizing: 'content-box',
            padding: '6px 0',
            border: 'none',
            borderTop: '1px solid var(--color-text-secondary)',
            opacity: '0.6',
            cursor: 'text',
            verticalAlign: 'middle',
        },
        // Slash menu styling lives in resources/shared/menuPanel.css (shared with settings panel).
        '.cm-lintRange-error': {
            backgroundImage: 'url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'6\' height=\'3\'><path d=\'m0 3 l2 -2 l1 0 l2 2\' fill=\'none\' stroke=\'%23e51400\' stroke-width=\'1\'/></svg>")',
            backgroundRepeat: 'repeat-x',
            backgroundPosition: 'left bottom',
            paddingBottom: '2px',
        },
        // Spell suggestion menu styling lives in resources/shared/menuPanel.css.
    });
}
