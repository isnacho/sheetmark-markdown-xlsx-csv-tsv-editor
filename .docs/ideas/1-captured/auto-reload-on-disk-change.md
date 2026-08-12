---
title: Auto-reload on disk change
slug: auto-reload-on-disk-change
status: captured
created: 2026-07-22
updated: 2026-07-22
---

# Auto-reload on disk change

## Idea

We've already worked on how to reload information from the disk when the AI changes something so that the preview edit mode updates by clicking on the reload button. What I want now is, I wonder if we can add functionality that, if there are no changes in the documents (so if I haven't made any changes to the doc that are unsaved), then if the document in the disk changes, the document in the preview edit should change automatically. Maybe with a little toast at the bottom of the page saying it has changed and it has been updated.

I think that we should use a sem toast for when there is something that has been changed in the document by the user, and then the document in the disk changes. That toast should appear and should say, "The disk document has changed. Do you want to reload?" or something like that.

## Brainstorm

_Not started._

## Plan

_Not started._

## Implementation Log

_Not started._

## QA

_Not started._
