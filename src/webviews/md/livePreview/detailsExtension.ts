// Toggle (`<details>`) blocks in Preview Edit, Notion style: the tag lines never show, the title is
// an ordinary Markdown block, a chevron in the left margin opens and closes the body, and a hover
// handle opens a small menu. Runtime: WEBVIEW.
//
// Deliberately NOT inside revealCompartment: hiding must work whether or not the "reveal syntax"
// setting is on, and reconfiguring that compartment would reset these fields. Block replace
// decorations must come from a StateField (a ViewPlugin cannot provide them).

import { EditorSelection, EditorState, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { findDetailsBlocks, isDetailsOpen } from './detailsTypes';
import type { DetailsBlock, Range } from './detailsTypes';
import { computeDeleteToggle, computeSetStartOpen, computeUnwrapToggle, structureEdit } from './detailsEditing';
import { toggleInputHandler } from './toggleInputRules';

/** Open/closed choices by block id; ids absent here use the block's own `open` attribute. */
export type DetailsOpenState = Readonly<Record<string, boolean>>;

interface SetDetailsOpen { id: string; open: boolean; initiallyOpen: boolean; }

export const setDetailsOpenEffect = StateEffect.define<SetDetailsOpen>();
/** Replace the whole map (host reload). */
export const replaceDetailsStateEffect = StateEffect.define<DetailsOpenState>();

export const detailsOpenField = StateField.define<DetailsOpenState>({
    create: () => ({}),
    update(value, tr) {
        let next = value;
        for (const effect of tr.effects) {
            if (effect.is(replaceDetailsStateEffect)) {
                next = { ...effect.value };
            } else if (effect.is(setDetailsOpenEffect)) {
                const { id, open, initiallyOpen } = effect.value;
                const copy = { ...next };
                if (open === initiallyOpen) { delete copy[id]; } else { copy[id] = open; }
                next = copy;
            }
        }
        return next;
    },
});

export function seedDetailsOpenState(initial: DetailsOpenState): ReturnType<typeof detailsOpenField.init> {
    return detailsOpenField.init(() => ({ ...initial }));
}

let onStateChanged: ((state: DetailsOpenState) => void) | undefined;
/** mdWebview.ts persists the new map to the host. */
export function setDetailsStateCallback(cb: ((state: DetailsOpenState) => void) | undefined): void {
    onStateChanged = cb;
}

const MAX_DEPTH_CLASS = 6;
const depthClass = (depth: number) => `cm-md-details-d${Math.min(depth, MAX_DEPTH_CLASS)}`;

function findBlock(view: EditorView, id: string): DetailsBlock | undefined {
    return findDetailsBlocks(view.state.doc, view.state).find((b) => b.id === id);
}

/** Open or close a block. Closing with the cursor in the body would instantly re-show it, so park the cursor on the title. */
function setOpen(view: EditorView, block: DetailsBlock, open: boolean): void {
    const sel = view.state.selection.main;
    const inBody = block.bodyFrom !== null && sel.to >= block.bodyFrom && sel.from <= block.bodyTo!;
    view.dispatch({
        effects: setDetailsOpenEffect.of({ id: block.id, open, initiallyOpen: block.initiallyOpen }),
        ...(!open && inBody ? { selection: EditorSelection.cursor(block.titleTo) } : {}),
    });
    onStateChanged?.(view.state.field(detailsOpenField));
}

class HiddenRunWidget extends WidgetType {
    eq(): boolean { return true; }
    get estimatedHeight(): number { return 0; }
    ignoreEvent(): boolean { return true; }
    toDOM(): HTMLElement {
        const el = document.createElement('div');
        el.className = 'cm-md-details-run';
        el.setAttribute('aria-hidden', 'true');
        return el;
    }
}
const HIDDEN_RUN = new HiddenRunWidget();

class ChevronWidget extends WidgetType {
    constructor(private readonly id: string, private readonly open: boolean) { super(); }
    eq(other: ChevronWidget): boolean { return other.id === this.id && other.open === this.open; }
    ignoreEvent(): boolean { return true; }
    toDOM(view: EditorView): HTMLElement {
        const el = document.createElement('span');
        el.className = `cm-md-details-chevron${this.open ? ' is-open' : ''}`;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', this.open ? 'Collapse toggle' : 'Expand toggle');
        el.setAttribute('aria-expanded', String(this.open));
        // A drawn triangle, not a text glyph: a glyph's box is off-centre, so rotating it would make the arrow shift.
        el.innerHTML = '<svg viewBox="0 0 8 10" aria-hidden="true"><polygon points="1,1 7,5 1,9" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
        el.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const block = findBlock(view, this.id);
            if (block) { setOpen(view, block, !this.open); }
        });
        return el;
    }
}

class HandleWidget extends WidgetType {
    constructor(private readonly id: string) { super(); }
    eq(other: HandleWidget): boolean { return other.id === this.id; }
    ignoreEvent(): boolean { return true; }
    toDOM(view: EditorView): HTMLElement {
        const el = document.createElement('span');
        el.className = 'cm-md-details-handle';
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', 'Toggle options');
        // Six drawn dots (Notion's grip), centred like the arrow's triangle; a text glyph such as
        // the vertical ellipsis sits low in its box.
        el.innerHTML = '<svg viewBox="0 0 10 16" aria-hidden="true">'
            + [3, 8, 13].map(y => `<circle cx="3" cy="${y}" r="1.5"/><circle cx="7" cy="${y}" r="1.5"/>`).join('')
            + '</svg>';
        el.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showToggleMenu(view, this.id, el.getBoundingClientRect());
        });
        return el;
    }
}

// ----- Menu (singleton on document.body, same look as the table context menu) -----

let menuEl: HTMLElement | null = null;

function hideToggleMenu(): void { menuEl?.classList.add('hidden'); }

function ensureToggleMenu(): HTMLElement {
    if (menuEl) { return menuEl; }
    const menu = document.createElement('div');
    menu.className = 'cm-md-table-context-menu cm-md-details-menu hidden';
    document.body.appendChild(menu);
    menuEl = menu;
    document.addEventListener('mousedown', (event) => {
        if (menuEl && !menuEl.classList.contains('hidden') && event.target instanceof Node && !menuEl.contains(event.target)) { hideToggleMenu(); }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { hideToggleMenu(); }
    });
    return menu;
}

function dispatchStructure(view: EditorView, spec: TransactionSpec): void {
    view.dispatch({ ...spec, annotations: [structureEdit.of(true)], userEvent: 'input.toggle' });
}

function showToggleMenu(view: EditorView, id: string, anchor: DOMRect): void {
    const block = findBlock(view, id);
    if (!block) { return; }
    const menu = ensureToggleMenu();
    menu.innerHTML = '';
    const readOnly = view.state.readOnly;
    const items: { label: string; run: (b: DetailsBlock) => void; edits: boolean }[] = [
        { label: 'Turn into text', edits: true, run: (b) => dispatchStructure(view, computeUnwrapToggle(view.state, b)) },
        {
            label: block.initiallyOpen ? 'Start closed' : 'Start open',
            edits: true,
            run: (b) => {
                const spec = computeSetStartOpen(view.state, b, !b.initiallyOpen);
                if (!spec) { return; }
                dispatchStructure(view, {
                    ...spec,
                    effects: setDetailsOpenEffect.of({ id: b.id, open: !b.initiallyOpen, initiallyOpen: !b.initiallyOpen }),
                });
                onStateChanged?.(view.state.field(detailsOpenField));
            },
        },
        { label: 'Delete toggle', edits: true, run: (b) => dispatchStructure(view, computeDeleteToggle(view.state, b)) },
    ];
    for (const item of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cm-md-table-context-item';
        btn.innerHTML = '<span class="cm-md-table-context-label"></span>';
        btn.querySelector('.cm-md-table-context-label')!.textContent = item.label;
        btn.disabled = item.edits && readOnly;
        btn.addEventListener('click', () => {
            hideToggleMenu();
            const fresh = findBlock(view, id);
            if (fresh) { item.run(fresh); }
            view.focus();
        });
        menu.appendChild(btn);
    }
    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(Math.max(8, anchor.left), window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(Math.max(8, anchor.bottom + 4), window.innerHeight - rect.height - 8)}px`;
}

// ----- Decorations -----

function selectionTouches(state: EditorState, from: number, to: number): boolean {
    return state.selection.ranges.some((r) => r.to >= from && r.from <= to);
}

interface DetailsDecorations {
    decos: DecorationSet;
    /** Ranges the cursor must skip: each hidden run plus the line break before it, so no ghost cursor spot is left. */
    atomic: DecorationSet;
    /** The document has at least one toggle: the editor reserves room in its left margin for the arrows. */
    hasToggles: boolean;
}

const EMPTY: DetailsDecorations = { decos: Decoration.none, atomic: Decoration.none, hasToggles: false };

/** Pure: decorations for the document, given the user's open/closed choices. Exported for tests. */
export function computeDetailsDecorations(state: EditorState, userState: DetailsOpenState): DetailsDecorations {
    const blocks = findDetailsBlocks(state.doc, state);
    if (blocks.length === 0) { return EMPTY; }
    const decos = [];
    const atomic = [];
    const bodyDepth = new Map<number, number>();
    const titleLines = new Set<number>();
    let hiddenUntil = -1;

    // The replace ends at the last hidden line's END, not at the next line's start: CodeMirror drops line
    // decorations and widgets that sit exactly where a block replace ends. The cursor still never stops
    // between the two positions, because the atomic range spans from the previous line's end to the next line's start.
    const hideBlockRun = (run: Range) => {
        if (run.from >= run.to) { return; }
        const end = state.doc.sliceString(run.to - 1, run.to) === '\n' ? run.to - 1 : run.to;
        decos.push(Decoration.replace({ block: true, widget: HIDDEN_RUN }).range(run.from, end));
        atomic.push(Decoration.mark({}).range(Math.max(0, run.from - 1), run.to));
    };

    for (const block of blocks) {
        if (block.headRun.from < hiddenUntil) { continue; }
        const open = isDetailsOpen(block, userState);
        const hasBody = block.bodyFrom !== null;
        const hide = !open && hasBody && !selectionTouches(state, block.bodyFrom!, block.bodyTo!);

        hideBlockRun(block.headRun);
        if (block.tailRun) { hideBlockRun(block.tailRun); }
        for (const r of block.inlineHidden) {
            if (r.from >= r.to) { continue; }
            decos.push(Decoration.replace({}).range(r.from, r.to));
            atomic.push(Decoration.mark({}).range(r.from, r.to));
        }

        const first = state.doc.lineAt(block.titleFrom).number;
        const last = state.doc.lineAt(block.titleTo).number;
        for (let n = first; n <= last; n++) {
            titleLines.add(n);
            decos.push(Decoration.line({ class: `cm-md-details-title-line ${depthClass(block.depth)}` }).range(state.doc.line(n).from));
        }
        decos.push(Decoration.widget({ widget: new HandleWidget(block.id), side: -2 }).range(block.titleFrom));
        decos.push(Decoration.widget({ widget: new ChevronWidget(block.id, open), side: -1 }).range(block.titleFrom));

        if (hide) {
            decos.push(Decoration.replace({ block: true, widget: HIDDEN_RUN }).range(block.bodyFrom!, block.bodyTo!));
            atomic.push(Decoration.mark({}).range(Math.max(0, block.bodyFrom! - 1), block.closerRun.from));
            hiddenUntil = block.closerRun.to;
        } else if (hasBody) {
            const firstBody = state.doc.lineAt(block.bodyFrom!).number;
            const lastBody = state.doc.lineAt(block.bodyTo!).number;
            for (let n = firstBody; n <= lastBody; n++) { bodyDepth.set(n, block.depth + 1); }
        }
        hideBlockRun(block.closerRun);
    }

    for (const [n, depth] of bodyDepth) {
        if (titleLines.has(n)) { continue; }
        decos.push(Decoration.line({ class: `cm-md-details-body ${depthClass(depth)}` }).range(state.doc.line(n).from));
    }
    return { decos: Decoration.set(decos, true), atomic: Decoration.set(atomic, true), hasToggles: true };
}

const detailsField = StateField.define<DetailsDecorations>({
    create: (state) => computeDetailsDecorations(state, state.field(detailsOpenField)),
    update(value, tr) {
        const stateChanged = tr.startState.field(detailsOpenField) !== tr.state.field(detailsOpenField);
        if (tr.docChanged || tr.selection || stateChanged) {
            return computeDetailsDecorations(tr.state, tr.state.field(detailsOpenField));
        }
        return value;
    },
    provide: (field) => [
        EditorView.decorations.from(field, (v) => v.decos),
        EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
        EditorView.contentAttributes.of((view) => (view.state.field(field).hasToggles ? { class: 'cm-md-has-toggles' } : null)),
    ],
});

// ----- Structure guard and keys -----

interface Protected { from: number; to: number; blockFrom: number; blockTo: number; }

/** Characters no user edit may partly delete: hidden runs plus the line break in front of each. */
function protectedRanges(state: EditorState): Protected[] {
    const out: Protected[] = [];
    for (const b of findDetailsBlocks(state.doc, state)) {
        // Selecting the block's text from its first tag to its last tag is a whole-block edit.
        const blockFrom = b.headRun.from;
        const blockTo = state.doc.line(b.closeLine).to;
        const runs: Range[] = [b.headRun, b.closerRun, ...(b.tailRun ? [b.tailRun] : [])];
        for (const r of runs) { out.push({ from: Math.max(0, r.from - 1), to: r.to, blockFrom, blockTo }); }
        for (const r of b.inlineHidden) { out.push({ from: r.from, to: r.to, blockFrom, blockTo }); }
    }
    return out;
}

const structureGuard = EditorState.changeFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(structureEdit)) { return true; }
    const event = tr.annotation(Transaction.userEvent);
    if (event && (event.startsWith('undo') || event.startsWith('redo'))) { return true; }
    const prot = protectedRanges(tr.startState);
    if (prot.length === 0) { return true; }
    let ok = true;
    tr.changes.iterChangedRanges((fromA, toA) => {
        for (const p of prot) {
            const insertion = fromA === toA;
            const hits = insertion ? p.from < fromA && fromA < p.to : fromA < p.to && toA > p.from;
            if (hits && !(fromA <= p.blockFrom && toA >= p.blockTo)) { ok = false; }
        }
    });
    return ok;
});

function atomicRangesOf(view: EditorView): Range[] {
    const out: Range[] = [];
    view.state.field(detailsField).atomic.between(0, view.state.doc.length, (from, to) => { out.push({ from, to }); });
    return out;
}

function titleBlockAt(view: EditorView, pos: number): DetailsBlock | undefined {
    return findDetailsBlocks(view.state.doc, view.state).find((b) => pos >= b.titleFrom && pos <= b.titleTo);
}

function openBlock(view: EditorView, block: DetailsBlock): void {
    if (!isDetailsOpen(block, view.state.field(detailsOpenField))) { setOpen(view, block, true); }
}

/**
 * Enter in a title moves into the body (opening it). The cursor goes on a new empty line above the
 * existing body, so typing never glues onto the first body line; a body that already starts with an
 * empty line, or a body-less toggle, just gets the cursor on an empty line.
 */
function enterInTitle(view: EditorView): boolean {
    const sel = view.state.selection.main;
    if (!sel.empty || view.state.readOnly) { return false; }
    const block = titleBlockAt(view, sel.head);
    if (!block) { return false; }
    openBlock(view, block);
    const fresh = findBlock(view, block.id) ?? block;
    if (fresh.bodyFrom === null) {
        dispatchStructure(view, { changes: { from: fresh.closerRun.from, insert: '\n' }, selection: EditorSelection.cursor(fresh.closerRun.from), scrollIntoView: true });
    } else if (view.state.doc.lineAt(fresh.bodyFrom).text.trim() === '') {
        view.dispatch({ selection: EditorSelection.cursor(fresh.bodyFrom), scrollIntoView: true });
    } else {
        dispatchStructure(view, { changes: { from: fresh.bodyFrom, insert: '\n\n' }, selection: EditorSelection.cursor(fresh.bodyFrom), scrollIntoView: true });
    }
    return true;
}

/** Backspace at the start of a title unwraps the toggle; elsewhere it never eats a hidden run, it steps over it. */
function backspaceNearToggle(view: EditorView): boolean {
    const sel = view.state.selection.main;
    if (!sel.empty || view.state.readOnly) { return false; }
    const block = findDetailsBlocks(view.state.doc, view.state).find((b) => b.titleFrom === sel.head);
    if (block) {
        dispatchStructure(view, computeUnwrapToggle(view.state, block));
        return true;
    }
    const runs = atomicRangesOf(view);
    let pos = sel.head;
    let moved = false;
    for (let r = runs.find((x) => x.to === pos); r; r = runs.find((x) => x.to === pos)) { pos = r.from; moved = true; }
    if (!moved) { return false; }
    view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
    return true;
}

function deleteNearToggle(view: EditorView): boolean {
    const sel = view.state.selection.main;
    if (!sel.empty || view.state.readOnly) { return false; }
    const runs = atomicRangesOf(view);
    let pos = sel.head;
    let moved = false;
    for (let r = runs.find((x) => x.from === pos); r; r = runs.find((x) => x.from === pos)) { pos = r.to; moved = true; }
    if (!moved) { return false; }
    view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
    return true;
}

const detailsKeymap = Prec.highest(keymap.of([
    { key: 'Enter', run: enterInTitle },
    { key: 'Backspace', run: backspaceNearToggle },
    { key: 'Delete', run: deleteNearToggle },
]));

/** If the cursor starts inside a hidden run (e.g. a document that begins with a toggle), move it to the next visible spot. */
export function moveCursorOutOfHiddenRuns(view: EditorView): void {
    const head = view.state.selection.main.head;
    const hit = atomicRangesOf(view).find((r) => head >= r.from && head < r.to && (r.from === 0 || head > r.from));
    if (hit) { view.dispatch({ selection: EditorSelection.cursor(hit.to) }); }
}

export function detailsExtensions(initial: DetailsOpenState): Extension[] {
    return [seedDetailsOpenState(initial), detailsField, structureGuard, detailsKeymap, toggleInputHandler];
}
