import MarkdownIt from 'markdown-it';
// @ts-ignore
import taskLists from 'markdown-it-task-lists';
// @ts-ignore
import container from 'markdown-it-container';
// @ts-ignore
import deflist from 'markdown-it-deflist';
// @ts-ignore
import footnote from 'markdown-it-footnote';
// @ts-ignore
import sub from 'markdown-it-sub';
// @ts-ignore
import sup from 'markdown-it-sup';
// @ts-ignore
import ins from 'markdown-it-ins';
// @ts-ignore
import mark from 'markdown-it-mark';
// @ts-ignore
import abbr from 'markdown-it-abbr';
// @ts-ignore
import { full as emoji } from 'markdown-it-emoji';
// @ts-ignore
import katex from 'markdown-it-katex';

import hljs from 'highlight.js';
import { ThemeManager, renderThemeToggleSettingItem } from '../shared/themeManager';
import { SettingsManager } from '../shared/settingsManager';
import { ToolbarManager, type ToolbarButton } from '../shared/toolbarManager';
import { applyToolbarLayout } from '../shared/toolbarLayout';
import { wireDelayedToolbarTooltips } from '../shared/delayedTitleTooltip';
import { Utils } from '../shared/utils';
import { Icons } from '../shared/icons';
import { vscode, debounce } from '../shared/common';
import { FeedbackModal } from '../shared/feedbackModal';
import { ProjectsModal } from '../shared/projectsModal';
import {
    mountLivePreview,
    unmountLivePreview,
    isLivePreviewActive,
    getLivePreviewContent,
    setLivePreviewContent,
    focusLivePreview,
    getLivePreviewScrollMetrics,
    getLivePreviewTopLine,
    scrollLivePreviewToLine,
    resolveLivePreviewInteraction,
    findLivePreviewMatches,
    setLivePreviewSearchHighlights,
    clearLivePreviewSearchHighlights,
    scrollLivePreviewToMatch,
    setLivePreviewReveal,
    setLivePreviewLineNumbers,
    setLivePreviewMermaidMode,
    setLivePreviewCalloutDefaultType,
    getLivePreviewCursorPosition,
    applyLivePreviewFormat,
    canLivePreviewUndo,
    canLivePreviewRedo,
    refreshLivePreviewImages,
} from './livePreview/livePreviewEditor';
import { setImageUriResolver } from './livePreview/imageWidget';
import { resolveFrontmatterForRender, markdownBodyWithoutFrontmatter, extractFrontmatter } from './frontmatter';
import { createFrontmatterCardElement } from './frontmatterCardUi';
import type { Cm6Match } from './livePreview/livePreviewSearch';
import { isMermaidFenceContent } from './livePreview/mermaidDetection';
import mermaid from 'mermaid';

// Inline custom plugin that mimics the markdown-it-mermaid API and behavior,
// but uses standard ES imports bundled properly by esbuild for the browser.
function markdownItMermaid(md: any) {
    md.mermaid = mermaid;

     
    (mermaid as any).loadPreferences = function (preferences: any) {
        let theme = preferences.get('mermaid-theme');
        if (theme === undefined) {
            theme = 'default';
        }
        let ganttAxisFormat = preferences.get('gantt-axis-format');
        if (ganttAxisFormat === undefined) {
            ganttAxisFormat = '%Y-%m-%d';
        }
        mermaid.initialize({
            theme: theme,
            gantt: {
                axisFormatter: [
                    [
                        ganttAxisFormat,
                        function (date: Date) {
                            return date.getDay() === 1;
                        }
                    ]
                ]
            }
        } as any);
        return {
            'mermaid-theme': theme,
            'gantt-axis-format': ganttAxisFormat
        };
    };
}

// ===== Throttle Utility =====
function throttleRAF(fn: () => void): () => void {
    let ticking = false;
    return () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(() => {
                fn();
                ticking = false;
            });
        }
    };
}

// ===== State =====
let isEditMode = false;
let isPreviewEditMode = false;
let isVersionPreviewMode = false;
let isSaving = false;
let isReloadingFromDisk = false;
let pendingDiskContent: string | null = null;
// Set when the watcher reports the file was deleted externally; cleared by a
// subsequent real disk change, a manual reload, or a save that recreates the file.
let pendingDiskDeleted = false;
// Mount CM6 preview edit exactly once on the panel's first `initSettings`.
let hasEnteredPreviewEdit = false;
let originalContent = '';
let currentContent = '';
let toolbarManager: ToolbarManager | null = null;
const resolvedImageUriCache = new Map<string, string>();
// Set while a CM6 Ctrl/Cmd+Click image lightbox is waiting on an async 'resolveImageUris'
// round-trip (see handleLivePreviewModifierClick / applyResolvedImageUris).
let pendingCm6LightboxSrc: string | null = null;
let documentUri = '';
let documentDirUri = '';
let workspaceFolderUri: string | null = null;
// Persisted table column widths (table order-index -> px per column), read
// once from the host on load and kept in sync locally after every resize —
// see tableColumnWidthStorageService.ts on the host side for why this can't
// live in the .md file's own table syntax.
let currentTableColumnWidths: Record<number, readonly number[]> = {};
let frontmatterPanelCollapsed = false;
let mermaidPreviewMode: 'diagram' | 'code' = 'diagram';
let calloutDefaultType = 'info';

// Turndown removed — Preview Edit uses CM6 raw markdown only.

// Settings
let currentSettings = {
    stickyToolbar: true,
    wordWrap: true,
    showOutline: true,
    showLineNumbers: true,
    livePreviewReveal: true,
    livePreviewLineNumbers: false,
    moveMdButtonsToEnd: false,
    autoSave: false,
    isMdEnabled: true
};

/** CM6 has no rendered code blocks — honor either line-number setting in the gutter. */
function wantsLivePreviewLineNumbers(): boolean {
    return !!(currentSettings.showLineNumbers || currentSettings.livePreviewLineNumbers);
}

let searchMatches: Element[] = [];
let cm6SearchMatches: Cm6Match[] = [];
let searchCurrentIndex = -1;

// ===== Utilities =====
const $ = Utils.$;

function slugify(text: string) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[`~!@#$%^&*()+=\[\]{}|\\;:'",.<>/?]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function escapeHtmlAttr(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function isRemoteOrInlineUri(value: string): boolean {
    return /^(https?:|data:|mailto:|#)/i.test(value);
}

function shouldResolveLocalImage(value: string): boolean {
    const src = (value || '').trim();
    if (!src) {
        return false;
    }
    return !isRemoteOrInlineUri(src);
}

function wrapCodeLines(html: string): string {
    const lines = html.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    if (lines.length === 0) {return '<span class="code-line"> </span>';}

    let openStack: string[] = [];

    return lines.map(line => {
        const reopenTags = openStack.join('');
        const tagRegex = /<(\/?)([a-z][a-z0-9]*)[^>]*?>/gi;
        let m;
        while ((m = tagRegex.exec(line)) !== null) {
            if (m[1] === '/') {
                openStack.pop();
            } else {
                openStack.push(m[0]);
            }
        }
        const closeTags = openStack.slice().reverse().map(tag => {
            const nameMatch = tag.match(/<([a-z][a-z0-9]*)/i);
            return nameMatch ? `</${nameMatch[1]}>` : '';
        }).join('');
        return `<span class="code-line">${reopenTags}${line}${closeTags}</span>`;
    }).join('');
}

function setButtonsEnabled(enabled: boolean) {
    const ids = ['enableMdEditorButton', 'disableMdEditorButton', 'openSettingsButton', 'versionHistoryButton'];
    ids.forEach((id) => {
        const el = $(id) as HTMLButtonElement;
        if (el) {el.disabled = !enabled;}
    });
    updateEditToolbarButtons();
}

function isEditorDirty(): boolean {
    return getActiveEditorContent() !== originalContent;
}

function canReloadFromDisk(): boolean {
    if (!isEditMode || isSaving || isReloadingFromDisk) {
        return false;
    }
    return pendingDiskContent !== null || pendingDiskDeleted || isEditorDirty();
}

function updateEditToolbarButtons() {
    if (!toolbarManager || !isEditMode) {
        return;
    }

    const blocked = isSaving || isReloadingFromDisk;
    const dirty = isEditorDirty();

    toolbarManager.setButtonEnabled('saveEditsButton', !blocked && dirty);
    toolbarManager.setButtonEnabled('reloadFromDiskButton', !blocked && canReloadFromDisk());
    toolbarManager.setButtonEnabled('undoEditsButton', !blocked && isLivePreviewActive() && canLivePreviewUndo());
    toolbarManager.setButtonEnabled('redoEditsButton', !blocked && isLivePreviewActive() && canLivePreviewRedo());
}

// ===== Markdown-it Setup =====
const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true, // GFM style line breaks
    highlight: function (str, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return hljs.highlight(str, { language: lang }).value;
            } catch (__) { }
        }
        return ''; // use external default escaping
    }
});
md.use(taskLists, { enabled: false, label: true, labelAfter: true });
 
md.use(container as any, 'warning');
 
md.use(container as any, 'info');
 
md.use(container as any, 'error');
 
md.use(container as any, 'success');

md.use(deflist);
md.use(footnote);
md.use(katex);
md.use(sub);
md.use(sup);
md.use(ins);
md.use(mark);
md.use(abbr);
md.use(emoji);
md.use(markdownItMermaid);

// Inline code styling
 
const defaultInlineCode = md.renderer.rules.code_inline || function (tokens: any, idx: number, options: any, env: any, self: any) {
    return self.renderToken(tokens, idx, options);
};
 
md.renderer.rules.code_inline = function (tokens: any, idx: number, options: any, env: any, self: any) {
    tokens[idx].attrJoin('class', 'inline-code');
    return defaultInlineCode(tokens, idx, options, env, self);
};

// Inject line numbers for sync scroll
 
function injectLineNumbers(tokens: any, idx: number, options: any, env: any, self: any) {
    const token = tokens[idx];
    if (token.map && token.level === 0) {
        token.attrSet('data-line', String(token.map[0]));
    }
    return self.renderToken(tokens, idx, options, env, self);
}

// Apply to block-level elements
md.renderer.rules.paragraph_open = injectLineNumbers;
md.renderer.rules.heading_open = injectLineNumbers;
md.renderer.rules.bullet_list_open = injectLineNumbers;
md.renderer.rules.ordered_list_open = injectLineNumbers;
md.renderer.rules.list_item_open = injectLineNumbers;
md.renderer.rules.blockquote_open = injectLineNumbers;
md.renderer.rules.hr = injectLineNumbers;

md.renderer.rules.table_open = function (tokens: any, idx: number, options: any, env: any, self: any) {
    tokens[idx].attrJoin('class', 'md-table');
    return `<div class="md-table-scroll">${injectLineNumbers(tokens, idx, options, env, self)}`;
};

const defaultTableClose = md.renderer.rules.table_close || function (tokens: any, idx: number, options: any, env: any, self: any) {
    return self.renderToken(tokens, idx, options, env, self);
};
md.renderer.rules.table_close = function (tokens: any, idx: number, options: any, env: any, self: any) {
    return defaultTableClose(tokens, idx, options, env, self) + '</div>';
};

// Heading close: inject anchor links for copyable heading URLs
md.renderer.rules.heading_close = function (tokens: any, idx: number, options: any, env: any, self: any) {
    const openToken = tokens[idx - 2];
    const id = openToken && openToken.type === 'heading_open' ? openToken.attrGet('id') : null;
    let anchor = '';
    if (id) {
        anchor = `<a class="heading-anchor" href="#${md.utils.escapeHtml(id)}" data-heading-id="${escapeHtmlAttr(encodeURIComponent(id))}" title="Copy link">#</a>`;
    }
    return anchor + self.renderToken(tokens, idx, options);
};

// Image renderer: add zoomable class for lightbox
const defaultImageRender = md.renderer.rules.image || function (tokens: any, idx: number, options: any, env: any, self: any) {
    return self.renderToken(tokens, idx, options);
};
md.renderer.rules.image = function (tokens: any, idx: number, options: any, env: any, self: any) {
    tokens[idx].attrJoin('class', 'md-image zoomable');
    tokens[idx].attrSet('loading', 'lazy');
    const src = (tokens[idx].attrGet('src') || '').trim();
    if (shouldResolveLocalImage(src)) {
        const resolved = resolvedImageUriCache.get(src);
        if (resolved) {
            tokens[idx].attrSet('src', resolved);
        } else {
            tokens[idx].attrSet('data-md-src', src);
        }
    }
    return defaultImageRender(tokens, idx, options, env, self);
};

function wireImageUriResolver() {
    setImageUriResolver({
        getResolved: (src) => resolvedImageUriCache.get(src.trim()),
        requestResolve: (sources) => {
            const pending = sources
                .map(s => s.trim())
                .filter(s => s && !resolvedImageUriCache.has(s));
            if (pending.length === 0) { return; }
            vscode.postMessage({ command: 'resolveImageUris', sources: pending });
        },
        openLightbox: (src, alt) => showLightbox(src, alt),
        requestLightbox: (src, alt) => {
            pendingCm6LightboxSrc = src;
            vscode.postMessage({ command: 'resolveImageUris', sources: [src] });
            void alt;
        },
    });
}

function requestLocalImageResolution() {
    const preview = $('markdownPreview');
    if (!preview) {return;}

    const pending = new Set<string>();
    preview.querySelectorAll('img[data-md-src]').forEach((node) => {
        const src = (node.getAttribute('data-md-src') || '').trim();
        if (!src || resolvedImageUriCache.has(src)) {
            return;
        }
        pending.add(src);
    });

    if (pending.size === 0) {
        return;
    }

    vscode.postMessage({
        command: 'resolveImageUris',
        sources: Array.from(pending)
    });
}

function applyResolvedImageUris(resolved: Record<string, string>) {
    if (!resolved || typeof resolved !== 'object') {
        return;
    }

    Object.entries(resolved).forEach(([source, uri]) => {
        if (!source || !uri) {
            return;
        }
        resolvedImageUriCache.set(source, uri);
    });

    if (pendingCm6LightboxSrc && resolved[pendingCm6LightboxSrc]) {
        showLightbox(resolved[pendingCm6LightboxSrc], '');
        pendingCm6LightboxSrc = null;
    }

    const preview = $('markdownPreview');
    if (!preview) {
        return;
    }

    preview.querySelectorAll('img[data-md-src]').forEach((node) => {
        const source = (node.getAttribute('data-md-src') || '').trim();
        const uri = resolvedImageUriCache.get(source);
        if (!uri) {
            return;
        }
        node.addEventListener('load', refreshDataLineCache, { once: true });
        node.setAttribute('src', uri);
        node.removeAttribute('data-md-src');
    });

    refreshDataLineCache();
    refreshLivePreviewImages();
}

// Fence (code blocks) needs special handling as it's a self-closing block token in terms of rendering
 
 
md.renderer.rules.fence = function (tokens: any, idx: number, options: any, env: any, self: any) {
    const token = tokens[idx];
    const info = token.info ? md.utils.unescapeAll(token.info).trim() : '';
    const langName = info ? info.split(/\s+/g)[0] : '';
    const code = token.content || '';

    if (isMermaidFenceContent(langName, code)) {
        const dataLine = token.map && token.level === 0 ? ` data-line="${token.map[0]}"` : '';
        return `<div class="mermaid"${dataLine}>${code}</div>`;
    }

    let highlighted = '';
    if (langName && hljs.getLanguage(langName)) {
        try {
            highlighted = hljs.highlight(code, { language: langName }).value;
        } catch {
            highlighted = md.utils.escapeHtml(code);
        }
    } else {
        highlighted = md.utils.escapeHtml(code);
    }

    const dataLine = token.map && token.level === 0 ? ` data-line="${token.map[0]}"` : '';
    const langLabel = langName ? `<div class="code-lang">${md.utils.escapeHtml(langName)}</div>` : `<div class="code-lang muted">text</div>`;
    const encoded = encodeURIComponent(code);
    const copyButton = `<button class="code-copy" data-code="${escapeHtmlAttr(encoded)}" title="Copy code">${Icons.Copy}<span>Copy</span></button>`;
    const langClass = langName ? ` class="language-${langName}"` : '';

    // Wrap each line for line numbers
    const numberedCode = wrapCodeLines(highlighted);

    return `<div class="code-block"${dataLine}><div class="code-block-header">${langLabel}${copyButton}</div><pre><code${langClass}>${numberedCode}</code></pre></div>`;
};

function addHeadingIds(tokens: any[]) {
    const slugCounts: Record<string, number> = {};
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === 'heading_open') {
            const inline = tokens[i + 1];
            const text = inline && inline.type === 'inline' ? normalizeHeadingText(inline.content) : '';
            const baseSlug = slugify(text);
            if (!baseSlug) {continue;}

            const count = (slugCounts[baseSlug] || 0) + 1;
            slugCounts[baseSlug] = count;
            const id = count > 1 ? `${baseSlug}-${count}` : baseSlug;
            token.attrSet('id', id);
            token.attrJoin('class', 'md-heading');
        }
    }
}

function stripHeadingCopyLinkArtifacts(text: string): string {
    if (!text) {
        return '';
    }

    return text
        .replace(/\s*\[#\]\(#[^)\s]+(?:\s+"Copy link")?\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeHeadingText(text: string): string {
    const stripped = stripHeadingCopyLinkArtifacts(text);
    return md.utils.unescapeAll(stripped);
}

function sanitizeMarkdownCopyLinkArtifacts(markdown: string): string {
    if (!markdown) {
        return '';
    }

    return markdown.split('\n').map((line) => {
        if (!/^\s{0,3}#{1,6}\s+/.test(line)) {
            return line;
        }
        return stripHeadingCopyLinkArtifacts(line);
    }).join('\n');
}

// id <-> CM6 line number (1-indexed), refreshed every buildToc() call. CM6 shows
// raw markdown text, not the rendered HTML the reading/split TOC-click and
// scroll-spy logic uses `#id` elements for — this is how the CM6 branch of that
// logic (updateScrollSpy, wireTocPanel's click handler) finds a heading's line.
const tocIdToLine = new Map<string, number>();
const tocLineToId = new Map<number, string>();

function buildToc(tokens: any[]) {
    tocIdToLine.clear();
    tocLineToId.clear();

    const items: Array<{ id: string; level: number; text: string }> = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === 'heading_open') {
            const inline = tokens[i + 1];
            const text = inline && inline.type === 'inline' ? normalizeHeadingText(inline.content) : '';
            const id = token.attrGet('id');
            const level = parseInt((token.tag || 'h2').replace('h', ''), 10);
            if (id && text) {
                items.push({ id, level, text });
                if (Array.isArray(token.map)) {
                    const line = token.map[0] + 1;
                    tocIdToLine.set(id, line);
                    tocLineToId.set(line, id);
                }
            }
        }
    }

    if (!items.length) {
        return '<div class="toc-empty">No headings found</div>';
    }

    return items.map(item => {
        const safeText = md.utils.escapeHtml(item.text);
        return `<div class="toc-item toc-level-${item.level}"><a href="#${item.id}" data-target="${item.id}">${safeText}</a></div>`;
    }).join('');
}

/** Re-derive the TOC + its id<->line map from live CM6 content (renderMarkdown/updateToc aren't called in CM6 mode). */
function refreshCm6Toc(content: string) {
    const body = markdownBodyWithoutFrontmatter(content || '');
    const tokens = md.parse(sanitizeMarkdownCopyLinkArtifacts(body), {});
    addHeadingIds(tokens);
    updateToc(tokens);
}

const debouncedCm6TocRefresh = debounce((content: string) => refreshCm6Toc(content), 300);

// ===== Rendering =====
function renderMermaidFlowcharts() {
    const mermaidLib = (md as any).mermaid;
    if (!mermaidLib) {return;}

    const isDark = document.body.classList.contains('dark-mode') ||
        document.body.classList.contains('dark-theme') ||
        document.body.classList.contains('vscode-dark') ||
        (document.body.classList.contains('vscode-theme') && document.body.classList.contains('vscode-dark'));

    mermaidLib.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default'
    });

    const nodes = document.querySelectorAll('.mermaid');
    if (nodes.length > 0) {
        mermaidLib.run({
            nodes: Array.from(nodes) as any
        }).catch((err: any) => {
            console.error('Mermaid render error:', err);
        });
    }
}

function persistFrontmatterPanelCollapsed(collapsed: boolean) {
    frontmatterPanelCollapsed = collapsed;
    vscode.postMessage({ command: 'saveFrontmatterPanelCollapsed', collapsed });
}

function persistMermaidPreviewMode(mode: 'diagram' | 'code') {
    mermaidPreviewMode = mode;
    vscode.postMessage({ command: 'saveMermaidPreviewMode', mode });
}

function persistCalloutDefaultType(type: string) {
    calloutDefaultType = type;
    vscode.postMessage({ command: 'saveCalloutDefaultType', type });
}

function applyFrontmatterBlockToDocument(newBlock: string) {
    const extracted = extractFrontmatter(currentContent);
    if (!extracted) { return; }
    currentContent = newBlock + extracted.body;
    if (isPreviewEditMode) {
        setLivePreviewContent(currentContent);
        refreshCm6Toc(currentContent);
    } else {
        renderMarkdown(currentContent);
    }
    updateStatusInfo();
}

function mountPreviewFrontmatterCard(cardData: NonNullable<ReturnType<typeof resolveFrontmatterForRender>['card']>) {
    const preview = $('markdownPreview');
    if (!preview || !cardData) { return; }
    const card = createFrontmatterCardElement({
        yamlText: cardData.yamlText,
        rows: cardData.rows,
        collapsed: frontmatterPanelCollapsed,
        editing: false,
        onCollapsedChange: persistFrontmatterPanelCollapsed,
        onEditingChange: () => { /* preview pane only persists on Done */ },
        onSave: (block) => {
            applyFrontmatterBlockToDocument(block);
        },
    });
    card.dataset.line = '0';
    preview.insertBefore(card, preview.firstChild);
}

function renderMarkdown(content: string) {
    const preview = $('markdownPreview');
    if (preview) {
        const env: any = {};
        const resolved = resolveFrontmatterForRender(content || '', frontmatterPanelCollapsed);
        const normalizedContent = sanitizeMarkdownCopyLinkArtifacts(resolved.body || '');
        const tokens = md.parse(normalizedContent, env);
        addHeadingIds(tokens);
        preview.innerHTML = md.renderer.render(tokens, md.options, env);
        if (resolved.card) {
            mountPreviewFrontmatterCard(resolved.card);
        }
        preview.querySelectorAll('img').forEach((node) => {
            if (!(node instanceof HTMLImageElement)) {return;}
            if (!node.complete) {
                node.addEventListener('load', refreshDataLineCache, { once: true });
            }
        });
        updateToc(tokens);
        refreshDataLineCache();
        requestAnimationFrame(() => {
            updateScrollSpy();
            updateProgressBar();
            reapplySearch();
            requestLocalImageResolution();
            renderMermaidFlowcharts();
        });
    }
}

function updateToc(tokens: any[]) {
    const tocBody = $('tocBody');
    if (!tocBody) {return;}
    tocBody.innerHTML = buildToc(tokens);
}

// ===== Preview Edit Mode (CM6 live preview) =====
function setPreviewEditMode(enabled: boolean) {
    isPreviewEditMode = enabled;
    isEditMode = enabled;
    document.body.classList.toggle('edit-mode', enabled);
    document.body.classList.toggle('preview-edit-mode', enabled);
    document.body.classList.toggle('cm6-preview-active', enabled);

    const saveBtn = $('saveEditsButton');
    const undoBtn = $('undoEditsButton');
    const redoBtn = $('redoEditsButton');
    const reloadBtn = $('reloadFromDiskButton');
    const container = $('markdownContainer');
    const preview = $('markdownPreview');

    const saveTarget = (saveBtn?.closest('.tooltip') as HTMLElement | null) || saveBtn;
    const undoTarget = (undoBtn?.closest('.tooltip') as HTMLElement | null) || undoBtn;
    const redoTarget = (redoBtn?.closest('.tooltip') as HTMLElement | null) || redoBtn;
    const reloadTarget = (reloadBtn?.closest('.tooltip') as HTMLElement | null) || reloadBtn;

    if (saveTarget) {saveTarget.classList.toggle('hidden', !enabled);}
    if (undoTarget) {undoTarget.classList.toggle('hidden', !enabled);}
    if (redoTarget) {redoTarget.classList.toggle('hidden', !enabled);}
    if (reloadTarget) {reloadTarget.classList.toggle('hidden', !enabled);}

    // Show formatting toolbar in preview edit mode
    const fmtToolbar = $('formattingToolbar');
    if (fmtToolbar) {fmtToolbar.classList.toggle('hidden', !enabled);}

    if (enabled) {
        originalContent = currentContent;

        container?.classList.add('preview-edit');
        container?.classList.remove('preview-left');

        if (preview) {
            preview.contentEditable = 'false';
            wireImageUriResolver();
            mountLivePreview({
                parent: preview,
                doc: currentContent,
                lineWrapping: currentSettings.wordWrap,
                onDocChanged: (doc) => {
                    currentContent = doc;
                    updateStatusInfo();
                    debouncedCm6TocRefresh(doc);
                    reapplySearch();
                    scheduleAutosave();
                    updateEditToolbarButtons();
                },
                onScroll: throttledScrollSpy,
                onModifierClick: handleLivePreviewModifierClick,
                reveal: currentSettings.livePreviewReveal,
                showLineNumbers: wantsLivePreviewLineNumbers(),
                onSelectionChange: updateStatusInfo,
                onHistoryChange: updateEditToolbarButtons,
                columnWidths: currentTableColumnWidths,
                onColumnWidthsChanged: (widths) => {
                    currentTableColumnWidths = widths;
                    vscode.postMessage({ command: 'saveTableColumnWidths', widths });
                },
                frontmatterCollapsed: frontmatterPanelCollapsed,
                onFrontmatterCollapsedChanged: (collapsed) => {
                    persistFrontmatterPanelCollapsed(collapsed);
                },
                mermaidPreviewMode,
                onMermaidPreviewModeChanged: (mode) => {
                    persistMermaidPreviewMode(mode);
                },
                calloutDefaultType,
                onCalloutDefaultTypeChanged: (type) => {
                    persistCalloutDefaultType(type);
                },
            });
            refreshCm6Toc(currentContent);
            focusLivePreview();
        }
    } else {
        if (isLivePreviewActive()) {
            unmountLivePreview();
        }
        if (preview) {
            preview.contentEditable = 'false';
        }
        container?.classList.remove('preview-edit');
        container?.classList.remove('preview-left');
        renderMarkdown(currentContent);
    }

    applyToolbarLayout(toolbarManager, {
        stickyToolbar: currentSettings.stickyToolbar,
        scrollTarget: '#content'
    });
    applyFormattingToolbarLayout();
    updateHeaderHeight();
    requestAnimationFrame(() => updateHeaderHeight());
    updateEditToolbarButtons();

    updateStatusInfo();
}

// Ctrl/Cmd+Click actions inside CM6 Preview Edit — the click-handling port of
// wirePreviewInteractions' link/image/heading-anchor/code-copy behaviors. Plain
// click keeps CM6's normal "place the caret" behavior since this surface (unlike
// the old non-editable render) is real editable text.
function handleLivePreviewModifierClick(pos: number) {
    const interaction = resolveLivePreviewInteraction(pos);
    if (!interaction) {return;}

    if (interaction.kind === 'link') {
        const href = interaction.href;
        if (href.startsWith('#')) {
            const line = tocIdToLine.get(href.slice(1));
            if (line !== undefined) {scrollLivePreviewToLine(line);}
        } else if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
            vscode.postMessage({ command: 'openExternal', url: href });
        } else if (href) {
            vscode.postMessage({ command: 'openRelativeFile', href, documentUri });
        }
        return;
    }

    if (interaction.kind === 'image') {
        const src = interaction.src.trim();
        if (!src) {return;}
        if (!shouldResolveLocalImage(src)) {
            showLightbox(src, '');
            return;
        }
        const resolved = resolvedImageUriCache.get(src);
        if (resolved) {
            showLightbox(resolved, '');
        } else {
            pendingCm6LightboxSrc = src;
            vscode.postMessage({ command: 'resolveImageUris', sources: [src] });
        }
        return;
    }

    if (interaction.kind === 'heading') {
        const id = tocLineToId.get(interaction.line);
        if (id && navigator.clipboard) {
            navigator.clipboard.writeText(`#${id}`).then(() => showToast('Link copied')).catch(() => showToast('Copy failed', undefined, { icon: 'warning' }));
        }
        return;
    }

    if (interaction.kind === 'code' && navigator.clipboard) {
        navigator.clipboard.writeText(interaction.text).then(() => showToast('Copied')).catch(() => showToast('Copy failed', undefined, { icon: 'warning' }));
    }
}

// ===== Active editor content =====
// The single reader over the editing surfaces.
function getActiveEditorContent(): string {
    if (isPreviewEditMode) {
        const cm6 = getLivePreviewContent();
        if (cm6 !== null) {
            return sanitizeMarkdownCopyLinkArtifacts(cm6);
        }
        return currentContent;
    }
    return currentContent;
}

function ensurePreviewEditMode() {
    if (!isPreviewEditMode && !isVersionPreviewMode) {
        setPreviewEditMode(true);
    }
}

function ensureVersionPreviewBanner(): HTMLElement {
    let banner = $('versionPreviewBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'versionPreviewBanner';
        banner.className = 'version-preview-banner hidden';
        banner.innerHTML = `
            <span id="versionPreviewText" class="version-preview-text"></span>
            <div class="version-preview-actions">
                <button id="restoreVersionButton" class="toggle-button" type="button">Restore</button>
                <button id="cancelVersionPreviewButton" class="toggle-button" type="button">Cancel</button>
            </div>
        `;

        const target = $('content') || document.body;
        target.insertBefore(banner, target.firstChild || null);

        const restoreBtn = $('restoreVersionButton') as HTMLButtonElement | null;
        const cancelBtn = $('cancelVersionPreviewButton') as HTMLButtonElement | null;
        restoreBtn?.addEventListener('click', () => {
            vscode.postMessage({ command: 'restoreVersion' });
        });
        cancelBtn?.addEventListener('click', () => {
            vscode.postMessage({ command: 'cancelVersionPreview' });
        });
    }

    return banner;
}

function setVersionPreviewMode(enabled: boolean, label?: string) {
    isVersionPreviewMode = enabled;
    document.body.classList.toggle('version-preview-mode', enabled);
    if (enabled) {
        setPreviewEditMode(false);
        const banner = ensureVersionPreviewBanner();
        const text = $('versionPreviewText');
        if (text) {
            text.textContent = label || 'Previewing selected version (read-only)';
        }
        banner.classList.remove('hidden');
    } else {
        const banner = $('versionPreviewBanner');
        if (banner) {
            banner.classList.add('hidden');
        }
        ensurePreviewEditMode();
    }
}

function performSave(isAutosave = false) {
    if (isSaving || !isEditMode) {return;}
    if (!isEditorDirty()) {return;}
    if (pendingDiskContent !== null) {
        // Autosave never interrupts with a dialog over an unresolved conflict — it
        // just skips this tick; the next edit reschedules and tries again.
        if (isAutosave) {return;}
        confirmOverwriteConflict().then((confirmed) => {
            if (!confirmed) {return;}
            pendingDiskContent = null;
            hideToast();
            doSave(false, isAutosave);
        });
        return;
    }
    doSave(false, isAutosave);
}

let lastSaveWasAutosave = false;

function doSave(force = false, isAutosave = false) {
    isSaving = true;
    lastSaveWasAutosave = isAutosave;
    setButtonsEnabled(false);
    currentContent = getActiveEditorContent();
    vscode.postMessage({ command: 'saveMarkdown', text: currentContent, force, isAutosave });
}

let autoSaveTimer: number | null = null;

function scheduleAutosave() {
    if (!currentSettings.autoSave || !isEditMode) {return;}
    if (autoSaveTimer !== null) {window.clearTimeout(autoSaveTimer);}
    autoSaveTimer = window.setTimeout(() => {
        autoSaveTimer = null;
        if (!currentSettings.autoSave || !isEditMode || isSaving) {return;}
        if (getActiveEditorContent() === originalContent) {return;}
        performSave(true);
    }, 1200);
}

function cancelEdit() {
    currentContent = originalContent;
    if (isPreviewEditMode && isLivePreviewActive()) {
        setLivePreviewContent(originalContent);
        refreshCm6Toc(originalContent);
        reapplySearch();
        updateStatusInfo();
    }
    updateEditToolbarButtons();
}

// Pushes freshly-read disk content into whichever surface is currently active.
// isPreviewEditMode implies isEditMode (see setPreviewEditMode), so it must be
// checked first or Preview Edit gets misrouted into the split-textarea branch below.
function applyReloadedContent(text: string) {
    currentContent = text;
    originalContent = text;
    resolvedImageUriCache.clear();

    if (isPreviewEditMode) {
        setLivePreviewContent(text);
        refreshCm6Toc(text);
        reapplySearch();
    } else {
        renderMarkdown(text);
    }

    updateStatusInfo();
    updateEditToolbarButtons();
}

// VS Code webviews are sandboxed without `allow-modals` — window.confirm()/alert()/
// prompt() are silently blocked, so a real dialog is built here reusing the shared
// .feedback-overlay/.feedback-modal pattern (same one FeedbackModal/ProjectsModal use).
function confirmModal(title: string, message: string, confirmLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'feedback-overlay reload-confirm-overlay';
        const modal = document.createElement('div');
        modal.className = 'feedback-modal';
        modal.innerHTML = `
            <div class="feedback-header">
                <h2>${escapeHtmlAttr(title)}</h2>
            </div>
            <div class="feedback-body" style="padding: 20px 24px 24px 24px; gap: 20px;">
                <p style="margin: 0; font-size: 13.5px; color: var(--text-color); line-height: 1.5;">
                    ${escapeHtmlAttr(message)}
                </p>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="reload-confirm-cancel" type="button" style="background: none; border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-color); font-size: 13px; font-weight: 500; padding: 6px 14px; cursor: pointer;">Cancel</button>
                    <button class="reload-confirm-ok" type="button" style="background: var(--warning-color); border: none; border-radius: 6px; color: var(--contrast-text); font-size: 13px; font-weight: 600; padding: 6px 14px; cursor: pointer;">${escapeHtmlAttr(confirmLabel)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.body.appendChild(modal);
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            modal.classList.add('active');
        });

        const finish = (result: boolean) => {
            overlay.remove();
            modal.remove();
            resolve(result);
        };
        overlay.addEventListener('click', () => finish(false));
        modal.querySelector('.reload-confirm-cancel')?.addEventListener('click', () => finish(false));
        modal.querySelector('.reload-confirm-ok')?.addEventListener('click', () => finish(true));
    });
}

function confirmDiscardAndReload(): Promise<boolean> {
    return confirmModal('Reload from Disk', 'Discard unsaved changes and reload from disk?', 'Discard & Reload');
}

function confirmOverwriteConflict(): Promise<boolean> {
    return confirmModal(
        'File Changed on Disk',
        'This file changed on disk since you opened it. Overwrite it with your local changes anyway?',
        'Overwrite'
    );
}

// Manual "Reload from disk" toolbar button handler.
async function requestReloadFromDisk() {
    if (isSaving || isReloadingFromDisk || !isEditMode || !canReloadFromDisk()) {return;}
    currentContent = getActiveEditorContent();
    const dirty = currentContent !== originalContent;
    if (dirty && !(await confirmDiscardAndReload())) {
        return;
    }
    isReloadingFromDisk = true;
    setButtonsEnabled(false);
    vscode.postMessage({ command: 'requestFreshData' });
}

// ===== Preview line cache (reading-mode render) =====
let cachedDataLineElements: HTMLElement[] = [];
let cachedPreviewLineMap: Array<{ line: number, top: number }> = [];

function normalizeLineMap(entries: Array<{ line: number, top: number }>): Array<{ line: number, top: number }> {
    const sorted = entries
        .filter(entry => Number.isFinite(entry.line) && Number.isFinite(entry.top))
        .sort((a, b) => a.line - b.line || a.top - b.top);

    const deduped: Array<{ line: number, top: number }> = [];
    for (const entry of sorted) {
        const last = deduped[deduped.length - 1];
        if (!last || last.line !== entry.line) {
            deduped.push(entry);
        }
    }

    return deduped;
}

function refreshDataLineCache() {
    const preview = $('markdownPreview');
    if (!preview) {
        cachedDataLineElements = [];
        cachedPreviewLineMap = [];
        return;
    }
    cachedDataLineElements = Array.from(preview.querySelectorAll('[data-line]')) as HTMLElement[];
    const previewTop = preview.getBoundingClientRect().top;
    const scrollOffset = preview.scrollTop;
    cachedPreviewLineMap = normalizeLineMap(cachedDataLineElements.map(el => ({
        line: parseInt(el.getAttribute('data-line') || '0'),
        top: el.getBoundingClientRect().top - previewTop + scrollOffset
    })));
}

function applyFormat(action: string) {
    if (!isPreviewEditMode) {return;}
    applyLivePreviewFormat(action);
}

// ===== UI Helpers =====
let toastDismissTimer: number | null = null;
let toastOnDismiss: (() => void) | null = null;

// Same outline/gray style for both — only the shape differs. Success: plain
// checkmark for positive acknowledgements (Saved, Copied, Reloaded, ...).
// Warning: caution triangle for anything the user should pay attention to
// (disk conflicts/deletions, failures).
const TOAST_ICON_SUCCESS = '<polyline points="20 6 9 17 4 12"></polyline>';
const TOAST_ICON_WARNING = '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>'
    + '<line x1="12" y1="9" x2="12" y2="13"></line>'
    + '<line x1="12" y1="17" x2="12.01" y2="17"></line>';

function hideToast() {
    const toast = $('toastNotification');
    if (toastDismissTimer !== null) {
        window.clearTimeout(toastDismissTimer);
        toastDismissTimer = null;
    }
    toast?.classList.remove('show');
    toastOnDismiss = null;
}

function showToast(
    message: string,
    action?: { label: string; onClick: () => void },
    opts?: { persistent?: boolean; onDismiss?: () => void; icon?: 'success' | 'warning' }
) {
    let toast = $('toastNotification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toastNotification';
        toast.className = 'toast-notification';
        toast.innerHTML = `
            <div class="toast-icon-wrapper">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg>
            </div>
            <span class="toast-text"></span>
            <button class="toast-action hidden" type="button"></button>
            <button class="toast-close" type="button" aria-label="Dismiss">&times;</button>
        `;
        document.body.appendChild(toast);

        toast.querySelector('.toast-close')?.addEventListener('click', () => {
            const onDismiss = toastOnDismiss;
            hideToast();
            onDismiss?.();
        });
    }
    if (toast) {
        const toastText = toast.querySelector('.toast-text') || $('toastText');
        if (toastText) {toastText.textContent = message;}

        const iconSvg = toast.querySelector('.toast-icon-wrapper svg');
        if (iconSvg) {iconSvg.innerHTML = opts?.icon === 'warning' ? TOAST_ICON_WARNING : TOAST_ICON_SUCCESS;}

        const actionBtn = toast.querySelector('.toast-action') as HTMLButtonElement | null;
        if (actionBtn) {
            if (action) {
                actionBtn.textContent = action.label;
                actionBtn.classList.remove('hidden');
                actionBtn.onclick = action.onClick;
            } else {
                actionBtn.classList.add('hidden');
                actionBtn.onclick = null;
            }
        }

        toastOnDismiss = opts?.onDismiss || null;

        toast.classList.add('show');
        if (toastDismissTimer !== null) {window.clearTimeout(toastDismissTimer);}
        if (opts?.persistent) {
            toastDismissTimer = null;
        } else {
            toastDismissTimer = window.setTimeout(() => {
                toast!.classList.remove('show');
                toastDismissTimer = null;
                toastOnDismiss = null;
            }, action ? 8000 : 6000);
        }
    }
}

/** Current cursor position for the active editing surface. null in Reading mode. */
function getCurrentCursorPosition(): { line: number; col: number } | null {
    if (isPreviewEditMode) {
        return getLivePreviewCursorPosition();
    }
    return null;
}

function updateStatusInfo() {
    const statusInfo = $('statusInfo');
    if (!statusInfo) {return;}

    const lines = currentContent.split('\n').length;
    const chars = currentContent.length;
    const words = currentContent.trim().split(/\s+/).filter(w => w).length;
    const readingTime = Math.max(1, Math.ceil(words / 200));
    const cursor = getCurrentCursorPosition();
    const cursorPrefix = cursor ? `Ln ${cursor.line}, Col ${cursor.col} \u00B7 ` : '';
    statusInfo.textContent = `${cursorPrefix}${lines} lines \u00B7 ${words} words \u00B7 ${chars} chars \u00B7 ~${readingTime} min read`;
    statusInfo.style.display = 'block';
}

// ===== Reading Progress Bar =====
function updateProgressBar() {
    const bar = $('readingProgressBar');
    if (!bar) {return;}

    // CM6's own `.cm-scroller` scrolls; #markdownPreview (view.dom's parent) does not.
    const cm6Metrics = isLivePreviewActive() ? getLivePreviewScrollMetrics() : null;
    let scrollTop: number, usableHeight: number;
    if (cm6Metrics) {
        scrollTop = cm6Metrics.scrollTop;
        usableHeight = cm6Metrics.scrollHeight - cm6Metrics.clientHeight;
    } else {
        const preview = $('markdownPreview');
        if (!preview) {return;}
        scrollTop = preview.scrollTop;
        usableHeight = preview.scrollHeight - preview.clientHeight;
    }

    const progress = usableHeight > 0 ? (scrollTop / usableHeight) * 100 : 0;
    bar.style.width = progress + '%';
}

// ===== Scroll Spy (Active TOC Tracking) =====
function nearestTocIdForLine(line: number): string {
    let bestLine = -1;
    let id = '';
    tocLineToId.forEach((headingId, headingLine) => {
        if (headingLine <= line && headingLine > bestLine) {
            bestLine = headingLine;
            id = headingId;
        }
    });
    return id;
}

function updateScrollSpy() {
    const tocBody = $('tocBody');
    if (!tocBody) {return;}

    let current = '';
    if (isLivePreviewActive()) {
        const topLine = getLivePreviewTopLine();
        current = topLine !== null ? nearestTocIdForLine(topLine) : '';
    } else {
        const preview = $('markdownPreview');
        if (!preview) {return;}
        const headings = Array.from(preview.querySelectorAll('.md-heading'));
        const scrollTop = preview.scrollTop;
        for (const heading of headings) {
            const el = heading as HTMLElement;
            if (el.offsetTop - 16 <= scrollTop + 100) {
                current = heading.id;
            }
        }
    }

    const links = tocBody.querySelectorAll('.toc-item a');
    let activeLink: HTMLElement | null = null;
    links.forEach(a => {
        const isActive = a.getAttribute('data-target') === current;
        a.classList.toggle('active', isActive);
        if (isActive) {activeLink = a as HTMLElement;}
    });

    // Auto-scroll TOC body to keep active item visible
    if (activeLink && tocBody) {
        const tocRect = tocBody.getBoundingClientRect();
        const linkRect = (activeLink as HTMLElement).getBoundingClientRect();
        const linkTop = linkRect.top - tocRect.top;
        const linkBot = linkRect.bottom - tocRect.top;
        const tocHeight = tocBody.clientHeight;

        if (linkTop < 0) {
            tocBody.scrollTop += linkTop - 16;
        } else if (linkBot > tocHeight) {
            tocBody.scrollTop += linkBot - tocHeight + 16;
        }
    }
}

const throttledScrollSpy = throttleRAF(() => {
    updateScrollSpy();
    updateProgressBar();
});

function initScrollSpy() {
    const preview = $('markdownPreview');
    if (!preview) {return;}

    preview.addEventListener('scroll', throttledScrollSpy, { passive: true });
}

// ===== Lightbox =====
function initLightbox() {
    const overlay = $('lightboxOverlay');
    const closeBtn = $('lightboxClose');
    if (!overlay) {return;}

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {closeLightbox();}
    });
    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeLightbox());
    }
}

function showLightbox(src: string, alt: string) {
    const overlay = $('lightboxOverlay');
    const img = $('lightboxImage') as HTMLImageElement;
    if (!overlay || !img) {return;}
    img.src = src;
    img.alt = alt || '';
    overlay.classList.add('active');
    document.body.classList.add('lightbox-open');
}

function closeLightbox() {
    const overlay = $('lightboxOverlay');
    if (!overlay) {return;}
    overlay.classList.remove('active');
    document.body.classList.remove('lightbox-open');
}

// ===== Search in Preview =====
const debouncedSearch = debounce((query: string) => {
    doSearch(query);
}, 200);

function toggleSearchOverlay() {
    const overlay = $('searchOverlay');
    if (!overlay) {return;}
    if (overlay.classList.contains('active')) {
        closeSearch();
    } else {
        openSearch();
    }
}

function openSearch() {
    const overlay = $('searchOverlay');
    const input = $('searchInput') as HTMLInputElement;
    if (!overlay) {return;}
    overlay.classList.add('active');
    if (input) {
        input.focus();
        input.select();
    }
}

function closeSearch() {
    const overlay = $('searchOverlay');
    if (!overlay) {return;}
    overlay.classList.remove('active');
    clearSearchHighlights();
    searchMatches = [];
    searchCurrentIndex = -1;
    updateSearchCount();
}

function doSearch(query: string) {
    clearSearchHighlights();
    searchMatches = [];
    cm6SearchMatches = [];
    searchCurrentIndex = -1;

    if (!query || query.length < 2) {
        updateSearchCount();
        return;
    }

    if (isLivePreviewActive()) {
        // CM6 doc is raw text — no rendered DOM to TreeWalker, use CM6's own SearchCursor.
        cm6SearchMatches = findLivePreviewMatches(query);
        if (cm6SearchMatches.length > 0) {
            searchCurrentIndex = 0;
            highlightCurrentMatch();
        }
        updateSearchCount();
        return;
    }

    const preview = $('markdownPreview');
    if (!preview) {return;}

    const lowerQuery = query.toLowerCase();
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null);
    const nodesToProcess: { node: Text; indices: number[] }[] = [];

    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent || '';
        const lowerText = text.toLowerCase();
        const indices: number[] = [];
        let idx = 0;
        while ((idx = lowerText.indexOf(lowerQuery, idx)) !== -1) {
            indices.push(idx);
            idx += lowerQuery.length;
        }
        if (indices.length > 0) {
            nodesToProcess.push({ node: textNode, indices });
        }
    }

    for (let i = nodesToProcess.length - 1; i >= 0; i--) {
        const { node, indices } = nodesToProcess[i];
        for (let j = indices.length - 1; j >= 0; j--) {
            const startIdx = indices[j];
            const range = document.createRange();
            range.setStart(node, startIdx);
            range.setEnd(node, startIdx + query.length);
            const highlightMark = document.createElement('mark');
            highlightMark.className = 'search-highlight';
            range.surroundContents(highlightMark);
            searchMatches.unshift(highlightMark);
        }
    }

    if (searchMatches.length > 0) {
        searchCurrentIndex = 0;
        highlightCurrentMatch();
    }
    updateSearchCount();
}

function clearSearchHighlights() {
    if (isLivePreviewActive()) {
        clearLivePreviewSearchHighlights();
        return;
    }
    const preview = $('markdownPreview');
    if (!preview) {return;}
    preview.querySelectorAll('.search-highlight').forEach(mark => {
        const parent = mark.parentNode;
        if (parent) {
            parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
            parent.normalize();
        }
    });
}

function highlightCurrentMatch() {
    if (isLivePreviewActive()) {
        setLivePreviewSearchHighlights(cm6SearchMatches, searchCurrentIndex);
        const match = cm6SearchMatches[searchCurrentIndex];
        if (match) {scrollLivePreviewToMatch(match);}
        return;
    }
    searchMatches.forEach((m, i) => {
        m.classList.toggle('current', i === searchCurrentIndex);
    });
    if (searchMatches[searchCurrentIndex]) {
        searchMatches[searchCurrentIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

function navigateSearch(direction: 'next' | 'prev') {
    const count = isLivePreviewActive() ? cm6SearchMatches.length : searchMatches.length;
    if (count === 0) {return;}
    if (direction === 'next') {
        searchCurrentIndex = (searchCurrentIndex + 1) % count;
    } else {
        searchCurrentIndex = (searchCurrentIndex - 1 + count) % count;
    }
    highlightCurrentMatch();
    updateSearchCount();
}

function updateSearchCount() {
    const countEl = $('searchCount');
    if (!countEl) {return;}
    const count = isLivePreviewActive() ? cm6SearchMatches.length : searchMatches.length;
    if (count === 0) {
        countEl.textContent = 'No results';
    } else {
        countEl.textContent = `${searchCurrentIndex + 1} / ${count}`;
    }
}

function reapplySearch() {
    const overlay = $('searchOverlay');
    const input = $('searchInput') as HTMLInputElement;
    if (overlay && overlay.classList.contains('active') && input && input.value.length >= 2) {
        doSearch(input.value);
    }
}

function initSearchOverlay() {
    const input = $('searchInput') as HTMLInputElement;
    const prevBtn = $('searchPrev');
    const nextBtn = $('searchNext');
    const closeBtn = $('searchClose');

    if (input) {
        input.addEventListener('input', () => {
            debouncedSearch(input.value);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                navigateSearch(e.shiftKey ? 'prev' : 'next');
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
            }
        });
    }
    if (prevBtn) {prevBtn.addEventListener('click', () => navigateSearch('prev'));}
    if (nextBtn) {nextBtn.addEventListener('click', () => navigateSearch('next'));}
    if (closeBtn) {closeBtn.addEventListener('click', () => closeSearch());}

    wireDelayedToolbarTooltips($('searchOverlay') || document);
}

// ===== Settings =====
function applySettings(settings: any, persist = false) {
    if (!settings) {return;}
    currentSettings = { ...currentSettings, ...settings };

    const container = $('markdownContainer');

    // Word wrap
    if (container) {
        container.classList.toggle('word-wrap', currentSettings.wordWrap);
    }

    if (isLivePreviewActive()) {
        setLivePreviewReveal(currentSettings.livePreviewReveal);
        setLivePreviewLineNumbers(wantsLivePreviewLineNumbers());
    }

    refreshDataLineCache();

    // Sticky toolbar
    applyToolbarLayout(toolbarManager, {
        stickyToolbar: currentSettings.stickyToolbar,
        scrollTarget: '#content'
    });

    applyFormattingToolbarLayout();
    updateHeaderHeight();

    // Update checkbox UI
    const chkWordWrap = $('chkWordWrap') as HTMLInputElement;
    const chkStickyToolbar = $('chkStickyToolbar') as HTMLInputElement;
    const chkShowOutline = $('chkShowOutline') as HTMLInputElement;
    const chkShowLineNumbers = $('chkShowLineNumbers') as HTMLInputElement;
    const chkLivePreviewReveal = $('chkLivePreviewReveal') as HTMLInputElement;
    const chkLivePreviewLineNumbers = $('chkLivePreviewLineNumbers') as HTMLInputElement;
    const chkAutoSave = $('chkAutoSave') as HTMLInputElement;

    if (chkWordWrap) {chkWordWrap.checked = currentSettings.wordWrap;}
    if (chkStickyToolbar) {chkStickyToolbar.checked = currentSettings.stickyToolbar;}
    if (chkShowOutline) {chkShowOutline.checked = currentSettings.showOutline;}
    if (chkShowLineNumbers) {chkShowLineNumbers.checked = currentSettings.showLineNumbers;}
    if (chkLivePreviewReveal) {chkLivePreviewReveal.checked = currentSettings.livePreviewReveal;}
    if (chkLivePreviewLineNumbers) {chkLivePreviewLineNumbers.checked = currentSettings.livePreviewLineNumbers;}
    if (chkAutoSave) {chkAutoSave.checked = currentSettings.autoSave;}

    // Line numbers
    document.body.classList.toggle('show-line-numbers', !!currentSettings.showLineNumbers);

    const tocPanel = $('tocPanel');
    if (container) {container.classList.toggle('toc-open', !!currentSettings.showOutline);}
    if (tocPanel) {tocPanel.classList.toggle('hidden', !currentSettings.showOutline);}

    if (toolbarManager) {
        reorderMdToolbarButtons();
        const btn = toolbarManager.getButton('toggleTocButton');
        if (btn) {btn.classList.toggle('active', !!currentSettings.showOutline);}
    }

    if (toolbarManager) {
        toolbarManager.setButtonVisibility('disableMdEditorButton', !!currentSettings.isMdEnabled);
        toolbarManager.setButtonVisibility('enableMdEditorButton', !currentSettings.isMdEnabled);
    }

    if (persist) {
        vscode.postMessage({ command: 'updateSettings', settings: currentSettings });
    }
}

function initializeSettings() {
    const settingsDefs = [
        {
            id: 'chkWordWrap',
            label: 'Word Wrap',
            tooltip: 'Wrap long lines in the Markdown preview/editor instead of horizontal scrolling.',
            defaultValue: currentSettings.wordWrap,
            onChange: (val: boolean) => {
                currentSettings.wordWrap = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkStickyToolbar',
            label: 'Sticky Toolbar',
            tooltip: 'Keep the Markdown toolbar pinned at the top while you scroll.',
            defaultValue: currentSettings.stickyToolbar,
            onChange: (val: boolean) => {
                currentSettings.stickyToolbar = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkShowOutline',
            label: 'Show Outline',
            tooltip: 'Display the document outline panel for heading navigation.',
            defaultValue: currentSettings.showOutline,
            onChange: (val: boolean) => {
                currentSettings.showOutline = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkShowLineNumbers',
            label: 'Line Numbers',
            tooltip: 'Show line numbers in fenced code block previews.',
            defaultValue: currentSettings.showLineNumbers,
            onChange: (val: boolean) => {
                currentSettings.showLineNumbers = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkLivePreviewReveal',
            label: 'Live Preview Reveal',
            tooltip: 'In Preview Edit mode, reveal raw markdown syntax (##, **, *) near the cursor and hide it elsewhere.',
            defaultValue: currentSettings.livePreviewReveal,
            onChange: (val: boolean) => {
                currentSettings.livePreviewReveal = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkLivePreviewLineNumbers',
            label: 'Line Numbers (Preview Edit)',
            tooltip: 'In Preview Edit mode, show line numbers in the editor gutter. Click a number to select that line.',
            defaultValue: currentSettings.livePreviewLineNumbers,
            onChange: (val: boolean) => {
                currentSettings.livePreviewLineNumbers = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkMoveMdButtonsToEnd',
            label: 'Move Enable/Disable MD Buttons Near Help',
            tooltip: 'Place the Enable/Disable MD buttons just before Help & Feedback instead of at the start of the toolbar.',
            defaultValue: currentSettings.moveMdButtonsToEnd,
            onChange: (val: boolean) => {
                currentSettings.moveMdButtonsToEnd = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkAutoSave',
            label: 'Autosave',
            tooltip: 'Automatically save Markdown edits after a short debounce.',
            defaultValue: currentSettings.autoSave,
            onChange: (val: boolean) => {
                currentSettings.autoSave = val;
                applySettings(currentSettings, true);
            }
        }
    ];

    // Render panel
    SettingsManager.renderPanel(document.body, 'settingsPanel', 'settingsCancelButton', settingsDefs);

    const settingsGroup = document.querySelector('#settingsPanel .settings-group');
    if (settingsGroup) {
        settingsGroup.insertAdjacentHTML('beforeend', renderThemeToggleSettingItem('themeSelect'));
    }

    // Initialize manager
    new SettingsManager('openSettingsButton', 'settingsPanel', 'settingsCancelButton', settingsDefs);

    // Theme manager
    new ThemeManager('themeSelect', {
        onBeforeCycle: () => true
    }, vscode);
}

function reorderMdToolbarButtons() {
    if (!toolbarManager) {return;}

    const toolbar = document.getElementById('toolbar');
    const startGroup = toolbar?.querySelector('.toolbar-group-start') as HTMLElement | null;
    const endGroup = toolbar?.querySelector('.toolbar-group-end') as HTMLElement | null;
    const enableBtn = toolbarManager.getButton('enableMdEditorButton');
    const disableBtn = toolbarManager.getButton('disableMdEditorButton');
    const saveBtn = toolbarManager.getButton('saveEditsButton');
    const anchorWrap = (saveBtn?.closest('.tooltip') as HTMLElement | null) || saveBtn;
    const helpBtn = toolbarManager.getButton('helpButton');

    if (!toolbar || !enableBtn || !disableBtn || !anchorWrap || !helpBtn) {
        return;
    }

    const enableWrap = enableBtn.closest('.tooltip') as HTMLElement | null;
    const disableWrap = disableBtn.closest('.tooltip') as HTMLElement | null;
    const helpWrap = helpBtn.closest('.tooltip') as HTMLElement | null;

    if (!enableWrap || !disableWrap || !anchorWrap || !helpWrap) {
        return;
    }

    if (currentSettings.moveMdButtonsToEnd) {
        const targetParent = endGroup || toolbar;
        targetParent.insertBefore(enableWrap, helpWrap);
        targetParent.insertBefore(disableWrap, helpWrap);
    } else {
        const targetParent = startGroup || toolbar;
        targetParent.insertBefore(enableWrap, anchorWrap);
        targetParent.insertBefore(disableWrap, anchorWrap);
    }
}

// ===== Header Height =====
function applyFormattingToolbarLayout() {
    const fmtToolbar = $('formattingToolbar');
    const contentArea = $('content');
    const mainToolbar = $('toolbar');
    if (!fmtToolbar || !contentArea) {return;}

    if (currentSettings.stickyToolbar) {
        const toolbarWrapper = mainToolbar?.closest('.toolbar-wrapper') as HTMLElement | null;
        const anchor = toolbarWrapper && toolbarWrapper.parentNode === document.body
            ? toolbarWrapper
            : mainToolbar;
        if (anchor?.parentNode === document.body) {
            document.body.insertBefore(fmtToolbar, anchor.nextSibling);
        } else {
            document.body.insertBefore(fmtToolbar, contentArea);
        }
        return;
    }

    if (mainToolbar && mainToolbar.parentNode === contentArea) {
        contentArea.insertBefore(fmtToolbar, mainToolbar.nextSibling);
    } else {
        contentArea.insertBefore(fmtToolbar, contentArea.firstChild);
    }
}

function syncMdHeaderHeight() {
    if (!document.body.classList.contains('sticky-toolbar-enabled')) {
        return;
    }

    const mainToolbar = $('toolbar');
    const fmtToolbar = $('formattingToolbar');
    const headerBg = document.querySelector('.header-background') as HTMLElement | null;
    const maxHeight = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--header-height-max'),
        10
    ) || 96;

    const mainHeight = Math.min(
        maxHeight,
        Math.max(6, Math.ceil(mainToolbar?.getBoundingClientRect().height || 0))
    );
    document.documentElement.style.setProperty('--main-toolbar-height', mainHeight + 'px');

    let totalHeight = mainHeight;
    if (fmtToolbar && !fmtToolbar.classList.contains('hidden')) {
        totalHeight += Math.ceil(fmtToolbar.getBoundingClientRect().height);
    }

    document.documentElement.style.setProperty('--header-height', totalHeight + 'px');
    if (headerBg) {
        headerBg.style.height = totalHeight + 'px';
    }
}

function updateHeaderHeight() {
    if (toolbarManager) {
        toolbarManager.updateHeaderHeight();
    } else {
        syncMdHeaderHeight();
    }
}

// ===== Message Handler =====
window.addEventListener('message', (event) => {
    const m = event.data;

    switch (m.command) {
        case 'initMarkdown':
            const loading = $('loadingIndicator');
            if (loading) {loading.style.display = 'none';}

            currentContent = m.content || '';
            originalContent = currentContent;
            documentUri = m.documentUri || '';
            documentDirUri = m.documentDirUri || '';
            workspaceFolderUri = m.workspaceFolderUri || null;
            currentTableColumnWidths = m.tableColumnWidths || {};
            frontmatterPanelCollapsed = !!m.frontmatterPanelCollapsed;
            mermaidPreviewMode = m.mermaidPreviewMode === 'code' ? 'code' : 'diagram';
            calloutDefaultType = typeof m.calloutDefaultType === 'string' && /^[\w-]*$/.test(m.calloutDefaultType)
                ? m.calloutDefaultType.toLowerCase()
                : 'info';
            resolvedImageUriCache.clear();
            if (isPreviewEditMode && isLivePreviewActive()) {
                setLivePreviewMermaidMode(mermaidPreviewMode);
                setLivePreviewCalloutDefaultType(calloutDefaultType);
                applyReloadedContent(currentContent);
            } else if (hasEnteredPreviewEdit || isVersionPreviewMode) {
                renderMarkdown(currentContent);
            }
            updateStatusInfo();
            updateEditToolbarButtons();
            break;

        case 'diskChangedExternally': {
            documentUri = m.documentUri || documentUri;
            documentDirUri = m.documentDirUri || documentDirUri;
            workspaceFolderUri = m.workspaceFolderUri || workspaceFolderUri;
            currentTableColumnWidths = m.tableColumnWidths || currentTableColumnWidths;
            mermaidPreviewMode = m.mermaidPreviewMode === 'code' ? 'code' : mermaidPreviewMode;
            if (typeof m.calloutDefaultType === 'string' && /^[\w-]*$/.test(m.calloutDefaultType)) {
                calloutDefaultType = m.calloutDefaultType.toLowerCase();
            }
            if (isPreviewEditMode && isLivePreviewActive()) {
                setLivePreviewMermaidMode(mermaidPreviewMode);
                setLivePreviewCalloutDefaultType(calloutDefaultType);
            }

            const wasManualReload = isReloadingFromDisk;
            if (isReloadingFromDisk) {
                isReloadingFromDisk = false;
                setButtonsEnabled(true);
            }

            // A real change supersedes any prior "deleted" notification.
            pendingDiskDeleted = false;

            // An explicit reload request (button already handled its own dirty-check/
            // confirm) or reading mode (nothing local can be lost) applies directly —
            // the persistent toast below is only for unprompted watcher-detected changes.
            if (wasManualReload || !isEditMode) {
                pendingDiskContent = null;
                applyReloadedContent(m.content || '');
                showToast('Reloaded from disk');
                break;
            }

            pendingDiskContent = m.content || '';
            showToast('File changed on disk', {
                label: 'Reload',
                onClick: () => {
                    if (pendingDiskContent === null) {return;}
                    const applyPending = () => {
                        if (pendingDiskContent === null) {return;}
                        applyReloadedContent(pendingDiskContent);
                        pendingDiskContent = null;
                        showToast('Reloaded from disk');
                    };
                    const dirty = isEditMode && getActiveEditorContent() !== originalContent;
                    if (dirty) {
                        confirmDiscardAndReload().then((confirmed) => {
                            if (confirmed) {applyPending();}
                        });
                    } else {
                        applyPending();
                    }
                }
            }, { persistent: true, icon: 'warning' });
            updateEditToolbarButtons();
            break;
        }

        case 'reloadFromDiskError':
            if (isReloadingFromDisk) {
                isReloadingFromDisk = false;
                setButtonsEnabled(true);
            }
            showToast('Error reloading from disk', undefined, { icon: 'warning' });
            break;

        case 'diskDeletedExternally':
            pendingDiskDeleted = true;
            showToast('File deleted from disk', undefined, { persistent: true, icon: 'warning' });
            updateEditToolbarButtons();
            break;

        case 'initSettings':
            applySettings(m.settings, false);
            if (!hasEnteredPreviewEdit) {
                hasEnteredPreviewEdit = true;
                setPreviewEditMode(true);
            }
            break;

        case 'settingsUpdated':
            applySettings(m.settings, false);
            break;

        case 'saveResult':
            isSaving = false;
            setButtonsEnabled(true);
            if (m.ok) {
                showToast(m.isAutosave ? 'Autosaved' : 'Saved');
                originalContent = currentContent;
                // A successful save recreates the file if it had been deleted externally.
                pendingDiskDeleted = false;
            } else {
                showToast(m.isAutosave ? 'Autosave failed' : 'Error saving', undefined, { icon: 'warning' });
            }
            break;

        case 'saveConflict':
            isSaving = false;
            setButtonsEnabled(true);
            if (lastSaveWasAutosave) {
                // Autosave never interrupts with a dialog; the file watcher will
                // independently surface the usual "file changed on disk" toast.
                break;
            }
            confirmOverwriteConflict().then((confirmed) => {
                if (confirmed) {doSave(true);}
            });
            break;

        case 'versionHistoryError':
            showToast(m.message || 'Version history failed', undefined, { icon: 'warning' });
            break;

        case 'versionPreviewMd':
            setVersionPreviewMode(true, m.timestamp ? `Previewing ${new Date(m.timestamp).toLocaleString()} (read-only)` : 'Previewing selected version (read-only)');
            showToast('Previewing version');
            break;

        case 'versionPreviewCancelledMd':
            setVersionPreviewMode(false);
            showToast('Preview canceled');
            break;

        case 'versionRestoredMd':
            setVersionPreviewMode(false);
            showToast('Version restored');
            break;

        case 'resolvedImageUris':
            applyResolvedImageUris(m.resolved || {});
            break;
    }
});

// ===== Button Handlers =====
function wireButtons() {
    toolbarManager = new ToolbarManager('toolbar');
    toolbarManager.setHeaderHeightHook(() => syncMdHeaderHeight());

    toolbarManager.setButtons(buildToolbarButtons());
    reorderMdToolbarButtons();
}

function buildToolbarButtons(): ToolbarButton[] {
    const buttons: ToolbarButton[] = [
        {
            id: 'enableMdEditorButton',
            icon: Icons.Zap,
            label: 'Enable MD',
            tooltip: 'Enable Markdown Viewer for all Markdown files (Make Default)',
            cls: 'edit-mode-hide',
            hidden: true,
            onClick: () => {
                vscode.postMessage({ command: 'enableMdEditor' });
            }
        },
        {
            id: 'refreshButton',
            icon: Icons.Refresh,
            tooltip: 'Reload file from disk',
            cls: 'icon-only edit-mode-hide',
            onClick: () => {
                vscode.postMessage({ command: 'requestFreshData' });
            }
        },
        {
            id: 'disableMdEditorButton',
            icon: Icons.ZapOff,
            label: 'Disable MD',
            tooltip: 'Disable Markdown Viewer for all Markdown files',
            cls: 'edit-mode-hide',
            onClick: () => {
                vscode.postMessage({ command: 'disableMdEditor' });
            }
        },
        {
            id: 'reloadFromDiskButton',
            icon: Icons.Refresh,
            tooltip: 'Reload from Disk',
            cls: 'icon-only',
            hidden: true,
            onClick: () => requestReloadFromDisk()
        },
        {
            id: 'saveEditsButton',
            icon: Icons.Save,
            tooltip: 'Save Changes (Ctrl+S)',
            cls: 'icon-only',
            hidden: true,
            onClick: () => performSave()
        },
        {
            id: 'undoEditsButton',
            icon: Icons.Undo,
            tooltip: 'Undo (Ctrl+Z)',
            cls: 'icon-only',
            hidden: true,
            onClick: () => applyFormat('undo')
        },
        {
            id: 'redoEditsButton',
            icon: Icons.Redo,
            tooltip: 'Redo (Ctrl+Shift+Z)',
            cls: 'icon-only',
            hidden: true,
            onClick: () => applyFormat('redo')
        },
        {
            id: 'toggleTocButton',
            icon: Icons.Outline,
            tooltip: 'Toggle Outline',
            cls: 'icon-only',
            section: 'end',
            onClick: () => {
                currentSettings.showOutline = !currentSettings.showOutline;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'searchButton',
            icon: Icons.Search,
            tooltip: 'Search in Preview (Ctrl/Cmd+F)',
            cls: 'icon-only',
            section: 'end',
            onClick: () => toggleSearchOverlay()
        },
        {
            id: 'openSettingsButton',
            icon: Icons.Settings,
            tooltip: 'Settings',
            cls: 'icon-only',
            section: 'end',
            onClick: () => { /* Handled by wireSettingsUI */ }
        },
        {
            id: 'copyHtmlButton',
            icon: Icons.CopyHtml,
            tooltip: 'Copy as HTML',
            cls: 'icon-only edit-mode-hide',
            section: 'end',
            onClick: () => {
                const preview = $('markdownPreview');
                if (preview && navigator.clipboard) {
                    navigator.clipboard.writeText(preview.innerHTML)
                        .then(() => showToast('HTML copied'))
                        .catch(() => showToast('Copy failed', undefined, { icon: 'warning' }));
                }
            }
        },
        {
            id: 'versionHistoryButton',
            icon: Icons.VersionHistory,
            tooltip: 'Version History',
            cls: 'icon-only edit-mode-hide',
            section: 'end',
            onClick: () => {
                vscode.postMessage({ command: 'showVersionHistory' });
            }
        },
        {
            id: 'projectsButton',
            icon: Icons.Link,
            tooltip: 'Other Projects',
            cls: 'icon-only edit-mode-hide',
            section: 'end',
            onClick: () => {
                ProjectsModal.show();
            }
        },
        {
            id: 'helpButton',
            icon: Icons.Help,
            tooltip: 'Help & Feedback',
            cls: 'icon-only edit-mode-hide',
            section: 'end',
            onClick: () => {
                FeedbackModal.show();
            }
        },
    ];

    if (currentSettings.moveMdButtonsToEnd) {
        const enableButton = buttons.shift();
        const disableButton = buttons.shift();
        const helpIndex = buttons.findIndex((button) => button.id === 'helpButton');
        if (enableButton && disableButton) {
            enableButton.section = 'end';
            disableButton.section = 'end';
            if (helpIndex >= 0) {
                buttons.splice(helpIndex, 0, enableButton, disableButton);
            } else {
                buttons.push(enableButton, disableButton);
            }
        }
    }

    return buttons;
}

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    const isCmdOrCtrl = e.ctrlKey || e.metaKey;

    if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (isEditMode) {
            performSave();
        }
        return;
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleSearchOverlay();
        return;
    }

    if (e.key === 'Escape') {
        // Close lightbox first, then search, then edit mode
        const lightbox = $('lightboxOverlay');
        if (lightbox && lightbox.classList.contains('active')) {
            e.preventDefault();
            closeLightbox();
            return;
        }
        const searchOverlay = $('searchOverlay');
        if (searchOverlay && searchOverlay.classList.contains('active')) {
            e.preventDefault();
            closeSearch();
            return;
        }
        if (isEditMode) {
            e.preventDefault();
            cancelEdit();
            return;
        }
    }
});

// ===== Resizable Panels =====
function initResizeHandles() {
    const container = $('markdownContainer');
    if (!container) {return;}

    const tocHandle = document.createElement('div');
    tocHandle.className = 'resize-handle resize-handle-toc';
    tocHandle.id = 'resizeHandleToc';

    const tocPanel = $('tocPanel');
    if (tocPanel) {tocPanel.after(tocHandle);}

    wireResizeHandle(tocHandle);
}

function wireResizeHandle(handle: HTMLElement) {
    let startX = 0;
    let startLeftWidth = 0;

    function onMouseDown(e: MouseEvent) {
        e.preventDefault();
        startX = e.clientX;

        const tocPanel = $('tocPanel');
        if (tocPanel) {startLeftWidth = tocPanel.getBoundingClientRect().width;}

        document.body.classList.add('resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e: MouseEvent) {
        const dx = e.clientX - startX;
        const container = $('markdownContainer');
        if (!container) {return;}

        const newWidth = Math.max(120, Math.min(500, startLeftWidth + dx));
        container.style.setProperty('--toc-width', newWidth + 'px');
    }

    function onMouseUp() {
        document.body.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        refreshDataLineCache();
    }

    handle.addEventListener('mousedown', onMouseDown);
}

// ===== Editor Events =====
// ===== Preview Interactions =====
function wirePreviewInteractions() {
    const preview = $('markdownPreview');
    if (!preview) {return;}
    const wired = (preview as any)._wired;
    if (wired) {return;}
    (preview as any)._wired = true;

    preview.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        const copyBtn = target.closest('.code-copy') as HTMLElement | null;
        if (copyBtn) {
            e.preventDefault();
            const encoded = copyBtn.getAttribute('data-code') || '';
            const code = decodeURIComponent(encoded);
            if (navigator.clipboard) {
                navigator.clipboard.writeText(code).then(() => showToast('Copied')).catch(() => showToast('Copy failed', undefined, { icon: 'warning' }));
            }
            return;
        }

        // Heading anchor link: copy URL
        const anchorLink = target.closest('.heading-anchor') as HTMLElement | null;
        if (anchorLink) {
            e.preventDefault();
            e.stopPropagation();
            const headingId = anchorLink.getAttribute('data-heading-id');
            if (headingId && navigator.clipboard) {
                const decoded = decodeURIComponent(headingId);
                navigator.clipboard.writeText(`#${decoded}`)
                    .then(() => showToast('Link copied'))
                    .catch(() => showToast('Copy failed', undefined, { icon: 'warning' }));
            }
            return;
        }

        // Image lightbox: click to zoom
        const img = target.closest('.zoomable') as HTMLImageElement | null;
        if (img) {
            e.preventDefault();
            showLightbox(img.src, img.alt);
            return;
        }

        const link = target.closest('a') as HTMLAnchorElement | null;
        if (link && link.href) {
            const href = link.getAttribute('href') || '';

            // Handle external links
            if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ command: 'openExternal', url: href });
                return;
            }

            // Handle anchor links (same document)
            if (href.startsWith('#')) {
                // Let the browser handle anchor navigation
                return;
            }

            // Handle relative links to other files
            if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:')) {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({
                    command: 'openRelativeFile',
                    href: href,
                    documentUri: documentUri
                });
            }
        }
    });
}

function wireTocPanel() {
    const tocBody = $('tocBody');
    const closeBtn = $('tocCloseButton');

    if (tocBody) {
        tocBody.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const link = target.closest('a[data-target]') as HTMLAnchorElement | null;
            if (!link) {return;}
            e.preventDefault();
            const id = link.getAttribute('data-target') || '';
            if (!id) {return;}
            if (isLivePreviewActive()) {
                const line = tocIdToLine.get(id);
                if (line !== undefined) {scrollLivePreviewToLine(line);}
                return;
            }
            const preview = $('markdownPreview');
            const el = preview?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
            if (el) {
                el.scrollIntoView({ block: 'start', behavior: 'smooth' });
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            currentSettings.showOutline = false;
            applySettings(currentSettings, true);
        });
    }
}

// ===== Hover Tooltip =====
 
let hoverHideTimer: any = null;

function wireHoverTooltip() {
    const trigger = $('hoverPicTrigger');
    const tooltip = $('hoverTooltip');
    if (!trigger || !tooltip) {return;}

    function showTooltip() {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
        const rect = trigger!.getBoundingClientRect();
        const tooltipWidth = tooltip!.offsetWidth || 300;
        const left = Math.max(8, Math.min(window.innerWidth - tooltipWidth - 8, rect.left - 100));
        const top = rect.bottom + 8;
        tooltip!.style.top = top + 'px';
        tooltip!.style.left = left + 'px';
        tooltip!.classList.remove('hidden');
        tooltip!.classList.add('visible');
    }

    function hideTooltip() {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
        }
        tooltip!.classList.remove('visible');
        tooltip!.classList.add('hidden');
    }

    function hideTooltipDelayed() {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
        }
        hoverHideTimer = setTimeout(() => hideTooltip(), 250);
    }

    trigger.addEventListener('mouseenter', showTooltip);
    trigger.addEventListener('mouseleave', hideTooltipDelayed);
    trigger.addEventListener('focus', showTooltip);
    trigger.addEventListener('blur', hideTooltip);

    tooltip!.addEventListener('mouseenter', () => {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
    });
    tooltip!.addEventListener('mouseleave', hideTooltipDelayed);
}

// ===== Formatting Toolbar =====
const formatIconMap: Record<string, string> = {
    bold: Icons.Bold,
    italic: Icons.Italic,
    strikethrough: Icons.Strikethrough,
    inlineCode: Icons.InlineCode,
    heading1: '<span class="fmt-text-icon">H1</span>',
    heading2: '<span class="fmt-text-icon">H2</span>',
    heading3: '<span class="fmt-text-icon">H3</span>',
    bulletList: Icons.ListBullet,
    orderedList: Icons.ListOrdered,
    checkbox: Icons.Checkbox,
    blockquote: Icons.Quote,
    link: Icons.Link,
    image: Icons.Image,
    table: Icons.TableInsert,
    tableAddRowBelow: '<span class="fmt-text-icon">+R</span>',
    tableRemoveRow: '<span class="fmt-text-icon">-R</span>',
    tableAddColumnRight: '<span class="fmt-text-icon">+C</span>',
    tableRemoveColumn: '<span class="fmt-text-icon">-C</span>',
    codeBlock: Icons.CodeBlock,
    hr: Icons.HorizontalRule,
    duplicateLine: Icons.DuplicateLine,
    deleteLine: Icons.DeleteLine,
    moveUp: Icons.MoveUp,
    moveDown: Icons.MoveDown,
    uppercase: '<span class="fmt-text-icon">AB</span>',
    lowercase: '<span class="fmt-text-icon">ab</span>',
    titlecase: '<span class="fmt-text-icon">Ab</span>',
    sortLines: Icons.SortLines,
    trimWhitespace: Icons.Trim,
    jumpToLine: Icons.GoToLine,
};

function wireFormattingToolbar() {
    const fmtToolbar = $('formattingToolbar');
    if (!fmtToolbar) {return;}

    const buttons = fmtToolbar.querySelectorAll('.fmt-btn');
    buttons.forEach(btn => {
        const format = btn.getAttribute('data-format');
        if (!format) {return;}

        // Set icon
        const icon = formatIconMap[format];
        if (icon) {btn.innerHTML = icon;}

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            applyFormat(format);
        });
    });
}

// ===== Initialize =====
wireButtons();
initializeSettings();
wireFormattingToolbar();
wireDelayedToolbarTooltips();
wireHoverTooltip();
wirePreviewInteractions();
wireTocPanel();
initLightbox();
initSearchOverlay();
initScrollSpy();
initResizeHandles();
updateHeaderHeight();

// Ensure settings are applied once toolbar is ready
if (currentSettings) {
    applySettings(currentSettings);
}

if ((md as any).mermaid) {
    (md as any).mermaid.initialize({
        startOnLoad: false
    });
}

vscode.postMessage({ command: 'webviewReady' });
