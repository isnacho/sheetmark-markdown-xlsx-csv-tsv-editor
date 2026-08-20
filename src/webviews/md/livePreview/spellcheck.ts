// Dictionary-based spell check for Preview Edit (CM6).
//
// VS Code webviews do not support native browser spellcheck on contenteditable
// surfaces (microsoft/vscode#214367). We use Typo.js + @codemirror/lint for
// red underlines and suggestion actions instead.
//
// PERFORMANCE — the one rule for this file. Measured against
// `resources/spell/en_US.dic` (551KB): `typo.check()` costs ~0.02ms per word,
// but `typo.suggest()` costs **100-460ms per word** (it walks edit-distance
// candidates across the alphabet and dictionary-checks every one). A lint pass
// covers a whole viewport, and a technical Markdown file has plenty of words no
// dictionary knows (identifiers, product names, filenames), so calling
// `suggest()` while building diagnostics froze the editor for seconds per
// keystroke. A lint pass must therefore only ever `check()`. Suggestions are
// computed lazily, for one word, when the user hovers the underline or
// right-clicks it — never in bulk.

import Typo from 'typo-js';
import { linter, forceLinting } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { extractFrontmatter } from '../frontmatter';
import {
    collectSpellcheckExclusionRanges,
    isSpellcheckExcluded,
    rangesOverlap,
    type TextRange,
} from './spellcheckExclusions';

declare global {
    interface Window {
        __SPELL_DICT__?: { aff: string; dic: string };
    }
}

let typo: Typo | null = null;
let loadPromise: Promise<void> | null = null;
let activeView: EditorView | null = null;
let suggestionMenuEl: HTMLElement | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hoverWordKey: string | null = null;

const WORD_RE = /[A-Za-z']+/g;
const WORD_CHAR_RE = /[A-Za-z']/;
const MIN_WORD_LEN = 2;
const MAX_SUGGESTIONS = 6;
const HOVER_DELAY_MS = 400;
const HOVER_HIDE_DELAY_MS = 150;
/** Frontmatter can only open the document — cap how much we scan looking for it. */
const FRONTMATTER_SCAN_LIMIT = 16384;

// Dictionary answers never change within a session, so both caches are plain
// flush-when-full maps. `checkCache` turns a re-lint of already-seen text into
// pure map lookups; `suggestCache` makes a second hover on the same word free.
const MAX_CACHE_ENTRIES = 20000;
const checkCache = new Map<string, boolean>();
const suggestCache = new Map<string, string[]>();

function isSpelledCorrectly(word: string): boolean {
    const cached = checkCache.get(word);
    if (cached !== undefined) { return cached; }
    const ok = !!typo?.check(word);
    if (checkCache.size >= MAX_CACHE_ENTRIES) { checkCache.clear(); }
    checkCache.set(word, ok);
    return ok;
}

/** Expensive on a cache miss (100-460ms). Only call from a user-initiated interaction. */
function suggestionsFor(word: string): string[] {
    const cached = suggestCache.get(word);
    if (cached) { return cached; }
    const suggestions = typo ? typo.suggest(word).slice(0, MAX_SUGGESTIONS) : [];
    if (suggestCache.size >= MAX_CACHE_ENTRIES) { suggestCache.clear(); }
    suggestCache.set(word, suggestions);
    return suggestions;
}

export function loadSpellDictionary(): Promise<void> {
    if (typo) { return Promise.resolve(); }
    if (loadPromise) { return loadPromise; }
    const urls = window.__SPELL_DICT__;
    if (!urls) { return Promise.resolve(); }
    loadPromise = Promise.all([
        fetch(urls.aff).then((r) => {
            if (!r.ok) { throw new Error('spell aff fetch failed'); }
            return r.text();
        }),
        fetch(urls.dic).then((r) => {
            if (!r.ok) { throw new Error('spell dic fetch failed'); }
            return r.text();
        }),
    ]).then(([aff, dic]) => {
        typo = new Typo('en_US', aff, dic);
        checkCache.clear();
        suggestCache.clear();
        if (activeView) { forceLinting(activeView); }
    }).catch(() => {
        loadPromise = null;
    });
    return loadPromise;
}

export function getSpellChecker(): Typo | null {
    return typo;
}

function frontmatterRange(state: EditorState): TextRange | null {
    const prefix = state.doc.sliceString(0, Math.min(state.doc.length, FRONTMATTER_SCAN_LIMIT));
    return extractFrontmatter(prefix)?.range ?? null;
}

function createSuggestionMenuShell(): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'menu-panel menu-panel--popover spell-suggestion-menu';
    menu.setAttribute('role', 'menu');
    return menu;
}

function appendSuggestionMenuRows(
    menu: HTMLElement,
    suggestions: readonly string[],
    onSelect: (suggestion: string) => void,
): void {
    for (const suggestion of suggestions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu-row';
        btn.setAttribute('role', 'menuitem');
        const label = document.createElement('span');
        label.textContent = suggestion;
        btn.appendChild(label);
        btn.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelect(suggestion);
        });
        menu.appendChild(btn);
    }
}

function clearHoverTimer(): void {
    if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
    }
}

function hideSuggestionMenu(): void {
    clearHoverTimer();
    suggestionMenuEl?.remove();
    suggestionMenuEl = null;
    hoverWordKey = null;
}

function showSuggestionMenu(
    view: EditorView,
    x: number,
    y: number,
    from: number,
    to: number,
    suggestions: readonly string[] | 'loading',
): void {
    hideSuggestionMenu();
    const menu = createSuggestionMenuShell();

    if (suggestions === 'loading') {
        const loading = document.createElement('div');
        loading.className = 'menu-panel__empty';
        loading.textContent = 'Finding suggestions…';
        menu.appendChild(loading);
    } else if (!suggestions.length) {
        const empty = document.createElement('div');
        empty.className = 'menu-panel__empty';
        empty.textContent = 'No suggestions';
        menu.appendChild(empty);
    } else {
        appendSuggestionMenuRows(menu, suggestions, (suggestion) => {
            view.dispatch({ changes: { from, to, insert: suggestion } });
            view.focus();
            hideSuggestionMenu();
        });
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    suggestionMenuEl = menu;

    const close = (event: Event) => {
        if (event.target instanceof Node && menu.contains(event.target)) { return; }
        hideSuggestionMenu();
        document.removeEventListener('mousedown', close, true);
        document.removeEventListener('scroll', close, true);
        window.removeEventListener('resize', close, true);
    };
    requestAnimationFrame(() => {
        document.addEventListener('mousedown', close, true);
        document.addEventListener('scroll', close, true);
        window.addEventListener('resize', close, true);
    });
}

function wordRangeAt(state: EditorState, pos: number): (TextRange & { text: string }) | null {
    if (pos < 0 || pos > state.doc.length) { return null; }
    // A word never spans lines, so the line is the whole search window — no need
    // to materialize the document.
    const line = state.doc.lineAt(pos);
    const text = line.text;
    let from = pos - line.from;
    let to = from;
    while (from > 0 && WORD_CHAR_RE.test(text[from - 1] ?? '')) { from--; }
    while (to < text.length && WORD_CHAR_RE.test(text[to] ?? '')) { to++; }
    if (to <= from) { return null; }
    const word = text.slice(from, to);
    if (word.length < MIN_WORD_LEN) { return null; }
    return { from: line.from + from, to: line.from + to, text: word };
}

function misspelledWordAt(view: EditorView, pos: number): (TextRange & { text: string }) | null {
    const word = wordRangeAt(view.state, pos);
    if (!word) { return null; }
    if (isSpellcheckExcluded(word.from, word.to, view.state, frontmatterRange(view.state))) { return null; }
    if (isSpelledCorrectly(word.text)) { return null; }
    return word;
}

function menuCoordsForWord(view: EditorView, word: TextRange): { x: number; y: number } | null {
    const coords = view.coordsAtPos(word.from);
    if (!coords) { return null; }
    return { x: coords.left, y: coords.bottom + 4 };
}

function scheduleHoverMenu(view: EditorView, word: TextRange & { text: string }): void {
    clearHoverTimer();
    const key = `${word.from}:${word.to}`;
    hoverWordKey = key;
    hoverTimer = setTimeout(() => {
        hoverTimer = null;
        const coords = menuCoordsForWord(view, word);
        if (!coords) { return; }
        showSuggestionMenu(view, coords.x, coords.y, word.from, word.to, 'loading');
        const suggestions = suggestionsFor(word.text);
        showSuggestionMenu(view, coords.x, coords.y, word.from, word.to, suggestions);
    }, HOVER_DELAY_MS);
}

function buildDiagnostics(view: EditorView): Diagnostic[] {
    if (!typo) { return []; }
    const { state } = view;
    const exclusions = collectSpellcheckExclusionRanges(
        state,
        view.visibleRanges,
        frontmatterRange(state),
    );
    const diags: Diagnostic[] = [];
    const seenRanges = new Set<string>();
    for (const { from, to } of view.visibleRanges) {
        const slice = state.doc.sliceString(from, to);
        WORD_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = WORD_RE.exec(slice))) {
            const word = match[0];
            if (word.length < MIN_WORD_LEN) { continue; }
            const wordFrom = from + match.index;
            const wordTo = wordFrom + word.length;
            const rangeKey = `${wordFrom}:${wordTo}`;
            if (seenRanges.has(rangeKey)) { continue; }
            if (rangesOverlap(wordFrom, wordTo, exclusions)) { continue; }
            if (isSpelledCorrectly(word)) { continue; }
            seenRanges.add(rangeKey);
            diags.push({
                from: wordFrom,
                to: wordTo,
                severity: 'error',
                message: '',
            });
        }
    }
    return diags;
}

export const spellcheckLint = linter((view) => buildDiagnostics(view), {
    delay: 300,
    // CM6 lint hover wraps content in its own tooltip chrome — we show suggestions
    // via our menu-panel popover instead (hover + right-click handlers below).
    tooltipFilter: () => null as unknown as Diagnostic[],
    // Diagnostics only cover the viewport, so scrolling into unlinted text has
    // to re-run the pass. Lint coalesces repeat triggers behind `delay`, and a
    // pass is check()-only now, so this stays cheap.
    needsRefresh: (update) => update.viewportChanged,
});

const spellcheckViewTracker = EditorView.updateListener.of((update) => {
    activeView = update.view;
    if (update.docChanged || update.viewportChanged) {
        hideSuggestionMenu();
    }
});

export function spellcheckSuggestionMenu(): Extension {
    return EditorView.domEventHandlers({
        mousemove(event, view) {
            if (!typo) { return false; }
            if (suggestionMenuEl?.contains(event.target as Node)) { return false; }

            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) {
                clearHoverTimer();
                hoverTimer = setTimeout(hideSuggestionMenu, HOVER_HIDE_DELAY_MS);
                return false;
            }

            const word = misspelledWordAt(view, pos);
            if (!word) {
                clearHoverTimer();
                hoverTimer = setTimeout(hideSuggestionMenu, HOVER_HIDE_DELAY_MS);
                return false;
            }

            const key = `${word.from}:${word.to}`;
            if (suggestionMenuEl && hoverWordKey === key) { return false; }

            scheduleHoverMenu(view, word);
            return false;
        },
        contextmenu(event, view) {
            if (!typo) { return false; }
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) { return false; }
            const word = misspelledWordAt(view, pos);
            if (!word) { return false; }
            event.preventDefault();
            showSuggestionMenu(view, event.clientX, event.clientY, word.from, word.to, suggestionsFor(word.text));
            return true;
        },
    });
}

export function teardownSpellcheck(): void {
    hideSuggestionMenu();
    activeView = null;
}

export const spellcheckExtensions: Extension[] = [
    spellcheckLint,
    spellcheckViewTracker,
    spellcheckSuggestionMenu(),
];
