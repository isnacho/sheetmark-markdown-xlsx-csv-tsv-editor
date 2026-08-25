---
title: Super Viewer Markdown Test Document
description: Extended sample for preview, edit mode, YAML frontmatter, tables, scroll sync, and ongoing diff testing.
status: approved
published: true
version: 2.7
review_count: 9
created: 2026-07-20
updated: 2026-08-20T23:12
tags:
  - markdown
  - yaml
  - testing
  - frontmatter
  - tables
  - diff-testing
  - callouts
  - scroll-sync
authors:
  - Alice Engineer
  - Bob Designer
  - Carol QA
  - Dan Docs
metadata:
  project: vscode-super-viewer
  priority: medium
  nested:
    depth: 3
    note: Round six updated this nested note for YAML card diffs.
aliases:
  - test-doc
  - sample-md
  - diff-playground
---

# Heading 1 — round six

This intro paragraph replaces the placeholder gibberish above. It now includes a **second sentence** for diff visibility, a *third* for round three, round four keeps editing, round five continues, and round six edits again.

## Heading 2 — round six rename dsjs
 Ddnwkdnw
### Heading 3 — mid-tree edit

#### Heading 4 — deepest level edited


**Hello**

- First bullet with real text
- Second bullet for list preview
- Third bullet to exercise wrapping in narrow panes
- Fourth bullet added in round three
- Fifth bullet — round five

## Hello (capitalized) — v2

- Nested spacing test dsjfbsj
- Another item with consistent indentation dhsd
- Round four list mak
- Round six list item

`inline-code-sample-v3`

Plain paragraph with **bold**, *italic*, ***bold italic***, ~~strikethrough~~, and `inline code`.

A second paragraph to pad scroll height. Round six replaced the lorem opener with this shorter line.

A [link](https://example.com), a [second link](https://github.com), a [third link](https://cursor.com), and a bare URL [https://example.com](https://example.com).

> Blockquote line one — edited.
> Blockquote line two — also edited.

> Blockquote line two — also edited.
> Blockquote line two — also edited.
> Blockquote line two — also edited.
> Blockquote line two — also edited.

>
> Blockquote with a third paragraph for height — still here from round two.

Unordered list:

- Item one with corrected pellingspelling
- Item two (renamed from "hey")
- Item three (renamed from "threedfsds")
- Item four
  - Nested item
  - Another nested item with longer text that may wrap in narrow panes
- Item five (was duplicate "Item three")
- Item six — round six addition

Ordered list:

1. First
2. Second (typo fixed)
    3. Nested step
3. Third
4. Fourth item added for length
5. Fifth item — new for diff testing
6. Sixth item — round three addition
7. Seventh item — round five
8. Eighth item — round six

Task list:

- [x] Done task
- [x] Previously open — now checked off
- [x] Second open task — checked off in round four
- [x] Round five task — freshly added
- [x] New unchecked task — checked in round six
- [ ] Round six task — open

::: info
Info callout — tests the markdown-it container plugin. Round six refresh.
:::

::: warning
Warning callout with **bold** and `code` inside. Round five appended this note.
:::

::: tip
New tip callout added in the second round of edits. Round three adds this trailing sentence.
:::

::: danger
Danger callout — round three addition for diff coverage. Escalated in round six.
:::

::: note
Note callout — brand new in round six.
:::

Horizontal rule (mid-document — must NOT be treated as YAML frontmatter):

---

Second horizontal rule immediately after the first:

---

Code blocks:

```js
function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}

function subtract(a, b) {
  return a - b;
}

// Extra lines so the fence block spans multiple source lines
console.log(add(2, 3));
console.log(subtract(5, 2));
console.log(multiply(4, 5));
console.log(divide(10, 2));
```

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"

def farewell(name: str) -> str:
    return f"Goodbye, {name}!"

for person in ["Alice", "Bob", "Carol", "Dan", "Eve"]:
    print(greet(person))
    print(farewell(person))
```

## Tables

Simple two-column table:

| Header 1 | Header 2                               | Header 3 |
| -------- | -------------------------------------- | -------- |
| Cell 1   | Cell 2 with cleaned-up text for readability | Cell 3   |
| Row 2 A  | Row 2 B with enough text to force wrapping when the preview pane is narrow | Row 2 C |
| Row 3 A  | Row 3 B — updated in round three         | Row 3 C  |
| Row 4 A  | Row 4 B — brand new row                    | Row 4 C  |
| Row 5 A  | Row 5 B — round five row                   | Row 5 C  |
| Row 6 A  | Row 6 B — round six row                    | Row 6 C  |

Team roster (more rows, mixed content):

| Name  | Role            | Active | Notes |
| ----- | --------------- | ------ | ----- |
| Alice | Engineer | true   | Primary maintainer; owns markdown preview and CM6 live edit. |
| Bob   | Designer   | false  | UI polish, toolbar icons, theme tokens. |
| Carol | QA         | true   | Smoke tests F5 samples after each change. |
| Dan   | Docs       | true   | Keeps MESSAGE-PROTOCOL.md in sync with handlers. |
| Eve   | Infra      | false  | esbuild bundle paths and CSP localResourceRoots. |
| Frank | DevOps     | true   | CI pipelines and release automation. |
| Grace | PM         | true   | Roadmap and sample file maintenance. |
| Henry | Support    | false  | User feedback triage — added round five. |
| Iris  | Security   | true   | CSP and localResourceRoots audits — round six. |

Wide feature matrix (long cells, many columns):

| Feature | Preview | Preview Edit | Split | Notes |
| ------- | ------- | ------------ | ----- | ----- |
| YAML frontmatter card | Yes | Yes (click field → jump to source) | Inherits preview pane | Doc-start `---` only |
| Tables | Rendered | CM6 table widget | Both panes | Resize columns persist per file |
| Task lists | Checkbox UI | Toggle dispatches doc change | — | See task list above |
| Mermaid | Below | Rendered when not editing fence | — | Requires reload after edit |
| Search in preview | Overlay | CM6 search | — | Case sensitivity setting |
| Version history | Panel | — | — | Snapshots on save |

Alignment and numeric columns:

| Left aligned | Center aligned | Right aligned | Qty |
| :----------- | :------------: | ------------: | --: |
| Alpha        | Beta           | Gamma         | 1   |
| Longer left column text that should wrap gracefully in a narrow editor | Mid | 99.50 | 42 |
| Delta        | Epsilon        | Zeta          | 100 |
| Omega        | Pi             | Tau           | 256 |
| Sigma        | Rho            | Phi           | 512 |

## Mermaid

```mermaid
flowchart LR
    A[Markdown file] --> B[extractFrontmatter]
    B --> C{Valid YAML?}
    C -->|yes| D[YAML card]
    C -->|no| E[hr + paragraphs]
    B --> F[Body → markdown-it]
    F --> G[Diff overlay]
    G --> H[Save to disk]
    H --> I[Version snapshot]
    I --> J[Reload webview]
```

## Definition list

Term one
: Definition for term one spanning a couple of clauses so it is not a single short line.

Term two
: Second definition with **emphasis** and a [link](https://example.com).

Term three
: Third term added in round three — tests definition list diffs.

Term four
: Fourth definition — round five addition with ~~removed text~~ and `code`.

Term five
: Fifth term — round six. Includes ***bold italic*** markup.

## Images

![Super Viewer icon](icon.png)

Missing image (should show an error placeholder):

![Alt text for a missing image](missing-sample-image.png)

## Footnotes

Footnote reference[^1], a second reference[^2], a third reference[^3], and a fourth[^4].

[^1]: Footnote text goes here. Add extra sentences so the footnote block occupies more vertical space in the preview footer area.
[^2]: Second footnote with `inline code` and **bold** for renderer coverage.
[^3]: Third footnote — round three addition for diff testing.
[^4]: Fourth footnote — round five. References the [project repo](https://github.com).

## Line breaks

Line break test:
This line ends with two trailing spaces.  
This is on a new line — round six edit.

This paragraph uses an explicit Markdown line break.\\
and another one here\\
to build a taller block without extra blank lines.

## Extra section for scroll spy

### Subsection A

Content under subsection A. Scroll the preview and watch the TOC highlight track this heading. Round five refresh.

### Subsection B

Content under subsection B. Enough filler to make scrolling meaningful when testing sync between editor and preview panes. Round four tweak.

### Subsection D

New subsection added in round four for TOC diff testing. Extended in round six.

### Subsection E

Subsection E — inserted in round six between D and C.

### Subsection C

Final subsection. End of `samples/test.md` test document — round six still editing.

## Diff test section (added 2026-08-20)

This section was added to exercise diff rendering in the markdown editor. **Round six** — still going.

| Change type | Example |
| ----------- | ------- |
| Modified    | Frontmatter `version` bumped to 2.7 |
| Added       | Iris row, subtract(), Term five, Subsection E, note callout |
| Removed     | Lorem ipsum from second paragraph |
| Fixed       | Two tasks checked off, info callout shortened |
| Round 6     | Eighth ordered item, mermaid reload node, alias diff-playground |
