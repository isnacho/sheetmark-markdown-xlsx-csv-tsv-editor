#!/usr/bin/env node
// Proves the tests guard the fixes: for each entry below, re-break one fix in a throwaway git
// worktree of HEAD and confirm `npm run verify` or `npm run test:integration` fails.
//
//   npm run test:regressions            # all entries
//   npm run test:regressions -- csp     # entries whose id contains "csp"
//
// Each mutation keeps the identifiers it neutralizes referenced (`void name;`), so it can't be
// "caught" just by noUnusedLocals: a test has to notice the behavior change. Add an entry whenever
// you fix a bug. `knownGap: true` marks a fix no test can reach yet; it is reported, not failed.

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MUTATIONS = [
    { id: 'xss-cell-sanitize', file: 'src/webviews/spreadsheet/components/spreadsheetCellTextComponent.ts',
      find: "return sanitizeHtml(value) || '&nbsp;';", replace: 'void sanitizeHtml; return value;' },
    { id: 'xss-cell-style-attr', file: 'src/webviews/spreadsheet/components/spreadsheetRenderComponent.ts',
      find: "html += ' style=\"' + escapeAttribute(cellStyleStr) + '\"';", replace: "html += ' style=\"' + cellStyleStr + '\"';" },
    { id: 'xlsx-color-alpha-ignored', file: 'src/spreadsheet/spreadsheetUtilities.ts',
      find: 'return `rgba(${r}, ${g}, ${b}, 1)`;', replace: 'return `rgba(${r}, ${g}, ${b}, ${parseInt(argb.substring(0, 2), 16) / 255})`;' },
    { id: 'xlsx-fill-pattern-none', file: 'src/spreadsheet/spreadsheetUtilities.ts',
      find: "if (!pattern.pattern || pattern.pattern === 'none') {return undefined;}", replace: "if (pattern.pattern === '__never__') {return undefined;}" },
    { id: 'xss-md-table', file: 'src/webviews/md/livePreview/tableWidget.ts',
      find: 'return sanitizeHtml(md.render(source, { colCount, widths }));', replace: 'void sanitizeHtml; return md.render(source, { colCount, widths });' },
    { id: 'xss-sanitizer-attrs', file: 'src/webviews/shared/sanitizeHtml.ts',
      find: 'if (!ALLOWED_ATTRS.has(name)) {', replace: 'if (!ALLOWED_ATTRS.has(name) && name === "__never__") {' },
    { id: 'csp-spreadsheet-inline', file: 'src/shared/webviewCsp.ts',
      find: '`script-src ${cspSource}`,', replace: "`script-src ${cspSource} 'unsafe-inline'`," },
    { id: 'csp-markdown-nonce-tag', file: 'src/shared/webviewHtml.ts',
      find: '<script nonce="${nonce}">window.__SPELL_DICT__', replace: '<script>window.__SPELL_DICT__' },
    { id: 'md-embedded-doc-escaped', file: 'src/shared/webviewHtml.ts',
      find: ".replace(/</g, '\\\\u003c')", replace: ".replace(/</g, '<')" },
    { id: 'md-boot-hidden-until-styled', file: 'src/shared/webviewHtml.ts',
      find: '<style id="${BOOT_STYLE_ELEMENT_ID}">body{visibility:hidden;', replace: '<style id="${BOOT_STYLE_ELEMENT_ID}">body{' },
    { id: 'md-embedded-doc-used-once', file: 'src/mdEditorProvider.ts',
      find: '                        embeddedContent = null;\n', replace: '' },
    { id: 'links-any-scheme', file: 'src/shared/commonHostMessages.ts',
      find: 'if (url && isAllowedExternalUrl(url)) {', replace: 'if (url && (isAllowedExternalUrl(url) || url.length > 0)) {' },
    { id: 'save-queue-dispatcher', file: 'src/shared/messageDispatch.ts',
      find: 'const done = options.queuedCommands.has(message?.command) ? options.queue.run(run) : run();', replace: 'void options.queuedCommands; void options.queue; const done = run();' },
    { id: 'save-queue-provider', file: 'src/spreadsheetEditorProvider.ts',
      find: 'queuedCommands: SPREADSHEET_FILE_WRITING_COMMANDS,', replace: 'queuedCommands: new Set([...SPREADSHEET_FILE_WRITING_COMMANDS].filter(() => false)),' },
    { id: 'copy-multiline', file: 'src/webviews/spreadsheet/components/spreadsheetCopyComponent.ts',
      find: 'return { text: serializeTsv(outputRows), cellCount: cellsArray.length };', replace: "void serializeTsv; return { text: outputRows.map(r => r.join('\\t')).join('\\n'), cellCount: cellsArray.length };" },
    { id: 'paste-multiline', file: 'src/webviews/spreadsheet/spreadsheetWebview.ts',
      find: 'const grid = parseTsv(text);', replace: "void parseTsv; const grid = text.split(/\\r?\\n/).filter(Boolean).map(l => l.split('\\t'));" },
    { id: 'convert-styles', file: 'src/extension.ts',
      find: '    applyStoredMetadataToWorksheet(worksheet, metadata);\n', replace: '    void applyStoredMetadataToWorksheet;\n' },
    { id: 'convert-notice-metadata', file: 'src/spreadsheetEditorProvider.ts',
      find: '                    applyStoredMetadataToWorksheet(worksheet, storedMetadata);\n', replace: '                    void applyStoredMetadataToWorksheet;\n' },
    { id: 'csv-version-history', file: 'src/spreadsheetEditorProvider.ts',
      find: '                        await persistVersionSnapshot();\n                        return;', replace: '                        return;' },
    { id: 'csv-save-stores-nothing-aside', file: 'src/spreadsheetEditorProvider.ts',
      find: "            await writeTabularFile(currentUri.fsPath, {\n                sheets: [{ name: 'Sheet1', rows }]\n            }, sourceType);\n",
      replace: "            await writeTabularFile(currentUri.fsPath, {\n                sheets: [{ name: 'Sheet1', rows }]\n            }, sourceType);\n            await this.styleStorage.saveMetadata(currentUri, { cells: { '1:1': { style: { bold: true } } }, merges: [] });\n" },
    { id: 'sheet-edit-kept-when-rows-reload', file: 'src/webviews/spreadsheet/persistence.ts',
      find: "    if (cellData) {\n        cellData.value = value;\n        cellData.isEmpty = value === '';", replace: "    if (cellData) {\n        cellData.isEmpty = value === '';" },
    { id: 'sheet-save-result-keeps-newer-edits', file: 'src/webviews/spreadsheet/persistence.ts',
      find: 'ledger.settleSaved(sent.mark);', replace: 'void sent; ledger.clearAll();' },
    { id: 'sheet-edits-go-to-their-sheet', file: 'src/webviews/spreadsheet/persistence.ts',
      find: '        sheetIndex: sheet,\n        edits: payload.edits,', replace: '        sheetIndex: state.currentWorksheet,\n        edits: payload.edits,' },
    { id: 'sheet-undo-is-saved', file: 'src/webviews/spreadsheet/undo.ts',
      find: '        recordCellValue(rowNum, colNum, undoState.value);', replace: '        void recordCellValue; void rowNum; void colNum;' },
    { id: 'sheet-escape-cancels-only-the-cell', file: 'src/webviews/spreadsheet/spreadsheetWebview.ts',
      find: "active.innerHTML = active.dataset.originalHtml || '';", replace: 'void active;' },
    { id: 'xlsx-css-style-edits-saved', file: 'src/spreadsheet/excelStyle.ts',
      find: '    const s = withLogicalStyleFields(edit);', replace: '    const s = edit;' },
    { id: 'sheet-inflight-value-not-dropped', file: 'src/webviews/spreadsheet/pendingEdits.ts',
      find: ' && !this.inFlight.get(sheet)?.values.has(key)) {', replace: ') {' },
    { id: 'sheet-settle-rebases-original', file: 'src/webviews/spreadsheet/pendingEdits.ts',
      find: 'entry.data.original = sent;', replace: 'void sent;' },
    { id: 'sheet-undo-waits-for-save', file: 'src/webviews/spreadsheet/undo.ts',
      find: 'if (!entry || !state.isSaving) {return false;}', replace: 'if (!entry || !state.isSaving || Date.now() > 0) {return false;}' },
    { id: 'toast-persistent-comes-back', file: 'src/webviews/shared/toast.ts',
      find: "if (persistentToast) {\n                    showToast(persistentToast.message, persistentToast.action, persistentToast.opts);\n                }", replace: 'void persistentToast;' },
    { id: 'sheet-home-end-move-caret', file: 'src/webviews/spreadsheet/spreadsheetWebview.ts',
      find: "if (e.key === 'Home' || e.key === 'End') {\n                    e.preventDefault();", replace: "if ((e.key === 'Home' || e.key === 'End') && Date.now() < 0) {\n                    e.preventDefault();" },
    { id: 'sheet-render-commits-edited-cell', file: 'src/webviews/spreadsheet/spreadsheetWebview.ts',
      find: '        if (state.isCellEditing) {exitCellEditMode();}\n        state.isRendering = true;', replace: '        state.isRendering = true;' },
    { id: 'sheet-saved-structure-undo-dropped', file: 'src/webviews/spreadsheet/undo.ts',
      find: "const unrecoverable = (entry: EditUndoEntry) => entry.seq <= upToSeq && (entry.kind === 'sheet' || changesFormatting(entry));", replace: "const unrecoverable = (entry: EditUndoEntry) => entry.seq <= upToSeq && Date.now() < 0 && (entry.kind === 'sheet' || changesFormatting(entry));" },
    { id: 'sheet-saved-structure-undo-drops-older-entries', file: 'src/webviews/spreadsheet/undo.ts',
      find: 'const keep = (entry: EditUndoEntry) => entry.seq > upToSeq;', replace: "const keep = (entry: EditUndoEntry) => entry.seq > upToSeq || !(entry.kind === 'sheet' || changesFormatting(entry));" },
    { id: 'sheet-saved-structure-undo-inverse-ops', file: 'src/webviews/spreadsheet/persistence.ts',
      find: '// Structure edits and formatting that are on disk now cannot be undone by restoring a snapshot.', replace: '// Structure edits and formatting that are on disk now cannot be undone by restoring a snapshot. ',
      knownGap: 'undoing a structure edit or formatting that was already saved is not possible: Undo history of that sheet before the save is cleared (no inverse operations yet)' },
    { id: 'sheet-disk-change-not-silent', file: 'src/spreadsheetEditorProvider.ts',
      find: "try { post({ command: 'diskChangedExternally' }); } catch { }", replace: "try { await loadWorkbookPayload(); trySendInit('reload'); } catch { }" },
    { id: 'sheet-own-save-echo-ignored', file: 'src/spreadsheetEditorProvider.ts',
      find: 'if (!changedSinceBaseline(diskBaseline, await hashFile(filePath))) {', replace: 'void changedSinceBaseline; void diskBaseline; if (Date.now() < 0) {' },
    { id: 'sheet-save-conflict-check', file: 'src/spreadsheetEditorProvider.ts',
      find: 'if (!message.force && changedSinceBaseline(diskBaseline, await hashFile(currentUri.fsPath))) {', replace: 'if (!message.force && Date.now() < 0 && changedSinceBaseline(diskBaseline, await hashFile(currentUri.fsPath))) {' },
    { id: 'sheet-autosave-pauses-on-disk-change', file: 'src/webviews/spreadsheet/persistence.ts',
      find: 'if (isAutosave && isDiskChangePending()) {return;}', replace: 'void isDiskChangePending;' },
    { id: 'rename-state-before-reopen', file: 'src/shared/renameStateMigration.ts',
      find: 'return vscode.workspace.onWillRenameFiles((event) => {\n        event.waitUntil(', replace: 'return vscode.workspace.onDidRenameFiles((event) => {\n        void (' },
    { id: 'md-heading-background-parse', file: 'src/webviews/md/livePreview/headingGutterSync.ts',
      find: 'if (!tr.docChanged && syntaxTree(tr.state).length <= syntaxTree(tr.startState).length) {', replace: 'if (!tr.docChanged) {' },
    { id: 'md-search-focus-on-open', file: 'resources/shared/theme.css',
      find: '    transition: opacity 0.2s ease, transform 0.2s ease, visibility 0s;\n', replace: '' },
    { id: 'md-slash-menu-below-toolbar', file: 'src/webviews/md/livePreview/slashMenu.ts',
      find: '        tooltips({ tooltipSpace: editorTooltipSpace }),\n', replace: '        ...(void tooltips, void editorTooltipSpace, []),\n' },
    { id: 'md-dark-selection-colour', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: "'&.cm-editor .cm-selectionBackground, &.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {", replace: "'&.cm-editor .cm-md-never-matches': {" },
    { id: 'md-image-placeholder-hidden', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: "'.cm-md-image-placeholder[hidden]': {", replace: "'.cm-md-image-placeholder[data-never]': {" },
    { id: 'md-table-no-scroll-jump', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: "            display: 'flow-root',\n", replace: "            display: 'block',\n" },
    { id: 'md-slash-menu-order', file: 'src/webviews/md/livePreview/slashMenu.ts',
      find: '    boost: SLASH_OPTIONS.length - index,\n', replace: '    boost: 0 * index,\n' },
    { id: 'md-toggle-gutter-constant', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: "        '.cm-content .cm-line.cm-md-details-title-line': {", replace: "        '.cm-content.cm-md-has-toggles': { paddingLeft: '64px' },\n        '.cm-content .cm-line.cm-md-details-title-line': {" },
    { id: 'md-cards-align-with-text', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: "        '.cm-line': {\n            paddingLeft: '0',\n        },", replace: "        '.cm-line': {\n            paddingLeft: '6px',\n        }," },
    { id: 'md-list-20px-step', file: 'src/webviews/md/livePreview/revealDecorations.ts',
      find: '    const columnPx = LIST_INDENT_STEP_PX + Math.max(0, columnChars - LIST_INDENT_FLOOR_CHARS) * monoCharWidthPx;', replace: '    const columnPx = (void LIST_INDENT_STEP_PX, columnChars * monoCharWidthPx);' },
    { id: 'md-rhythm-code-gap', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: "            '--cm-md-fence-external-gap': '4px',", replace: "            '--cm-md-fence-external-gap': '32px'," },
    { id: 'md-rhythm-callout-fence', file: 'src/webviews/md/livePreview/calloutDecorations.ts',
      find: "        parts.push('cm-md-callout-fence');", replace: '        void parts;' },
    { id: 'md-image-unresolved-hidden', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: "'.cm-md-image-preview[hidden]': {", replace: "'.cm-md-image-preview[data-never]': {" },
    { id: 'md-heading-marker-hangs', file: 'src/webviews/md/livePreview/revealDecorations.ts',
      find: '            ? Decoration.mark({ class: `cm-md-reveal-mark cm-md-h${level} cm-md-heading-marker` })\n', replace: '            ? dimHeadingMark\n' },
    { id: 'md-fence-language-label', file: 'src/webviews/md/livePreview/revealDecorations.ts',
      find: "                } else if (node.name === 'FencedCode') {", replace: "                } else if (node.name === 'FencedCode-never') {" },
    { id: 'md-fence-chrome-narrow', file: 'resources/md/mdWebview.css',
      find: 'body.cm6-preview-active .cm-md-fence-chrome:not(.cm-md-fence-chrome-overlay) {\n    left: auto;', replace: 'body.cm6-preview-active .cm-md-fence-chrome:not(.cm-md-fence-chrome-overlay) {\n    left: 0;' },
    { id: 'md-find-placeholder', file: 'src/shared/webviewHtml.ts',
      find: 'placeholder="Find in document" aria-label="Find in document"', replace: 'placeholder="Search in preview..."' },
    { id: 'md-toggle-handle-centred', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: "margin: '0.1em auto 0',\n            fill: 'currentColor',", replace: "margin: '0.4em auto 0',\n            fill: 'currentColor'," },
    { id: 'md-selection-text-column', file: 'src/webviews/md/livePreview/selectionColumn.ts',
      find: 'const left = Math.max(box.left, columnLeft);\n    const right = Math.min(box.left + box.width, columnRight);', replace: 'const left = Math.max(box.left, columnLeft - 1e6);\n    const right = Math.min(box.left + box.width, columnRight + 1e6);' },
    { id: 'md-table-header-align', file: 'resources/md/mdWebview.css',
      find: '.cm-md-table-scroll table.md-table th {\n    text-align: left;', replace: '.cm-md-table-scroll table.md-table th {\n    text-align: center;' },
    { id: 'md-spellcheck-skip-links', file: 'src/webviews/md/livePreview/spellcheckExclusions.ts',
      find: "new Set(['InlineCode', 'FencedCode', 'URL', 'Autolink', 'HTMLTag'])", replace: "new Set(['InlineCode', 'FencedCode'])" },
    { id: 'md-spellcheck-skip-urls', file: 'src/webviews/md/livePreview/spellcheckExclusions.ts',
      find: 'exclusions.push(...urlLikeRanges(line.text, line.from));', replace: 'void urlLikeRanges; void line;' },
    { id: 'md-spellcheck-tech-words', file: 'src/webviews/md/livePreview/spellcheckExclusions.ts',
      find: 'return TECH_WORDS.has(word.toLowerCase());', replace: 'return TECH_WORDS.has(word);' },
    { id: 'md-heading-space-above', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: "'.cm-content .cm-line.cm-md-heading-line.cm-md-h1': { paddingTop: '16px' },", replace: "'.cm-content .cm-line.cm-md-heading-line.cm-md-h1': { paddingTop: '0px' }," },
    { id: 'md-heading-h6-size', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: "'.cm-content .cm-md-h6': { fontSize: '0.875em',", replace: "'.cm-content .cm-md-h6': { fontSize: '1em'," },
    { id: 'md-cursor-clear-of-stats', file: 'src/webviews/md/livePreview/statusBarClearance.ts',
      find: 'return Math.max(0, scrollerBottom - pill.top + gap);', replace: 'return 0 * Math.max(0, scrollerBottom - pill.top + gap);' },
    { id: 'reduced-motion-global', file: 'resources/shared/theme.css',
      find: '@media (prefers-reduced-motion: reduce) {\n    *,\n    *::before,', replace: '@media (prefers-reduced-motion: no-such-value) {\n    *,\n    *::before,' },
    { id: 'motion-fast-token', file: 'resources/shared/theme.css',
      find: '--motion-fast: 120ms;', replace: '--motion-fast: 300ms;' },
    { id: 'md-image-no-hover-zoom', file: 'resources/md/mdWebview.css',
      find: '.markdown-preview .zoomable:hover {\n    box-shadow', replace: '.markdown-preview .zoomable:hover {\n    transform: scale(1.02);\n    box-shadow' },
    { id: 'md-callout-title-shown', file: 'src/webviews/md/livePreview/calloutDecorations.ts',
      find: 'to: titleFrom ?? block.openTo, value: fenceMark', replace: 'to: block.openTo, value: fenceMark' },
    { id: 'md-callout-drawn-icons', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: 'maskImage: CALLOUT_ICONS.info,', replace: "maskImage: 'none', outline: CALLOUT_ICONS.info," },
    { id: 'md-callout-picker-follows-cursor', file: 'src/webviews/md/livePreview/calloutWidget.ts',
      find: 'if (!tr.docChanged && !tr.selection) {', replace: 'if (!tr.docChanged) {' },
    { id: 'md-mermaid-error-actions', file: 'src/webviews/md/livePreview/mermaidWidget.ts',
      find: 'diagramWrap.insertBefore(createMermaidError(view, err), chrome);', replace: 'diagramWrap.textContent = \'\'; diagramWrap.appendChild(createMermaidError(view, err)); void chrome;' },
    { id: 'md-toolbar-one-row-scroll', file: 'resources/md/mdWebview.css',
      find: 'flex-direction: row;\n    flex-wrap: nowrap;\n    align-items: center;\n    position: relative;', replace: 'flex-direction: row;\n    flex-wrap: wrap;\n    align-items: center;\n    position: relative;' },
    { id: 'toolbar-icon-one-colour', file: 'resources/shared/theme.css',
      // The VS Code theme block: the one the browser tests (and most users) run with.
      find: "var(--color-text-primary));\n    --color-toolbar-icon: color-mix(in srgb, var(--palette-icon-muted) 50%, var(--palette-neutral-900));", replace: "var(--color-text-primary));\n    --color-toolbar-icon: var(--palette-icon-muted);" },
    { id: 'md-toggle-card-indent', file: 'src/webviews/md/livePreview/cm6Theme.ts',
      find: '{ marginLeft: `${d * 20}px` }', replace: '{ marginLeft: `${d * 0}px` }' },
    { id: 'md-toggle-arrow-focusable', file: 'src/webviews/md/livePreview/detailsExtension.ts',
      find: "el.setAttribute('aria-expanded', String(this.open));\n        el.tabIndex = 0;", replace: "el.setAttribute('aria-expanded', String(this.open));" },
    { id: 'md-toggle-mod-enter', file: 'src/webviews/md/livePreview/detailsExtension.ts',
      find: "{ key: 'Mod-Enter', run: toggleFromTitle },", replace: "{ key: 'Mod-Alt-Shift-F12', run: toggleFromTitle }," },
    { id: 'focus-ring-small-controls', file: 'resources/shared/theme.css',
      find: '.cm-md-details-chevron:focus-visible,\n.cm-md-block-grip:focus-visible,', replace: '.cm-md-details-chevron:never-focus,\n.cm-md-block-grip:focus-visible,' },
    { id: 'sheet-toolbar-end-group', file: 'src/webviews/spreadsheet/components/spreadsheetToolbarComponent.ts',
      find: "section: 'end',\n            onClick: options.onOpenSettings", replace: "onClick: options.onOpenSettings" },
    { id: 'sheet-formatting-row-under-toolbar', file: 'src/webviews/spreadsheet/spreadsheetWebview.ts',
      find: '(wrapper ?? document.body).appendChild(strip);', replace: 'void wrapper; toolbar.appendChild(strip);' },
    { id: 'md-cursor-clearance-visible-bottom', file: 'src/webviews/md/livePreview/statusBarClearance.ts',
      find: 'const visibleBottom = Math.min(scrollerBottom, windowHeight);\n    return Math.min(Math.max(0, visibleBottom - pill.top + gap), windowHeight / 4);', replace: 'const visibleBottom = scrollerBottom + 0 * windowHeight;\n    return Math.max(0, visibleBottom - pill.top + gap);' },
    { id: 'mermaid-lazy-load', file: 'src/webviews/md/livePreview/mermaidWidget.ts',
      find: "import { Icons } from '../../shared/icons';", replace: "import { Icons } from '../../shared/icons';\nimport * as eagerMermaid from 'mermaid';\nvoid eagerMermaid;" },
    { id: 'resize-listeners-once', file: 'src/webviews/spreadsheet/spreadsheetWebview.ts',
      find: 'if (!state.resizeGlobalListenersAttached) {', replace: 'if (!state.resizeGlobalListenersAttached || document.body !== null) {' },
    { id: 'md-table-header-text-select', file: 'src/webviews/md/livePreview/tableWidget.ts',
      find: 'if (tableCellEditingAtPointer(event)) { return; }\n        event.preventDefault();\n        event.stopPropagation();\n\n        const tableNode = findTableNodeByIndex(view.state, tableIndex);\n        if (!tableNode) { return; }\n        const col = colTarget.col;',
      replace: 'event.preventDefault();\n        event.stopPropagation();\n        if (document.activeElement?.classList.contains(\'cm-md-table-cell-editing\')) { return; }\n\n        const tableNode = findTableNodeByIndex(view.state, tableIndex);\n        if (!tableNode) { return; }\n        const col = colTarget.col;' },
    { id: 'outline-rail-active-line', file: 'src/webviews/md/outlineToc.ts',
      find: 'const active = item.id === activeId ? \' active\' : \'\';',
      replace: 'void activeId; const active = \'\';' },
    { id: 'outline-rail-below-toolbar', file: 'src/webviews/md/outlineRailOverlay.ts',
      find: 'return Math.max(0, ...toolbarBottoms) + gap;', replace: 'return 0 * Math.max(0, ...toolbarBottoms) + gap;' },
    { id: 'md-escape-stays-in-popup', file: 'src/webviews/md/mdWebview.ts',
      find: "if (e.key === 'Escape' && isInsidePopup(e.target)) {", replace: "if (e.key === 'Escape' && isInsidePopup(e.target) && e.key !== 'Escape') {" },
    { id: 'md-escape-keeps-edits', file: 'src/webviews/md/mdWebview.ts',
      find: "            closeSearch();\n            return;\n        }\n    }\n}, true);",
      replace: "            closeSearch();\n            return;\n        }\n        if (state.isEditMode) { e.preventDefault(); applyReloadedContent(state.originalContent); return; }\n    }\n}, true);" },
    { id: 'slash-menu-height', file: 'resources/shared/menuPanel.css',
      find: '.cm-editor .cm-tooltip.cm-tooltip-autocomplete.cm-slash-menu-tooltip > ul {',
      replace: '.cm-tooltip-autocomplete.cm-slash-menu-tooltip ul {' },
];

const repo = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const filter = process.argv[2];
const selected = MUTATIONS.filter(m => !filter || m.id.includes(filter));
const worktree = mkdtempSync(join(tmpdir(), 'sheetmark-regressions-'));

// A mutation can make a test wait forever (a page that never reports ready, say). Each command
// runs in its own process group with a time limit, and the whole group is killed when it runs out,
// so one stuck browser test can no longer stall the run.
const COMMAND_TIMEOUT_MS = 20 * 60_000;
const run = (cmd, cwd = worktree) => new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, detached: true });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, COMMAND_TIMEOUT_MS);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status: timedOut ? null : status, output, timedOut }); });
});
// Names of the failing node:test tests in a run's output, each once.
const failingTests = (output) => [...new Set([...output.matchAll(/^✖ (?!failing tests)(.+?)(?: \([\d.]+m?s\))?$/gm)].map(m => m[1]))];
// Which check failed, naming the first failing test when there is one.
const failingCheck = (output) => {
    if (/error TS\d+/.test(output)) { return 'type check'; }
    const [test] = failingTests(output);
    if (test) { return `test: ${test}`; }
    return /failing|fail [1-9]/.test(output) ? 'tests' : 'lint/build';
};
const timedOutStatus = (cmd) => `TIMED OUT after ${COMMAND_TIMEOUT_MS / 60_000} min in \`${cmd}\` (a test waits forever: fix it)`;

console.log(`Worktree of HEAD at ${worktree}`);
execSync(`git worktree add --detach "${worktree}" HEAD`, { cwd: repo, stdio: 'ignore' });
symlinkSync(join(repo, 'node_modules'), join(worktree, 'node_modules'));
if (existsSync(join(repo, '.vscode-test'))) { symlinkSync(join(repo, '.vscode-test'), join(worktree, '.vscode-test')); }

const results = [];
try {
    // Baseline: everything must pass unmutated, or "caught" below would mean nothing.
    for (const cmd of ['npm run verify', 'npm run test:integration']) {
        const baseline = await run(cmd);
        if (baseline.status !== 0) {
            const names = failingTests(baseline.output);
            console.error(`Baseline \`${cmd}\` ${baseline.timedOut ? 'timed out' : 'fails'} on unmodified HEAD; fix that first.`
                + (names.length ? `\nFailing tests:\n${names.map(n => `  ✖ ${n}`).join('\n')}` : '')
                + '\n' + baseline.output.slice(-3000));
            process.exitCode = 1;
            throw new Error('baseline failed');
        }
    }

    for (const m of selected) {
        await run('git checkout -q -- .');
        const path = join(worktree, m.file);
        const source = readFileSync(path, 'utf8');
        if (!source.includes(m.find)) { results.push({ m, status: 'STALE (pattern not found: update this entry)' }); continue; }
        writeFileSync(path, source.replace(m.find, m.replace));

        const verify = await run('npm run verify');
        if (verify.timedOut) { results.push({ m, status: timedOutStatus('npm run verify') }); continue; }
        if (verify.status !== 0) { results.push({ m, status: `caught by verify (${failingCheck(verify.output)})` }); continue; }
        const integration = await run('npm run test:integration');
        if (integration.timedOut) { results.push({ m, status: timedOutStatus('npm run test:integration') }); continue; }
        const failed = integration.output.match(/^\s+\d+\) .+$/m)?.[0].trim();
        results.push({ m, status: integration.status !== 0 ? `caught by integration tests${failed ? ` (${failed})` : ''}` : 'SURVIVED' });
        process.stdout.write('.');
    }
} catch (error) {
    if (error.message !== 'baseline failed') { throw error; }
} finally {
    execSync(`git worktree remove --force "${worktree}"`, { cwd: repo, stdio: 'ignore' });
    rmSync(worktree, { recursive: true, force: true });
}

console.log('\n');
let failed = false;
for (const { m, status } of results) {
    const survived = status === 'SURVIVED' || status.startsWith('STALE');
    // A timeout is neither caught nor survived: always a failure to look at.
    if (status.startsWith('TIMED OUT')) { failed = true; console.log(`✖ ${m.id.padEnd(24)} ${status}`); continue; }
    // A known gap that is suddenly "caught" is suspicious too: either a test now covers it (remove
    // knownGap) or something unrelated is failing.
    const ok = survived === Boolean(m.knownGap);
    if (!ok) { failed = true; }
    const label = survived && m.knownGap ? `known gap: ${m.knownGap}` : status + (!survived && m.knownGap ? ' (check, then remove knownGap)' : '');
    console.log(`${ok ? '✔' : '✖'} ${m.id.padEnd(24)} ${label}`);
}
process.exit(failed || process.exitCode ? 1 : 0);
