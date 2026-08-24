// Phase 6 — slash menu for CM6 Preview Edit mode.
//
// Runtime: WEBVIEW (browser). Built on `@codemirror/autocomplete` rather than
// a hand-rolled popup (r1 -> r2 correction in the plan doc): it already gives
// positioning, viewport-flip, keyboard nav (Prec.highest completionKeymap —
// wins over @codemirror/lang-markdown's Prec.high Enter binding while the
// menu is open, falls through to it otherwise), filtering, and
// Esc/blur/scroll dismissal for free. This file is just an option table + a
// completion source + the block-transform each option applies.

import { EditorSelection, EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { autocompletion, CompletionContext, pickedCompletion, selectedCompletionIndex, setSelectedCompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { Icons } from '../../shared/icons';
import { renderMenuIcon } from '../../shared/menuPanel';
import { calloutDefaultTypeField } from './calloutDefaultType';
import { buildCalloutSnippet, calloutCursorOffsetForType } from './calloutTypes';

type SlashIconKey = keyof Pick<typeof Icons,
    'Paragraph' | 'Heading' | 'ListBullet' | 'ListOrdered' | 'Checkbox' |
    'Callout' | 'Quote' | 'TableInsert' | 'HorizontalRule'
>;

interface SlashOption {
    label: string;
    /** Text that replaces the "/filter" trigger, starting at the line's first column. */
    insert: string;
    /** Cursor position, as an offset from the start of `insert`. */
    cursorOffset: number;
    icon: SlashIconKey;
    /** Muted shortcut hint shown on the right (Notion-style markdown cue). */
    hint?: string;
}

const TABLE_SNIPPET = '|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n';

/** Exported for headless testing of computeSlashApply against the real snippets. */
export const SLASH_OPTIONS: SlashOption[] = [
    { label: 'Text', insert: '', cursorOffset: 0, icon: 'Paragraph' },
    { label: 'Heading 1', insert: '# ', cursorOffset: 2, icon: 'Heading', hint: '#' },
    { label: 'Heading 2', insert: '## ', cursorOffset: 3, icon: 'Heading', hint: '##' },
    { label: 'Heading 3', insert: '### ', cursorOffset: 4, icon: 'Heading', hint: '###' },
    { label: 'Heading 4', insert: '#### ', cursorOffset: 5, icon: 'Heading', hint: '####' },
    { label: 'Bulleted List', insert: '- ', cursorOffset: 2, icon: 'ListBullet', hint: '-' },
    { label: 'Numbered List', insert: '1. ', cursorOffset: 3, icon: 'ListOrdered', hint: '1.' },
    { label: 'To-do List', insert: '- [ ] ', cursorOffset: 6, icon: 'Checkbox', hint: '[ ]' },
    { label: 'Callout', insert: ':::info\n\n:::', cursorOffset: 8, icon: 'Callout', hint: ':::' },
    { label: 'Quote', insert: '> ', cursorOffset: 2, icon: 'Quote', hint: '>' },
    { label: 'Table', insert: TABLE_SNIPPET, cursorOffset: TABLE_SNIPPET.length, icon: 'TableInsert', hint: '|' },
    { label: 'Divider', insert: '---', cursorOffset: 3, icon: 'HorizontalRule', hint: '---' },
];

/** Label → toolbar SVG HTML, for slash-menu icon rendering and tests. */
export const SLASH_ICON_BY_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
    SLASH_OPTIONS.map((option) => [option.label, Icons[option.icon]]),
);

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
    ...(option.hint ? { detail: option.hint } : {}),
    apply: (view, completion, from, to) => {
        if (option.label === 'Callout') {
            const type = view.state.field(calloutDefaultTypeField);
            const insert = buildCalloutSnippet(type);
            const slashPos = from - 1;
            view.dispatch({
                changes: { from: slashPos, to, insert },
                selection: EditorSelection.cursor(slashPos + calloutCursorOffsetForType(type)),
                annotations: pickedCompletion.of(completion),
            });
            return;
        }
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

function renderSlashMenuIcon(completion: Completion, _state: EditorState, _view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.innerHTML = renderMenuIcon(SLASH_ICON_BY_LABEL[completion.label] ?? '');
    return wrap.firstElementChild as HTMLElement;
}

const SLASH_MENU_TOOLTIP_SELECTOR = '.cm-tooltip-autocomplete.cm-slash-menu-tooltip';

function parseSlashMenuOptionIndex(li: Element): number | null {
    const match = /-(\d+)$/.exec(li.id);
    return match ? +match[1] : null;
}

/**
 * Sync pointer hover to CM6's `aria-selected` so keyboard and mouse share one
 * highlight — no separate CSS :hover row.
 */
class SlashMenuPointerPlugin {
    private detachPointer: (() => void) | null = null;
    private attachedTooltip: Element | null = null;

    constructor(private readonly view: EditorView) {
        this.syncTooltipListeners();
    }

    update(_update: ViewUpdate): void {
        this.syncTooltipListeners();
    }

    destroy(): void {
        this.detach();
    }

    private syncTooltipListeners(): void {
        const tooltip = document.querySelector(SLASH_MENU_TOOLTIP_SELECTOR);
        if (tooltip === this.attachedTooltip) { return; }
        this.detach();
        if (!tooltip) { return; }
        const onPointerOver = (event: Event) => {
            const li = (event.target as Element).closest('li[role="option"]');
            if (!li || !tooltip.contains(li)) { return; }
            const index = parseSlashMenuOptionIndex(li);
            if (index === null) { return; }
            if (selectedCompletionIndex(this.view.state) === index) { return; }
            this.view.dispatch({ effects: setSelectedCompletion(index) });
        };
        tooltip.addEventListener('pointerover', onPointerOver);
        this.attachedTooltip = tooltip;
        this.detachPointer = () => tooltip.removeEventListener('pointerover', onPointerOver);
    }

    private detach(): void {
        this.detachPointer?.();
        this.detachPointer = null;
        this.attachedTooltip = null;
    }
}

const slashMenuPointerPlugin = ViewPlugin.fromClass(SlashMenuPointerPlugin);

/** CM6 autocomplete extension: slash source + icon row + themed tooltip classes. */
export function slashMenuAutocompletion(): Extension {
    return [
        autocompletion({
            override: [livePreviewSlashSource],
            icons: false,
            selectOnOpen: false,
            tooltipClass: () => 'cm-slash-menu-tooltip',
            optionClass: () => 'cm-slash-menu-option',
            addToOptions: [{ position: 20, render: renderSlashMenuIcon }],
        }),
        slashMenuPointerPlugin,
    ];
}
