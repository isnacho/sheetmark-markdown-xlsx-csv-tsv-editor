import { StateEffect, StateField } from '@codemirror/state';
import { normalizeCalloutTypeSlug, CUSTOM_CALLOUT_TYPE_SLUG } from './calloutTypes';

export const setCalloutDefaultTypeEffect = StateEffect.define<string>();

export const calloutDefaultTypeField = StateField.define<string>({
    create: () => 'info',
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setCalloutDefaultTypeEffect)) {
                const slug = normalizeCalloutTypeSlug(effect.value);
                if (slug !== null) {
                    return slug;
                }
            }
        }
        return value;
    },
});

export function seedCalloutDefaultType(type: string): ReturnType<typeof calloutDefaultTypeField.init> {
    const slug = normalizeCalloutTypeSlug(type);
    if (slug === '') {
        return calloutDefaultTypeField.init(() => CUSTOM_CALLOUT_TYPE_SLUG);
    }
    return calloutDefaultTypeField.init(() => slug ?? 'info');
}
