```mermaid
flowchart TD
    EVT["EVENT<br>External disk change detected"] --> GATE{"Setting: Review External<br>Changes as a Diff?"}

    GATE -- disabled --> TOAST2["TOAST<br>File changed on disk"]
    TOAST2 --> LOAD["Load disk changes"] & KEEPLOCAL["Keep local version"]
    LOAD --> UNSAVED{"Unsaved local edits?"}
    UNSAVED -- YES --> DISCARDCONF["CONFIRM<br>Discard local edits?"]
    UNSAVED -- NO --> REPLACED["ACTION<br>Buffer replaced with disk content"]
    DISCARDCONF --> DISCARDMINE["BUTTON<br>Yes"] & KEEPMINE["BUTTON<br>No"]
    DISCARDMINE --> REPLACED
    KEEPMINE --> WRITTENBACK["ACTION<br>Local edits written back to disk"]
    KEEPLOCAL --> OVERWRITECONF["CONFIRM<br>Overwrite disk with your version?"]
    OVERWRITECONF --> OVERWRITE["Overwrite disk"] & CANCEL["Cancel"]
    OVERWRITE --> DISKOVERWRITTEN["ACTION<br>Disk overwritten with buffer content"]
    CANCEL --> CLOSEQUIET["ACTION<br>Closes quietly (toast still open)"]
    REPLACED --> RECONCILED["ACTION<br>Reconciled: disk and buffer match"]
    WRITTENBACK --> RECONCILED
    DISKOVERWRITTEN --> RECONCILED

    GATE -- enabled --> DIFFOPEN["ACTION<br>Load disk content + open diff view<br>(local edits become the rejectable side —<br>no discard confirm needed, nothing is destroyed)"]
    DIFFOPEN --> HUD["TOAST (bottom-center)<br>Row 1: File changed on disk<br>Row 2: N of M · ↑↓ nav · +A −R · Accept All / Reject All<br>+ density ruler along the scrollbar<br>No close button — stays until you act"]
    DIFFOPEN --> CHUNK["INLINE<br>Per-chunk Accept / Reject"]
    HUD --> ACCEPTALL["BUTTON<br>Accept all"] & REJECTALL["BUTTON<br>Reject all"]
    CHUNK --> ACCEPTCHUNK["BUTTON<br>Accept"] & REJECTCHUNK["BUTTON<br>Reject"]
    ACCEPTCHUNK --> CHUNK
    REJECTCHUNK --> CHUNK
    ACCEPTALL --> ALLRESOLVED
    REJECTALL --> ALLRESOLVED
    CHUNK -- last chunk resolved --> ALLRESOLVED
    ALLRESOLVED["ACTION<br>Resolved: N accepted, M rejected<br>(buffer dirty — still needs a normal Save,<br>same as any other edit)"]
```

Setting: **Review External Changes as a Diff** (default: off — opt in from the Settings menu). Enabled, the diff opens automatically — the right-hand branch above. Off (the default), only the two-button toast on the left exists, each option with its own discard/overwrite confirm, since neither is undo-able through a diff.

Accept All / Reject All are also reachable without the mouse: Command Palette → "Sheetmark: Accept/Reject All Disk Changes", or `Ctrl+Alt+Y` / `Ctrl+Alt+N` (`Cmd+Alt+Y/N` on macOS) while a Sheetmark Markdown editor is focused.
