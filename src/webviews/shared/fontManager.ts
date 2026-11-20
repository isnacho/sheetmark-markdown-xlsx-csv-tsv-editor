// The font picker in both editors' Settings panels: a button that opens a searchable list under the
// Font row. The choice is the shared `xlsxViewer.fontFamily` setting: a built-in font (Inter, System,
// Serif) or any font installed on the computer. The host sends `fontFamilyChanged` on load and whenever
// the setting changes (this panel, another editor, or Settings JSON) and `localFonts` (the installed
// families, which a webview cannot list itself); each webview's message handler passes them to
// `applyFontChoice` / `applyLocalFonts`.
// The CSS stack for each built-in font lives in resources/shared/theme.css (`:root[data-font=...]`).
//
// The list opens inline, not as a floating popup: the Settings panel is a fixed box that clips and
// scrolls its content, so a popup would be cut off. It follows the ARIA combobox pattern: the search
// box has focus the whole time and points at the highlighted option with aria-activedescendant.

import type { BuiltInFont, FontChoice } from '../../protocol/common';
import { escapeMenuHtml } from './menuPanel';
import { Icons } from './icons';
import { filterFontNames } from './fontSearch';

// A Record, so adding a member to BuiltInFont fails to compile until it has a label here.
const BUILT_IN_LABELS: Record<BuiltInFont, string> = {
    inter: 'Inter',
    system: 'System',
    serif: 'Serif',
};

const DEFAULT_FONT: BuiltInFont = 'inter';
// What an installed font falls back to when it is missing on this machine (a setting copied from
// another computer, or a font that was uninstalled).
const FALLBACK_STACK = 'system-ui, -apple-system, sans-serif';
const MAX_FONT_NAME_LENGTH = 100;
const PAGE_STEP = 8;

type PickerMessage = { command: 'setFontFamily'; font: FontChoice } | { command: 'requestLocalFonts' };

let current: FontChoice = DEFAULT_FONT;
let localFonts: readonly string[] = [];
let appliedHandler: (() => void) | null = null;
let pickerId: string | null = null;
let postMessage: ((message: PickerMessage) => void) | null = null;

function isBuiltIn(value: unknown): value is BuiltInFont {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUILT_IN_LABELS, value);
}

/** The font name as a quoted CSS string, or null if it is not a usable family name. The host checks names too; this is the last line. */
function quotedFamily(name: unknown): string | null {
    if (typeof name !== 'string') { return null; }
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MAX_FONT_NAME_LENGTH || /[\u0000-\u001f\u007f"\\;{}<>]/.test(trimmed)) { return null; }
    return `"${trimmed}"`;
}

/** The value of `--font-family` for an installed font; null for a built-in font or an unusable name. */
export function installedFontStack(choice: unknown): string | null {
    if (isBuiltIn(choice)) { return null; }
    const family = quotedFamily(choice);
    return family ? `${family}, ${FALLBACK_STACK}` : null;
}

/** The settings row: "Font" and a button showing the font in use. The list under it opens when the button is pressed. */
export function renderFontSettingItem(selectId: string): string {
    const id = escapeMenuHtml(selectId);
    return `<div class="font-picker" data-font-picker="${id}">`
        + '<div class="menu-row menu-row--control setting-item theme-setting-item">'
        + '<span>Font</span>'
        + `<button type="button" id="${id}" class="theme-select font-picker__button" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}Panel" title="Font">`
        + `<span class="font-picker__value"></span>${Icons.ChevronDown}</button>`
        + '</div>'
        + `<div class="font-picker__panel hidden" id="${id}Panel">`
        + `<input type="text" id="${id}Search" class="font-picker__search" role="combobox" aria-label="Search fonts" aria-expanded="true" aria-controls="${id}List" aria-autocomplete="list" placeholder="Search fonts" autocomplete="off" autocapitalize="off" spellcheck="false">`
        + `<div class="font-picker__list" id="${id}List" role="listbox" aria-label="Fonts"></div>`
        + `<div class="font-picker__empty hidden" id="${id}Empty" role="status">No fonts match</div>`
        + '</div>'
        + '</div>';
}

/** The font in use now (Inter until the host says otherwise). */
export function currentFontChoice(): FontChoice {
    return current;
}

/**
 * Run `handler` after every font change, once the new font is applied. An editor uses it to redo
 * anything measured in the old font (column widths, editor line measurements).
 */
export function onFontApplied(handler: () => void): void {
    appliedHandler = handler;
}

// ---------------------------------------------------------------------------------------------
// The picker's DOM

interface PickerElements {
    id: string;
    button: HTMLButtonElement;
    value: HTMLElement;
    panel: HTMLElement;
    search: HTMLInputElement;
    list: HTMLElement;
    empty: HTMLElement;
}

function pickerElements(): PickerElements | null {
    if (!pickerId) { return null; }
    const id = pickerId;
    const button = document.getElementById(id) as HTMLButtonElement | null;
    const panel = document.getElementById(`${id}Panel`);
    const search = document.getElementById(`${id}Search`) as HTMLInputElement | null;
    const list = document.getElementById(`${id}List`);
    const empty = document.getElementById(`${id}Empty`);
    const value = button?.querySelector<HTMLElement>('.font-picker__value');
    if (!button || !panel || !search || !list || !empty || !value) { return null; }
    return { id, button, value, panel, search, list, empty };
}

interface FontOption { value: string; label: string }
interface FontGroup { label: string; options: FontOption[] }

/** The groups of fonts that match `query`; groups with no match are left out. */
function fontGroups(query: string): FontGroup[] {
    const matching = (options: FontOption[]): FontOption[] => {
        const byLabel = new Map(options.map(option => [option.label, option] as const));
        return filterFontNames(options.map(option => option.label), query).map(label => byLabel.get(label)!);
    };

    const groups: FontGroup[] = [
        { label: 'Built in', options: matching((Object.keys(BUILT_IN_LABELS) as BuiltInFont[]).map(value => ({ value, label: BUILT_IN_LABELS[value] }))) },
    ];
    // A font that is in use but not on the list (a setting made on another computer, or a remote window) still has to show as chosen.
    if (!isBuiltIn(current) && !localFonts.includes(current)) {
        groups.push({ label: 'In use', options: matching([{ value: current, label: current }]) });
    }
    groups.push({ label: 'Installed on this computer', options: matching(localFonts.map(name => ({ value: name, label: name }))) });
    return groups.filter(group => group.options.length > 0);
}

function optionElements(els: PickerElements): HTMLElement[] {
    return Array.from(els.list.querySelectorAll<HTMLElement>('[role="option"]'));
}

function setActive(els: PickerElements, option: HTMLElement | null, scroll = true): void {
    els.list.querySelectorAll('.is-active').forEach(el => el.classList.remove('is-active'));
    if (!option) {
        els.search.removeAttribute('aria-activedescendant');
        return;
    }
    option.classList.add('is-active');
    els.search.setAttribute('aria-activedescendant', option.id);
    if (scroll) { option.scrollIntoView({ block: 'nearest' }); }
}

/** Fill the list for `query`. With no query the font in use is highlighted; otherwise the best match. */
function renderList(els: PickerElements, query: string): void {
    els.list.textContent = '';
    let optionCount = 0;
    fontGroups(query).forEach((group, groupIndex) => {
        const groupEl = document.createElement('div');
        groupEl.setAttribute('role', 'group');
        const labelEl = document.createElement('div');
        labelEl.className = 'font-picker__group-label';
        labelEl.id = `${els.id}Group${groupIndex}`;
        labelEl.textContent = group.label;
        groupEl.setAttribute('aria-labelledby', labelEl.id);
        groupEl.appendChild(labelEl);
        for (const option of group.options) {
            const el = document.createElement('div');
            el.id = `${els.id}Option${optionCount++}`;
            el.className = 'font-picker__option';
            el.setAttribute('role', 'option');
            el.setAttribute('aria-selected', String(option.value === current));
            el.dataset.value = option.value;
            el.title = option.label;
            el.textContent = option.label;
            groupEl.appendChild(el);
        }
        els.list.appendChild(groupEl);
    });
    els.empty.classList.toggle('hidden', optionCount > 0);

    const options = optionElements(els);
    const selected = query.trim() ? undefined : options.find(option => option.getAttribute('aria-selected') === 'true');
    setActive(els, selected ?? options[0] ?? null);
}

function isOpen(els: PickerElements): boolean {
    return !els.panel.classList.contains('hidden');
}

function openPicker(els: PickerElements): void {
    if (isOpen(els)) { return; }
    els.panel.classList.remove('hidden');
    els.button.setAttribute('aria-expanded', 'true');
    els.search.value = '';
    renderList(els, '');
    els.search.focus();
    els.panel.scrollIntoView({ block: 'nearest' });
}

function closePicker(els: PickerElements, returnFocus: boolean): void {
    if (!isOpen(els)) { return; }
    els.panel.classList.add('hidden');
    els.button.setAttribute('aria-expanded', 'false');
    if (returnFocus) { els.button.focus(); }
}

/** Keep the button's label, and the list if it is open, in step with the font in use. */
function refreshPicker(): void {
    const els = pickerElements();
    if (!els) { return; }
    const label = isBuiltIn(current) ? BUILT_IN_LABELS[current] : current;
    els.value.textContent = label;
    els.button.title = `Font: ${label}`;
    if (isOpen(els)) { renderList(els, els.search.value); }
}

function chooseFont(els: PickerElements, value: string): void {
    // Close first: applying the font redraws an open list, and a click on a redrawn option would
    // look like a click outside the Settings panel and close it.
    closePicker(els, true);
    applyFontChoice(value);
    postMessage?.({ command: 'setFontFamily', font: value });
}

function onSearchKeydown(els: PickerElements, event: KeyboardEvent): void {
    const options = optionElements(els);
    const active = options.findIndex(option => option.classList.contains('is-active'));
    const moveTo = (index: number) => {
        event.preventDefault();
        event.stopPropagation();
        setActive(els, options[Math.max(0, Math.min(options.length - 1, index))] ?? null);
    };

    switch (event.key) {
        case 'ArrowDown': moveTo(active + 1); break;
        case 'ArrowUp': moveTo(active < 0 ? 0 : active - 1); break;
        case 'PageDown': moveTo(active + PAGE_STEP); break;
        case 'PageUp': moveTo(active - PAGE_STEP); break;
        case 'Enter': {
            event.preventDefault();
            event.stopPropagation();
            const value = options[active]?.dataset.value;
            if (value) { chooseFont(els, value); }
            break;
        }
        case 'Escape':
            // Closes the list only; a second Escape closes the Settings panel.
            event.preventDefault();
            event.stopPropagation();
            closePicker(els, true);
            break;
        case 'Tab':
            closePicker(els, false);
            break;
    }
}

// ---------------------------------------------------------------------------------------------
// Applying fonts

/** Show the installed fonts in the picker (the host's `localFonts` message). */
export function applyLocalFonts(fonts: unknown): void {
    localFonts = Array.isArray(fonts) ? fonts.filter((name): name is string => quotedFamily(name) !== null && !isBuiltIn(name)) : [];
    refreshPicker();
}

/** Use `font` everywhere: built-in fonts through `data-font` on <html>, installed ones through `--font-family`. */
export function applyFontChoice(font: unknown): void {
    const root = document.documentElement;
    const stack = installedFontStack(font);
    const choice: FontChoice = isBuiltIn(font) ? font : stack ? (font as string).trim() : DEFAULT_FONT;
    const changed = choice !== current || root.dataset.font === undefined;
    current = choice;

    if (stack) {
        root.dataset.font = 'custom';
        root.style.setProperty('--font-family', stack);
    } else {
        root.dataset.font = choice;
        root.style.removeProperty('--font-family');
    }
    refreshPicker();
    if (!changed) { return; }

    // Bundled Inter may not be loaded yet (the page was using another font), and measuring before it
    // is would use the fallback's widths. Wait for the font, then let the editor re-measure.
    const family = getComputedStyle(root).getPropertyValue('--font-family');
    const done = () => appliedHandler?.();
    document.fonts.load(`13px ${family}`).then(done, done);
}

/**
 * Wire the picker rendered by `renderFontSettingItem` and ask the host for the installed fonts.
 * Choosing a font applies it straight away and asks the host to save it as the shared setting;
 * `post` is the editor's typed `post`.
 */
export function wireFontPicker(selectId: string, post: (message: PickerMessage) => void): void {
    pickerId = selectId;
    postMessage = post;
    const els = pickerElements();
    if (!els) { return; }
    refreshPicker();

    els.button.addEventListener('click', () => {
        if (isOpen(els)) { closePicker(els, true); } else { openPicker(els); }
    });
    els.button.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            openPicker(els);
        }
    });

    els.search.addEventListener('input', () => renderList(els, els.search.value));
    els.search.addEventListener('keydown', event => onSearchKeydown(els, event));

    // Mouse: keep focus in the search box, highlight what the pointer is over, choose on click.
    const optionAt = (event: Event) => (event.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    els.list.addEventListener('mousedown', event => { if (optionAt(event)) { event.preventDefault(); } });
    els.list.addEventListener('mousemove', event => {
        const option = optionAt(event);
        if (option && !option.classList.contains('is-active')) { setActive(els, option, false); }
    });
    els.list.addEventListener('click', event => {
        const value = optionAt(event)?.dataset.value;
        if (value) { chooseFont(els, value); }
    });

    // A click anywhere else in the page (including the gear that closes Settings) folds the list away.
    document.addEventListener('click', event => {
        if (isOpen(els) && !(event.target as HTMLElement).closest('[data-font-picker]')) { closePicker(els, false); }
    });

    post({ command: 'requestLocalFonts' });
}
