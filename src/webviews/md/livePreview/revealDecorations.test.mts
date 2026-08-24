// Headless test: CM6 EditorState only, no DOM / no EditorView / no VS Code host.
// One case per mark type x cursor-in/out (per the plan's Phase 4 exit bar), plus
// the nested ***bold-italic*** overlap hazard called out in the plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import {
    computeRevealDecorations, computeToggleTaskMarker, TaskCheckboxWidget, HorizontalRuleWidget,
    numberToLowerAlpha, numberToLowerRoman, formatOrderedMarkerLabel,
    OrderedMarkerWidget, BulletMarkerWidget, computeOrderedMarkerRanges,
} from './revealDecorations.ts';

// GFM is required for Strikethrough/TaskList nodes to exist in the tree at
// all (bare `markdown()` is CommonMark-only) — matches production's own
// `markdown({ extensions: GFM })` in livePreviewEditor.ts.
function stateFor(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
}

interface FlatDeco { from: number; to: number; class: string | undefined; }

function decorate(doc: string, selFrom: number, selTo = selFrom): FlatDeco[] {
    const state = stateFor(doc);
    const set = computeRevealDecorations(state, selFrom, selTo, [{ from: 0, to: doc.length }]);
    const out: FlatDeco[] = [];
    set.between(0, doc.length, (from, to, value) => {
        out.push({ from, to, class: (value.spec as { class?: string }).class });
    });
    return out;
}

test('heading: cursor away hides "#" and its gap space, applies heading-size class to the text', () => {
    const doc = '# Title\n\nbody';
    const decos = decorate(doc, doc.indexOf('body'));
    assert.deepEqual(decos, [
        { from: 0, to: 1, class: undefined }, // "#" marker
        { from: 1, to: 2, class: undefined }, // the grammar's implicit one-space gap
        { from: 2, to: 7, class: 'cm-md-heading-content cm-md-h1' },
    ]);
});

test('heading: collapsed caret at end of title-less "#" or "# " reveals the marker while typing', () => {
    assert.deepEqual(decorate('#', 1), [
        { from: 0, to: 1, class: 'cm-md-reveal-mark cm-md-h1' },
    ]);
    assert.deepEqual(decorate('# ', 2), [
        { from: 0, to: 2, class: 'cm-md-reveal-mark cm-md-h1' },
    ]);
});

test('heading: cursor on the heading line shows "#" dimmed AT THE HEADING\'S OWN SIZE, and content KEEPS its size styling', () => {
    const doc = '# Title\n\nbody';
    const decos = decorate(doc, doc.indexOf('Title'));
    assert.deepEqual(decos, [
        // Marker + its gap space are one combined dimmed span, sized to match
        // the heading level (cm-md-h1) — a bare cm-md-reveal-mark (no size
        // class) would render smaller than the heading text right next to it.
        { from: 0, to: 2, class: 'cm-md-reveal-mark cm-md-h1' },
        { from: 2, to: 7, class: 'cm-md-heading-content cm-md-h1' },
    ]);
});

test('bold: cursor away hides both ** and bolds the content', () => {
    const doc = 'plain **bold** plain';
    const decos = decorate(doc, 0);
    assert.deepEqual(decos, [
        { from: 6, to: 8, class: undefined },
        { from: 8, to: 12, class: 'cm-md-strong-content' },
        { from: 12, to: 14, class: undefined },
    ]);
});

test('bold: cursor inside shows both ** dimmed but KEEPS the bold styling', () => {
    const doc = 'plain **bold** plain';
    const decos = decorate(doc, doc.indexOf('bold'));
    assert.deepEqual(decos, [
        { from: 6, to: 8, class: 'cm-md-reveal-mark' },
        { from: 8, to: 12, class: 'cm-md-strong-content' },
        { from: 12, to: 14, class: 'cm-md-reveal-mark' },
    ]);
});

test('italic: cursor away hides both * and italicizes the content', () => {
    const doc = 'plain *italic* plain';
    const decos = decorate(doc, 0);
    assert.deepEqual(decos, [
        { from: 6, to: 7, class: undefined },
        { from: 7, to: 13, class: 'cm-md-em-content' },
        { from: 13, to: 14, class: undefined },
    ]);
});

test('italic: cursor inside shows both * dimmed but KEEPS the italic styling', () => {
    const doc = 'plain *italic* plain';
    const decos = decorate(doc, doc.indexOf('italic'));
    assert.deepEqual(decos, [
        { from: 6, to: 7, class: 'cm-md-reveal-mark' },
        { from: 7, to: 13, class: 'cm-md-em-content' },
        { from: 13, to: 14, class: 'cm-md-reveal-mark' },
    ]);
});

test('nested ***bold-italic***: outer emphasis and inner strong both reveal independently', () => {
    // lezer resolves *** as an outer 1-char-marked Emphasis wrapping a 2-char-marked
    // StrongEmphasis (confirmed by walking the tree), not the other way around —
    // either nesting order exercises the same "handle overlap" hazard from the plan.
    const doc = 'xx ***wow*** xx';
    const decos = decorate(doc, 0); // cursor in the leading "xx", away from *** entirely
    const classes = decos.map(d => d.class);
    assert.ok(classes.includes('cm-md-em-content'), 'expected the outer emphasis content styling');
    assert.ok(classes.includes('cm-md-strong-content'), 'expected the inner strong content styling');
    const hidden = decos.filter(d => d.class === undefined);
    assert.ok(hidden.some(d => d.to - d.from === 1), 'expected the outer 1-char * to be hidden');
    assert.ok(hidden.some(d => d.to - d.from === 2), 'expected the inner 2-char ** to be hidden');
});

test('nested ***bold-italic***: cursor inside dims all four marks but keeps both content styles', () => {
    const doc = 'xx ***wow*** xx';
    const decos = decorate(doc, doc.indexOf('wow'));
    const marks = decos.filter(d => d.class === 'cm-md-reveal-mark');
    assert.equal(marks.length, 4); // 2 outer marks + 2 inner marks, all dimmed
    const classes = decos.map(d => d.class);
    assert.ok(classes.includes('cm-md-em-content'), 'expected the outer emphasis content styling to persist');
    assert.ok(classes.includes('cm-md-strong-content'), 'expected the inner strong content styling to persist');
});

// ===== Phase 7: extended reveal set =====

test('strikethrough: cursor away hides both ~~ and strikes the content', () => {
    const doc = 'plain ~~strike~~ plain';
    const decos = decorate(doc, 0);
    assert.deepEqual(decos, [
        { from: 6, to: 8, class: undefined },
        { from: 8, to: 14, class: 'cm-md-strike-content' },
        { from: 14, to: 16, class: undefined },
    ]);
});

test('strikethrough: cursor inside shows both ~~ dimmed but KEEPS the strike styling', () => {
    const doc = 'plain ~~strike~~ plain';
    const decos = decorate(doc, doc.indexOf('strike'));
    assert.deepEqual(decos, [
        { from: 6, to: 8, class: 'cm-md-reveal-mark' },
        { from: 8, to: 14, class: 'cm-md-strike-content' },
        { from: 14, to: 16, class: 'cm-md-reveal-mark' },
    ]);
});

test('inlineCode: cursor away hides both backticks (content look comes from codeStylingPlugin, not here)', () => {
    const doc = 'plain `code` plain';
    const decos = decorate(doc, 0);
    assert.deepEqual(decos, [
        { from: 6, to: 7, class: undefined },
        { from: 11, to: 12, class: undefined },
    ]);
});

test('inlineCode: cursor inside shows both backticks dimmed', () => {
    const doc = 'plain `code` plain';
    const decos = decorate(doc, doc.indexOf('code'));
    assert.deepEqual(decos, [
        { from: 6, to: 7, class: 'cm-md-reveal-mark' },
        { from: 11, to: 12, class: 'cm-md-reveal-mark' },
    ]);
});

test('link: cursor away hides "[" and "](url)", styles the label text', () => {
    const doc = 'see [text](url) here';
    const decos = decorate(doc, 0);
    assert.deepEqual(decos, [
        { from: 4, to: 5, class: undefined },
        { from: 5, to: 9, class: 'cm-md-link-content' },
        { from: 9, to: 15, class: undefined },
    ]);
});

test('link: cursor inside shows "[" and "](url)" dimmed but KEEPS the label styling', () => {
    const doc = 'see [text](url) here';
    const decos = decorate(doc, doc.indexOf('text'));
    assert.deepEqual(decos, [
        { from: 4, to: 5, class: 'cm-md-reveal-mark' },
        { from: 5, to: 9, class: 'cm-md-link-content' },
        { from: 9, to: 15, class: 'cm-md-reveal-mark' },
    ]);
});

test('link: cursor immediately after the closing ")" stays collapsed (paste-to-link caret)', () => {
    const doc = 'see [text](url) here';
    const decos = decorate(doc, doc.indexOf(') ') + 1);
    assert.deepEqual(decos, [
        { from: 4, to: 5, class: undefined },
        { from: 5, to: 9, class: 'cm-md-link-content' },
        { from: 9, to: 15, class: undefined },
    ]);
});

test('link: URL-as-label (paste-to-link with no selection) collapses when caret is after the link', () => {
    const doc = '[https://example.com](https://example.com)';
    const decos = decorate(doc, doc.length);
    assert.deepEqual(decos, [
        { from: 0, to: 1, class: undefined },
        { from: 1, to: 20, class: 'cm-md-link-content' },
        { from: 20, to: doc.length, class: undefined },
    ]);
});

test('blockquote: cursor away hides "> " on every line and adds one line decoration per line', () => {
    const doc = '> quote one\n> quote two\n\nplain';
    const decos = decorate(doc, doc.indexOf('plain'));
    const hiddenMarks = decos.filter(d => d.class === undefined && d.to > d.from);
    assert.equal(hiddenMarks.length, 4); // "> " (mark + gap space) x 2 lines
    assert.equal(decos.filter(d => d.class === 'cm-md-blockquote-line').length, 2);
});

test('blockquote: cursor on one line dims "> " on EVERY line (node-wide active), not just that line', () => {
    const doc = '> quote one\n> quote two\n\nplain';
    const decos = decorate(doc, doc.indexOf('two'));
    const dimmed = decos.filter(d => d.class === 'cm-md-reveal-mark');
    assert.equal(dimmed.length, 2); // one ">" per line, both dimmed though the cursor is only on line 2
    // Still one line decoration per line regardless of active state.
    assert.equal(decos.filter(d => d.class === 'cm-md-blockquote-line').length, 2);
});

function widgetsOfType<T>(doc: string, ctor: new (...args: never[]) => T, selFrom = 0, selTo = selFrom): { from: number; to: number; widget: T }[] {
    const state = stateFor(doc);
    const set = computeRevealDecorations(state, selFrom, selTo, [{ from: 0, to: doc.length }]);
    const widgets: { from: number; to: number; widget: T }[] = [];
    set.between(0, doc.length, (from, to, value) => {
        const widget = (value.spec as { widget?: unknown }).widget;
        if (widget instanceof ctor) { widgets.push({ from, to, widget }); }
    });
    return widgets;
}

function orderedMarkerWidgets(doc: string): { from: number; to: number; widget: OrderedMarkerWidget }[] {
    return widgetsOfType(doc, OrderedMarkerWidget);
}

test('list marker: partial markers stay plain text until the gap space is typed', () => {
    for (const partial of ['1.', '-', '- [ ]', '12.']) {
        assert.equal(orderedMarkerWidgets(partial).length, 0, partial);
        assert.equal(widgetsOfType(partial, BulletMarkerWidget).length, 0, partial);
        assert.equal(widgetsOfType(partial, TaskCheckboxWidget).length, 0, partial);
    }
    assert.equal(orderedMarkerWidgets('1. ').length, 1);
    assert.equal(widgetsOfType('- ', BulletMarkerWidget).length, 1);
    assert.equal(widgetsOfType('- [ ] ', TaskCheckboxWidget).length, 1);
});

test('list marker: bullets get the dot widget regardless of cursor position', () => {
    const doc = '- one\n- two\n';
    for (const pos of [0, doc.indexOf('two')]) {
        const widgets = widgetsOfType(doc, BulletMarkerWidget, pos, pos);
        assert.equal(widgets.length, 2, `expected 2 bullet widgets at cursor ${pos}`);
        assert.equal(widgets.every(w => !w.widget.nested), true, 'top-level bullets should not be nested');
    }
});

test('list marker: nested bullets get the outline (nested) dot widget, top-level stays filled', () => {
    const doc = '- one\n  - nested\n    - deeper\n';
    const widgets = widgetsOfType(doc, BulletMarkerWidget);
    assert.deepEqual(widgets.map(w => w.widget.nested), [false, true, true]);
});

test('numberToLowerAlpha: 1->a, rolls over at 26/27, and at 52/53', () => {
    assert.equal(numberToLowerAlpha(1), 'a');
    assert.equal(numberToLowerAlpha(26), 'z');
    assert.equal(numberToLowerAlpha(27), 'aa');
    assert.equal(numberToLowerAlpha(28), 'ab');
    assert.equal(numberToLowerAlpha(52), 'az');
    assert.equal(numberToLowerAlpha(53), 'ba');
});

test('numberToLowerRoman: standard subtractive cases', () => {
    assert.equal(numberToLowerRoman(1), 'i');
    assert.equal(numberToLowerRoman(4), 'iv');
    assert.equal(numberToLowerRoman(9), 'ix');
    assert.equal(numberToLowerRoman(40), 'xl');
    assert.equal(numberToLowerRoman(90), 'xc');
    assert.equal(numberToLowerRoman(2026), 'mmxxvi');
});

test('formatOrderedMarkerLabel: cycles decimal -> alpha -> roman -> decimal, preserves delimiter', () => {
    assert.equal(formatOrderedMarkerLabel(1, 3, '.'), '3.');
    assert.equal(formatOrderedMarkerLabel(2, 3, '.'), 'c.');
    assert.equal(formatOrderedMarkerLabel(3, 3, '.'), 'iii.');
    assert.equal(formatOrderedMarkerLabel(4, 3, '.'), '3.');
    assert.equal(formatOrderedMarkerLabel(1, 3, ')'), '3)');
});

test('ordered marker: plain top-level list gets sequential decimal labels via a widget, no bullet dot widget', () => {
    const doc = '1. one\n2. two\n3. three\n';
    const widgets = orderedMarkerWidgets(doc);
    assert.deepEqual(widgets.map(w => w.widget.label), ['1.', '2.', '3.']);
    assert.equal(widgetsOfType(doc, BulletMarkerWidget).length, 0);
});

test('ordered marker: a blank line between items resets numbering for the next segment', () => {
    const doc = '1. one\n2. two\n\n1. three\n';
    assert.deepEqual(orderedMarkerWidgets(doc).map(w => w.widget.label), ['1.', '2.', '1.']);
});

test('ordered marker: a blank line resets numbering even when the next marker digit is wrong', () => {
    const doc = '1. one\n2. two\n\n3. four\n';
    assert.deepEqual(orderedMarkerWidgets(doc).map(w => w.widget.label), ['1.', '2.', '1.']);
});

test('ordered marker: numbering is positional, ignoring mismatched typed digits', () => {
    const doc = '1. one\n1. two\n1. three\n';
    assert.deepEqual(orderedMarkerWidgets(doc).map(w => w.widget.label), ['1.', '2.', '3.']);
});

test('ordered marker: seeds from the first item\'s own typed starting number', () => {
    const doc = '5. one\n6. two\n7. three\n';
    assert.deepEqual(orderedMarkerWidgets(doc).map(w => w.widget.label), ['5.', '6.', '7.']);
});

test('ordered marker: nested list renders alpha at depth 2, roman at depth 3, in document order', () => {
    const doc = '1. one\n   1. nested-a\n   2. nested-b\n      1. deeper-a\n';
    const widgets = orderedMarkerWidgets(doc);
    assert.deepEqual(widgets.map(w => w.widget.label), ['1.', 'a.', 'b.', 'i.']);
});

test('ordered marker: ")" delimiter is preserved in the rendered label', () => {
    const doc = '1) one\n2) two\n';
    assert.deepEqual(orderedMarkerWidgets(doc).map(w => w.widget.label), ['1)', '2)']);
});

test('ordered marker: a numbered checklist item still gets the widget (no dash to hide)', () => {
    const doc = '1. [ ] a\n2. [x] b\n';
    assert.deepEqual(orderedMarkerWidgets(doc).map(w => w.widget.label), ['1.', '2.']);
});

test('checkbox dash: hidden for a bullet task item, single-space gap', () => {
    const doc = '- [ ] todo\n';
    const hidden = decorate(doc, 0).filter(d => d.class === 'cm-md-checkbox-bullet-hidden');
    assert.deepEqual(hidden.map(d => [d.from, d.to]), [[0, 1], [1, 2]]);
});

test('checkbox dash: hidden for a bullet task item, multi-space gap', () => {
    const doc = '-   [ ] todo\n';
    const hidden = decorate(doc, 0).filter(d => d.class === 'cm-md-checkbox-bullet-hidden');
    assert.deepEqual(hidden.map(d => [d.from, d.to]), [[0, 1], [1, 4]]);
});

test('checkbox dash: plain bullet item gets the dot widget and hides gap space', () => {
    const doc = '- plain\n';
    assert.equal(widgetsOfType(doc, BulletMarkerWidget).length, 1);
    assert.deepEqual(
        decorate(doc, 0).filter(d => d.class === undefined && d.from === 1).map(d => [d.from, d.to]),
        [[1, 2]],
    );
});

test('computeOrderedMarkerRanges: collects only ordered marker spans', () => {
    const state = stateFor('1. one\n- two\n');
    const ranges = computeOrderedMarkerRanges(state);
    assert.deepEqual(ranges, [{ from: 0, to: 2 }]);
});

test('computeOrderedMarkerRanges: spans multi-digit markers correctly', () => {
    const doc = '12. a\n13. b\n';
    const state = stateFor(doc);
    const ranges = computeOrderedMarkerRanges(state);
    assert.deepEqual(ranges, [{ from: 0, to: 3 }, { from: 6, to: 9 }]);
});

test('task marker: "[ ]" is replaced by an unchecked TaskCheckboxWidget over the marker range, and strikes nothing', () => {
    const doc = '- [ ] todo\n- [x] done\n';
    const state = stateFor(doc);
    const set = computeRevealDecorations(state, 0, 0, [{ from: 0, to: doc.length }]);
    const widgets: { from: number; to: number; widget: TaskCheckboxWidget }[] = [];
    set.between(0, doc.length, (from, to, value) => {
        const widget = (value.spec as { widget?: TaskCheckboxWidget }).widget;
        if (widget instanceof TaskCheckboxWidget) { widgets.push({ from, to, widget }); }
    });
    assert.equal(widgets.length, 2);
    const todoFrom = doc.indexOf('[ ]');
    const doneFrom = doc.indexOf('[x]');
    const todo = widgets.find(w => w.from === todoFrom);
    const done = widgets.find(w => w.from === doneFrom);
    assert.ok(todo && !todo.widget.checked);
    assert.equal(todo!.to, todoFrom + 3);
    assert.ok(done && done.widget.checked);
    // Always-on — same result regardless of cursor position (re-checked at a different cursor).
    const decosElsewhere = decorate(doc, 0);
    assert.ok(decosElsewhere.some(d => d.class === 'cm-md-task-done-content'));
});

test('task marker: undone with nothing after it does not throw (empty content span)', () => {
    assert.doesNotThrow(() => decorate('- [x]', 0));
});

test('computeToggleTaskMarker: flips "[ ]"->"[x]" and "[x]"/"[X]"->"[ ]"', () => {
    const doc = '- [ ] a\n- [x] b\n- [X] c\n';
    const state = stateFor(doc);
    for (const [marker, expected] of [['[ ]', '[x]'], ['[x]', '[ ]'], ['[X]', '[ ]']] as const) {
        const from = doc.indexOf(marker);
        assert.deepEqual(computeToggleTaskMarker(state, from, from + 3), { changes: { from, to: from + 3, insert: expected } });
    }
});

test('horizontal rule: cursor away renders the styled rule widget, hiding the raw dashes', () => {
    const doc = 'before\n\n---\n\nafter';
    const from = doc.indexOf('---');
    const widgets = widgetsOfType(doc, HorizontalRuleWidget, 0);
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0].from, from);
    assert.equal(widgets[0].to, from + 3);
    assert.equal(widgets[0].widget.nodeFrom, from);
    assert.equal(widgets[0].widget.nodeTo, from + 3);
});

test('horizontal rule: cursor on the line shows raw text, no decoration', () => {
    const doc = 'before\n\n---\n\nafter';
    const pos = doc.indexOf('---');
    assert.equal(widgetsOfType(doc, HorizontalRuleWidget, pos).length, 0);
});

test('horizontal rule: collapsed caret at end of the rule line still reveals raw text', () => {
    const doc = 'before\n\n---\n\nafter';
    const endOfRuleLine = doc.indexOf('---') + 3;
    assert.equal(widgetsOfType(doc, HorizontalRuleWidget, endOfRuleLine).length, 0);
});

test('horizontal rule: "***", "___", and longer dash runs are all detected', () => {
    for (const rule of ['***', '___', '----------']) {
        const doc = `x\n\n${rule}\n\ny`;
        const from = doc.indexOf(rule);
        const widgets = widgetsOfType(doc, HorizontalRuleWidget, 0);
        assert.equal(widgets.length, 1);
        assert.equal(widgets[0].from, from);
        assert.equal(widgets[0].to, from + rule.length);
        assert.equal(widgets[0].widget.nodeFrom, from);
        assert.equal(widgets[0].widget.nodeTo, from + rule.length);
    }
});

// ===== Regression: real F5 bug — typing a new heading blanked EVERY heading =====
//
// Root cause: `Decoration.mark()` throws "Mark decorations may not be empty"
// for a zero-length range. Typing "#" or "# " is a valid, title-less
// ATXHeading per CommonMark — `handleHeading`'s content span collapses to
// zero length for that split second. A ViewPlugin that throws mid-update
// drops decorations for its WHOLE plugin, not just the offending node, so
// every OTHER heading in the doc visibly lost its size/hidden-marker styling
// too — not caught by the earlier per-mark-type tests above because none of
// them had more than one heading, and none typed one into existence
// incrementally.

test('heading: an empty heading ("#" or "# ", mid-typing) does not throw', () => {
    assert.doesNotThrow(() => decorate('#', 0));
    assert.doesNotThrow(() => decorate('# ', 0));
    assert.doesNotThrow(() => decorate('## ', 0));
});

test('heading: typing a brand-new heading character by character never disturbs an EXISTING heading elsewhere', () => {
    const existing = '## GHe\n\nbody\n\n';
    const toType = '# New heading';
    for (let i = 0; i <= toType.length; i++) {
        const doc = existing + toType.slice(0, i);
        const decos = decorate(doc, doc.length);
        const existingHeading = decos.find(d => d.from === 3 && d.class === 'cm-md-heading-content cm-md-h2');
        assert.ok(existingHeading, `existing "## GHe" lost its styling while typing ${JSON.stringify(toType.slice(0, i))}`);
    }
});

test('link: an empty label ("[]()") does not throw', () => {
    assert.doesNotThrow(() => decorate('[]()', 0));
});

// ===== Regression: paragraph + "- " without blank line (Setext vs bullet) =====
//
// CommonMark parses `some text\n- ` as Setext h2, not a bullet list. That made
// the paragraph look like a heading and left the "-" invisible as a list marker.

test('setext-as-list: paragraph + "- " shows bullet widget, not heading styling on the paragraph', () => {
    const doc = 'some text\n- ';
    const widgets = widgetsOfType(doc, BulletMarkerWidget);
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0]!.from, doc.indexOf('-'));
    const decos = decorate(doc, doc.length);
    assert.equal(decos.some(d => d.class === 'cm-md-heading-content cm-md-h2'), false);
});

test('setext-as-list: paragraph + "--" shows no bullet widget until the gap space is typed', () => {
    const doc = 'some text\n--';
    const widgets = widgetsOfType(doc, BulletMarkerWidget);
    assert.equal(widgets.length, 0);
    const decos = decorate(doc, doc.length);
    assert.equal(decos.some(d => d.class?.includes('cm-md-h')), false);
});

test('setext-as-list: paragraph + "-- " shows bullet widget once the gap space is present', () => {
    const doc = 'some text\n-- ';
    const widgets = widgetsOfType(doc, BulletMarkerWidget);
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0]!.from, doc.indexOf('-'));
});

test('setext-as-list: blank-line "- " also shows bullet widget before any item text', () => {
    const doc = 'some text\n\n- ';
    const widgets = widgetsOfType(doc, BulletMarkerWidget);
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0]!.from, doc.indexOf('-'));
});

test('setext-as-list: typing item text on the same line switches to normal list parsing', () => {
    const doc = 'some text\n- item';
    const widgets = widgetsOfType(doc, BulletMarkerWidget);
    assert.equal(widgets.length, 1);
    let setext = false;
    syntaxTree(stateFor(doc)).iterate({
        enter(node) {
            if (node.name === 'SetextHeading1' || node.name === 'SetextHeading2') { setext = true; }
        },
    });
    assert.equal(setext, false);
});
