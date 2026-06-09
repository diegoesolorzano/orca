# Cross-Model Review — orca-5031-webgl-atlas-recovery (spec) — Round 1

**Feature ID:** orca-5031-webgl-atlas-recovery
**Repo:** orca
**Issue:** stablyai/orca#5031
**Upstream:** docs-fork/specs/orca-5031-webgl-atlas-recovery.md
**Date:** 2026-06-09
**Status:** InReview
**Review:** real

---

## Summary
The spec proposes adding a safe "Redraw terminal" recovery path for xterm WebGL glyph-atlas corruption: expose a pane redraw method, wire it to a configurable shortcut and discoverable command surface, optionally auto-clear on focus/visibility return, and test WebGL/DOM/no-op cases.

## Findings
- **[CRITICAL]** FR-3/default shortcut — `Mod+Alt+R` already exists on macOS for `workspace.rename` in `src/shared/keybindings.ts`, so the proposed default cannot be shipped as-is without a collision. Suggested fix: pick a verified free platform-specific binding, or leave the default unbound on conflicting platforms and state that explicitly.
- **[WARNING]** FR-4 requirement state is contradictory — the header says FR-4 is included in v1, but Requirements, Scope, Acceptance Criteria, and Testing still label it "optional / si FR-4". Suggested fix: make FR-4 unconditional or move it fully out of v1; do not leave conditional wording in an approved spec.
- **[WARNING]** Command palette scope is ambiguous — the project has a curated Cmd+J worktree palette, not a generic command palette, and its quick-actions are context-light workspace actions. The spec says "palette if exists" while acceptance requires "atajo o paleta". Suggested fix: explicitly decide whether to add this to Cmd+J quick actions, a different command surface, or remove palette acceptance from v1.
- **[WARNING]** "No active pane" acceptance conflates editor/browser focus with pane-manager state. A terminal tab can retain an active pane even when another app surface is focused, and a global palette action may need to choose between "redraw last active terminal pane" and "no-op unless active tab is terminal". Suggested fix: define the exact routing rule based on `activeTabType`, active terminal tab, and mounted `PaneManager`.
- **[WARNING]** Auto-clear-on-focus needs a precise transition definition. "Una vez por transición" is not enough to plan safely across tab activation, split-pane focus, app window focus, visibilitychange, render suspension/resume, and WebGL reattach. Suggested fix: specify the exact event source and idempotency state, e.g. only tab/pane foreground transition, not every DOM focus event.
- **[WARNING]** Acceptance for corrupted atlas recovery is not objectively automatable as written. "Atlas corrupto" is hard to synthesize in unit tests. Suggested fix: split acceptance into verifiable units (`clearTextureAtlas` called, refresh range called, errors swallowed) plus a required manual reproduction protocol for the real glitch.
- **[INFO]** The spec correctly avoids broadening complex-script fallback ranges; code confirms WebGL fallback currently disables itself for Linux/complex scripts/context loss, and a manual atlas clear is a smaller blast-radius recovery path.
- **[INFO]** Testing section is mostly well-targeted, but should add tests for shortcut policy resolution (`resolveTerminalShortcutAction`) if `terminal.redraw` is implemented as a terminal-scoped action rather than only a top-level window handler.

## Verdict
REQUEST_CHANGES — the feature direction is sound, but the approved shortcut conflicts with an existing binding and FR-4/palette/no-active-pane semantics are not precise enough for implementation planning.
