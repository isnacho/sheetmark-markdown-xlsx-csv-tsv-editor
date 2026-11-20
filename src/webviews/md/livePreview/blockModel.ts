// Block model for Notion-style block drag in Preview Edit. Pure: no DOM, no EditorView.
//
// Runtime: WEBVIEW (browser), and loaded directly by node unit tests.
//
// A "block" is what the user sees as one draggable unit: a paragraph, heading, list item (with
// its nested content), code fence, quote, callout, toggle, table, divider or HTML block. Blocks
// nest: list items, quotes, callouts and (open) toggles hold child blocks.
//
// Callouts (`:::type` … `:::`) and toggles (`<details>`) are not syntax nodes: they are found by
// line scanners, so the tree is built in two layers. Container line ranges come first; the
// syntax tree fills the lines between them, with nodes clipped to those lines (without blank lines
// around a fence, lezer glues the `:::` line into the neighbouring paragraph).
//
// `computeMoveBlocks` turns "move these sibling blocks to (parent, index)" into one text change:
// it re-bases the moved lines from their old context (list indent, `> ` prefixes) onto the new
// one, keeps one blank line between blocks (none inside tight lists), and renumbers ordered lists.

import { EditorSelection, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { findCalloutBlocks } from './calloutTypes';
import { findDetailsBlocks } from './detailsTypes';
import { structureEdit } from './detailsEditing';
import { effectiveTableRange } from './tableBoundaryEditing';
import { extractFrontmatter } from '../frontmatter';

export type BlockKind =
    | 'paragraph' | 'heading' | 'listItem' | 'code' | 'quote' | 'callout' | 'toggle'
    | 'table' | 'hr' | 'html' | 'other';

export interface ListInfo {
    ordered: boolean;
    /** No blank line between this list's items. */
    tight: boolean;
    /** Number of the list's first item (ordered lists), else 1. */
    start: number;
    /** Position among the list's items. */
    index: number;
    /** The marker text, e.g. `-`, `*`, `3.`, `2)`. */
    marker: string;
    /** Columns from the item's line start (after outer prefixes) to its content. */
    contentWidth: number;
}

export interface BlockNode {
    kind: BlockKind;
    /** 1-based line numbers; a block always covers whole lines. */
    firstLine: number;
    lastLine: number;
    from: number;
    to: number;
    /** 0 for top-level blocks. */
    depth: number;
    parent: BlockNode | null;
    children: BlockNode[];
    /** Containers with a head (list item text, callout opener, toggle summary): its last line. */
    headLastLine?: number;
    /** ATX heading or fenced code: may directly follow any block with no blank line. */
    interrupts?: boolean;
    list?: ListInfo;
    toggleId?: string;
    /** First line the user sees (a toggle's tag lines are hidden: its title line). */
    visualLine?: number;
    /** A closed toggle: its children are hidden and it takes no drops inside. */
    collapsed?: boolean;
}

export interface BlockTreeOptions {
    /** Toggle open state; defaults to the `open` attribute. */
    isToggleOpen?: (id: string, initiallyOpen: boolean) => boolean;
}

interface ContainerSpan {
    kind: 'toggle' | 'callout';
    firstLine: number;
    lastLine: number;
    headLastLine: number;
    bodyFirst: number;
    bodyLast: number;
    toggleId?: string;
    titleLine?: number;
    collapsed?: boolean;
    inner: ContainerSpan[];
}

const SUMMARY_CLOSE_RE = /^\s*<\/summary>\s*$/i;
const LIST_MARKER_RE = /^( *)([-+*]|\d{1,9}[.)])( *)/;
const ORDERED_LINE_RE = /^((?: {0,3}> ?)*)( *)(\d{1,9})([.)])( +|$)/;
const ANY_LIST_LINE_RE = /^((?: {0,3}> ?)*)( *)([-+*]|\d{1,9}[.)])( +|$)/;

export function isBlankLine(text: string): boolean {
    return /^[\s>]*$/.test(text);
}

function lineOf(state: EditorState, pos: number): number {
    return state.doc.lineAt(pos).number;
}

function makeBlock(
    state: EditorState, kind: BlockKind, firstLine: number, lastLine: number,
    parent: BlockNode | null,
): BlockNode {
    return {
        kind,
        firstLine,
        lastLine,
        from: state.doc.line(firstLine).from,
        to: state.doc.line(lastLine).to,
        depth: parent ? parent.depth + 1 : 0,
        parent,
        children: [],
    };
}

/** Context chain of a block's parent, outermost first, including the parent itself. */
export function contextChain(parent: BlockNode | null): BlockNode[] {
    const chain: BlockNode[] = [];
    for (let p = parent; p; p = p.parent) { chain.unshift(p); }
    return chain;
}

/** Remove the prefixes the containers in `chain` put in front of a line (`> `, list indent). */
export function stripContextPrefix(text: string, chain: readonly BlockNode[]): string {
    let rest = text;
    for (const c of chain) {
        if (c.kind === 'quote') {
            const m = /^ {0,3}> ?/.exec(rest);
            if (!m) { return rest.replace(/^\s+/, ''); } // lazy continuation line
            rest = rest.slice(m[0].length);
        } else if (c.kind === 'listItem' && c.list) {
            rest = stripColumns(rest, c.list.contentWidth);
        }
    }
    return rest;
}

/** Strip up to `width` columns of leading whitespace (a tab advances to the next multiple of 4). */
function stripColumns(text: string, width: number): string {
    let col = 0;
    let i = 0;
    while (i < text.length && col < width) {
        const ch = text[i];
        if (ch === ' ') { col++; } else if (ch === '\t') { col = (Math.floor(col / 4) + 1) * 4; } else { break; }
        i++;
    }
    return text.slice(i);
}

/** The prefix a line needs to sit inside every container in `chain`. */
export function contextPrefix(chain: readonly BlockNode[]): string {
    let prefix = '';
    for (const c of chain) {
        if (c.kind === 'quote') { prefix += '> '; } else if (c.kind === 'listItem' && c.list) { prefix += ' '.repeat(c.list.contentWidth); }
    }
    return prefix;
}

function blankLineFor(chain: readonly BlockNode[]): string {
    return contextPrefix(chain).trimEnd().replace(/^ +$/, '');
}

function listContentWidth(markerLineText: string): number {
    const m = LIST_MARKER_RE.exec(markerLineText);
    if (!m) { return 2; }
    const lead = m[1].length + m[2].length;
    const spaces = m[3].length;
    const rest = markerLineText.slice(m[0].length);
    if (rest.length === 0 || spaces === 0 || spaces > 4) { return lead + 1; }
    return lead + spaces;
}

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

function frontmatterLastLine(state: EditorState): number {
    const head = state.doc.sliceString(0, Math.min(state.doc.length, 200_000));
    const fm = extractFrontmatter(head);
    if (!fm || fm.range.to === 0) { return 0; }
    return state.doc.lineAt(Math.max(0, fm.range.to - 1)).number;
}

function collectContainers(state: EditorState, options: BlockTreeOptions, minLine: number): ContainerSpan[] {
    const doc = state.doc;
    const spans: ContainerSpan[] = [];
    for (const t of findDetailsBlocks(doc, state)) {
        if (t.openLine < minLine || /^\s/.test(doc.line(t.openLine).text)) { continue; }
        let headLast = lineOf(state, t.titleTo);
        if (!t.legacy) {
            for (let n = headLast + 1; n < t.closeLine; n++) {
                if (SUMMARY_CLOSE_RE.test(doc.line(n).text)) { headLast = n; break; }
            }
        }
        const open = options.isToggleOpen ? options.isToggleOpen(t.id, t.initiallyOpen) : t.initiallyOpen;
        spans.push({
            kind: 'toggle', firstLine: t.openLine, lastLine: t.closeLine, headLastLine: headLast,
            bodyFirst: headLast + 1, bodyLast: t.closeLine - 1, toggleId: t.id, collapsed: !open, inner: [],
            titleLine: lineOf(state, t.titleFrom),
        });
    }
    for (const c of findCalloutBlocks(doc, state)) {
        if (c.openLine < minLine || /^\s/.test(doc.line(c.openLine).text)) { continue; }
        const last = c.closeLine ?? c.contentEndLine;
        spans.push({
            kind: 'callout', firstLine: c.openLine, lastLine: last, headLastLine: c.openLine,
            bodyFirst: c.contentStartLine, bodyLast: c.contentEndLine, inner: [],
        });
    }
    spans.sort((a, b) => a.firstLine - b.firstLine || b.lastLine - a.lastLine);
    // Nest by containment; a span that crosses its would-be parent's end is dropped.
    const roots: ContainerSpan[] = [];
    const stack: ContainerSpan[] = [];
    for (const s of spans) {
        while (stack.length && stack[stack.length - 1].lastLine < s.firstLine) { stack.pop(); }
        const top = stack[stack.length - 1];
        if (top && (s.lastLine > top.bodyLast || s.firstLine < top.bodyFirst)) { continue; }
        (top ? top.inner : roots).push(s);
        stack.push(s);
    }
    return roots;
}

interface TopNode { node: SyntaxNode; firstLine: number; lastLine: number; }

function nodeKind(name: string): BlockKind | null {
    if (name === 'Paragraph') { return 'paragraph'; }
    if (/^(ATX|Setext)Heading\d$/.test(name)) { return 'heading'; }
    if (name === 'FencedCode' || name === 'CodeBlock') { return 'code'; }
    if (name === 'Blockquote') { return 'quote'; }
    if (name === 'Table') { return 'table'; }
    if (name === 'HorizontalRule') { return 'hr'; }
    if (name === 'HTMLBlock' || name === 'CommentBlock' || name === 'ProcessingInstructionBlock') { return 'html'; }
    if (name === 'LinkReference') { return 'other'; }
    return null;
}

class TreeBuilder {
    constructor(private readonly state: EditorState) {}

    nodeLines(node: SyntaxNode): [number, number] {
        let to = node.to;
        if (node.name === 'Table') { to = effectiveTableRange(this.state, node).to; }
        return [lineOf(this.state, node.from), lineOf(this.state, Math.max(node.from, to))];
    }

    /** Blocks for one syntax node, clipped to lines [a, b]. */
    blocksForNode(node: SyntaxNode, a: number, b: number, parent: BlockNode | null): BlockNode[] {
        const [nf, nl] = this.nodeLines(node);
        const first = Math.max(a, nf);
        const last = Math.min(b, nl);
        if (first > last) { return []; }
        if (node.name === 'BulletList' || node.name === 'OrderedList') {
            return this.listItems(node, first, last, parent);
        }
        const kind = nodeKind(node.name);
        if (!kind) { return []; }
        const block = makeBlock(this.state, kind, first, last, parent);
        if (node.name.startsWith('ATXHeading') || node.name === 'FencedCode') { block.interrupts = true; }
        if (kind === 'quote') {
            for (let c = node.firstChild; c; c = c.nextSibling) {
                if (c.name === 'QuoteMark') { continue; }
                block.children.push(...this.blocksForNode(c, first, last, block));
            }
        }
        return [block];
    }

    listItems(list: SyntaxNode, a: number, b: number, parent: BlockNode | null): BlockNode[] {
        const ordered = list.name === 'OrderedList';
        const items: SyntaxNode[] = [];
        for (let c = list.firstChild; c; c = c.nextSibling) { if (c.name === 'ListItem') { items.push(c); } }
        let tight = true;
        for (let i = 1; i < items.length; i++) {
            const prevLine = lineOf(this.state, items[i].from) - 1;
            if (prevLine >= 1 && isBlankLine(this.state.doc.line(prevLine).text)) { tight = false; break; }
        }
        let start = 1;
        const firstMark = items[0]?.getChild('ListMark');
        if (ordered && firstMark) { start = parseInt(this.state.doc.sliceString(firstMark.from, firstMark.to), 10) || 1; }
        const chain = contextChain(parent);
        const out: BlockNode[] = [];
        items.forEach((item, index) => {
            const [nf, nl] = this.nodeLines(item);
            const first = Math.max(a, nf);
            const last = Math.min(b, nl);
            if (first > last) { return; }
            const block = makeBlock(this.state, 'listItem', first, last, parent);
            const mark = item.getChild('ListMark');
            const markerLine = stripContextPrefix(this.state.doc.line(nf).text, chain);
            block.list = {
                ordered, tight, start, index,
                marker: mark ? this.state.doc.sliceString(mark.from, mark.to) : '-',
                contentWidth: listContentWidth(markerLine),
            };
            // The head is the item's own text: the first content node when it starts on the marker line.
            let headLast = nf;
            const children: SyntaxNode[] = [];
            for (let c = item.firstChild; c; c = c.nextSibling) {
                if (c.name === 'ListMark') { continue; }
                const cl = lineOf(this.state, c.from);
                if (children.length === 0 && cl === nf && (c.name === 'Paragraph' || c.name === 'Task')) {
                    headLast = lineOf(this.state, c.to);
                    continue;
                }
                children.push(c);
            }
            block.headLastLine = Math.min(headLast, last);
            for (const c of children) {
                block.children.push(...this.blocksForNode(c, Math.max(first, block.headLastLine + 1), last, block));
            }
            out.push(block);
        });
        return out;
    }
}

/** All blocks in the document as a tree (frontmatter excluded). */
export function buildBlockTree(state: EditorState, options: BlockTreeOptions = {}): BlockNode[] {
    const fmLast = frontmatterLastLine(state);
    const containers = collectContainers(state, options, fmLast + 1);
    const tops: TopNode[] = [];
    const builder = new TreeBuilder(state);
    for (let c = syntaxTree(state).topNode.firstChild; c; c = c.nextSibling) {
        const [firstLine, lastLine] = builder.nodeLines(c);
        tops.push({ node: c, firstLine, lastLine });
    }

    const segment = (a: number, b: number, parent: BlockNode | null): BlockNode[] => {
        if (a > b) { return []; }
        const out: BlockNode[] = [];
        // First top node that ends at or after line a.
        let lo = 0;
        let hi = tops.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (tops[mid].lastLine < a) { lo = mid + 1; } else { hi = mid; }
        }
        for (let i = lo; i < tops.length && tops[i].firstLine <= b; i++) {
            out.push(...builder.blocksForNode(tops[i].node, a, b, parent));
        }
        return out;
    };

    const region = (a: number, b: number, inner: ContainerSpan[], parent: BlockNode | null): BlockNode[] => {
        const out: BlockNode[] = [];
        let cursor = a;
        for (const span of inner) {
            out.push(...segment(cursor, span.firstLine - 1, parent));
            const block = makeBlock(state, span.kind, span.firstLine, span.lastLine, parent);
            block.headLastLine = span.headLastLine;
            if (span.toggleId !== undefined) {
                block.toggleId = span.toggleId;
                block.collapsed = span.collapsed;
                block.visualLine = span.titleLine;
            }
            block.children = region(span.bodyFirst, span.bodyLast, span.inner, block);
            out.push(block);
            cursor = span.lastLine + 1;
        }
        out.push(...segment(cursor, b, parent));
        return out;
    };

    return region(fmLast + 1, state.doc.lines, containers, null);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function isContainer(block: BlockNode): boolean {
    return block.kind === 'listItem' || block.kind === 'quote' || block.kind === 'callout'
        || (block.kind === 'toggle' && !block.collapsed);
}

function siblingsOf(tree: readonly BlockNode[], block: BlockNode): readonly BlockNode[] {
    return block.parent ? block.parent.children : tree;
}

function containsLine(block: BlockNode, line: number): boolean {
    return block.firstLine <= line && line <= block.lastLine;
}

/** The innermost visible block on a line, or null (frontmatter, outside any block). */
export function blockAtLine(tree: readonly BlockNode[], line: number): BlockNode | null {
    let level: readonly BlockNode[] = tree;
    let found: BlockNode | null = null;
    for (;;) {
        const hit = level.find(b => containsLine(b, line));
        if (!hit) { return found; }
        found = hit;
        if (hit.kind === 'toggle' && hit.collapsed) { return found; }
        if (hit.headLastLine !== undefined && line <= hit.headLastLine) { return found; }
        level = hit.children;
    }
}

export function blockAt(state: EditorState, tree: readonly BlockNode[], pos: number): BlockNode | null {
    return blockAtLine(tree, lineOf(state, pos));
}

function ancestorsOf(block: BlockNode): BlockNode[] {
    const out: BlockNode[] = [];
    for (let b: BlockNode | null = block; b; b = b.parent) { out.push(b); }
    return out;
}

/** Sibling blocks touched by the range [from, to], widened to whole blocks under their common parent. */
export function blocksForRange(state: EditorState, tree: readonly BlockNode[], from: number, to: number): BlockNode[] {
    const a = blockAt(state, tree, from);
    const b = blockAt(state, tree, Math.max(from, to));
    if (!a || !b) { return a ? [a] : b ? [b] : []; }
    if (a === b) { return [a]; }
    const chainA = ancestorsOf(a);
    const chainB = ancestorsOf(b);
    const setA = new Set(chainA);
    const common = chainB.find(x => setA.has(x)) ?? null;
    if (common === a || common === b) { return [common]; }
    const liftA = chainA[chainA.indexOf(common as BlockNode) - 1] ?? chainA[chainA.length - 1];
    const liftB = chainB[chainB.indexOf(common as BlockNode) - 1] ?? chainB[chainB.length - 1];
    const siblings = common ? common.children : tree;
    const i = siblings.indexOf(liftA);
    const j = siblings.indexOf(liftB);
    if (i < 0 || j < 0) { return []; }
    return siblings.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Blocks in document order, skipping the children of closed toggles. */
export function visibleBlocks(tree: readonly BlockNode[]): BlockNode[] {
    const out: BlockNode[] = [];
    const walk = (level: readonly BlockNode[]) => {
        for (const b of level) {
            out.push(b);
            if (!(b.kind === 'toggle' && b.collapsed)) { walk(b.children); }
        }
    };
    walk(tree);
    return out;
}

// ---------------------------------------------------------------------------
// Drop targets
// ---------------------------------------------------------------------------

export interface DropTarget {
    /** null = top level. */
    parent: BlockNode | null;
    /** Insert before `parent.children[index]` (or at the end when index = length). */
    index: number;
    depth: number;
}

function sameTarget(a: DropTarget, b: DropTarget): boolean {
    return a.parent === b.parent && a.index === b.index;
}

function containsKind(block: BlockNode, kinds: readonly BlockKind[]): boolean {
    if (kinds.includes(block.kind)) { return true; }
    return block.children.some(c => containsKind(c, kinds));
}

/** Whether `sources` may be dropped at `target`. */
export function isDropAllowed(sources: readonly BlockNode[], target: DropTarget): boolean {
    if (target.parent && !isContainer(target.parent)) { return false; }
    const chain = contextChain(target.parent);
    const sourceSet = new Set(sources);
    if (chain.some(c => sourceSet.has(c))) { return false; }
    if (target.parent && target.parent.kind === 'toggle' && target.parent.collapsed) { return false; }
    const movesCallout = sources.some(s => containsKind(s, ['callout']));
    if (movesCallout && chain.some(c => c.kind === 'callout')) { return false; }
    // Toggle tags and callout fences must start at column 0: they cannot go under a list item or into a quote.
    const movesContainer = sources.some(s => containsKind(s, ['callout', 'toggle']));
    if (movesContainer && chain.some(c => c.kind === 'listItem' || c.kind === 'quote')) { return false; }
    // A quote whose every child moves out disappears; dropping into it makes no sense.
    if (target.parent?.kind === 'quote' && target.parent.children.every(c => sourceSet.has(c))) { return false; }
    return true;
}

/**
 * Legal placements in the gap before `visible[gapIndex]` (gapIndex = visible.length: end of the
 * document), shallowest first. `visible` comes from `visibleBlocks(tree)`.
 */
export function dropTargetsAtGap(
    tree: readonly BlockNode[], visible: readonly BlockNode[], gapIndex: number, sources: readonly BlockNode[],
): DropTarget[] {
    const above = gapIndex > 0 ? visible[gapIndex - 1] : null;
    const below = gapIndex < visible.length ? visible[gapIndex] : null;
    const targets: DropTarget[] = [];
    const add = (parent: BlockNode | null, index: number) => {
        const t: DropTarget = { parent, index, depth: parent ? parent.depth + 1 : 0 };
        if (!targets.some(x => sameTarget(x, t))) { targets.push(t); }
    };
    const hasVisibleChildren = (b: BlockNode) => b.children.length > 0 && !(b.kind === 'toggle' && b.collapsed);
    // A block above with visible children does not end at this gap (its first child is below it).
    if (above && !hasVisibleChildren(above)) {
        if (isContainer(above)) { add(above, 0); }
        for (let x: BlockNode | null = above; x; x = x.parent) {
            const siblings = siblingsOf(tree, x);
            add(x.parent, siblings.indexOf(x) + 1);
            if (siblings[siblings.length - 1] !== x) { break; }
        }
    }
    if (below) {
        add(below.parent, siblingsOf(tree, below).indexOf(below));
    }
    if (!above && !below) { add(null, 0); }
    return targets
        .filter(t => isDropAllowed(sources, t))
        .sort((a, b) => a.depth - b.depth);
}

// ---------------------------------------------------------------------------
// Moving blocks
// ---------------------------------------------------------------------------

interface Line {
    text: string;
    moved?: boolean;
    tableIndex?: number;
    toggleId?: string;
}

export interface BlockMoveResult {
    spec: TransactionSpec;
    /** The moved blocks' range in the new document. */
    movedFrom: number;
    movedTo: number;
    /** Old table indices (syntax-tree order) in their new order. */
    tableOrder: number[];
    /** Old toggle ids in their new order. */
    toggleOrder: string[];
}

type Neighbour = BlockNode | 'head' | 'start' | 'end';

function bothList(a: BlockNode, b: BlockNode): boolean {
    return a.kind === 'listItem' && b.kind === 'listItem';
}

/** Can block `a` be directly followed by block `b` with no blank line in between? */
function canTouch(a: BlockNode, b: BlockNode): boolean {
    if (bothList(a, b)) { return true; }
    if (a.kind === 'heading' || a.kind === 'hr' || (a.kind === 'code' && a.interrupts)) { return true; }
    return !!b.interrupts;
}

/** A blank line between the moved blocks and what is above them? */
function blankAbove(above: Neighbour, parent: BlockNode | null, moved: BlockNode): boolean {
    if (above === 'start') { return false; }
    if (above === 'head') {
        if (!parent) { return false; }
        if (parent.kind === 'listItem') { return moved.kind !== 'listItem'; }
        return parent.kind === 'toggle';
    }
    if (above === 'end') { return false; }
    if (bothList(above, moved)) { return !above.list!.tight; }
    return true;
}

/** A blank line between the moved blocks and what is below them? `nextLine` is the text after them. */
function blankBelow(moved: BlockNode, below: Neighbour, parent: BlockNode | null, nextLine: string | null): boolean {
    if (nextLine === null) { return false; }
    if (below === 'end') {
        if (!parent) { return false; }
        if (parent.kind === 'toggle') { return true; }
        if (parent.kind === 'callout') { return false; }
        if (parent.kind === 'listItem') { return !ANY_LIST_LINE_RE.test(nextLine); }
        return true;
    }
    if (below === 'head' || below === 'start') { return false; }
    if (bothList(moved, below)) { return !below.list!.tight; }
    return true;
}

function neighbours(
    tree: readonly BlockNode[], parent: BlockNode | null, index: number, skip: ReadonlySet<BlockNode>,
): { prev: BlockNode | null; next: BlockNode | null } {
    const siblings = parent ? parent.children : tree;
    let prev: BlockNode | null = null;
    for (let i = Math.min(index, siblings.length) - 1; i >= 0; i--) { if (!skip.has(siblings[i])) { prev = siblings[i]; break; } }
    let next: BlockNode | null = null;
    for (let i = index; i < siblings.length; i++) { if (!skip.has(siblings[i])) { next = siblings[i]; break; } }
    return { prev, next };
}

function adoptMarker(text: string, like: BlockNode | null, moved: BlockNode): string {
    if (!like || like.kind !== 'listItem' || !like.list || !moved.list || like.list.ordered !== moved.list.ordered) { return text; }
    if (moved.list.ordered) {
        const delim = like.list.marker.slice(-1);
        return text.replace(/^(\d{1,9})[.)]/, `$1${delim}`);
    }
    return text.replace(/^[-+*]/, like.list.marker);
}

function renumberRun(lines: Line[], at: number, start: number): void {
    const sig = ORDERED_LINE_RE.exec(lines[at]?.text ?? '');
    if (!sig) { return; }
    const quoteDepth = (sig[1].match(/>/g) ?? []).length;
    const indent = sig[2].length;
    const delim = sig[4];
    const classify = (text: string): 'same' | 'inside' | 'stop' => {
        const m = ORDERED_LINE_RE.exec(text);
        if (m && (m[1].match(/>/g) ?? []).length === quoteDepth && m[2].length === indent && m[4] === delim) { return 'same'; }
        if (isBlankLine(text)) { return 'inside'; }
        const q = /^((?: {0,3}> ?)*)( *)/.exec(text)!;
        if ((q[1].match(/>/g) ?? []).length === quoteDepth && q[2].length > indent) { return 'inside'; }
        return 'stop';
    };
    let first = at;
    for (let i = at - 1; i >= 0; i--) {
        const k = classify(lines[i].text);
        if (k === 'stop') { break; }
        if (k === 'same') { first = i; }
    }
    let n = start;
    for (let i = first; i < lines.length; i++) {
        const k = classify(lines[i].text);
        if (k === 'stop') { break; }
        if (k === 'same') {
            lines[i].text = lines[i].text.replace(ORDERED_LINE_RE, (_all, q: string, sp: string, _num: string, d: string, after: string) => `${q}${sp}${n}${d}${after}`);
            n++;
        }
    }
}

/**
 * Move `sources` (contiguous siblings) to `target`. Null when the move is not allowed or would
 * leave the document unchanged.
 */
export function computeMoveBlocks(
    state: EditorState, tree: readonly BlockNode[], sources: readonly BlockNode[], target: DropTarget,
): BlockMoveResult | null {
    if (sources.length === 0 || !isDropAllowed(sources, target)) { return null; }
    const srcParent = sources[0].parent;
    if (sources.some(s => s.parent !== srcParent)) { return null; }
    const sourceSet = new Set(sources);
    const doc = state.doc;
    const lines: Line[] = [];
    for (let n = 1; n <= doc.lines; n++) { lines.push({ text: doc.line(n).text }); }
    tagTablesAndToggles(state, lines);
    const original = [...lines];

    const first = sources[0];
    const last = sources[sources.length - 1];
    const srcSiblings = srcParent ? srcParent.children : tree;
    const srcPrev = srcSiblings[srcSiblings.indexOf(first) - 1] ?? null;
    const srcNext = srcSiblings[srcSiblings.indexOf(last) + 1] ?? null;
    const { prev: tPrev, next: tNext } = neighbours(tree, target.parent, target.index, sourceSet);

    // Re-base the moved lines: strip the old context, then add the new one.
    const srcChain = contextChain(srcParent);
    const tgtChain = contextChain(target.parent);
    const tgtPrefix = contextPrefix(tgtChain);
    const tgtBlank = blankLineFor(tgtChain);
    const stripped = lines.slice(first.firstLine - 1, last.lastLine).map(l => stripContextPrefix(l.text, srcChain));
    const baseIndent = /^ */.exec(stripped.find(t => t.trim() !== '') ?? '')![0].length;
    const topStarts = new Set(sources.map(s => s.firstLine - first.firstLine));
    const movedLines: Line[] = stripped.map((text, i) => {
        let t = stripColumns(text, baseIndent);
        if (topStarts.has(i)) {
            const block = sources.find(s => s.firstLine - first.firstLine === i)!;
            if (block.kind === 'listItem') { t = adoptMarker(t, tPrev ?? tNext, block); }
        }
        const orig = lines[first.firstLine - 1 + i];
        return {
            text: isBlankLine(t) && !t.includes('>') ? tgtBlank : tgtPrefix + t,
            moved: true,
            tableIndex: orig.tableIndex,
            toggleId: orig.toggleId,
        };
    });

    // Insertion anchor: a line object that survives the removal.
    let anchor: Line | null;
    let anchorAfter: boolean;
    let above: Neighbour;
    if (tPrev) {
        anchor = lines[tPrev.lastLine - 1];
        anchorAfter = true;
        above = tPrev;
    } else if (target.parent && target.parent.headLastLine !== undefined) {
        anchor = lines[target.parent.headLastLine - 1];
        anchorAfter = true;
        above = 'head';
    } else if (tNext) {
        anchor = lines[tNext.firstLine - 1];
        anchorAfter = false;
        above = 'start';
    } else {
        anchor = target.parent ? lines[target.parent.firstLine - 1] : null;
        anchorAfter = !!target.parent;
        above = 'start';
    }
    const below: Neighbour = tNext ?? 'end';

    // 1. Remove the sources and the blank lines around them; put back one blank line if needed.
    const blankBefore = first.firstLine >= 2 && isBlankLine(lines[first.firstLine - 2].text);
    const blankAfter = last.lastLine < lines.length && isBlankLine(lines[last.lastLine].text);
    let removeFrom = first.firstLine - 1;
    let removeTo = last.lastLine; // exclusive
    const lowerBound = srcPrev ? srcPrev.lastLine : srcParent?.headLastLine ?? (srcParent ? srcParent.firstLine - 1 : 0);
    while (removeFrom > lowerBound && isBlankLine(lines[removeFrom - 1].text)) { removeFrom--; }
    const upperBound = srcNext ? srcNext.firstLine - 1 : (srcParent ? srcParent.lastLine : lines.length);
    while (removeTo < upperBound && isBlankLine(lines[removeTo].text)) { removeTo++; }
    let keepBlank: boolean;
    if (srcPrev && srcNext) {
        keepBlank = blankBefore || blankAfter || !canTouch(srcPrev, srcNext);
    } else if (!srcPrev && !srcNext) {
        keepBlank = srcParent?.kind === 'toggle';
    } else if (!srcPrev) {
        // Head (or region start) above, a sibling below.
        keepBlank = srcParent
            ? (srcParent.kind === 'listItem' ? srcNext!.kind !== 'listItem' : srcParent.kind === 'toggle')
            : false;
    } else {
        // A sibling above, the parent's end (or the document's end) below.
        if (!srcParent) { keepBlank = removeTo < lines.length && blankAfter; } else if (srcParent.kind === 'toggle') { keepBlank = true; } else if (srcParent.kind === 'callout') { keepBlank = false; } else { keepBlank = blankAfter && removeTo < lines.length; }
    }
    if (removeFrom === 0) { keepBlank = false; }
    const seamChain = !srcNext && srcParent ? contextChain(srcParent.parent) : srcChain;
    const seamBlank: Line[] = keepBlank ? [{ text: blankLineFor(seamChain) }] : [];
    // The anchor may sit inside the removed lines (a parent whose last lines were the sources).
    if (anchor) {
        const ai = original.indexOf(anchor);
        if (ai >= removeFrom && ai < removeTo) {
            anchor = anchorAfter ? original[removeFrom - 1] ?? null : original[removeTo] ?? null;
            if (!anchor && !anchorAfter && removeFrom > 0) { anchor = original[removeFrom - 1]; anchorAfter = true; }
        }
    }
    lines.splice(removeFrom, removeTo - removeFrom, ...seamBlank);

    // 2. Insert at the anchor.
    const anchorIndex = anchor ? lines.indexOf(anchor) : 0;
    if (anchorIndex < 0) { return null; }
    const at = anchor ? anchorIndex + (anchorAfter ? 1 : 0) : 0;
    const firstMoved = sources[0];
    const lastMoved = sources[sources.length - 1];
    const group: Line[] = [...movedLines];
    const lineAbove = at > 0 ? lines[at - 1] : null;
    if (blankAbove(above, target.parent, firstMoved) && lineAbove && !isBlankLine(lineAbove.text)) {
        group.unshift({ text: tgtBlank });
    }
    const lineBelow = at < lines.length ? lines[at] : null;
    const belowChain = below === 'end' && target.parent ? contextChain(target.parent.parent) : tgtChain;
    if (lineBelow && !isBlankLine(lineBelow.text)
        && blankBelow(lastMoved, below, target.parent, lineBelow.text)) {
        group.push({ text: blankLineFor(belowChain) });
    }
    lines.splice(at, 0, ...group);

    // 3. Collapse doubled blank lines at the two seams.
    collapseBlanksAround(lines, lines.indexOf(group[0]));
    collapseBlanksAround(lines, lines.indexOf(group[group.length - 1]) + 1);
    const seam = seamBlank[0] ? lines.indexOf(seamBlank[0]) : -1;
    if (seam >= 0) { collapseBlanksAround(lines, seam); }

    // 4. Renumber the ordered lists on both ends.
    const firstMovedIdx = lines.findIndex(l => l.moved);
    const lastMovedIdx = lines.length - 1 - [...lines].reverse().findIndex(l => l.moved);
    const orderedSource = sources.find(src => src.kind === 'listItem' && src.list?.ordered);
    if (orderedSource) {
        const neighbour = [tPrev, tNext].find(n => n?.kind === 'listItem' && n.list?.ordered);
        const start = neighbour
            ? neighbour.list!.start
            : (orderedSource === first && orderedSource.list!.index === 0 ? orderedSource.list!.start : 1);
        renumberRun(lines, lines.indexOf(movedLines[orderedSource.firstLine - first.firstLine]), start);
        const rest = [srcPrev, srcNext].find(n => n?.kind === 'listItem' && n.list?.ordered);
        if (rest) {
            const restIndex = lines.indexOf(original[rest.firstLine - 1]);
            if (restIndex >= 0) { renumberRun(lines, restIndex, rest.list!.start); }
        }
    }

    const newText = lines.map(l => l.text).join('\n');
    const oldText = doc.toString();
    if (newText === oldText) { return null; }

    let movedFrom = 0;
    for (let i = 0; i < firstMovedIdx; i++) { movedFrom += lines[i].text.length + 1; }
    let movedTo = movedFrom;
    for (let i = firstMovedIdx; i <= lastMovedIdx; i++) { movedTo += lines[i].text.length + (i < lastMovedIdx ? 1 : 0); }

    return {
        spec: {
            changes: minimalChange(oldText, newText),
            selection: EditorSelection.single(movedFrom, movedTo),
            annotations: [Transaction.userEvent.of('move.block'), isolateHistory.of('full'), structureEdit.of(true)],
            scrollIntoView: true,
        },
        movedFrom,
        movedTo,
        tableOrder: lines.filter(l => l.tableIndex !== undefined).map(l => l.tableIndex!),
        toggleOrder: lines.filter(l => l.toggleId !== undefined).map(l => l.toggleId!),
    };
}

function tagTablesAndToggles(state: EditorState, lines: Line[]): void {
    let tableIndex = 0;
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name !== 'Table') { return; }
            lines[lineOf(state, node.from) - 1].tableIndex = tableIndex++;
            return false;
        },
    });
    for (const t of findDetailsBlocks(state.doc, state)) { lines[t.openLine - 1].toggleId = t.id; }
}

/** One change that turns `oldText` into `newText`, trimmed to the part that differs. */
function minimalChange(oldText: string, newText: string): { from: number; to: number; insert: string } {
    const max = Math.min(oldText.length, newText.length);
    let p = 0;
    while (p < max && oldText.charCodeAt(p) === newText.charCodeAt(p)) { p++; }
    let s = 0;
    while (s < max - p && oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) { s++; }
    return { from: p, to: oldText.length - s, insert: newText.slice(p, newText.length - s) };
}

function collapseBlanksAround(lines: Line[], index: number): void {
    // The blank run at `index`, or the one just above it.
    let i = index;
    if (!(i < lines.length && isBlankLine(lines[i].text))) { i = index - 1; }
    if (i < 0 || i >= lines.length || !isBlankLine(lines[i].text)) { return; }
    let a = i;
    while (a > 0 && isBlankLine(lines[a - 1].text)) { a--; }
    let b = i;
    while (b < lines.length - 1 && isBlankLine(lines[b + 1].text)) { b++; }
    if (a === 0) {
        lines.splice(0, b + 1);
        return;
    }
    if (b > a) {
        // Keep the line with the fewest `>`: ending a quote is safer than pulling the next block into it.
        const quoteCount = (t: string) => (t.match(/>/g) ?? []).length;
        let keep = a;
        for (let k = a; k <= b; k++) { if (quoteCount(lines[k].text) < quoteCount(lines[keep].text)) { keep = k; } }
        lines.splice(a, b - a + 1, lines[keep]);
    }
}

// ---------------------------------------------------------------------------
// The `+` button
// ---------------------------------------------------------------------------

export interface InsertAfterResult {
    spec: TransactionSpec;
    /** The new line is a plain `/` line: the caller opens the slash menu. */
    openSlashMenu: boolean;
}

/**
 * Add an empty block below `block`. A list item gets an empty sibling item (same marker, task
 * items unchecked); inside a quote or under a list item, an empty line in that context; anywhere
 * else, a `/` line for the slash menu.
 */
export function computeInsertAfter(state: EditorState, block: BlockNode): InsertAfterResult {
    const doc = state.doc;
    const chain = contextChain(block.parent);
    const prefix = contextPrefix(chain);
    const lines: Line[] = [];
    for (let n = 1; n <= doc.lines; n++) { lines.push({ text: doc.line(n).text }); }
    const nextText = block.lastLine < doc.lines ? doc.line(block.lastLine + 1).text : null;
    let insert: Line[];
    let openSlashMenu = false;
    if (block.kind === 'listItem' && block.list) {
        const stripped = stripContextPrefix(doc.line(block.firstLine).text, chain);
        const lead = LIST_MARKER_RE.exec(stripped)?.[1] ?? '';
        const task = /^ *([-+*]|\d{1,9}[.)]) +\[[ xX]\]/.test(stripped) ? '[ ] ' : '';
        const marker = block.list.ordered
            ? `${(parseInt(block.list.marker, 10) || 0) + 1}${block.list.marker.slice(-1)}`
            : block.list.marker;
        insert = [{ text: `${prefix}${lead}${marker} ${task}`, moved: true }];
        if (!block.list.tight) { insert.unshift({ text: blankLineFor(chain) }); }
    } else if (prefix !== '') {
        insert = [{ text: blankLineFor(chain) }, { text: prefix, moved: true }];
    } else {
        insert = [{ text: '' }, { text: '/', moved: true }];
        if (nextText !== null && !isBlankLine(nextText)) { insert.push({ text: '' }); }
        openSlashMenu = true;
    }
    lines.splice(block.lastLine, 0, ...insert);
    const at = lines.findIndex(l => l.moved);
    if (block.kind === 'listItem' && block.list?.ordered) { renumberRun(lines, at, block.list.start); }
    const newText = lines.map(l => l.text).join('\n');
    let cursor = 0;
    for (let i = 0; i < at; i++) { cursor += lines[i].text.length + 1; }
    cursor += lines[at].text.length;
    return {
        spec: {
            changes: minimalChange(doc.toString(), newText),
            selection: EditorSelection.cursor(cursor),
            userEvent: 'input',
            scrollIntoView: true,
        },
        openSlashMenu,
    };
}

// ---------------------------------------------------------------------------
// Position-keyed state that follows a move
// ---------------------------------------------------------------------------

/** Re-key a table-index map after tables changed order (`order[newIndex] = oldIndex`). */
export function remapTableIndexMap<T>(map: Readonly<Record<number, T>>, order: readonly number[]): Record<number, T> {
    const out: Record<number, T> = {};
    order.forEach((oldIndex, newIndex) => {
        if (map[oldIndex] !== undefined) { out[newIndex] = map[oldIndex]; }
    });
    return out;
}

/** Re-key toggle open state after toggles changed order (`oldIds` in new order, `newIds` as found after the move). */
export function remapToggleState(
    stateMap: Readonly<Record<string, boolean>>, oldIds: readonly string[], newIds: readonly string[],
): Record<string, boolean> {
    if (oldIds.length !== newIds.length) { return { ...stateMap }; }
    const out: Record<string, boolean> = {};
    for (const [id, v] of Object.entries(stateMap)) { if (!oldIds.includes(id)) { out[id] = v; } }
    oldIds.forEach((oldId, i) => {
        if (stateMap[oldId] !== undefined) { out[newIds[i]] = stateMap[oldId]; }
    });
    return out;
}
