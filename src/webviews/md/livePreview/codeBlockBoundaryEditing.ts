// Logical ↑↓ arrow navigation inside fenced code blocks for CM6 Preview Edit.
//
// Runtime: WEBVIEW (browser). Pure compute helpers are headlessly testable;
// the keymap wires in livePreviewEditor.ts next to codeStylingPlugin.
//
// Fenced-code line decorations add vertical padding on the first/last lines for
// the card look (cm6Theme.ts). CM6's default vertical movement is visual, so
// caret motion can skip interior lines or jump out of the block. This module
// walks one document line at a time while inside a FencedCode syntax node.

import { EditorState, EditorSelection, Prec } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

function fencedCodeNodeAtLine(state: EditorState, lineNumber: number): SyntaxNode | null {
    const line = state.doc.line(lineNumber);
    let found: SyntaxNode | null = null;
    syntaxTree(state).iterate({
        from: line.from,
        to: line.to,
        enter(node) {
            if (node.name === 'FencedCode') {
                found = node.node;
            }
        },
    });
    return found;
}

function fencedCodeLineBounds(state: EditorState, node: SyntaxNode): { firstLine: number; lastLine: number } {
    return {
        firstLine: state.doc.lineAt(node.from).number,
        lastLine: state.doc.lineAt(node.to).number,
    };
}

function posAtColumn(state: EditorState, lineNumber: number, sourcePos: number): number {
    const sourceLine = state.doc.lineAt(sourcePos);
    const offset = sourcePos - sourceLine.from;
    const targetLine = state.doc.line(lineNumber);
    return targetLine.from + Math.min(offset, targetLine.length);
}

function selectionAtLineColumn(state: EditorState, lineNumber: number, sourcePos: number): TransactionSpec {
    return { selection: EditorSelection.cursor(posAtColumn(state, lineNumber, sourcePos)) };
}

/** True when `pos` sits on a line inside a FencedCode syntax node. */
export function isPosInsideFencedCode(state: EditorState, pos: number): boolean {
    return fencedCodeNodeAtLine(state, state.doc.lineAt(pos).number) !== null;
}

/** Logical line-at-a-time ↑↓ inside fenced code, plus enter/exit at adjacent boundaries. */
export function computeFencedCodeArrow(
    state: EditorState,
    direction: 'up' | 'down',
): TransactionSpec | null {
    const sel = state.selection.main;
    if (!sel.empty) { return null; }

    const line = state.doc.lineAt(sel.head);
    const fence = fencedCodeNodeAtLine(state, line.number);

    if (fence) {
        const { firstLine, lastLine } = fencedCodeLineBounds(state, fence);
        if (direction === 'down') {
            if (line.number < lastLine) {
                return selectionAtLineColumn(state, line.number + 1, sel.head);
            }
            if (line.number === lastLine && lastLine < state.doc.lines) {
                return selectionAtLineColumn(state, lastLine + 1, sel.head);
            }
            return null;
        }
        if (line.number > firstLine) {
            return selectionAtLineColumn(state, line.number - 1, sel.head);
        }
        if (line.number === firstLine && firstLine > 1) {
            return selectionAtLineColumn(state, firstLine - 1, sel.head);
        }
        return null;
    }

    if (direction === 'down') {
        const nextLineNum = line.number + 1;
        if (nextLineNum > state.doc.lines) { return null; }
        const nextFence = fencedCodeNodeAtLine(state, nextLineNum);
        if (!nextFence) { return null; }
        const { firstLine } = fencedCodeLineBounds(state, nextFence);
        if (nextLineNum !== firstLine) { return null; }
        return selectionAtLineColumn(state, firstLine, sel.head);
    }

    const prevLineNum = line.number - 1;
    if (prevLineNum < 1) { return null; }
    const prevFence = fencedCodeNodeAtLine(state, prevLineNum);
    if (!prevFence) { return null; }
    const { lastLine } = fencedCodeLineBounds(state, prevFence);
    if (prevLineNum !== lastLine) { return null; }
    return selectionAtLineColumn(state, lastLine, sel.head);
}

function runFencedCodeArrow(view: EditorView, direction: 'up' | 'down'): boolean {
    const spec = computeFencedCodeArrow(view.state, direction);
    if (!spec) {
        if (isPosInsideFencedCode(view.state, view.state.selection.main.head)) {
            return true;
        }
        return false;
    }
    const pos = view.state.update(spec).state.selection.main.head;
    view.dispatch({ ...spec, effects: EditorView.scrollIntoView(pos) });
    return true;
}

export const codeBlockNavigationKeymap = Prec.highest(keymap.of([
    { key: 'ArrowUp', run: (view) => runFencedCodeArrow(view, 'up') },
    { key: 'ArrowDown', run: (view) => runFencedCodeArrow(view, 'down') },
]));
