// Notion-style block controls in Preview Edit: hover a block to see `+` and a grip in the left
// margin. `+` adds a block below; clicking the grip selects the block (Shift extends); dragging it
// moves the block (or the selected blocks) with a faded copy under the pointer and a blue line
// where it will land. How far right the pointer is sets how deep the block nests. Holding the
// pointer near the top or bottom edge of the visible editor scrolls it (requestAnimationFrame,
// faster closer to the edge) until the pointer moves away or the drag ends.
//
// Runtime: WEBVIEW (browser). All document logic is in blockModel.ts (pure, unit-tested); this
// file is DOM only: hover, positioning, the drag state machine and dispatch.
//
// The controls and drop line are single overlay elements inside `.cm-scroller`, not widgets per
// block, so nothing is rebuilt as the user types. Pointer events are native listeners on the
// scroller: widgets with `ignoreEvent() === true` (tables, mermaid) never reach CodeMirror's own
// handlers.

import { ViewPlugin } from '@codemirror/view';
import type { EditorView, PluginValue, ViewUpdate } from '@codemirror/view';
import type { Extension, StateEffect, Text } from '@codemirror/state';
import { startCompletion } from '@codemirror/autocomplete';
import { Icons } from '../../shared/icons';
import {
    blockAt, blockAtLine, blocksForRange, buildBlockTree, computeInsertAfter, computeMoveBlocks,
    dropTargetsAtGap, remapTableIndexMap, remapToggleState, visibleBlocks,
} from './blockModel';
import type { BlockNode, DropTarget } from './blockModel';
import { activeBlockSelection, selectBlocksEffect, selectBlocksSpec, setDragSourceEffect } from './blockSelection';
import { resolveLinePosAtPointer } from './pointerLineResolution';
import { applyDetailsOpenState, detailsOpenField, showToggleMenu } from './detailsExtension';
import type { DetailsOpenState } from './detailsExtension';
import { findDetailsBlocks } from './detailsTypes';
import { columnWidthsField, setColumnWidthsEffect } from './tableWidget';

export interface BlockDragOptions {
    /** True while block controls must stay hidden (for example the disk diff overlay is on). */
    isDisabled?: () => boolean;
}

const DRAG_THRESHOLD_PX = 4;
const CONTROL_PX = 18;
const CONTROLS_GAP_PX = 2;
/** Extra reach to the right when picking a nesting depth from the pointer's x. */
const DEPTH_SLOP_PX = 12;
/** How close to the top or bottom edge of the visible editor the pointer starts auto-scrolling. */
const EDGE_SCROLL_PX = 40;
/** Auto-scroll speed in px per second: just inside the edge zone, and at or past the edge. */
const EDGE_SCROLL_MIN_SPEED = 60;
const EDGE_SCROLL_MAX_SPEED = 1500;
/** Longest frame gap counted for auto-scroll, so a stalled frame does not jump the page. */
const EDGE_SCROLL_MAX_FRAME_MS = 50;

/**
 * Auto-scroll velocity in px per second (negative scrolls up, 0 means none) for a pointer at
 * client `y` over a visible area from `top` to `bottom`. Speed grows with the square of how deep
 * the pointer is in the edge zone: gentle at its inner side, fastest at the edge and beyond it.
 */
export function edgeScrollVelocity(y: number, top: number, bottom: number): number {
    const zone = Math.min(EDGE_SCROLL_PX, (bottom - top) / 4);
    if (!(zone > 0)) { return 0; }
    let depth: number;
    if (y < top + zone) { depth = -(top + zone - y) / zone; } else if (y > bottom - zone) { depth = (y - (bottom - zone)) / zone; } else { return 0; }
    const t = Math.min(1, Math.abs(depth));
    return Math.sign(depth) * (EDGE_SCROLL_MIN_SPEED + (EDGE_SCROLL_MAX_SPEED - EDGE_SCROLL_MIN_SPEED) * t * t);
}

const PLUS_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>';

interface Cache { doc: Text; open: DetailsOpenState; tree: BlockNode[]; visible: BlockNode[]; }

interface Row { block: BlockNode; top: number; bottom: number; }

interface DragState {
    block: BlockNode;
    startX: number;
    startY: number;
    shift: boolean;
    started: boolean;
    sources: BlockNode[];
    ghost: HTMLElement | null;
    ghostOffsetX: number;
    ghostOffsetY: number;
    /** Pointer x minus the dragged block's left edge at grab time. */
    grabDx: number;
    rows: Row[];
    target: DropTarget | null;
    lastX: number;
    lastY: number;
}

function isTableCellEditing(): boolean {
    return !!document.activeElement?.closest?.('.cm-md-table-cell-editing');
}

class BlockDragView implements PluginValue {
    private cache: Cache | null = null;
    private readonly controls: HTMLElement;
    private readonly addButton: HTMLElement;
    private readonly grip: HTMLElement;
    private readonly dropLine: HTMLElement;
    private hovered: BlockNode | null = null;
    private drag: DragState | null = null;
    private pendingMove: MouseEvent | null = null;
    private moveFrame = 0;
    /** Edge auto-scroll while dragging: the pending frame, its last timestamp and the sub-pixel carry. */
    private scrollFrame = 0;
    private scrollFrameTime = 0;
    private scrollCarry = 0;

    constructor(private readonly view: EditorView, private readonly options: BlockDragOptions) {
        this.controls = document.createElement('div');
        this.controls.className = 'cm-md-block-controls';
        this.controls.setAttribute('aria-hidden', 'false');

        this.addButton = document.createElement('span');
        this.addButton.className = 'cm-md-block-add';
        this.addButton.setAttribute('role', 'button');
        this.addButton.setAttribute('aria-label', 'Add block below');
        this.addButton.title = 'Add block below';
        this.addButton.innerHTML = PLUS_SVG;

        this.grip = document.createElement('span');
        this.grip.className = 'cm-md-block-grip';
        this.grip.setAttribute('role', 'button');
        this.grip.tabIndex = 0;
        this.grip.innerHTML = Icons.DragGrip;

        this.controls.append(this.addButton, this.grip);
        this.dropLine = document.createElement('div');
        this.dropLine.className = 'cm-md-block-drop-line';
        view.scrollDOM.append(this.controls, this.dropLine);

        view.scrollDOM.addEventListener('mousemove', this.onHoverMove);
        view.dom.addEventListener('mouseleave', this.onLeave);
        view.dom.addEventListener('keydown', this.onEditorKey);
        this.addButton.addEventListener('mousedown', this.onAddDown);
        this.grip.addEventListener('mousedown', this.onGripDown);
        this.grip.addEventListener('contextmenu', this.onGripContextMenu);
        this.grip.addEventListener('keydown', this.onGripKey);
    }

    update(update: ViewUpdate): void {
        if (update.docChanged || update.startState.field(detailsOpenField, false) !== update.state.field(detailsOpenField, false)) {
            this.cache = null;
        }
        if (update.docChanged && !this.drag) { this.hide(); }
        if (this.drag?.started && update.docChanged) { this.endDrag(false); return; }
        // Lines scrolled into view get measured and replace their estimated heights: re-read the
        // rows (height map only, no DOM) so the drop target stays right during a long scroll.
        if (this.drag?.started && update.heightChanged) { this.drag.rows = this.computeRows(); }
    }

    destroy(): void {
        this.endDrag(false);
        this.stopEdgeScroll();
        cancelAnimationFrame(this.moveFrame);
        this.view.scrollDOM.removeEventListener('mousemove', this.onHoverMove);
        this.view.dom.removeEventListener('mouseleave', this.onLeave);
        this.view.dom.removeEventListener('keydown', this.onEditorKey);
        this.controls.remove();
        this.dropLine.remove();
    }

    // ----- Tree -----

    private getCache(): Cache {
        const state = this.view.state;
        const open = state.field(detailsOpenField, false) ?? {};
        if (!this.cache || this.cache.doc !== state.doc || this.cache.open !== open) {
            const tree = buildBlockTree(state, { isToggleOpen: (id, initiallyOpen) => open[id] ?? initiallyOpen });
            this.cache = { doc: state.doc, open, tree, visible: visibleBlocks(tree) };
        }
        return this.cache;
    }

    // ----- Geometry -----

    /** The direct child of `.cm-content` that renders `pos` (a line or a block widget). */
    private elementAt(pos: number): HTMLElement | null {
        const view = this.view;
        if (pos < view.viewport.from || pos > view.viewport.to) { return null; }
        let node: Node | null;
        try {
            const at = view.domAtPos(pos);
            node = at.node === view.contentDOM ? (at.node.childNodes[at.offset] ?? at.node.childNodes[at.offset - 1] ?? null) : at.node;
        } catch { return null; }
        while (node && node.parentNode !== view.contentDOM) { node = node.parentNode; }
        return node instanceof HTMLElement ? node : null;
    }

    private visualFrom(block: BlockNode): number {
        return this.view.state.doc.line(block.visualLine ?? block.firstLine).from;
    }

    private columnLeft(): number {
        const content = this.view.contentDOM.getBoundingClientRect();
        return content.left + parseFloat(getComputedStyle(this.view.contentDOM).paddingLeft);
    }

    private columnRight(): number {
        const content = this.view.contentDOM.getBoundingClientRect();
        return content.right - parseFloat(getComputedStyle(this.view.contentDOM).paddingRight);
    }

    /** Client x of the block's visual left edge (list items: their marker). */
    private blockLeft(block: BlockNode): number {
        const el = this.elementAt(this.visualFrom(block));
        if (!el) { return this.columnLeft() + block.depth * 20; }
        const rect = el.getBoundingClientRect();
        if (block.kind === 'listItem') {
            const slot = el.querySelector('.cm-md-list-marker-slot, .cm-md-task-checkbox');
            if (slot) { return slot.getBoundingClientRect().left; }
        }
        const padding = parseFloat(getComputedStyle(el).paddingLeft) || 0;
        if (block.kind === 'quote' || block.kind === 'callout') { return rect.left; }
        if (block.kind === 'toggle') { return rect.left + padding - 20; }
        return rect.left + padding;
    }

    /** Client x where a drop target's blocks start. */
    private targetLeft(target: DropTarget, sources: ReadonlySet<BlockNode>): number {
        const siblings = target.parent ? target.parent.children : this.getCache().tree;
        const ref = [siblings[target.index], siblings[target.index - 1], siblings[target.index + 1]]
            .find(b => b && !sources.has(b));
        if (ref) { return this.blockLeft(ref); }
        if (!target.parent) { return this.columnLeft(); }
        if (target.parent.kind === 'listItem') {
            const el = this.elementAt(this.visualFrom(target.parent));
            if (el) { return el.getBoundingClientRect().left + (parseFloat(getComputedStyle(el).paddingLeft) || 0); }
        }
        return this.blockLeft(target.parent) + 24;
    }

    private toScroller(clientX: number, clientY: number): { x: number; y: number } {
        const rect = this.view.scrollDOM.getBoundingClientRect();
        return { x: clientX - rect.left + this.view.scrollDOM.scrollLeft, y: clientY - rect.top + this.view.scrollDOM.scrollTop };
    }

    // ----- Hover controls -----

    private readonly onHoverMove = (event: MouseEvent): void => {
        if (this.drag) { return; }
        this.pendingMove = event;
        if (this.moveFrame) { return; }
        this.moveFrame = requestAnimationFrame(() => {
            this.moveFrame = 0;
            const e = this.pendingMove;
            this.pendingMove = null;
            if (e) { this.hoverAt(e); }
        });
    };

    private readonly onLeave = (): void => {
        if (!this.drag) { this.hide(); }
    };

    private readonly onEditorKey = (event: KeyboardEvent): void => {
        if (event.target === this.grip || this.drag) { return; }
        // Typing hides the controls until the mouse moves again; drop a hover still waiting for its frame.
        cancelAnimationFrame(this.moveFrame);
        this.moveFrame = 0;
        this.pendingMove = null;
        this.hide();
    };

    private disabled(): boolean {
        return this.view.state.readOnly || !!this.options.isDisabled?.() || isTableCellEditing();
    }

    private hoverAt(event: MouseEvent): void {
        if (this.controls.contains(event.target as Node)) { return; }
        if (this.disabled()) { this.hide(); return; }
        const { tree } = this.getCache();
        const pos = resolveLinePosAtPointer(this.view, event.clientY, event.target);
        let block = blockAtLine(tree, this.view.state.doc.lineAt(pos).number);
        if (!block) { this.hide(); return; }
        // The first line of a callout or quote belongs to the box itself (a callout's icon sits there),
        // so the box can be grabbed; later blocks inside it get their own controls.
        while (block.parent && (block.parent.kind === 'callout' || block.parent.kind === 'quote')
            && block.parent.children[0] === block) {
            block = block.parent;
        }
        if (block.kind === 'table') {
            // Body rows keep the table's own row grip; the block grip belongs to the header row.
            const el = this.elementAt(block.from);
            const head = el?.querySelector('thead')?.getBoundingClientRect();
            if (!head || event.clientY > head.bottom) { this.hide(); return; }
        }
        this.showFor(block);
    }

    private showFor(block: BlockNode): void {
        const el = this.elementAt(this.visualFrom(block));
        if (!el) { this.hide(); return; }
        const rect = el.getBoundingClientRect();
        let top = rect.top;
        let height = Math.min(rect.height, 26);
        const textPos = Math.min(this.visualFrom(block) + /^\s*/.exec(this.view.state.doc.lineAt(this.visualFrom(block)).text)![0].length, this.view.state.doc.length);
        const coords = this.view.coordsAtPos(textPos, 1);
        if (coords && coords.bottom - coords.top > 4 && coords.bottom - coords.top < 60 && block.kind !== 'table' && block.kind !== 'callout') {
            top = coords.top;
            height = coords.bottom - coords.top;
        }
        // Inside a callout or quote the controls sit outside the box, not over its icon or border.
        let box: BlockNode = block;
        while (box.parent && (box.parent.kind === 'callout' || box.parent.kind === 'quote')) { box = box.parent; }
        const left = this.blockLeft(box) - 2 * CONTROL_PX - CONTROLS_GAP_PX - 2;
        const at = this.toScroller(left, top + height / 2 - CONTROL_PX / 2);
        this.controls.style.left = `${at.x}px`;
        this.controls.style.top = `${at.y}px`;
        this.hovered = block;
        const toggleHint = block.kind === 'toggle' ? ' · Right-click for options' : '';
        this.grip.title = `Drag to move · Click to select${toggleHint}`;
        this.grip.setAttribute('aria-label', block.kind === 'toggle' ? 'Move or select toggle; Enter for options' : 'Move or select block');
        this.controls.classList.add('cm-md-block-controls-visible');
        // The outline rail sits over the margin near the top on narrow panes: it wins.
        const rail = document.querySelector('.outline-rail-widget');
        if (rail instanceof HTMLElement && rail.offsetParent !== null) {
            const a = this.controls.getBoundingClientRect();
            const b = rail.getBoundingClientRect();
            if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) { this.hide(); }
        }
    }

    private hide(): void {
        this.controls.classList.remove('cm-md-block-controls-visible');
        this.hovered = null;
    }

    // ----- + button -----

    private readonly onAddDown = (event: MouseEvent): void => {
        if (event.button !== 0) { return; }
        event.preventDefault();
        event.stopPropagation();
        const block = this.hovered;
        if (!block || this.disabled()) { return; }
        const result = computeInsertAfter(this.view.state, block);
        this.view.dispatch(result.spec);
        this.view.focus();
        this.hide();
        if (result.openSlashMenu) { startCompletion(this.view); }
    };

    // ----- Grip: select, menu, drag -----

    private readonly onGripContextMenu = (event: MouseEvent): void => {
        const block = this.hovered;
        if (!block || block.kind !== 'toggle' || !block.toggleId) { return; }
        event.preventDefault();
        event.stopPropagation();
        showToggleMenu(this.view, block.toggleId, this.grip.getBoundingClientRect());
    };

    private readonly onGripKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Enter' && event.key !== ' ') { return; }
        const block = this.hovered;
        if (!block) { return; }
        event.preventDefault();
        event.stopPropagation();
        if (block.kind === 'toggle' && block.toggleId) {
            showToggleMenu(this.view, block.toggleId, this.grip.getBoundingClientRect());
        } else {
            this.select(block, event.shiftKey);
        }
    };

    private readonly onGripDown = (event: MouseEvent): void => {
        if (event.button !== 0) { return; }
        event.preventDefault();
        event.stopPropagation();
        const block = this.hovered;
        if (!block || this.disabled()) { return; }
        this.drag = {
            block, startX: event.clientX, startY: event.clientY, shift: event.shiftKey, started: false,
            sources: [], ghost: null, ghostOffsetX: 0, ghostOffsetY: 0, grabDx: 0, rows: [], target: null,
            lastX: event.clientX, lastY: event.clientY,
        };
        window.addEventListener('mousemove', this.onDragMove, true);
        window.addEventListener('mouseup', this.onDragUp, true);
        window.addEventListener('keydown', this.onDragKey, true);
        window.addEventListener('blur', this.onDragCancel);
        window.addEventListener('scroll', this.onDragScroll, true);
    };

    private select(block: BlockNode, extend: boolean): void {
        const state = this.view.state;
        const { tree } = this.getCache();
        let blocks = [block];
        if (extend) {
            const current = activeBlockSelection(state);
            const anchor = current ?? (() => {
                const b = blockAt(state, tree, state.selection.main.head);
                return b ? { from: b.from, to: b.to } : null;
            })();
            if (anchor) {
                const range = blocksForRange(state, tree, Math.min(anchor.from, block.from), Math.max(anchor.to, block.to));
                if (range.length) { blocks = range; }
            }
        }
        this.view.dispatch(selectBlocksSpec({ from: blocks[0].from, to: blocks[blocks.length - 1].to }));
        this.view.focus();
    }

    private resolveSources(block: BlockNode): BlockNode[] {
        const state = this.view.state;
        const { tree } = this.getCache();
        const main = state.selection.main;
        const range = activeBlockSelection(state) ?? (main.empty ? null : { from: main.from, to: main.to });
        if (range && range.from <= block.to && range.to >= block.from) {
            const blocks = blocksForRange(state, tree, range.from, range.to);
            if (blocks.includes(block)) { return blocks; }
        }
        return [block];
    }

    private readonly onDragMove = (event: MouseEvent): void => {
        const drag = this.drag;
        if (!drag) { return; }
        event.preventDefault();
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        if (!drag.started) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) { return; }
            this.startDrag(drag);
        }
        this.trackDrag(drag);
        this.startEdgeScroll();
    };

    // ----- Edge auto-scroll -----

    /** The element that scrolls the editor: `.cm-scroller`, or an ancestor such as `#content` when the page scrolls. */
    private scrollContainer(): HTMLElement | null {
        for (let el: HTMLElement | null = this.view.scrollDOM; el; el = el.parentElement) {
            if (el.scrollHeight > el.clientHeight + 1 && /^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY)) { return el; }
        }
        const root = document.scrollingElement;
        return root instanceof HTMLElement && root.scrollHeight > root.clientHeight + 1 ? root : null;
    }

    /** The scroll container and the auto-scroll velocity for the pointer's y, or null outside the edge zones. */
    private edgeScroll(y: number): { scroller: HTMLElement; velocity: number } | null {
        const scroller = this.scrollContainer();
        if (!scroller) { return null; }
        // The visible editor area: the scroller's client box, cut to the editor and the window.
        let top = 0;
        let bottom = window.innerHeight;
        if (scroller !== document.scrollingElement) {
            const rect = scroller.getBoundingClientRect();
            top = Math.max(top, rect.top + scroller.clientTop);
            bottom = Math.min(bottom, rect.top + scroller.clientTop + scroller.clientHeight);
        }
        const editor = this.view.scrollDOM.getBoundingClientRect();
        top = Math.max(top, editor.top);
        bottom = Math.min(bottom, editor.bottom);
        const velocity = edgeScrollVelocity(y, top, bottom);
        if (velocity === 0) { return null; }
        // Already at the end in that direction: nothing to do.
        if (velocity < 0 ? scroller.scrollTop <= 0 : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) { return null; }
        return { scroller, velocity };
    }

    private startEdgeScroll(): void {
        if (this.scrollFrame || !this.drag?.started || !this.edgeScroll(this.drag.lastY)) { return; }
        this.scrollFrameTime = 0;
        this.scrollCarry = 0;
        this.scrollFrame = requestAnimationFrame(this.edgeScrollStep);
    }

    private stopEdgeScroll(): void {
        cancelAnimationFrame(this.scrollFrame);
        this.scrollFrame = 0;
    }

    /** One auto-scroll frame; keeps itself going while the pointer stays in an edge zone. */
    private readonly edgeScrollStep = (time: number): void => {
        this.scrollFrame = 0;
        const drag = this.drag;
        if (!drag?.started) { return; }
        const edge = this.edgeScroll(drag.lastY);
        if (!edge) { return; }
        const dt = this.scrollFrameTime ? Math.min(time - this.scrollFrameTime, EDGE_SCROLL_MAX_FRAME_MS) : 1000 / 60;
        this.scrollFrameTime = time;
        const delta = edge.velocity * dt / 1000 + this.scrollCarry;
        const step = Math.trunc(delta);
        this.scrollCarry = delta - step;
        if (step !== 0) {
            edge.scroller.scrollTop += step;
            this.trackDrag(drag);
        }
        this.scrollFrame = requestAnimationFrame(this.edgeScrollStep);
    };

    private readonly onDragScroll = (): void => {
        if (this.drag?.started) { this.trackDrag(this.drag); }
    };

    private readonly onDragUp = (event: MouseEvent): void => {
        const drag = this.drag;
        if (!drag) { return; }
        event.preventDefault();
        if (!drag.started) {
            this.endDrag(false);
            this.select(drag.block, drag.shift);
            return;
        }
        this.endDrag(true);
    };

    private readonly onDragKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || !this.drag) { return; }
        event.preventDefault();
        event.stopPropagation();
        this.endDrag(false);
    };

    private readonly onDragCancel = (): void => { this.endDrag(false); };

    private startDrag(drag: DragState): void {
        drag.started = true;
        drag.sources = this.resolveSources(drag.block);
        const first = drag.sources[0];
        const last = drag.sources[drag.sources.length - 1];
        drag.grabDx = drag.startX - this.blockLeft(drag.block);
        drag.rows = this.computeRows();
        this.hide();
        this.view.dom.classList.add('cm-md-block-dragging');
        // The dragged blocks become the selection, so an older block highlight elsewhere goes away.
        this.view.dispatch({
            ...selectBlocksSpec({ from: first.from, to: last.to }),
            effects: [selectBlocksEffect.of({ from: first.from, to: last.to }), setDragSourceEffect.of({ from: first.from, to: last.to })],
        });
        drag.ghost = this.buildGhost(first.from, last.to);
        if (drag.ghost) {
            const box = drag.ghost.getBoundingClientRect();
            drag.ghostOffsetX = drag.startX - box.left;
            drag.ghostOffsetY = drag.startY - box.top;
        }
    }

    private buildGhost(from: number, to: number): HTMLElement | null {
        const view = this.view;
        const ghost = document.createElement('div');
        ghost.className = 'cm-md-block-drag-ghost';
        const inner = document.createElement('div');
        inner.className = 'cm-content cm-md-block-drag-ghost-content';
        let firstRect: DOMRect | null = null;
        let count = 0;
        for (const child of Array.from(view.contentDOM.children)) {
            let pos: number;
            try { pos = view.posAtDOM(child, 0); } catch { continue; }
            if (pos < from || pos > to) { continue; }
            if (!firstRect) {
                const r = child.getBoundingClientRect();
                if (r.height > 0) { firstRect = r; }
            }
            inner.appendChild(child.cloneNode(true));
            if (++count >= 40) { break; }
        }
        if (count === 0) { return null; }
        ghost.appendChild(inner);
        const left = this.columnLeft();
        ghost.style.width = `${Math.max(120, this.columnRight() - left)}px`;
        ghost.style.left = `${left}px`;
        ghost.style.top = `${firstRect?.top ?? this.drag?.startY ?? 0}px`;
        view.dom.appendChild(ghost);
        return ghost;
    }

    /** Visible blocks with their own row (head for containers with children) in document coordinates. */
    private computeRows(): Row[] {
        const view = this.view;
        const doc = view.state.doc;
        return this.getCache().visible.map((block) => {
            const top = view.lineBlockAt(block.from).top;
            const hasChildren = block.children.length > 0 && !(block.kind === 'toggle' && block.collapsed);
            let bottom: number;
            if (!hasChildren) {
                bottom = view.lineBlockAt(block.to).bottom;
            } else if (block.headLastLine !== undefined) {
                bottom = view.lineBlockAt(doc.line(block.headLastLine).to).bottom;
            } else {
                bottom = top;
            }
            return { block, top, bottom };
        });
    }

    private gapAt(rows: Row[], docY: number): number {
        let lo = 0;
        let hi = rows.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (rows[mid].top <= docY) { lo = mid + 1; } else { hi = mid; }
        }
        const i = lo - 1;
        if (i < 0) { return 0; }
        const row = rows[i];
        return docY < (row.top + row.bottom) / 2 ? i : i + 1;
    }

    private trackDrag(drag: DragState): void {
        if (drag.ghost) {
            drag.ghost.style.left = `${drag.lastX - drag.ghostOffsetX}px`;
            drag.ghost.style.top = `${drag.lastY - drag.ghostOffsetY}px`;
        }
        const { tree, visible } = this.getCache();
        const docY = drag.lastY - this.view.documentTop;
        const gap = this.gapAt(drag.rows, docY);
        const targets = dropTargetsAtGap(tree, visible, gap, drag.sources);
        const sourceSet = new Set(drag.sources);
        const blockX = drag.lastX - drag.grabDx;
        let chosen: DropTarget | null = null;
        let chosenX = 0;
        for (const t of targets) {
            const x = this.targetLeft(t, sourceSet);
            if (!chosen || x <= blockX + DEPTH_SLOP_PX) { chosen = t; chosenX = x; }
        }
        drag.target = chosen && !this.isNoOp(drag.sources, chosen) ? chosen : null;
        if (!drag.target) { this.dropLine.classList.remove('cm-md-block-drop-line-visible'); return; }
        const rows = drag.rows;
        let lineY: number;
        if (gap === 0) { lineY = rows[0]?.top ?? 0; } else if (gap >= rows.length) { lineY = rows[rows.length - 1].bottom; } else { lineY = (rows[gap - 1].bottom + rows[gap].top) / 2; }
        const at = this.toScroller(chosenX, lineY + this.view.documentTop);
        const right = this.toScroller(this.columnRight(), 0).x;
        this.dropLine.style.left = `${at.x}px`;
        this.dropLine.style.width = `${Math.max(24, right - at.x)}px`;
        this.dropLine.style.top = `${at.y - 1}px`;
        this.dropLine.classList.add('cm-md-block-drop-line-visible');
    }

    /** Dropping right where the blocks already are. */
    private isNoOp(sources: BlockNode[], target: DropTarget): boolean {
        const parent = sources[0].parent;
        if (target.parent !== parent) { return false; }
        const siblings = parent ? parent.children : this.getCache().tree;
        const first = siblings.indexOf(sources[0]);
        const last = siblings.indexOf(sources[sources.length - 1]);
        return target.index >= first && target.index <= last + 1;
    }

    private endDrag(commit: boolean): void {
        const drag = this.drag;
        if (!drag) { return; }
        this.drag = null;
        this.stopEdgeScroll();
        window.removeEventListener('mousemove', this.onDragMove, true);
        window.removeEventListener('mouseup', this.onDragUp, true);
        window.removeEventListener('keydown', this.onDragKey, true);
        window.removeEventListener('blur', this.onDragCancel);
        window.removeEventListener('scroll', this.onDragScroll, true);
        if (!drag.started) { return; }
        drag.ghost?.remove();
        this.dropLine.classList.remove('cm-md-block-drop-line-visible');
        this.view.dom.classList.remove('cm-md-block-dragging');
        if (commit && drag.target) {
            this.commit(drag.sources, drag.target);
        } else {
            this.view.dispatch({ effects: setDragSourceEffect.of(null) });
        }
    }

    private commit(sources: BlockNode[], target: DropTarget): void {
        const view = this.view;
        const state = view.state;
        const { tree, open } = this.getCache();
        const result = computeMoveBlocks(state, tree, sources, target);
        if (!result) {
            view.dispatch({ effects: setDragSourceEffect.of(null) });
            return;
        }
        const effects: StateEffect<unknown>[] = [
            setDragSourceEffect.of(null),
            selectBlocksEffect.of({ from: result.movedFrom, to: result.movedTo }),
        ];
        const widths = state.field(columnWidthsField, false);
        if (widths && result.tableOrder.some((old, i) => old !== i)) {
            const next = remapTableIndexMap(widths, result.tableOrder);
            const keys = new Set([...Object.keys(widths), ...Object.keys(next)].map(Number));
            for (const k of keys) { effects.push(setColumnWidthsEffect.of({ tableIndex: k, widths: next[k] ?? [] })); }
        }
        view.dispatch({ ...result.spec, effects });
        view.focus();
        if (result.toggleOrder.length > 1 && Object.keys(open).length > 0) {
            const newIds = findDetailsBlocks(view.state.doc, view.state).map(b => b.id);
            const remapped = remapToggleState(open, result.toggleOrder, newIds);
            if (JSON.stringify(remapped) !== JSON.stringify(open)) { applyDetailsOpenState(view, remapped); }
        }
    }
}

/** Hover `+` and grip, click-to-select and drag-to-move for every block in Preview Edit. */
export function blockDragExtension(options: BlockDragOptions = {}): Extension {
    return ViewPlugin.define((view) => new BlockDragView(view, options));
}
