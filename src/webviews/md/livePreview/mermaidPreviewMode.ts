import { StateField, StateEffect } from '@codemirror/state';

export type MermaidPreviewMode = 'diagram' | 'code';

export const setMermaidPreviewModeEffect = StateEffect.define<MermaidPreviewMode>();

export const mermaidPreviewModeField = StateField.define<MermaidPreviewMode>({
    create: () => 'diagram',
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setMermaidPreviewModeEffect)) {
                return effect.value;
            }
        }
        return value;
    },
});

export function seedMermaidPreviewMode(mode: MermaidPreviewMode): ReturnType<typeof mermaidPreviewModeField.init> {
    return mermaidPreviewModeField.init(() => (mode === 'code' ? 'code' : 'diagram'));
}
