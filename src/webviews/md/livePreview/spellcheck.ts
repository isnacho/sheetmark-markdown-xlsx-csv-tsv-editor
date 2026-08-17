// Dictionary-based spell check for Preview Edit (CM6).
//
// VS Code webviews do not support native browser spellcheck on contenteditable
// surfaces (microsoft/vscode#214367). We use Typo.js + @codemirror/lint for
// red underlines and suggestion actions instead.

import Typo from 'typo-js';
import { linter, forceLinting } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
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
let contextMenuEl: HTMLElement | null = null;

const WORD_RE = /[A-Za-z']+/g;
const MIN_WORD_LEN = 2;
const MAX_SUGGESTIONS = 6;

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
        if (activeView) { forceLinting(activeView); }
    }).catch(() => {
        loadPromise = null;
    });
    return loadPromise;
}

export function getSpellChecker(): Typo | null {
    return typo;
}

function buildDiagnostics(view: EditorView): Diagnostic[] {
    if (!typo) { return []; }
    const doc = view.state.doc.toString();
    const frontmatterPrefix = doc.slice(0, Math.min(doc.length, 16384));
    const frontmatter = extractFrontmatter(frontmatterPrefix);
    const exclusions = collectSpellcheckExclusionRanges(
        view.state,
        view.visibleRanges,
        frontmatter?.range ?? null,
    );
    const diags: Diagnostic[] = [];
    for (const { from, to } of view.visibleRanges) {
        const slice = doc.slice(from, to);
        WORD_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = WORD_RE.exec(slice))) {
            const word = match[0];
            if (word.length < MIN_WORD_LEN) { continue; }
            const wordFrom = from + match.index;
            const wordTo = wordFrom + word.length;
            if (rangesOverlap(wordFrom, wordTo, exclusions)) { continue; }
            if (typo.check(word)) { continue; }
            const suggestions = typo.suggest(word).slice(0, MAX_SUGGESTIONS);
            diags.push({
                from: wordFrom,
                to: wordTo,
                severity: 'error',
                source: 'spell',
                message: suggestions.length
                    ? `Spelling suggestions: ${suggestions.join(', ')}`
                    : 'Unknown word',
                actions: suggestions.map((suggestion) => ({
                    name: suggestion,
                    apply(v, wordStart, wordEnd) {
                        v.dispatch({ changes: { from: wordStart, to: wordEnd, insert: suggestion } });
                    },
                })),
            });
        }
    }
    return diags;
}

export const spellcheckLint = linter((view) => buildDiagnostics(view), { delay: 300 });

const spellcheckViewTracker = EditorView.updateListener.of((update) => {
    activeView = update.view;
});

function wordRangeAt(doc: string, pos: number): TextRange & { text: string } | null {
    if (pos < 0 || pos > doc.length) { return null; }
    let from = pos;
    let to = pos;
    while (from > 0 && /[A-Za-z']/.test(doc[from - 1] ?? '')) { from--; }
    while (to < doc.length && /[A-Za-z']/.test(doc[to] ?? '')) { to++; }
    if (to <= from) { return null; }
    const text = doc.slice(from, to);
    if (text.length < MIN_WORD_LEN) { return null; }
    return { from, to, text };
}

function hideContextMenu(): void {
    contextMenuEl?.remove();
    contextMenuEl = null;
}

function showContextMenu(
    view: EditorView,
    x: number,
    y: number,
    from: number,
    to: number,
    suggestions: readonly string[],
): void {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'cm-spell-context-menu';
    menu.setAttribute('role', 'menu');

    for (const suggestion of suggestions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cm-spell-context-item';
        btn.textContent = suggestion;
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch({ changes: { from, to, insert: suggestion } });
            view.focus();
            hideContextMenu();
        });
        menu.appendChild(btn);
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    contextMenuEl = menu;

    const close = (event: Event) => {
        if (event.target instanceof Node && menu.contains(event.target)) { return; }
        hideContextMenu();
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

export function spellcheckContextMenu(): Extension {
    return EditorView.domEventHandlers({
        contextmenu(event, view) {
            if (!typo) { return false; }
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) { return false; }
            const doc = view.state.doc.toString();
            const frontmatter = extractFrontmatter(doc);
            const word = wordRangeAt(doc, pos);
            if (!word) { return false; }
            if (isSpellcheckExcluded(word.from, word.to, view.state, frontmatter?.range ?? null)) {
                return false;
            }
            if (typo.check(word.text)) { return false; }
            const suggestions = typo.suggest(word.text).slice(0, MAX_SUGGESTIONS);
            if (!suggestions.length) { return false; }
            event.preventDefault();
            showContextMenu(view, event.clientX, event.clientY, word.from, word.to, suggestions);
            return true;
        },
    });
}

export function teardownSpellcheck(): void {
    hideContextMenu();
    activeView = null;
}

export const spellcheckExtensions: Extension[] = [
    spellcheckLint,
    spellcheckViewTracker,
    spellcheckContextMenu(),
];
