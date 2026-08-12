import type { EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';
import type { CalloutBlock } from './calloutTypes';
import { formatCalloutOpener, isBuiltinCalloutType, parseCalloutOpener } from './calloutTypes';
import { setCalloutDefaultTypeEffect } from './calloutDefaultType';

export function computeSetCalloutType(
    state: EditorState,
    block: CalloutBlock,
    newType: string,
): TransactionSpec | null {
    const line = state.doc.line(block.openLine);
    const parsed = parseCalloutOpener(line.text);
    if (!parsed) {
        return null;
    }
    const opener = formatCalloutOpener(
        newType,
        parsed.leading,
        isBuiltinCalloutType(newType) ? parsed.titleSuffix : '',
    );
    const spec: TransactionSpec = {
        changes: { from: line.from, to: line.to, insert: opener },
        effects: setCalloutDefaultTypeEffect.of(newType),
    };
    if (!isBuiltinCalloutType(newType)) {
        spec.selection = EditorSelection.cursor(line.from + opener.length);
    }
    return spec;
}
