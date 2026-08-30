// Smart list paste for CM6 Preview Edit — merge clipboard lists into empty list
// items instead of inserting at the cursor (which doubles markers: "- - item").
//
// Runtime: WEBVIEW (browser). Pure compute helpers are headlessly testable;
// wired from livePreviewEditor.ts paste handler.

import { EditorState, EditorSelection } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';

/** Mirrored from listMarkerEditing.ts — kept local for Node ESM test loading. */
function isEmptyActivatedListItem(lineText: string): boolean {
    return /^\s*(?:\d+[.)]\s*|[-*+]\s(?:\[[ xX]\]\s)?)$/.test(lineText);
}

export interface ParsedListMarkerLine {
    indent: string;
    marker: string;
    content: string;
}

const TASK_RE = /^(\s*)([-*+])\s\[([ xX])\]\s(.*)$/;
const BULLET_RE = /^(\s*)([-*+])\s(?!\[)(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)([.)])\s(.*)$/;

/** Parse one physical line that starts with an activated list marker. */
export function parseListMarkerLine(line: string): ParsedListMarkerLine | null {
    let m = line.match(TASK_RE);
    if (m) {
        return { indent: m[1], marker: `${m[2]} [${m[3]}] `, content: m[4] };
    }
    m = line.match(BULLET_RE);
    if (m) {
        return { indent: m[1], marker: `${m[2]} `, content: m[3] };
    }
    m = line.match(ORDERED_RE);
    if (m) {
        return { indent: m[1], marker: `${m[2]}${m[3]} `, content: m[4] };
    }
    return null;
}

type ParsedClipboardLine =
    | ParsedListMarkerLine
    | { kind: 'blank' }
    | { kind: 'continuation'; indent: string; content: string };

function parseClipboardLines(text: string): ParsedClipboardLine[] | null {
    const parsed: ParsedClipboardLine[] = [];
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        if (!line.trim()) {
            parsed.push({ kind: 'blank' });
            continue;
        }
        const marker = parseListMarkerLine(line);
        if (marker) {
            parsed.push(marker);
            continue;
        }
        const cont = line.match(/^(\s+)(.*)$/);
        if (cont) {
            parsed.push({ kind: 'continuation', indent: cont[1], content: cont[2] });
            continue;
        }
        return null;
    }
    return parsed;
}

/** True when clipboard text is a markdown list (marker lines + optional continuations). */
export function clipboardLooksLikeList(text: string): boolean {
    const lines = parseClipboardLines(text);
    if (!lines) { return false; }
    let sawMarker = false;
    for (const line of lines) {
        if ('kind' in line) { continue; }
        sawMarker = true;
    }
    return sawMarker;
}

function extractCurrentLineMarker(lineText: string): { indent: string; marker: string } | null {
    if (!isEmptyActivatedListItem(lineText)) { return null; }
    const trimmed = lineText.trimEnd();
    const m = trimmed.match(/^(\s*)(.*)$/);
    if (!m) { return null; }
    const indent = m[1];
    const rest = m[2];

    const task = rest.match(/^([-*+])\s\[([ xX])\]\s?$/);
    if (task) { return { indent, marker: `${task[1]} [${task[2]}] ` }; }

    const bullet = rest.match(/^([-*+])\s?$/);
    if (bullet) { return { indent, marker: `${bullet[1]} ` }; }

    const ordered = rest.match(/^(\d+)([.)])\s?$/);
    if (ordered) { return { indent, marker: `${ordered[1]}${ordered[2]} ` }; }

    return null;
}

/**
 * Merge clipboard list lines into an empty target list item, preserving relative
 * nesting and using the target marker for the first item.
 */
export function mergeListPasteIntoEmptyItem(
    targetIndent: string,
    targetMarker: string,
    clipboardText: string,
): string {
    const parsedLines = parseClipboardLines(clipboardText);
    if (!parsedLines) { return clipboardText.replace(/\r\n?/g, '\n'); }
    const markerLines = parsedLines.filter((l): l is ParsedListMarkerLine => !('kind' in l));
    const pasteBaseIndentLen = markerLines.reduce(
        (min, l) => Math.min(min, l.indent.length),
        markerLines[0]?.indent.length ?? 0,
    );

    const out: string[] = [];
    let firstMarker = true;

    for (const entry of parsedLines) {
        if ('kind' in entry) {
            if (entry.kind === 'blank') {
                out.push('');
                continue;
            }
            const relative = entry.indent.length - pasteBaseIndentLen;
            const extra = relative > 0 ? ' '.repeat(relative) : '';
            out.push(targetIndent + extra + entry.content);
            continue;
        }

        const relative = entry.indent.length - pasteBaseIndentLen;
        const extra = relative > 0 ? ' '.repeat(relative) : '';
        if (firstMarker) {
            out.push(targetIndent + targetMarker + entry.content);
            firstMarker = false;
        } else {
            out.push(targetIndent + extra + entry.marker + entry.content);
        }
    }

    while (out.length > 0 && out[out.length - 1] === '') {
        out.pop();
    }
    return out.join('\n');
}

/** Paste a list into an empty list item, or null to fall through to default paste. */
export function computePasteList(state: EditorState, clipboardText: string): TransactionSpec | null {
    if (!clipboardText || !clipboardLooksLikeList(clipboardText)) { return null; }

    const { from, to } = state.selection.main;
    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);
    if (startLine.number !== endLine.number) { return null; }
    if (!isEmptyActivatedListItem(startLine.text)) { return null; }

    const current = extractCurrentLineMarker(startLine.text);
    if (!current) { return null; }

    const insert = mergeListPasteIntoEmptyItem(current.indent, current.marker, clipboardText);
    return {
        changes: { from: startLine.from, to: startLine.to, insert },
        selection: EditorSelection.cursor(startLine.from + insert.length),
    };
}
