---
title: Own Help & Feedback Google Form
slug: own-feedback-google-form
status: completed
created: 2026-08-12
updated: 2026-08-13
---

# Own Help & Feedback Google Form

## Idea

The in-app **Help & Feedback** modal already POSTs to a Google Form, but it targets the upstream author's form (`1FAIpQLSe5AqE_f1-WqUlQmvuPn1as3Mkn4oLjA0EDhNssetzt63ONzA`) and GitHub issue URL. I need my own Google Form so submissions land in my account. I know how to create Google Forms — I need the extension wired to *my* form: which questions to create on the Form (vs what the modal auto-fills), how to get entry IDs and the `formResponse` URL, and which code files to update.

## Brainstorm

**Decisions (2026-08-13):**

- **A3 — Form-only swap:** Replace Google Form endpoint and `entry.*` field IDs; align modal fields to user's 5-question form.
- **B1 — Hardcode:** Form ID in both provider files.
- **C1 — GitHub issues:** `https://github.com/nacho-allendesalazar/vscode-super-viewer/issues/new`.

## Plan

Form ID: `1FAIpQLSc0rQ232X2rAI-gyLeACwaFsgN_UKf5LMt3ENd8WYtNVCCp7w`

| Field | `entry.*` |
|---|---|
| System Information | `entry.1173041044` |
| What brings you here today? | `entry.500729934` |
| Please describe your issue or suggestion | `entry.1328099188` |
| How satisfied are you overall? | `entry.2123855879` |
| Okay if I follow up? (optional email) | `entry.1729939963` |

Files: `feedbackModal.ts`, `spreadsheetEditorProvider.ts`, `mdEditorProvider.ts`.

## Implementation Log

**2026-08-13**

- `src/webviews/shared/feedbackModal.ts` — new entry IDs and labels; options `Found a bug/issue`, `Got an idea`, `General feedback`; optional email for follow-up; GitHub URL → `nacho-allendesalazar/vscode-super-viewer`; removed old follow-up Yes/No popup.
- `src/spreadsheetEditorProvider.ts` — `formResponse` path updated.
- `src/mdEditorProvider.ts` — same path update.
- `npm run compile` — pass.

## QA

**2026-08-13 — passed**

- F5 Extension Development Host → Help & Feedback → submit test entry.
- Initial failure: Google Form returned 401 (form required sign-in). Fixed by opening form to anonymous responders in Google Forms settings.
- Re-test after settings change: submission succeeded; response appeared in user's Google Form sheet.
