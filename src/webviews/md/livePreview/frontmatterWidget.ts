import { EditorState, StateField, StateEffect } from '@codemirror/state';
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
        return createFrontmatterCardElement({
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

function buildFromState(state: EditorState): DecorationSet {
    let data;
    try {
        data = resolveFrontmatterWidgetData(state.doc.toString());
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
    update(_value, tr) {
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
