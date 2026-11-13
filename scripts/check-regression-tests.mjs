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

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MUTATIONS = [
    { id: 'xss-cell-sanitize', file: 'src/webviews/spreadsheet/components/spreadsheetCellTextComponent.ts',
      find: "return sanitizeHtml(value) || '&nbsp;';", replace: 'void sanitizeHtml; return value;' },
    { id: 'xss-cell-style-attr', file: 'src/webviews/spreadsheet/components/spreadsheetRenderComponent.ts',
      find: "html += ' style=\"' + escapeAttribute(cellStyleStr) + '\"';", replace: "html += ' style=\"' + cellStyleStr + '\"';" },
    { id: 'xss-md-table', file: 'src/webviews/md/livePreview/tableWidget.ts',
      find: 'return sanitizeHtml(md.render(source, { colCount, widths }));', replace: 'void sanitizeHtml; return md.render(source, { colCount, widths });' },
    { id: 'xss-sanitizer-attrs', file: 'src/webviews/shared/sanitizeHtml.ts',
      find: 'if (!ALLOWED_ATTRS.has(name)) {', replace: 'if (!ALLOWED_ATTRS.has(name) && name === "__never__") {' },
    { id: 'csp-spreadsheet-inline', file: 'src/shared/webviewCsp.ts',
      find: '`script-src ${cspSource}`,', replace: "`script-src ${cspSource} 'unsafe-inline'`," },
    { id: 'csp-markdown-nonce-tag', file: 'src/shared/webviewHtml.ts',
      find: '<script nonce="${nonce}">window.__SPELL_DICT__', replace: '<script>window.__SPELL_DICT__' },
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
      find: '    applyStoredStylesToWorksheet(worksheet, storedStyles);\n', replace: '    void applyStoredStylesToWorksheet;\n' },
    { id: 'csv-version-history', file: 'src/spreadsheetEditorProvider.ts',
      find: '                        await persistVersionSnapshot();\n                        return;', replace: '                        return;' },
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
    { id: 'mermaid-lazy-load', file: 'src/webviews/md/livePreview/mermaidWidget.ts',
      find: "import { Icons } from '../../shared/icons';", replace: "import { Icons } from '../../shared/icons';\nimport * as eagerMermaid from 'mermaid';\nvoid eagerMermaid;" },
    { id: 'resize-listeners-once', file: 'src/webviews/spreadsheet/spreadsheetWebview.ts',
      find: 'if (!state.resizeGlobalListenersAttached) {', replace: 'if (!state.resizeGlobalListenersAttached || document.body !== null) {' },
];

const repo = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const filter = process.argv[2];
const selected = MUTATIONS.filter(m => !filter || m.id.includes(filter));
const worktree = mkdtempSync(join(tmpdir(), 'sheetmark-regressions-'));

const run = (cmd, cwd = worktree) => spawnSync(cmd, { cwd, shell: true, encoding: 'utf8' });
const failingCheck = (output) => (/error TS\d+/.test(output) ? 'type check' : /✖|failing|fail [1-9]/.test(output) ? 'tests' : 'lint/build');

console.log(`Worktree of HEAD at ${worktree}`);
execSync(`git worktree add --detach "${worktree}" HEAD`, { cwd: repo, stdio: 'ignore' });
symlinkSync(join(repo, 'node_modules'), join(worktree, 'node_modules'));
if (existsSync(join(repo, '.vscode-test'))) { symlinkSync(join(repo, '.vscode-test'), join(worktree, '.vscode-test')); }

const results = [];
try {
    // Baseline: everything must pass unmutated, or "caught" below would mean nothing.
    for (const cmd of ['npm run verify', 'npm run test:integration']) {
        const baseline = run(cmd);
        if (baseline.status !== 0) {
            console.error(`Baseline \`${cmd}\` fails on unmodified HEAD; fix that first.\n` + (baseline.stdout + baseline.stderr).slice(-3000));
            process.exitCode = 1;
            throw new Error('baseline failed');
        }
    }

    for (const m of selected) {
        run('git checkout -q -- .');
        const path = join(worktree, m.file);
        const source = readFileSync(path, 'utf8');
        if (!source.includes(m.find)) { results.push({ m, status: 'STALE (pattern not found: update this entry)' }); continue; }
        writeFileSync(path, source.replace(m.find, m.replace));

        const verify = run('npm run verify');
        if (verify.status !== 0) { results.push({ m, status: `caught by verify (${failingCheck(verify.stdout + verify.stderr)})` }); continue; }
        const integration = run('npm run test:integration');
        const failed = (integration.stdout + integration.stderr).match(/^\s+\d+\) .+$/m)?.[0].trim();
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
    // A known gap that is suddenly "caught" is suspicious too: either a test now covers it (remove
    // knownGap) or something unrelated is failing.
    const ok = survived === Boolean(m.knownGap);
    if (!ok) { failed = true; }
    const label = survived && m.knownGap ? `known gap: ${m.knownGap}` : status + (!survived && m.knownGap ? ' (check, then remove knownGap)' : '');
    console.log(`${ok ? '✔' : '✖'} ${m.id.padEnd(24)} ${label}`);
}
process.exit(failed || process.exitCode ? 1 : 0);
