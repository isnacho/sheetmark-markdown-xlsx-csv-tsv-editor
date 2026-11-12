// Toggle blocks: standard HTML `<details>` / `<summary>` written in the Markdown file.
//
// Runtime: WEBVIEW (browser). Pure detection only (no decorations). The Markdown parser's HTMLBlock
// nodes cannot delimit a toggle (a blank line ends one), so this scans lines like findCalloutBlocks.
//
// Two shapes are recognised. Sheetmark writes the first; the second is what other tools write.
//
//   <details open>            <details open>
//   <summary>                 <summary>Title</summary>
//                             (blank)
//   Title as Markdown         body
//
//   </summary>                </details>
//
//   body
//
//   </details>

import { Text } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

const OPEN_RE = /^\s*<details((?:\s[^>]*)?)>\s*$/i;
const CLOSE_RE = /^\s*<\/details>\s*$/i;
const SUMMARY_OPEN_RE = /^\s*<summary>\s*$/i;
const SUMMARY_CLOSE_RE = /^\s*<\/summary>\s*$/i;
const LEGACY_SUMMARY_RE = /^(\s*<summary>)(.*?)(<\/summary>\s*)$/i;

export interface Range { from: number; to: number; }

export interface DetailsBlock {
    /** Stable id: plain title text plus occurrence index among blocks with the same title. */
    id: string;
    /** Plain-text title (formatting stripped). */
    title: string;
    /** The `open` attribute is present. */
    initiallyOpen: boolean;
    /** One-line `<summary>Title</summary>` written by another tool. */
    legacy: boolean;
    openLine: number;
    closeLine: number;
    /** The editable title span: first title line start to last title line end. */
    titleFrom: number;
    titleTo: number;
    /** Inline ranges hidden inside the title line (legacy `<summary>` / `</summary>` and inner tags). */
    inlineHidden: Range[];
    /** Hidden lines before the title (opener, `<summary>`, blank). Ends at the title's line start. */
    headRun: Range;
    /** Hidden lines between the title and the body (blank, `</summary>`, blank). Null for the legacy shape. */
    tailRun: Range | null;
    /** The `</details>` line including its line break, preceded by the body's trailing blank line when it has one. */
    closerRun: Range;
    /** Offsets of the body's first line start and last line end; null when there are no body lines. */
    bodyFrom: number | null;
    bodyTo: number | null;
    bodyLineCount: number;
    /** Number of enclosing toggles, 0 for top-level. */
    depth: number;
}

function lineIsInsideFencedCode(state: EditorState, lineNumber: number): boolean {
    const line = state.doc.line(lineNumber);
    let inside = false;
    syntaxTree(state).iterate({
        from: line.from,
        to: line.to,
        enter(node) {
            if (node.name === 'FencedCode') { inside = true; }
        },
    });
    return inside;
}

/** Plain text of a Markdown/HTML title, for ids and for tools that only want words. */
export function plainTitle(raw: string): string {
    return raw
        .replace(/<[^>]*>/g, '')
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_~`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isBlank(doc: Text, n: number): boolean {
    return doc.line(n).text.trim() === '';
}

/**
 * The `</details>` run and the body's end. When the body ends with a blank line (the separator Sheetmark
 * writes before `</details>`), that blank line is hidden together with the closing tag, so a toggle does
 * not add an extra empty line of space after its last body line. A body that is only one blank line
 * (a fresh toggle waiting for text) keeps it: it is the line the cursor types in.
 */
function closerAndBody(doc: Text, closeLine: number, bodyStart: number): { closerRun: Range; bodyTo: number | null; bodyLineCount: number } {
    const count = Math.max(0, closeLine - bodyStart);
    const closeEnd = Math.min(doc.length, doc.line(closeLine).to + 1);
    if (count >= 2 && isBlank(doc, closeLine - 1)) {
        return { closerRun: { from: doc.line(closeLine - 1).from, to: closeEnd }, bodyTo: doc.line(closeLine - 2).to, bodyLineCount: count - 1 };
    }
    return { closerRun: { from: doc.line(closeLine).from, to: closeEnd }, bodyTo: count > 0 ? doc.line(closeLine - 1).to : null, bodyLineCount: count };
}

function buildBlock(doc: Text, o: number, c: number, attrs: string, depth: number): DetailsBlock | null {
    const initiallyOpen = /\bopen\b/i.test(attrs);
    if (o + 1 >= c) { return null; }
    const second = doc.line(o + 1).text;

    if (SUMMARY_OPEN_RE.test(second)) {
        // New shape: <summary>, blank, title, blank, </summary>, blank, body.
        let s = -1;
        for (let n = o + 3; n < c; n++) {
            if (SUMMARY_CLOSE_RE.test(doc.line(n).text)) { s = n; break; }
        }
        if (s < o + 5 || !isBlank(doc, o + 2) || !isBlank(doc, s - 1)) { return null; }
        const titleFirst = o + 3;
        const titleLast = s - 2;
        const bodyStart = s + 1 < c && isBlank(doc, s + 1) ? s + 2 : s + 1;
        const { closerRun, bodyTo, bodyLineCount } = closerAndBody(doc, c, bodyStart);
        const titleFrom = doc.line(titleFirst).from;
        const titleTo = doc.line(titleLast).to;
        return {
            id: '',
            title: plainTitle(doc.sliceString(titleFrom, titleTo)),
            initiallyOpen,
            legacy: false,
            openLine: o,
            closeLine: c,
            titleFrom,
            titleTo,
            inlineHidden: [],
            headRun: { from: doc.line(o).from, to: titleFrom },
            tailRun: { from: doc.line(s - 1).from, to: bodyLineCount > 0 ? doc.line(bodyStart).from : closerRun.from },
            closerRun,
            bodyFrom: bodyLineCount > 0 ? doc.line(bodyStart).from : null,
            bodyTo,
            bodyLineCount,
            depth,
        };
    }

    const legacy = LEGACY_SUMMARY_RE.exec(second);
    if (!legacy) { return null; }
    const summary = doc.line(o + 1);
    const titleFrom = summary.from + legacy[1].length;
    const titleTo = titleFrom + legacy[2].length;
    const inlineHidden: Range[] = [];
    if (summary.from < titleFrom) { inlineHidden.push({ from: summary.from, to: titleFrom }); }
    for (const tag of legacy[2].matchAll(/<[^>]*>/g)) {
        inlineHidden.push({ from: titleFrom + tag.index!, to: titleFrom + tag.index! + tag[0].length });
    }
    if (titleTo < summary.to) { inlineHidden.push({ from: titleTo, to: summary.to }); }
    const bodyStart = o + 2;
    const { closerRun, bodyTo, bodyLineCount } = closerAndBody(doc, c, bodyStart);
    return {
        id: '',
        title: plainTitle(legacy[2]),
        initiallyOpen,
        legacy: true,
        openLine: o,
        closeLine: c,
        titleFrom,
        titleTo,
        inlineHidden,
        headRun: { from: doc.line(o).from, to: summary.from },
        tailRun: null,
        closerRun,
        bodyFrom: bodyLineCount > 0 ? doc.line(bodyStart).from : null,
        bodyTo,
        bodyLineCount,
        depth,
    };
}

/**
 * Every complete toggle in the document, outer blocks before their nested ones. Anything that does
 * not have the exact shape (including an unclosed opener) is plain text and never hides content.
 */
export function findDetailsBlocks(doc: Text, state?: EditorState): DetailsBlock[] {
    interface Open { line: number; attrs: string; }
    const stack: Open[] = [];
    const found: DetailsBlock[] = [];

    for (let n = 1; n <= doc.lines; n++) {
        const text = doc.line(n).text;
        const open = OPEN_RE.exec(text);
        if (open && !(state && lineIsInsideFencedCode(state, n))) {
            stack.push({ line: n, attrs: open[1] ?? '' });
            continue;
        }
        if (CLOSE_RE.test(text) && stack.length > 0 && !(state && lineIsInsideFencedCode(state, n))) {
            const opener = stack.pop()!;
            const block = buildBlock(doc, opener.line, n, opener.attrs, stack.length);
            if (block) { found.push(block); }
        }
    }

    found.sort((a, b) => a.openLine - b.openLine);
    const seen = new Map<string, number>();
    for (const block of found) {
        const count = seen.get(block.title) ?? 0;
        seen.set(block.title, count + 1);
        block.id = `${block.title.slice(0, 100)}#${count}`;
    }
    return found;
}

/** Whether the block is currently open: the user's choice, else the `open` attribute. */
export function isDetailsOpen(block: DetailsBlock, userState: Readonly<Record<string, boolean>>): boolean {
    return userState[block.id] ?? block.initiallyOpen;
}

/** Ranges of every tag character the user never sees (not the closed body). Sorted by start. */
export function toggleTagRanges(blocks: readonly DetailsBlock[]): Range[] {
    const ranges: Range[] = [];
    for (const b of blocks) {
        ranges.push(b.headRun, b.closerRun, ...b.inlineHidden);
        if (b.tailRun) { ranges.push(b.tailRun); }
    }
    return ranges.sort((a, b) => a.from - b.from);
}

/** `text` with every hidden tag removed, for word counts. Pure string in, string out. */
export function stripToggleTags(text: string): string {
    if (!text.includes('<')) { return text; }
    const doc = Text.of(text.split('\n'));
    const ranges = toggleTagRanges(findDetailsBlocks(doc));
    if (ranges.length === 0) { return text; }
    let out = '';
    let at = 0;
    for (const r of ranges) {
        if (r.from > at) { out += text.slice(at, r.from); }
        at = Math.max(at, r.to);
    }
    return out + text.slice(at);
}
