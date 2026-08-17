import { EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { findActiveCalloutBlock } from './calloutTypes';
import type { CalloutBlock } from './calloutTypes';
import { computeSetCalloutType } from './calloutEditing';
import {
    BUILTIN_CALLOUT_TYPES,
    CALLOUT_TYPE_LABELS,
    CUSTOM_CALLOUT_OPTION,
    CUSTOM_CALLOUT_TYPE_SLUG,
    isBuiltinCalloutType,
} from './calloutTypes';

let onCalloutDefaultTypeChangedCallback: ((type: string) => void) | undefined;

export function setCalloutDefaultTypeCallback(callback: ((type: string) => void) | undefined): void {
    onCalloutDefaultTypeChangedCallback = callback;
}

function activeBlock(view: EditorView, fallback: CalloutBlock): CalloutBlock {
    return findActiveCalloutBlock(view.state) ?? fallback;
}

function dispatchCalloutType(view: EditorView, block: CalloutBlock, newType: string): void {
    const spec = computeSetCalloutType(view.state, block, newType);
    if (!spec) {
        return;
    }
    view.dispatch(spec);
    onCalloutDefaultTypeChangedCallback?.(newType);
}

function populateTypeSelect(select: HTMLSelectElement, currentType: string): void {
    select.replaceChildren();
    for (const type of BUILTIN_CALLOUT_TYPES) {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = CALLOUT_TYPE_LABELS[type];
        option.selected = currentType === type;
        select.appendChild(option);
    }
    const customOption = document.createElement('option');
    customOption.value = CUSTOM_CALLOUT_OPTION;
    customOption.textContent = 'Custom';
    customOption.selected = !isBuiltinCalloutType(currentType);
    select.appendChild(customOption);
}

function createTypeSelect(view: EditorView, block: CalloutBlock): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'cm-md-callout-type-select';
    select.title = 'Callout type';
    populateTypeSelect(select, block.type);

    select.addEventListener('mousedown', (event) => event.stopPropagation());
    select.addEventListener('change', () => {
        const active = activeBlock(view, block);
        if (select.value === CUSTOM_CALLOUT_OPTION) {
            dispatchCalloutType(view, active, CUSTOM_CALLOUT_TYPE_SLUG);
            return;
        }
        dispatchCalloutType(view, active, select.value);
    });
    return select;
}

class CalloutTypeWidget extends WidgetType {
    constructor(private readonly block: CalloutBlock) {
        super();
    }

    eq(other: CalloutTypeWidget): boolean {
        return other.block.openFrom === this.block.openFrom
            && other.block.type === this.block.type;
    }

    ignoreEvent(): boolean {
        return true;
    }

    toDOM(view: EditorView): HTMLElement {
        const wrap = document.createElement('span');
        wrap.className = 'cm-md-callout-type-toolbar';
        wrap.appendChild(createTypeSelect(view, this.block));
        return wrap;
    }
}

function buildFromState(state: EditorState): DecorationSet {
    const block = findActiveCalloutBlock(state);
    if (!block) {
        return Decoration.none;
    }
    return Decoration.set([
        Decoration.widget({
            side: 1,
            widget: new CalloutTypeWidget(block),
        }).range(block.openTo),
    ]);
}

export const calloutWidgetField = StateField.define<DecorationSet>({
    create: (state) => buildFromState(state),
    update(value, tr) {
        if (!tr.docChanged) {
            return value;
        }
        return buildFromState(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
});
