**Feature ID:** orca-time-tracking
**Repo:** orca
**Issue:** none
**Upstream:** .claude/plans/orca-time-tracking-plan.md
**Date:** 2026-06-04
**Status:** InReview
**Review:** real

## Verdict

REVISE

## Findings

- [CRITICAL] Service recovery is under-specified and likely fails the “service down → resumes when it returns” AC. `TrackerClient.sendEvent()` “never rejects” and returns `void`, so the state machine can mark a project open even when `focus` was never delivered. Later same-project activity won’t resend `focus`, and heartbeats may only renew already-open blocks. Change the client/tracker contract to expose delivery/health state, or explicitly re-emit `focus`/`active` after health recovery.

- [CRITICAL] Window close is not actually wired despite the AC requiring deterministic close. Task 4 only lists `app.on('before-quit' → flush)`. In Electron, `before-quit` is app-quit lifecycle, not ordinary macOS window close; `BrowserWindow` has `close`/`closed` events for window lifecycle. Add `closed`/`close` cleanup for the tracked `webContents.id` so closing the main window blurs immediately and stops heartbeats for destroyed senders.

- [WARNING] IPC attribution trusts renderer-provided paths and `remote` boolean. The main process should not rely on the renderer to decide “SSH/remote repos produce zero events.” Existing source of truth already exists in `Store` (`Repo.connectionId`, `Worktree.repoId`). Prefer sending IDs (`repoId`, `worktreeId`) and resolving/validating `Repo` + `Worktree` in main, with sender validation against the main window/webContents.

- [WARNING] The plan says the renderer sends “raw IDs/paths,” but `ActivityPing` contains only paths and a `remote` boolean. This inconsistency matters because using IDs would also solve the validation issue above.

- [WARNING] Manual E2E says “lower `idleTimeoutMs` via dev env,” but the config only documents `TIME_TRACKER_BASE_URL` and `TIME_TRACKER_SERVICE_PATH`. Add explicit dev env overrides for idle/grace/heartbeat intervals or remove that verification instruction.

- [WARNING] Artifact contract issue: this is a plan artifact with `**Upstream:** none`. The local artifact rules say plan artifacts should point upstream to the spec path. If this intentionally skips a spec, document that exception; otherwise add the missing spec/cross-link.

- [WARNING] Task 4 says `buildCtx` may live in `wire.ts`, then Task 4 says it should be tested via `tracker.ts` or `types.ts`; the test matrix assigns `buildCtx remote` to `tracker.test.ts`. Make the ownership explicit so the implementation doesn’t leave untested IPC/context logic in glue code.

- [INFO] Strong parts: isolating logic under `src/main/time-tracker/`, avoiding `registerCoreHandlers`, deriving `workspaceName` in main via Node path utilities, explicitly skipping SSH repos, and using fake timers for the state machine all align well with Orca’s conventions and cross-platform constraints.
