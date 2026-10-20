// The HTML shells of both webviews. Pure (no `vscode` import): providers pass an `asset` function
// that turns an extension-relative path into a webview URI, and the webview tests
// (src/test/webview) render the same HTML against a local HTTP server.

import { markdownCsp, spreadsheetCsp } from './webviewCsp';

export interface WebviewHtmlOptions {
    /** Webview URI for an extension-relative path, e.g. 'dist/md/mdWebview.js'. */
    asset: (relativePath: string) => string;
    /** `webview.cspSource`: the origin the extension's files are served from. */
    cspSource: string;
}

export function renderSpreadsheetHtml({ asset, cspSource }: WebviewHtmlOptions): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${spreadsheetCsp(cspSource)}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sheetmark</title>
    <link href="${asset('resources/shared/theme.css')}" rel="stylesheet" />
    <link href="${asset('resources/shared/menuPanel.css')}" rel="stylesheet" />
    <link href="${asset('resources/spreadsheet/spreadsheetWebview.css')}" rel="stylesheet" />
    <link href="${asset('resources/shared/feedback.css')}" rel="stylesheet" />
</head>
<body>
    <div class="header-background"></div>

    <div class="loading-overlay" id="loadingOverlay">
        <div class="spinner"></div>
        <div class="loading-text">Rendering worksheet...</div>
    </div>

    <div class="toolbar-wrapper"><div class="toolbar" id="toolbar"></div></div>
    <div id="content">
        <div id="tableContainer"></div>
    </div>
    <div class="selection-info" id="selectionInfo"></div>
    <div class="resize-indicator" id="resizeIndicator"></div>

    <noscript>
        <div style="padding: 8px; margin-top: 10px; background: #fff3cd; border: 1px solid #ffeeba;">
            JavaScript is disabled in this webview, so the spreadsheet table cannot load.
        </div>
    </noscript>

    <script src="${asset('dist/spreadsheet/spreadsheetWebview.js')}"></script>
</body>
</html>`;
}

export function renderMarkdownHtml({ asset, cspSource, nonce }: WebviewHtmlOptions & { nonce: string }): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="${markdownCsp(cspSource, nonce)}">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Sheetmark</title>
            <link href="${asset('resources/shared/theme.css')}" rel="stylesheet" />
            <link href="${asset('resources/shared/menuPanel.css')}" rel="stylesheet" />
            <link href="${asset('resources/md/mdWebview.css')}" rel="stylesheet" />
            <link href="${asset('resources/md/highlight.css')}" rel="stylesheet" />
            <link href="${asset('resources/shared/feedback.css')}" rel="stylesheet" />
        </head>
        <body>
            <div id="readingProgressBar" class="reading-progress-bar"></div>
            <div class="header-background"></div>
            <div class="toolbar-wrapper"><div class="toolbar" id="toolbar"></div></div>

            <div id="formattingToolbar" class="formatting-toolbar hidden">
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="bold" title="Bold (Ctrl+B)"></button>
                    <button class="fmt-btn" data-format="italic" title="Italic (Ctrl+I)"></button>
                    <button class="fmt-btn" data-format="strikethrough" title="Strikethrough (Ctrl+Shift+X)"></button>
                    <button class="fmt-btn" data-format="inlineCode" title="Inline Code (Ctrl+E)"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="heading1" title="Heading 1 (Ctrl+1)"></button>
                    <button class="fmt-btn" data-format="heading2" title="Heading 2 (Ctrl+2)"></button>
                    <button class="fmt-btn" data-format="heading3" title="Heading 3 (Ctrl+3)"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="bulletList" title="Bullet List (Ctrl+L)"></button>
                    <button class="fmt-btn" data-format="orderedList" title="Ordered List (Ctrl+Shift+L)"></button>
                    <button class="fmt-btn" data-format="checkbox" title="Checkbox List"></button>
                    <button class="fmt-btn" data-format="blockquote" title="Blockquote"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="link" title="Insert Link (Ctrl+K)"></button>
                    <button class="fmt-btn" data-format="image" title="Insert Image"></button>
                    <button class="fmt-btn" data-format="table" title="Insert Table"></button>
                    <button class="fmt-btn" data-format="tableAddRowBelow" title="Add Row Below (WYSIWYG table)"></button>
                    <button class="fmt-btn" data-format="tableRemoveRow" title="Remove Current Row (WYSIWYG table)"></button>
                    <button class="fmt-btn" data-format="tableAddColumnRight" title="Add Column Right (WYSIWYG table)"></button>
                    <button class="fmt-btn" data-format="tableRemoveColumn" title="Remove Current Column (WYSIWYG table)"></button>
                    <button class="fmt-btn" data-format="codeBlock" title="Code Block (Ctrl+Shift+E)"></button>
                    <button class="fmt-btn" data-format="hr" title="Horizontal Rule"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="duplicateLine" title="Duplicate Line (Ctrl+Shift+D)"></button>
                    <button class="fmt-btn" data-format="deleteLine" title="Delete Line (Ctrl+Shift+K)"></button>
                    <button class="fmt-btn" data-format="moveUp" title="Move Line Up (Alt+&#x2191;)"></button>
                    <button class="fmt-btn" data-format="moveDown" title="Move Line Down (Alt+&#x2193;)"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="uppercase" title="UPPERCASE (Ctrl+Shift+U)"></button>
                    <button class="fmt-btn" data-format="lowercase" title="lowercase (Ctrl+U)"></button>
                    <button class="fmt-btn" data-format="titlecase" title="Title Case"></button>
                    <button class="fmt-btn" data-format="sortLines" title="Sort Lines A-Z"></button>
                    <button class="fmt-btn" data-format="trimWhitespace" title="Trim Trailing Whitespace"></button>
                    <button class="fmt-btn" data-format="jumpToLine" title="Go to Line (Ctrl+G)"></button>
                </div>
            </div>

            <div id="searchOverlay" class="search-overlay">
                <div class="search-bar">
                    <input type="text" id="searchInput" class="search-input" placeholder="Search in preview..." autocomplete="off" />
                    <span id="searchCount" class="search-count"></span>
                    <button id="searchPrev" class="search-nav-btn" title="Previous (Shift+Enter)">&#9650;</button>
                    <button id="searchNext" class="search-nav-btn" title="Next (Enter)">&#9660;</button>
                    <button id="searchClose" class="search-close-btn" title="Close (Esc)">&times;</button>
                </div>
            </div>

            <div id="diskDiffBulkActions" class="toast-notification disk-diff-bulk-actions">
                <div class="toast-header">
                    <div class="toast-icon-wrapper">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                    </div>
                    <span class="toast-text">File changed on disk</span>
                </div>
                <div class="toast-actions">
                    <span id="diskDiffChunkIndicator" class="disk-diff-chunk-indicator"></span>
                    <button id="diffPrevButton" class="disk-diff-nav-btn" type="button" title="Previous Change (Shift+F7)"></button>
                    <button id="diffNextButton" class="disk-diff-nav-btn" type="button" title="Next Change (F7)"></button>
                    <span class="disk-diff-sep"></span>
                    <div class="diff-badge hidden" id="diffBadge" aria-live="polite"></div>
                    <span class="disk-diff-sep hidden" id="diffBadgeSep"></span>
                    <button id="diffAcceptAllButton" class="toast-action disk-diff-bulk-btn accept" type="button">Accept All</button>
                    <button id="diffRejectAllButton" class="toast-action disk-diff-bulk-btn reject" type="button">Reject All</button>
                </div>
            </div>

            <div id="content" class="is-loading">
                <div id="loadingIndicator" class="loading-indicator">Loading Markdown...</div>
                <div class="markdown-container" id="markdownContainer">
                    <aside id="tocPanel" class="toc-panel hidden" aria-label="Outline">
                        <div class="toc-header">
                            <span class="toc-title">Outline</span>
                            <button id="tocCloseButton" class="toc-close" title="Hide outline">x</button>
                        </div>
                        <div id="tocBody" class="toc-body"></div>
                    </aside>
                    <div id="markdownPreview" class="markdown-preview"></div>
                    <div id="diskDiffChunkRuler" class="disk-diff-chunk-ruler hidden" aria-hidden="true"></div>
                </div>
            </div>

            <div class="status-bar" id="statusBar">
                <div class="status-info" id="statusInfo"></div>
            </div>

            <div id="lightboxOverlay" class="lightbox-overlay">
                <button id="lightboxClose" class="lightbox-close">&times;</button>
                <img id="lightboxImage" class="lightbox-image" />
            </div>

            <noscript>
                <div style="padding: 8px; margin-top: 10px; background: #fff3cd; border: 1px solid #ffeeba;">
                    JavaScript is disabled in this webview, so the Markdown preview cannot load.
                </div>
            </noscript>
            <script nonce="${nonce}">window.__SPELL_DICT__={aff:${JSON.stringify(asset('resources/spell/en_US.aff'))},dic:${JSON.stringify(asset('resources/spell/en_US.dic'))}};</script>
            <script type="module" nonce="${nonce}" src="${asset('dist/md/mdWebview.js')}"></script>
        </body>
        </html>`;
}
