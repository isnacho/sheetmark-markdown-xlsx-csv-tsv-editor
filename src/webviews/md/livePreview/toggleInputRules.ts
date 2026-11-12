// Notion-style typed shortcuts: `> ` turns a paragraph or heading into a toggle, `" ` into a quote.
// Runtime: WEBVIEW. Pure compute functions (testable headlessly) plus one inputHandler.
//
// Only typed input reaches an inputHandler, so paste, the slash menu and programmatic edits never
// convert. The typed space is applied first and the conversion second, in separate undo steps, so a
// single Undo restores the literal `> ` / `"`.

import { EditorSelection } from '@codemirror/state';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { FENCE_RE, HEADING_RE, isBlankLine, sectionEndLine, structureEdit, toggleText } from './detailsEditing';

const LIST_RE = /^\s*([-*+]|\d+[.)])(\s|$)/;
const BREAK_RE = /^(\*{3,}|-{3,}|_{3,})\s*$/;

/** A rest-of-line that is not a plain paragraph or heading (list, table, quote, fence, rule, code). */
function restIsOtherBlock(rest: string): boolean {
    return LIST_RE.test(rest) || BREAK_RE.test(rest) || /^(>|\||    |\t)/.test(rest) || FENCE_RE.test(rest);
}

function insideFrontmatter(state: EditorState, lineNo: number): boolean {
    const { doc } = state;
    if (doc.lines < 2 || doc.line(1).text.trim() !== '---') { return false; }
    for (let n = 2; n <= doc.lines; n++) {
        const t = doc.line(n).text.trim();
        if (t === '---' || t === '...') { return lineNo <= n; }
    }
    return false;
}

/** Whether the line sits inside fenced code or a table, where typing must stay literal. */
function inLiteralContext(state: EditorState, lineNo: number): boolean {
    if (insideFrontmatter(state, lineNo)) { return true; }
    const line = state.doc.line(lineNo);
    const tree = ensureSyntaxTree(state, line.to, 50) ?? syntaxTree(state);
    for (let node: { name: string; parent: unknown } | null = tree.resolveInner(Math.min(line.from + 1, line.to), 1); node;) {
        if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'Table') { return true; }
        node = node.parent as typeof node;
    }
    return false;
}

/**
 * `state` already contains the typed space, cursor at `pos` right after it. Returns the transaction
 * that converts the line to a toggle, or null when the line is not a convertible paragraph/heading.
 */
export function computeToggleFromMarker(state: EditorState, pos: number): TransactionSpec | null {
    const { doc } = state;
    const line = doc.lineAt(pos);
    const atStart = /^> (.*)$/.exec(line.text);
    const afterHashes = /^(#{1,6}) > (.*)$/.exec(line.text);
    let rest: string;
    if (atStart && pos === line.from + 2) {
        rest = atStart[1];
    } else if (afterHashes && pos === line.from + afterHashes[1].length + 3) {
        rest = `${afterHashes[1]} ${afterHashes[2]}`;
    } else {
        return null;
    }
    if (restIsOtherBlock(rest) || inLiteralContext(state, line.number)) { return null; }

    const heading = HEADING_RE.exec(rest);
    let endNo = line.number;
    let title = rest;
    let body = '';
    if (heading) {
        endNo = sectionEndLine(doc, line.number, heading[1].length);
        if (endNo > line.number) {
            body = doc.sliceString(doc.line(line.number + 1).from, doc.line(endNo).to).replace(/^\s*\n/, '').replace(/\s+$/, '');
        }
    } else if (!isBlankLine(rest)) {
        // The whole paragraph is the title, not just its first line.
        for (let n = line.number + 1; n <= doc.lines; n++) {
            const text = doc.line(n).text;
            if (isBlankLine(text) || HEADING_RE.test(text) || FENCE_RE.test(text) || LIST_RE.test(text)) { break; }
            title += `\n${text}`;
            endNo = n;
        }
    } else {
        title = '';
    }

    const { text, titleOffset, bodyOffset } = toggleText(title, body);
    const cursor = heading
        ? line.from + titleOffset + title.length
        : title === '' ? line.from + titleOffset : line.from + bodyOffset;
    return {
        changes: { from: line.from, to: doc.line(endNo).to, insert: text },
        selection: EditorSelection.cursor(cursor),
    };
}

/** `" ` at the start of a line becomes a Markdown quote (`> `). Same state contract as above. */
export function computeQuoteFromMarker(state: EditorState, pos: number): TransactionSpec | null {
    const line = state.doc.lineAt(pos);
    if (!line.text.startsWith('" ') || pos !== line.from + 2) { return null; }
    if (inLiteralContext(state, line.number)) { return null; }
    return {
        changes: { from: line.from, to: line.from + 1, insert: '>' },
        selection: EditorSelection.cursor(pos),
    };
}

export const toggleInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== ' ' || from !== to || view.state.readOnly) { return false; }
    const line = view.state.doc.lineAt(from);
    const before = view.state.sliceDoc(line.from, from);
    const kind = before === '>' || /^#{1,6} >$/.test(before) ? 'toggle' : before === '"' ? 'quote' : null;
    if (!kind) { return false; }
    const typed = view.state.update({
        changes: { from, insert: ' ' },
        selection: EditorSelection.cursor(from + 1),
        userEvent: 'input.type',
    });
    const spec = kind === 'toggle' ? computeToggleFromMarker(typed.state, from + 1) : computeQuoteFromMarker(typed.state, from + 1);
    if (!spec) { return false; }
    view.dispatch(typed);
    view.dispatch({
        ...spec,
        annotations: [isolateHistory.of('before'), structureEdit.of(true)],
        userEvent: 'input.toggle',
    });
    return true;
});
