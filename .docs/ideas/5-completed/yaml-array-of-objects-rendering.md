---
title: YAML preview — array-of-objects rendering
slug: yaml-array-of-objects-rendering
status: completed
created: 2026-09-09
updated: 2026-09-09
---

# YAML preview — array-of-objects rendering

## Idea

The YAML frontmatter preview card shows `[object Object]` pills for any list whose items are objects instead of rendering their contents. String arrays (e.g. `platforms: [ios, android]`) and nested object maps (e.g. `related.depends_on`) work fine; the failure is specifically **arrays of objects** such as:

- `external_partners: [{ name, role }]`
- `tooling: [{ braze: "…" }]`
- `verification.targets: [{ braze: "…" }, { gsheet: "…" }]`

Example from a real frontmatter block (push-notifications spec): scalar fields and string-array chips render correctly, but every object-in-array field collapses to one or more blue pills reading `[object Object]`.

## Brainstorm

**Decided UX (A1 + B1 + C1 + C2 + D1 + E1):**

- **Type-split arrays:** scalar-only arrays keep the current chip row (`platforms`, `channels`,
  `depends_on`, etc.). If any element is a non-scalar (object or nested array), stop chipifying
  the whole field.
- **Object arrays expand like nested maps:** emit an object-style header row for the array field
  (key only, bold — same as `related`), then render each object's keys as indented child rows at
  `depth + 1`.
- **Single-key object items** (`tooling: [{ braze: "…" }]`, `targets: [{ braze: … }, { gsheet: … }]`)
  become normal indented key/value rows under the header — no special case.
- **Multi-key object items** (`external_partners: [{ name, role }]`) expand to one row per key
  (`name`, `role`) under the header.
- **Multiple object items:** when the array contains 2+ object elements, prefix the **first key**
  of each item with a dim index label in the key column — `[1] name`, `[2] name`. Single-item
  arrays get no index prefix (C1).
- **Mixed scalar + object arrays (D1):** under the object header, show scalar elements as a chip
  row at `depth + 1` (empty/minimal key column), then expanded object items below.
- **Scope:** data-layer fix in `flattenFieldRows` / `buildFieldRows` only; reuse existing
  `frontmatterCardUi` row rendering. No new CSS unless index styling is added later.
- **Fixed:** no `[object Object]` anywhere; string arrays and nested object maps unchanged;
  invalid YAML still falls back to raw rendering.

## Plan

### Root cause

`flattenFieldRows` ([frontmatter.ts:84-94](../../../src/webviews/md/frontmatter.ts)) maps every array
element through `formatScalar`, which stringifies objects as `[object Object]`.

### A — Refactor array branch in `flattenFieldRows`

**File:** `src/webviews/md/frontmatter.ts`

1. Add a small helper `isScalarItem(value)` — `null`, boolean, number, string, Date; not plain
   objects or arrays.
2. **Scalar-only array** (all items pass `isScalarItem`): keep current behavior — one `kind:
   'array'` row with `chips`.
3. **Array with any non-scalar item:**
   - Push an object header row (`kind: 'object'`, empty value) for the field name — mirrors
     `related`.
   - **D1 mixed:** if any scalar items remain, push one chip row at `depth + 1` with an empty key
     (value column only shows chips).
   - Collect plain-object items from the array (skip scalars already chipped).
   - For each object item at index `i` (1-based among object items only):
     - Iterate `Object.entries(item)`.
     - On the **first entry** of each item, when `objectItemCount > 1`, set display key to
       `` `[${i}] ${childKey}` ``; otherwise use `childKey` as-is.
     - Call `flattenFieldRows(childValue, displayKey, keyPath, depth + 1, …)` for each entry.
   - **Nested array inside an array item:** recurse via existing `flattenFieldRows` on the nested
     array at `depth + 1` (same index-prefix rule on first row if multiple top-level object
     items — edge case; covered by a unit test if trivial, otherwise document as follow-up).
4. Do **not** change object-map or scalar branches.

### B — Unit tests

**File:** `src/webviews/md/frontmatter.test.mts`

Add cases using YAML parsed through `parseFrontmatter` → `buildFieldRows`:

| Test | Assert |
|---|---|
| Push-notifications `external_partners` (1 multi-key object) | rows include `name` + `role` scalars at depth 1; no `[object Object]` in any chip |
| `tooling: [{ braze: "…" }]` | header `tooling` + `braze` scalar at depth 1 |
| `targets: [{ braze: a }, { gsheet: b }]` | `[1] braze` and `[2] gsheet` keys (or first-field index prefix) |
| `platforms: [ios, android]` | unchanged — one array row, chips `['ios','android']` |
| `related.depends_on` nested string array | unchanged |
| Mixed `[foo, { bar: baz }]` | chip row for `foo` + expanded `bar` under header |
| Regression | existing `buildFieldRows: nested object and array chips` still passes |

Optional assertion helper: `assert.ok(!rows.some(r => r.chips?.some(c => c.includes('[object Object]'))))`.

### C — UI / other files

**No changes expected** to `frontmatterCardUi.ts` — it already renders `kind: 'object'` headers and
indented rows via `row.depth`. Index prefix lives in `row.key` string.

Verify `FrontmatterWidget.eq` ([frontmatterWidget.ts](../../../src/webviews/md/livePreview/frontmatterWidget.ts))
still compares `row.key` — prefix in key is fine.

### D — Verification

```bash
npm run test:unit -- src/webviews/md/frontmatter.test.mts
npm run compile
```

Manual smoke (F5): open a `.md` file with the push-notifications frontmatter; confirm
`external_partners`, `tooling`, and `verification.targets` render as indented rows, string arrays
still show chips.

### Out of scope

- Dim CSS styling for `[1]` prefixes (plain text prefix is enough for v1).
- Click-to-jump per nested field (still deferred from v1 frontmatter).
- Nested arrays-of-arrays (rare in frontmatter; recurse if trivial, else fall back gracefully).

## Implementation Log

**2026-09-09** — Implemented per plan.

Files changed:
- `src/webviews/md/frontmatter.ts` — type-split array handling in `flattenFieldRows`; scalar arrays
  keep chips; object/mixed arrays expand as indented sub-rows with optional `[n]` index prefix.
- `src/webviews/md/frontmatter.test.mts` — 7 new tests covering multi-key objects, single-key
  object lists, mixed arrays, push-notifications shapes, and regression guards.
- `samples/test.md`, `samples/test copy.md` — added frontmatter fields demonstrating array-of-objects
  YAML (`external_partners`, `tooling`, `verification.targets`, `mixed`, plus string-array controls).

Verification: `node --test src/webviews/md/frontmatter.test.mts` — 25 pass. `npm run compile`
rebuilt `dist/md/mdWebview.js` (2026-09-09). Initial smoke failed because compile did not
complete (missing source files) so the webview bundle was stale; fix re-applied after restoring
`src/` from git.

No deviations from plan.

## QA

**2026-09-09** — Passed.

- `node --test src/webviews/md/frontmatter.test.mts` — 25/25 pass.
- `npm run compile` — clean after restoring `src/` and rebuilding `dist/md/mdWebview.js`.
- Manual smoke (Extension Development Host, reload): `samples/test.md` — `external_partners`
  shows indented `name`/`role` rows; `tooling` shows `braze`; `verification.targets` shows indexed
  `[1] braze` / `[2] gsheet`; string arrays (`platforms`, `depends_on`) still render as chips; no
  `[object Object]` pills. User confirmed good.
