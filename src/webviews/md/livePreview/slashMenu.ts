// Phase 6 — slash menu for CM6 Preview Edit mode.
//
// Runtime: WEBVIEW (browser). Built on `@codemirror/autocomplete` rather than
// a hand-rolled popup (r1 -> r2 correction in the plan doc): it already gives
// positioning, viewport-flip, keyboard nav (Prec.highest completionKeymap —
// wins over @codemirror/lang-markdown's Prec.high Enter binding while the
// menu is open, falls through to it otherwise), filtering, and
// Esc/blur/scroll dismissal for free. This file is just an option table + a
// completion source + the block-transform each option applies.

import { EditorSelection } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { CompletionContext, pickedCompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionResult, CompletionSource } from '@codemirror/autocomplete';

interface SlashOption {
    label: string;
    /** Text that replaces the "/filter" trigger, starting at the line's first column. */
    insert: string;
    /** Cursor position, as an offset from the start of `insert`. */
    cursorOffset: number;
}

const TABLE_SNIPPET = '| Header 1 | Header 2 | Header 3 |\n| -------- | -------- | -------- |\n| Cell 1   | Cell 2   | Cell 3   |\n';

/** Exported for headless testing of computeSlashApply against the real snippets. */
export const SLASH_OPTIONS: SlashOption[] = [
    { label: 'Text', insert: '', cursorOffset: 0 },
    { label: 'Heading 1', insert: '# ', cursorOffset: 2 },
    { label: 'Heading 2', insert: '## ', cursorOffset: 3 },
    { label: 'Heading 3', insert: '### ', cursorOffset: 4 },
    { label: 'Heading 4', insert: '#### ', cursorOffset: 5 },
    { label: 'Bulleted List', insert: '- ', cursorOffset: 2 },
    { label: 'Numbered List', insert: '1. ', cursorOffset: 3 },
    { label: 'To-do List', insert: '- [ ] ', cursorOffset: 6 },
    { label: 'Callout', insert: ':::info\n\n:::', cursorOffset: 8 },
    { label: 'Quote', insert: '> ', cursorOffset: 2 },
    { label: 'Table', insert: TABLE_SNIPPET, cursorOffset: TABLE_SNIPPET.length },
    { label: 'Divider', insert: '---', cursorOffset: 3 },
];

/** Pure — the same compute-then-dispatch shape as formatCommands.ts's computeXxx functions. */
export function computeSlashApply(option: SlashOption, from: number, to: number): TransactionSpec {
    const slashPos = from - 1;
    return {
        changes: { from: slashPos, to, insert: option.insert },
        selection: EditorSelection.cursor(slashPos + option.cursorOffset),
    };
}

export const slashMenuCompletions: Completion[] = SLASH_OPTIONS.map((option) => ({
    label: option.label,
    type: 'text',
    apply: (view, completion, from, to) => {
        view.dispatch({
            ...computeSlashApply(option, from, to),
            annotations: pickedCompletion.of(completion),
        });
    },
}));

/**
 * Fires only for a lone "/" (plus letters typed so far) that is the entire
 * content of its line — i.e. a slash at the start of an otherwise-empty line.
 * Exported separately from the `CompletionSource` wrapper so it can be
 * exercised headlessly with a hand-built `CompletionContext` (its constructor
 * is public for exactly this — see the class's own doc comment upstream).
 */
export function slashMenuSource(context: CompletionContext): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    if (context.pos !== line.to) { return null; }
    if (!/^\/[a-zA-Z-]*$/.test(line.text)) { return null; }

    return {
        from: line.from + 1,
        to: line.to,
        options: slashMenuCompletions,
        filter: true,
    };
}

export const livePreviewSlashSource: CompletionSource = slashMenuSource;
