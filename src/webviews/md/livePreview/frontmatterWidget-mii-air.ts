import { EditorState, StateField, StateEffect, EditorSelection } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { resolveFrontmatterWidgetData } from '../frontmatter';
import { createFrontmatterCardElement } from '../frontmatterCardUi';

export const setFrontmatterCollapsedEffect = StateEffect.define<boolean>();
export const setFrontmatterEditingEffect = StateEffect.define<boolean>();

export const frontmatterCollapsedField = StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setFrontmatterCollapsedEffect)) {
                return effect.value;
            }
        }
        return value;
    },
});

export const frontmatterEditingField = StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setFrontmatterEditingEffect)) {
                return effect.value;
            }
        }
        return value;
    },
});

class FrontmatterWidget extends WidgetType {
    constructor(
        private readonly data: NonNullable<ReturnType<typeof resolveFrontmatterWidgetData>>,
        private readonly collapsed: boolean,
        private readonly editing: boolean,
        private readonly onCollapsedChanged: ((collapsed: boolean) => void) | undefined,
    ) {
        super();
    }

    eq(other: FrontmatterWidget): boolean {
        return other.collapsed === this.collapsed
            && other.editing === this.editing
            && other.data.range.from === this.data.range.from
            && other.data.range.to === this.data.range.to
            && other.data.yamlText === this.data.yamlText
            && other.data.rows.length === this.data.rows.length
            && other.data.rows.every((row, index) => {
                const mine = this.data.rows[index];
                return mine.key === row.key
                    && mine.displayValue === row.displayValue
                    && mine.kind === row.kind
                    && mine.depth === row.depth;
            });
    }

    ignoreEvent(): boolean {
        return true;
    }

    toDOM(view: EditorView): HTMLElement {
        const dom = createFrontmatterCardElement({
            yamlText: this.data.yamlText,
            rows: this.data.rows,
            collapsed: this.collapsed,
            editing: this.editing,
            onCollapsedChange: (collapsed) => {
                view.dispatch({ effects: setFrontmatterCollapsedEffect.of(collapsed) });
                this.onCollapsedChanged?.(collapsed);
            },
            onEditingChange: (editing) => {
                view.dispatch({ effects: setFrontmatterEditingEffect.of(editing) });
            },
            onSave: (block) => {
                view.dispatch({
                    changes: { from: this.data.range.from, to: this.data.range.to, insert: block },
                    effects: setFrontmatterEditingEffect.of(false),
                });
            },
        });

        // The card is a block replace widget (`ignoreEvent` below), so CM6 never
        // sees clicks on it — place the cursor after the frontmatter block and
        // return focus to the editor (same idea as table cell click wiring).
        dom.addEventListener('mousedown', (event) => {
            if (view.state.readOnly) { return; }
            const target = event.target;
            if (!(target instanceof HTMLElement)) { return; }
            if (target.closest('button, textarea, select, a, input')) { return; }
            event.preventDefault();
            view.dispatch({
                selection: EditorSelection.cursor(this.data.range.to),
                effects: setFrontmatterEditingEffect.of(false),
                scrollIntoView: true,
            });
            view.focus();
        });

        return dom;
    }

    updateDOM(dom: HTMLElement, view: EditorView): boolean {
        const next = this.toDOM(view);
        dom.replaceWith(next);
        return true;
    }
}

let onCollapsedChangedCallback: ((collapsed: boolean) => void) | undefined;

export function setFrontmatterCollapsedCallback(callback: ((collapsed: boolean) => void) | undefined): void {
    onCollapsedChangedCallback = callback;
}

function frontmatterDocPrefix(state: EditorState): string {
    const doc = state.doc;
    for (let n = 2; n <= doc.lines; n++) {
        if (/^---[ \t]*$/.test(doc.line(n).text)) {
            return doc.sliceString(0, doc.line(n).to);
        }
    }
    return doc.sliceString(0, Math.min(doc.length, 8192));
}

function buildFromState(state: EditorState): DecorationSet {
    let data;
    try {
        data = resolveFrontmatterWidgetData(frontmatterDocPrefix(state));
    } catch {
        return Decoration.none;
    }
    if (!data) {
        return Decoration.none;
    }
    const collapsed = state.field(frontmatterCollapsedField);
    const editing = state.field(frontmatterEditingField);
    return Decoration.set([
        Decoration.replace({
            block: true,
            widget: new FrontmatterWidget(data, collapsed, editing, onCollapsedChangedCallback),
        }).range(data.range.from, data.range.to),
    ]);
}

export const frontmatterWidgetField = StateField.define<DecorationSet>({
    create: (state) => buildFromState(state),
    update(value, tr) {
        const uiToggled = tr.effects.some((effect) =>
            effect.is(setFrontmatterCollapsedEffect) || effect.is(setFrontmatterEditingEffect),
        );
        if (!tr.docChanged && !uiToggled) {
            return value;
        }
        return buildFromState(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
});

export function seedFrontmatterCollapsed(collapsed: boolean): ReturnType<typeof frontmatterCollapsedField.init> {
    return frontmatterCollapsedField.init(() => collapsed);
}

export function seedFrontmatterEditing(editing: boolean): ReturnType<typeof frontmatterEditingField.init> {
    return frontmatterEditingField.init(() => editing);
}

/** Leave the YAML card textarea so CM6 can own keyboard focus (e.g. Cmd+A). */
export function blurActiveFrontmatterEditing(): void {
    const textarea = document.querySelector('.yaml-frontmatter-textarea');
    if (textarea instanceof HTMLTextAreaElement) {
        textarea.blur();
    }
}
