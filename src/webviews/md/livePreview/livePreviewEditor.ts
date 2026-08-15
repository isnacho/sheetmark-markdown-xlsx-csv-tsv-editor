// CodeMirror 6 editor for Markdown "Preview Edit" mode.
//
// Runtime: WEBVIEW (browser). No Node / no `vscode` module here — only DOM +
// the CM6 packages, which esbuild bundles into dist/md/mdWebview.js.
//
// ============================================================================
// DUAL-SURFACE STATE-SYNC CONTRACT (acceptance criterion for the Phase 1 spike)
// ============================================================================
// There are two editing surfaces: Split mode owns the <textarea> (editor.value);
// Preview Edit mode (CM6 engine) owns this EditorView's doc. The rules that keep
// them from drifting — the whole reason the turndown round-trip is being removed:
//
//   1. `currentContent` (a string in mdWebview.ts) is the SINGLE SOURCE OF TRUTH.
//      Neither surface is authoritative; both are views over it.
//   2. On ENTERING a mode, seed that surface FROM `currentContent`
//      (editor.value = currentContent for Split; mountLivePreview({doc}) for CM6).
//   3. On LEAVING a mode / on SAVE / on ANY READ, pull live text OUT of the active
//      surface and write it back to `currentContent` BEFORE the other surface is
//      touched. `getActiveEditorContent()` in mdWebview.ts is the ONLY reader; its
//      CM6 branch calls getLivePreviewContent() here.
//   4. On Split<->Preview switch: read active surface -> write currentContent ->
//      seed incoming surface. Never seed the incoming surface from the outgoing
//      surface directly.
//   5. Dirty tracking compares currentContent to originalContent, unchanged. CM6's
//      own change events feed currentContent via the updateListener below (this
//      replaces the onEditorInput() side-effect the old textarea path relied on).
// ============================================================================

import { EditorState, Compartment, Annotation, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { cm6Theme } from './cm6Theme';
import { slashMenuAutocompletion } from './slashMenu';
import {
    livePreviewSearchField, findCm6Matches, setCm6SearchHighlights,
    clearCm6SearchHighlights, scrollCm6ToMatch,
} from './livePreviewSearch';
import type { Cm6Match } from './livePreviewSearch';
import { detectInteractionAtPos } from './livePreviewInteractions';
import type { Cm6Interaction } from './livePreviewInteractions';
import { livePreviewRevealPlugin, orderedListAtomicRanges } from './revealDecorations';
import { codeStylingPlugin } from './codeStylingPlugin';
import { tableWidgetField, columnWidthsField, setColumnWidthsEffect } from './tableWidget';
import { tableBoundaryExtensions } from './tableBoundaryEditing';
import { frontmatterWidgetField, seedFrontmatterCollapsed, seedFrontmatterEditing, setFrontmatterCollapsedCallback } from './frontmatterWidget';
import { headingLineDecorationField } from './headingGutterSync';
import { hoverLineGutter, hoverGutterDomEventHandlers } from './hoverLineGutter';
import {
    mermaidWidgetField,
    mermaidAtomicRanges,
    setMermaidPreviewModeCallback,
} from './mermaidWidget';
import {
    mermaidPreviewModeField,
    seedMermaidPreviewMode,
    setMermaidPreviewModeEffect,
    type MermaidPreviewMode,
} from './mermaidPreviewMode';
import { calloutWidgetField, setCalloutDefaultTypeCallback } from './calloutWidget';
import {
    imageWidgetField,
    refreshImageWidgetsEffect,
    setImageUriResolver,
} from './imageWidget';
import {
    calloutDefaultTypeField,
    seedCalloutDefaultType,
    setCalloutDefaultTypeEffect,
} from './calloutDefaultType';
import { runFormatCommand, livePreviewFormatKeymap, computePasteLink } from './formatCommands';
import { paragraphNavigationKeymap } from './paragraphNavigation';
import { applyTableCellInlineFormatAction } from './tableWidget';
import { spellcheckExtensions, loadSpellDictionary, teardownSpellcheck } from './spellcheck';

export interface LivePreviewMountOptions {
    /** Element to mount the editor into (its children are cleared first). */
    parent: HTMLElement;
    /** Initial document text (seed from currentContent — see contract rule 2). */
    doc: string;
    /** Fired on genuine user edits (not programmatic seeds) — feeds currentContent. */
    onDocChanged: (doc: string) => void;
    /** Whether to soft-wrap long lines (mirrors the md.wordWrap setting). */
    lineWrapping?: boolean;
    /** Fired on scroll (viewport change) — drives scroll-spy/TOC/progress-bar re-integration. */
    onScroll?: () => void;
    /** Fired on Ctrl/Cmd+Click at a doc position — mdWebview.ts resolves the interaction and acts. */
    onModifierClick?: (pos: number) => void;
    /** Whether reveal-on-cursor decorations are on (mirrors the md.livePreviewReveal setting). */
    reveal?: boolean;
    /** Whether to show the line-number gutter (mirrors the md.livePreviewLineNumbers setting). */
    showLineNumbers?: boolean;
    /** Persisted table column widths (table order-index -> px per column), read from the host on load. */
    columnWidths?: Record<number, readonly number[]>;
    /** Fired once per completed column-resize drag (never per-pixel) — mdWebview.ts persists it to the host. */
    onColumnWidthsChanged?: (widths: Record<number, readonly number[]>) => void;
    /** Persisted YAML frontmatter card collapsed state, read from the host on load. */
    frontmatterCollapsed?: boolean;
    /** Fired when the user toggles the YAML card — mdWebview.ts persists it to the host. */
    onFrontmatterCollapsedChanged?: (collapsed: boolean) => void;
    /** Persisted global Mermaid preview mode, read from the host on load. */
    mermaidPreviewMode?: MermaidPreviewMode;
    /** Fired when the user changes Mermaid preview mode — mdWebview.ts persists it to the host. */
    onMermaidPreviewModeChanged?: (mode: MermaidPreviewMode) => void;
    /** Persisted default callout type for new /callout inserts, read from the host on load. */
    calloutDefaultType?: string;
    /** Fired when the user picks a callout type — mdWebview.ts persists it as the new default. */
    onCalloutDefaultTypeChanged?: (type: string) => void;
    /** Fired on any selection/cursor change (including plain cursor moves with no doc change) — drives the status-bar Ln/Col display. */
    onSelectionChange?: () => void;
    /** Fired when undo/redo availability changes (incl. after undo/redo). */
    onHistoryChange?: () => void;
}

let view: EditorView | null = null;
const wrapCompartment = new Compartment();
const revealCompartment = new Compartment();
const gutterCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
/** Line-number gutter: clicking a line number selects that line's text; hovering shows the muted hover bar (hoverLineGutter.ts — must attach here, not via EditorView.domEventHandlers, since that never sees gutter-only mouse events). */
function buildLineNumbersGutter() {
    return lineNumbers({
        domEventHandlers: {
            // CM6's gutter plugin resolves the line from the gutter cell's
            // vertical midpoint when the target is a gutter element — that
            // feels one line off when cells are tall or visually misaligned.
            // Map the actual click Y through the content column instead.
            click: (v, line, event) => {
                const mouse = event as MouseEvent;
                const contentLeft = v.contentDOM.getBoundingClientRect().left;
                const pos = v.posAtCoords({ x: contentLeft + 4, y: mouse.clientY });
                const docLine = pos !== null
                    ? v.state.doc.lineAt(pos)
                    : v.state.doc.lineAt(line.from);
                v.dispatch({ selection: EditorSelection.range(docLine.from, docLine.to) });
                return true;
            },
            ...hoverGutterDomEventHandlers(),
        },
    });
}

// Marks a transaction as a programmatic seed so the updateListener does not echo
// it back into currentContent (avoids feedback during mode switches / seeding).
const programmatic = Annotation.define<boolean>();

/**
 * Lazily construct and mount the CM6 EditorView. Called on FIRST (and each)
 * entry into Preview Edit mode; CM6 core is only *constructed* here, so
 * Reading/Split-only sessions pay parse cost but not construction cost.
 */
export function mountLivePreview(opts: LivePreviewMountOptions): EditorView {
    // Defensive: never leak a previous view.
    unmountLivePreview();

    const {
        parent, doc, onDocChanged, lineWrapping = true, onScroll, onModifierClick, reveal = true,
        showLineNumbers = false, columnWidths, onColumnWidthsChanged, onSelectionChange, onHistoryChange,
        frontmatterCollapsed = false, onFrontmatterCollapsedChanged,
        mermaidPreviewMode = 'diagram', onMermaidPreviewModeChanged,
        calloutDefaultType = 'info', onCalloutDefaultTypeChanged,
    } = opts;
    parent.innerHTML = '';
    setFrontmatterCollapsedCallback(onFrontmatterCollapsedChanged);
    setMermaidPreviewModeCallback(onMermaidPreviewModeChanged);
    setCalloutDefaultTypeCallback(onCalloutDefaultTypeChanged);
    void loadSpellDictionary();

    const updateListener = EditorView.updateListener.of((update) => {
        if (update.viewportChanged) { onScroll?.(); }
        if (update.selectionSet) { onSelectionChange?.(); }
        if (undoDepth(update.startState) !== undoDepth(update.state)
            || redoDepth(update.startState) !== redoDepth(update.state)) {
            onHistoryChange?.();
        }
        // Checked before the docChanged early-return below: a column-resize
        // commit is an effects-only transaction (see wireResizeHandle in
        // tableWidget.ts) with no doc change at all.
        if (update.transactions.some(tr => tr.effects.some(e => e.is(setColumnWidthsEffect)))) {
            onColumnWidthsChanged?.(update.state.field(columnWidthsField));
        }
        if (!update.docChanged) { return; }
        const isProgrammatic = update.transactions.some(tr => tr.annotation(programmatic));
        if (isProgrammatic) { return; }
        onDocChanged(update.state.doc.toString());
    });

    const domHandlers = EditorView.domEventHandlers({
        mousedown(event, editorView) {
            if (!onModifierClick || !(event.ctrlKey || event.metaKey)) { return false; }
            const pos = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) { return false; }
            onModifierClick(pos);
            return true;
        },
        paste(event, editorView) {
            const text = event.clipboardData?.getData('text/plain');
            if (!text) { return false; }
            const spec = computePasteLink(editorView.state, text);
            if (!spec) { return false; }
            editorView.dispatch(spec);
            event.preventDefault();
            return true;
        },
        scroll() { onScroll?.(); },
    });

    const state = EditorState.create({
        doc,
        extensions: [
            history(),
            drawSelection(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            hoverLineGutter(),
            markdown({ extensions: GFM }),
            // No `syntaxHighlighting(defaultHighlightStyle)` here — it was
            // unused boilerplate, not a real dependency: no `codeLanguages` is
            // configured for `markdown()`, so its programming-language tags
            // (keyword/string/comment/...) never fire; its heading/emphasis/
            // strong/strikethrough tags are all already styled, better, by
            // this file's own decorations. Its only OBSERVABLE effect was an
            // unwanted underline+bold on headings from its generic
            // `tags.heading` rule (`@lezer/markdown` tags ATXHeading1-6 as
            // `heading1`-`heading6`, which fall back to matching the more
            // general `heading` tag). Removing the rule at the source beats
            // trying to out-rank it with a `!important` override of unclear
            // cascade precedence against a same-range decoration from a
            // different plugin.
            wrapCompartment.of(lineWrapping ? EditorView.lineWrapping : []),
            gutterCompartment.of(showLineNumbers ? [buildLineNumbersGutter()] : []),
            readOnlyCompartment.of([]),
            keymap.of(livePreviewFormatKeymap),
            paragraphNavigationKeymap,
            keymap.of([...defaultKeymap, ...historyKeymap]),
            cm6Theme(),
            livePreviewSearchField(),
            // Deliberately OUTSIDE revealCompartment: toggling the reveal
            // setting off/on reconfigures that compartment's extensions,
            // which would re-`create()` (i.e. reset to `{}`) any StateField
            // living inside it. Column widths must survive that toggle.
            columnWidthsField.init(() => columnWidths ?? {}),
            seedFrontmatterCollapsed(frontmatterCollapsed),
            seedFrontmatterEditing(false),
            frontmatterWidgetField,
            headingLineDecorationField,
            seedMermaidPreviewMode(mermaidPreviewMode),
            mermaidPreviewModeField,
            seedCalloutDefaultType(calloutDefaultType),
            calloutDefaultTypeField,
            calloutWidgetField,
            imageWidgetField,
            revealCompartment.of(reveal ? [livePreviewRevealPlugin, tableWidgetField, ...tableBoundaryExtensions, mermaidWidgetField, mermaidAtomicRanges, orderedListAtomicRanges] : []),
            codeStylingPlugin,
            ...spellcheckExtensions,
            slashMenuAutocompletion(),
            domHandlers,
            updateListener,
        ],
    });

    view = new EditorView({ state, parent });
    return view;
}

export function refreshLivePreviewImages(): void {
    view?.dispatch({ effects: refreshImageWidgetsEffect.of(undefined) });
}

/** Destroy the view and clear its DOM. Idempotent — safe to call when unmounted. */
export function unmountLivePreview(): void {
    if (view) {
        const parent = view.dom.parentElement;
        view.destroy();
        if (parent) { parent.innerHTML = ''; }
        view = null;
    }
    teardownSpellcheck();
    setFrontmatterCollapsedCallback(undefined);
    setMermaidPreviewModeCallback(undefined);
    setCalloutDefaultTypeCallback(undefined);
    setImageUriResolver(undefined);
}

export function isLivePreviewActive(): boolean {
    return view !== null;
}

/** Read the live document out of CM6 (contract rule 3). null when not mounted. */
export function getLivePreviewContent(): string | null {
    return view ? view.state.doc.toString() : null;
}

/** Replace the whole document programmatically (does NOT fire onDocChanged). */
export function setLivePreviewContent(text: string): void {
    if (!view) { return; }
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: programmatic.of(true),
    });
}

export function focusLivePreview(): void {
    view?.focus();
}

export function livePreviewUndo(): boolean {
    return view ? undo(view) : false;
}

export function livePreviewRedo(): boolean {
    return view ? redo(view) : false;
}

export function canLivePreviewUndo(): boolean {
    return view ? undoDepth(view.state) > 0 : false;
}

export function canLivePreviewRedo(): boolean {
    return view ? redoDepth(view.state) > 0 : false;
}

/** Toolbar/keyboard-shortcut entry point (Phase 5). `view` never leaks past this module. */
export function applyLivePreviewFormat(action: string): boolean {
    if (!view || view.state.readOnly) { return false; }
    if (action === 'undo') { return livePreviewUndo(); }
    if (action === 'redo') { return livePreviewRedo(); }
    if (applyTableCellInlineFormatAction(action)) { return true; }
    const handled = runFormatCommand(view, action);
    if (handled) { view.focus(); }
    return handled;
}

/** Toggle soft-wrap without rebuilding the view (reconfigures a compartment). */
export function setLivePreviewLineWrapping(on: boolean): void {
    view?.dispatch({
        effects: wrapCompartment.reconfigure(on ? EditorView.lineWrapping : []),
    });
}

/** Toggle reveal-on-cursor decorations without rebuilding the view. */
export function setLivePreviewReveal(on: boolean): void {
    view?.dispatch({
        effects: revealCompartment.reconfigure(on ? [livePreviewRevealPlugin, tableWidgetField, ...tableBoundaryExtensions, mermaidWidgetField, mermaidAtomicRanges, orderedListAtomicRanges] : []),
    });
}

/** Toggle the line-number gutter without rebuilding the view. */
export function setLivePreviewLineNumbers(on: boolean): void {
    view?.dispatch({
        effects: gutterCompartment.reconfigure(on ? [buildLineNumbersGutter()] : []),
    });
}

/** Update global Mermaid preview mode without rebuilding the view. */
export function setLivePreviewMermaidMode(mode: MermaidPreviewMode): void {
    if (!view) { return; }
    view.dispatch({ effects: setMermaidPreviewModeEffect.of(mode === 'code' ? 'code' : 'diagram') });
}

export function setLivePreviewCalloutDefaultType(type: string): void {
    if (!view) { return; }
    view.dispatch({ effects: setCalloutDefaultTypeEffect.of(type) });
}

/** Version-history preview: block doc edits while keeping scroll/selection/search. */
export function setLivePreviewReadOnly(on: boolean): void {
    view?.dispatch({
        effects: readOnlyCompartment.reconfigure(on ? [EditorState.readOnly.of(true)] : []),
    });
}

export function isLivePreviewReadOnly(): boolean {
    return view?.state.readOnly ?? false;
}

// ===== Re-integration (Phase 2): scroll metrics, TOC scroll, search, click =====
// `.cm-scroller` is the actual scrolling element — `view.dom`'s parent
// (#markdownPreview) does not scroll itself, unlike the old contentEditable.

/** null when not mounted. Mirrors what updateProgressBar/updateScrollSpy read off `preview` in legacy mode. */
export function getLivePreviewScrollMetrics(): { scrollTop: number; scrollHeight: number; clientHeight: number } | null {
    if (!view) { return null; }
    const scroller = view.scrollDOM;
    return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
}

/** 1-indexed line number nearest the top of the viewport, for scroll-spy. */
export function getLivePreviewTopLine(): number | null {
    if (!view) { return null; }
    const top = view.scrollDOM.scrollTop + 8;
    const block = view.lineBlockAtHeight(Math.min(top, view.scrollDOM.scrollHeight));
    return view.state.doc.lineAt(block.from).number;
}

/** 1-indexed line + 1-indexed column of the current selection head. null when not mounted. */
export function getLivePreviewCursorPosition(): { line: number; col: number } | null {
    if (!view) { return null; }
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    return { line: line.number, col: head - line.from + 1 };
}

/** TOC click target — scroll CM6 so the given 1-indexed line sits at the top. */
export function scrollLivePreviewToLine(line: number): void {
    if (!view) { return; }
    const clamped = Math.max(1, Math.min(line, view.state.doc.lines));
    const pos = view.state.doc.line(clamped).from;
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
}

export function resolveLivePreviewInteraction(pos: number): Cm6Interaction | null {
    return view ? detectInteractionAtPos(view.state, pos) : null;
}

export function findLivePreviewMatches(query: string): Cm6Match[] {
    return view ? findCm6Matches(view.state, query) : [];
}

export function setLivePreviewSearchHighlights(matches: Cm6Match[], current: number): void {
    if (view) { setCm6SearchHighlights(view, matches, current); }
}

export function clearLivePreviewSearchHighlights(): void {
    if (view) { clearCm6SearchHighlights(view); }
}

export function scrollLivePreviewToMatch(match: Cm6Match): void {
    if (view) { scrollCm6ToMatch(view, match); }
}
