// Phase 5 — formatting commands for CM6 Preview Edit mode.
//
// Runtime: WEBVIEW (browser). Ports the Split-mode formatting helpers
// (mdWebview.ts wrapSelection/toggleLinePrefix/... — see CLAUDE.md's
// "formatting commands" note in the plan doc) from an imperative
// mutate-`editor.value`-then-read model to CM6's compute-a-TransactionSpec-
// then-dispatch model. Each `computeXxx` function is a pure function of
// `EditorState` (headlessly testable, no `EditorView`/DOM); each is wrapped
// by `runFormatCommand`/`livePreviewFormatKeymap` for the two real call
// sites: toolbar clicks (mdWebview.ts `applyFormat`) and CM6-native
// keybindings (Tab/Shift-Tab, Mod+letter shortcuts).
//
// Enter-key list/blockquote continuation and smart Backspace are NOT ported
// here — `@codemirror/lang-markdown`'s `markdown({..})` already installs its
// own `markdownKeymap` (Enter -> insertNewlineContinueMarkup, Backspace ->
// deleteMarkupBackward) with `Prec.high`, which is strictly more capable than
// the legacy regex (it also continues blockquotes, which the legacy
// bullet/ordered/checkbox-only regex never did). Reusing it beats
// reimplementing it, same reasoning the plan already applied to the slash
// menu (`@codemirror/autocomplete` over a hand-rolled popup).

import { EditorState, EditorSelection } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { KeyBinding } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

function safeSlice(state: EditorState, from: number, to: number): string {
    const len = state.doc.length;
    const f = Math.max(0, Math.min(from, len));
    const t = Math.max(f, Math.min(to, len));
    return state.sliceDoc(f, t);
}

function dispatchSpec(view: EditorView, spec: TransactionSpec | null): boolean {
    if (!spec) { return false; }
    view.dispatch(spec);
    return true;
}

// ===== Pure compute functions (headlessly testable) =====

export function computeWrapSelection(state: EditorState, before: string, after: string): TransactionSpec {
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);
    const bLen = before.length;
    const aLen = after.length;

    if (from >= bLen && safeSlice(state, from - bLen, from) === before && safeSlice(state, to, to + aLen) === after) {
        return {
            changes: { from: from - bLen, to: to + aLen, insert: selected },
            selection: EditorSelection.range(from - bLen, to - bLen),
        };
    }
    return {
        changes: { from, to, insert: before + selected + after },
        selection: EditorSelection.range(from + bLen, to + bLen),
    };
}

export function computeToggleLinePrefix(state: EditorState, prefix: string): TransactionSpec {
    const { from, to } = state.selection.main;
    const firstLine = state.doc.lineAt(from);
    const lastLine = state.doc.lineAt(to);
    const lineStart = firstLine.from;
    const lineEndFix = lastLine.to;
    const lineContent = state.sliceDoc(lineStart, lineEndFix);

    if (lineContent.startsWith(prefix)) {
        return {
            changes: { from: lineStart, to: lineStart + prefix.length, insert: '' },
            selection: EditorSelection.range(Math.max(lineStart, from - prefix.length), Math.max(lineStart, to - prefix.length)),
        };
    }

    let cleaned = lineContent;
    if (prefix.startsWith('#')) {
        cleaned = lineContent.replace(/^#{1,6}\s/, '');
    }
    const diff = prefix.length + cleaned.length - lineContent.length;
    return {
        changes: { from: lineStart, to: lineEndFix, insert: prefix + cleaned },
        selection: EditorSelection.range(from + diff, to + diff),
    };
}

export function computeInsertAtCursor(state: EditorState, text: string, cursorOffset?: number): TransactionSpec {
    const { from, to } = state.selection.main;
    const pos = cursorOffset !== undefined ? from + cursorOffset : from + text.length;
    return { changes: { from, to, insert: text }, selection: EditorSelection.cursor(pos) };
}

export function computeInsertLink(state: EditorState): TransactionSpec {
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);
    if (selected) {
        return {
            changes: { from, to, insert: '[' + selected + '](url)' },
            selection: EditorSelection.range(to + 3, to + 6),
        };
    }
    return {
        changes: { from, to, insert: '[text](url)' },
        selection: EditorSelection.range(from + 1, from + 5),
    };
}

export function computeInsertImage(state: EditorState): TransactionSpec {
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);
    const alt = selected || 'alt text';
    const snippet = `![${alt}](image-url)`;
    return {
        changes: { from, to, insert: snippet },
        selection: EditorSelection.range(from + alt.length + 4, from + alt.length + 13),
    };
}

export function computeInsertTable(state: EditorState): TransactionSpec {
    const table = '\n| Header 1 | Header 2 | Header 3 |\n| -------- | -------- | -------- |\n| Cell 1   | Cell 2   | Cell 3   |\n';
    return computeInsertAtCursor(state, table);
}

export function computeInsertHorizontalRule(state: EditorState): TransactionSpec {
    const { from } = state.selection.main;
    const before = from === 0 ? '' : '\n';
    return computeInsertAtCursor(state, before + '---\n');
}

export function computeToggleCodeBlock(state: EditorState): TransactionSpec {
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);

    if (selected.startsWith('```') && selected.endsWith('```')) {
        const inner = selected.slice(3, -3).replace(/^\n/, '').replace(/\n$/, '');
        return {
            changes: { from, to, insert: inner },
            selection: EditorSelection.range(from, from + inner.length),
        };
    }
    const body = selected || 'code';
    return {
        changes: { from, to, insert: '```\n' + body + '\n```' },
        selection: EditorSelection.range(from + 4, from + 4 + body.length),
    };
}

export function computeMultiLineIndent(state: EditorState, outdent: boolean): TransactionSpec {
    const { from, to } = state.selection.main;
    const blockFrom = state.doc.lineAt(from).from;
    const blockTo = state.doc.lineAt(to).to;
    const lines = state.sliceDoc(blockFrom, blockTo).split('\n');

    let firstLineShift = 0;
    let totalShift = 0;
    const newLines = lines.map((line, i) => {
        if (outdent) {
            if (line.startsWith('    ')) {
                if (i === 0) { firstLineShift = -4; }
                totalShift -= 4;
                return line.slice(4);
            } else if (line.startsWith('\t')) {
                if (i === 0) { firstLineShift = -1; }
                totalShift -= 1;
                return line.slice(1);
            }
            return line;
        }
        if (i === 0) { firstLineShift = 4; }
        totalShift += 4;
        return '    ' + line;
    });

    return {
        changes: { from: blockFrom, to: blockTo, insert: newLines.join('\n') },
        selection: EditorSelection.range(Math.max(blockFrom, from + firstLineShift), to + totalShift),
    };
}

/**
 * The nearest enclosing ListItem for a position at the start of a physical line — the
 * marker line itself, or a wrapped continuation line within that item's content. Same
 * "walk node.parent for a named ancestor" shape as revealDecorations.ts's
 * enclosingBlockquote.
 */
export function enclosingListItem(state: EditorState, pos: number): SyntaxNode | null {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
        if (node.name === 'ListItem') { return node; }
    }
    return null;
}

/** Count of ListItem ancestors at `pos` — how many list levels deep this position is. */
export function listItemDepth(state: EditorState, pos: number): number {
    let depth = 0;
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
        if (node.name === 'ListItem') { depth++; }
    }
    return depth;
}

export function computeTabIndent(state: EditorState, shiftKey: boolean): TransactionSpec | null {
    const { from, to } = state.selection.main;
    if (from !== to && state.sliceDoc(from, to).includes('\n')) {
        return computeMultiLineIndent(state, shiftKey);
    }

    const line = state.doc.lineAt(from);
    // Resolve the enclosing item from the cursor position itself, not the
    // line's raw start — an already-nested line's leading whitespace can
    // include a "gap" beyond what's structurally required for its own depth,
    // which has no specific enclosing node and would resolve to the wrong
    // (shallower) ancestor. The cursor is always inside real content.
    const item = from === to ? enclosingListItem(state, from) : null;

    if (item) {
        const hasIndent = line.text.startsWith('    ') || line.text.startsWith('\t');
        if (shiftKey && !hasIndent) {
            return null; // Shift-Tab on an already-flush list line stays a true no-op
        }
        const spec = computeMultiLineIndent(state, shiftKey);

        // Only the ListItem's OWN marker line changes list nesting depth — a
        // wrapped continuation line just shifts text, no new level is created,
        // so it's exempt from the check below. For the marker line: prepending/
        // removing a flat 4 spaces is a plain textual step that does NOT always
        // correspond to a valid "one level deeper/shallower" CommonMark nesting
        // (bullet markers only need 2 columns per level, not 4 — a second Tab
        // press, or indenting an item with no preceding sibling to nest under,
        // can overshoot CommonMark's "4+ relative spaces = code block" cutoff
        // and silently swallow the marker into plain/code text). Rather than
        // hand-computing the exact required column per marker width, re-parse
        // the trial result and verify the depth actually changed by exactly
        // one level — if it didn't, the indent/outdent is disabled outright
        // (returns null) instead of corrupting the list.
        const mark = item.getChild('ListMark');
        const isMarkerLine = mark ? state.doc.lineAt(mark.from).number === line.number : false;
        if (isMarkerLine) {
            // Probe depth at the (mapped) cursor position, not the line's raw
            // start — the line's start can sit inside the leading-whitespace
            // gap between the new nested list and its parent's own content,
            // a position with no specific enclosing node, which under-counts
            // depth. The cursor itself is always inside real content.
            const trialState = state.update(spec).state;
            const depthBefore = listItemDepth(state, from);
            const depthAfter = listItemDepth(trialState, trialState.selection.main.from);
            if (depthAfter !== depthBefore + (shiftKey ? -1 : 1)) {
                return null;
            }
        }
        return spec;
    }

    const beforeCursor = state.sliceDoc(line.from, from);
    if (shiftKey) {
        if (beforeCursor.startsWith('    ')) {
            return { changes: { from: line.from, to: line.from + 4, insert: '' }, selection: EditorSelection.cursor(from - 4) };
        }
        if (beforeCursor.startsWith('\t')) {
            return { changes: { from: line.from, to: line.from + 1, insert: '' }, selection: EditorSelection.cursor(from - 1) };
        }
        return null;
    }
    return { changes: { from, to, insert: '    ' }, selection: EditorSelection.cursor(from + 4) };
}

export function computeDuplicateLine(state: EditorState): TransactionSpec {
    const pos = state.selection.main.from;
    const line = state.doc.lineAt(pos);
    const offset = pos - line.from;
    return {
        changes: { from: line.to, to: line.to, insert: '\n' + line.text },
        selection: EditorSelection.cursor(line.to + 1 + offset),
    };
}

export function computeDeleteLine(state: EditorState): TransactionSpec {
    const pos = state.selection.main.from;
    const line = state.doc.lineAt(pos);
    if (line.number === state.doc.lines) {
        const from = Math.max(0, line.from - 1);
        return { changes: { from, to: state.doc.length, insert: '' }, selection: EditorSelection.cursor(from) };
    }
    return { changes: { from: line.from, to: line.to + 1, insert: '' }, selection: EditorSelection.cursor(line.from) };
}

export function computeMoveLineUp(state: EditorState): TransactionSpec | null {
    const { from, to } = state.selection.main;
    const firstLine = state.doc.lineAt(from);
    if (firstLine.number === 1) { return null; }

    const adjustedTo = (to > from && state.sliceDoc(to - 1, to) === '\n') ? to - 1 : to;
    const lastLine = state.doc.lineAt(adjustedTo);
    const prevLine = state.doc.line(firstLine.number - 1);
    const currentBlock = state.sliceDoc(firstLine.from, lastLine.to);
    const shift = firstLine.from - prevLine.from;

    return {
        changes: { from: prevLine.from, to: lastLine.to, insert: currentBlock + '\n' + prevLine.text },
        selection: EditorSelection.range(from - shift, to - shift),
    };
}

export function computeMoveLineDown(state: EditorState): TransactionSpec | null {
    const { from, to } = state.selection.main;
    const firstLine = state.doc.lineAt(from);
    const adjustedTo = (to > from && state.sliceDoc(to - 1, to) === '\n') ? to - 1 : to;
    const lastLine = state.doc.lineAt(adjustedTo);
    if (lastLine.number === state.doc.lines) { return null; }

    const nextLine = state.doc.line(lastLine.number + 1);
    const currentBlock = state.sliceDoc(firstLine.from, lastLine.to);
    const shift = nextLine.text.length + 1;

    return {
        changes: { from: firstLine.from, to: nextLine.to, insert: nextLine.text + '\n' + currentBlock },
        selection: EditorSelection.range(from + shift, to + shift),
    };
}

export function computeSelectWord(state: EditorState): TransactionSpec | null {
    const pos = state.selection.main.from;
    const wordChars = /[\w-]/;
    let wStart = pos;
    let wEnd = pos;
    while (wStart > 0 && wordChars.test(state.sliceDoc(wStart - 1, wStart))) { wStart--; }
    while (wEnd < state.doc.length && wordChars.test(state.sliceDoc(wEnd, wEnd + 1))) { wEnd++; }
    if (wStart === wEnd) { return null; }
    return { selection: EditorSelection.range(wStart, wEnd) };
}

export function computeTransformCase(state: EditorState, mode: 'upper' | 'lower' | 'title'): TransactionSpec | null {
    const { from, to } = state.selection.main;
    if (from === to) { return null; }
    const selected = state.sliceDoc(from, to);
    const transformed = mode === 'upper' ? selected.toUpperCase()
        : mode === 'lower' ? selected.toLowerCase()
        : selected.replace(/\b\w/g, c => c.toUpperCase());
    return {
        changes: { from, to, insert: transformed },
        selection: EditorSelection.range(from, from + transformed.length),
    };
}

export function computeSortSelectedLines(state: EditorState, descending: boolean): TransactionSpec | null {
    const { from, to } = state.selection.main;
    if (from === to) { return null; }
    const firstLine = state.doc.lineAt(from);
    const lastLine = state.doc.lineAt(to);
    const lines = state.sliceDoc(firstLine.from, lastLine.to).split('\n');
    lines.sort((a, b) => descending ? b.localeCompare(a) : a.localeCompare(b));
    const sorted = lines.join('\n');
    return {
        changes: { from: firstLine.from, to: lastLine.to, insert: sorted },
        selection: EditorSelection.range(firstLine.from, firstLine.from + sorted.length),
    };
}

export function computeTrimTrailingWhitespace(state: EditorState): TransactionSpec | null {
    const text = state.doc.toString();
    const re = /[ \t]+$/gm;
    const changes: { from: number; to: number; insert: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        changes.push({ from: m.index, to: m.index + m[0].length, insert: '' });
    }
    if (changes.length === 0) { return null; }
    return { changes };
}

function runJumpToLine(view: EditorView): boolean {
    const lineCount = view.state.doc.lines;
    const input = window.prompt(`Go to line (1-${lineCount}):`);
    if (!input) { return false; }
    const lineNum = parseInt(input, 10);
    if (isNaN(lineNum) || lineNum < 1 || lineNum > lineCount) { return false; }
    const pos = view.state.doc.line(lineNum).from;
    view.dispatch({
        selection: EditorSelection.cursor(pos),
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    return true;
}

// ===== Dispatch table — one entry point for both the toolbar and the keymap =====

export function runFormatCommand(view: EditorView, action: string): boolean {
    const { state } = view;
    switch (action) {
        case 'bold': return dispatchSpec(view, computeWrapSelection(state, '**', '**'));
        case 'italic': return dispatchSpec(view, computeWrapSelection(state, '*', '*'));
        case 'strikethrough': return dispatchSpec(view, computeWrapSelection(state, '~~', '~~'));
        case 'inlineCode': return dispatchSpec(view, computeWrapSelection(state, '`', '`'));
        case 'codeBlock': return dispatchSpec(view, computeToggleCodeBlock(state));
        case 'link': return dispatchSpec(view, computeInsertLink(state));
        case 'image': return dispatchSpec(view, computeInsertImage(state));
        case 'table': return dispatchSpec(view, computeInsertTable(state));
        case 'heading1': return dispatchSpec(view, computeToggleLinePrefix(state, '# '));
        case 'heading2': return dispatchSpec(view, computeToggleLinePrefix(state, '## '));
        case 'heading3': return dispatchSpec(view, computeToggleLinePrefix(state, '### '));
        case 'bulletList': return dispatchSpec(view, computeToggleLinePrefix(state, '- '));
        case 'orderedList': return dispatchSpec(view, computeToggleLinePrefix(state, '1. '));
        case 'checkbox': return dispatchSpec(view, computeToggleLinePrefix(state, '- [ ] '));
        case 'blockquote': return dispatchSpec(view, computeToggleLinePrefix(state, '> '));
        case 'hr': return dispatchSpec(view, computeInsertHorizontalRule(state));
        case 'duplicateLine': return dispatchSpec(view, computeDuplicateLine(state));
        case 'deleteLine': return dispatchSpec(view, computeDeleteLine(state));
        case 'moveUp': return dispatchSpec(view, computeMoveLineUp(state));
        case 'moveDown': return dispatchSpec(view, computeMoveLineDown(state));
        case 'selectWord': return dispatchSpec(view, computeSelectWord(state));
        case 'jumpToLine': return runJumpToLine(view);
        case 'uppercase': return dispatchSpec(view, computeTransformCase(state, 'upper'));
        case 'lowercase': return dispatchSpec(view, computeTransformCase(state, 'lower'));
        case 'titlecase': return dispatchSpec(view, computeTransformCase(state, 'title'));
        case 'sortLines': return dispatchSpec(view, computeSortSelectedLines(state, false));
        case 'sortLinesDesc': return dispatchSpec(view, computeSortSelectedLines(state, true));
        case 'trimWhitespace': return dispatchSpec(view, computeTrimTrailingWhitespace(state));
        default: return false;
    }
}

// ===== CM6-native keymap — Tab/Shift-Tab (no CM6 default) + Mod shortcuts =====
// Placed ahead of `defaultKeymap` in the EditorView's extensions (see
// livePreviewEditor.ts) so these win over any colliding default binding
// (e.g. defaultKeymap's own "Mod-i" -> selectParentSyntax).

export const livePreviewFormatKeymap: KeyBinding[] = [
    { key: 'Tab', run: (view) => { dispatchSpec(view, computeTabIndent(view.state, false)); return true; } },
    { key: 'Shift-Tab', run: (view) => { dispatchSpec(view, computeTabIndent(view.state, true)); return true; } },
    { key: 'Mod-b', run: (view) => runFormatCommand(view, 'bold') },
    { key: 'Mod-i', run: (view) => runFormatCommand(view, 'italic') },
    { key: 'Mod-k', run: (view) => runFormatCommand(view, 'link') },
    { key: 'Mod-e', run: (view) => runFormatCommand(view, 'inlineCode') },
    { key: 'Mod-Shift-e', run: (view) => runFormatCommand(view, 'codeBlock') },
    { key: 'Mod-Shift-x', run: (view) => runFormatCommand(view, 'strikethrough') },
    { key: 'Mod-l', run: (view) => runFormatCommand(view, 'bulletList') },
    { key: 'Mod-Shift-l', run: (view) => runFormatCommand(view, 'orderedList') },
    { key: 'Mod-1', run: (view) => runFormatCommand(view, 'heading1') },
    { key: 'Mod-2', run: (view) => runFormatCommand(view, 'heading2') },
    { key: 'Mod-3', run: (view) => runFormatCommand(view, 'heading3') },
    { key: 'Mod-Shift-d', run: (view) => runFormatCommand(view, 'duplicateLine') },
    { key: 'Mod-Shift-k', run: (view) => runFormatCommand(view, 'deleteLine') },
    { key: 'Mod-d', run: (view) => runFormatCommand(view, 'selectWord') },
    { key: 'Mod-g', run: (view) => runFormatCommand(view, 'jumpToLine') },
    { key: 'Mod-Shift-u', run: (view) => runFormatCommand(view, 'uppercase') },
    { key: 'Mod-u', run: (view) => runFormatCommand(view, 'lowercase') },
    { key: 'Alt-ArrowUp', run: (view) => runFormatCommand(view, 'moveUp') },
    { key: 'Alt-ArrowDown', run: (view) => runFormatCommand(view, 'moveDown') },
];
