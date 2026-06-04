# Plan: Human Time Tracking in Orca (time-tracker integration)

**Feature ID:** orca-time-tracking
**Repo:** orca
**Issue:** none
**Upstream:** none
**Date:** 2026-06-04
**Status:** Planned

## Overview

Source-level patch on the permanent fork (branch `feat/time-tracking` → `personal/build`) that makes Orca a "human activity" reporter against the local time-tracker service (`http://localhost:47321`), replicating the contract the VS Code extension implements: `POST /events/{focus,blur,idle,active,heartbeat}`. All HTTP, idle and grace logic lives in ONE main-process module (`src/main/time-tracker/`); the renderer only reports throttled raw activity pings via IPC. Agent tracking needs no work — agent hooks live outside Orca and already report.

Key decisions:
- **Activity capture is generic** — `keydown` + `pointerdown` + `wheel` at `window` level in the renderer, throttled. Covers agents mode (typing prompts, reviewing diffs), Monaco editor and terminals without instrumenting components.
- **Attribution = active worktree** — the human block belongs to the project of the currently selected worktree; `projectRootPath` = canonical repo (`Repo.path`), `worktreePath` = checkout, matching the worktree-collapse semantics the service implements.
- **Main process owns everything** — context building (incl. `path.basename`, OS-aware), state machine, idle, grace, heartbeat, HTTP. The renderer sends only raw IDs/paths. Fire-and-forget (`.catch(() => {})`), never blocks UI.
- **SSH/remote repos are NOT tracked** — `Repo.connectionId` set ⇒ skip (`src/shared/types.ts:99`: null/undefined = local). Remote paths would create phantom local projects and collide with the VS Code extension's local keys. Explicit guard + test; revisit mapping later if needed.
- **Idle = input-idle, parity with the VS Code extension** — reading >5 min without any input idles the block, exactly like the extension (its signals are editor events). Documented trade-off, not an accident. `wheel`/`pointerdown` count, so normal reading/scrolling keeps the block alive.
- **Single-window model** — Orca uses a `mainWindow` singleton. The tracker keys state by `webContents.id` (one consistent identifier end-to-end) but does NOT implement cross-window refcounting; multi-window is out of scope until Orca supports it.

## Sprint Goal

> When working in Orca — agents mode or editor/terminal — human time is tracked into the local time-tracker service per project (canonical repo), opening/closing human blocks with the same semantics as the VS Code extension, without ever blocking or breaking Orca if the service is down.

### Done when

- [ ] Interacting in any Orca surface (chat input, diff review, editor, terminal) opens a human block for the active worktree's canonical repo within seconds.
- [ ] Switching the active worktree to another repo closes (blur) the previous project's block and opens (focus) the new one; switching between worktrees of the SAME repo causes no churn.
- [ ] 5 minutes without input sends `idle`; the next interaction sends `active`.
- [ ] App blur closes the block after a 60s grace; refocus within the grace keeps it open.
- [ ] System suspend force-closes open blocks; resume re-health-checks before resuming.
- [ ] App quit / window close sends `blur` (deterministic close, not sweep-reliant).
- [ ] Heartbeats every 30s renew `last_seen_at` for EVERY open project and keep the service alive.
- [ ] SSH/remote repos produce zero tracking events.
- [ ] With the service down, Orca behaves identically (no errors, no lag); when it returns, tracking resumes.
- [ ] All tests pass; no regressions.
- [ ] Fork docs (`docs-fork/`) and tracker-repo docs (rule + AGENTS.md) updated.

## Shared Types

```typescript
// src/main/time-tracker/types.ts
export interface ProjectContext {
  projectRootPath: string // canonical repo root (Repo.path) — logical project key
  worktreePath: string // physical checkout (Worktree.path)
  workspaceName: string // basename(projectRootPath), derived in MAIN (Node path, OS-aware)
  branch: string // '' if unknown
}

/** Raw ping from the renderer — main builds ProjectContext from it. */
export interface ActivityPing {
  repoPath: string
  remote: boolean // Repo.connectionId != null ⇒ main drops the ping
  worktreePath: string
  branch: string
}

export type TrackerEvent = 'focus' | 'blur' | 'idle' | 'active'

export interface TimeTrackerConfig {
  baseUrl: string // TIME_TRACKER_BASE_URL ?? 'http://localhost:47321' (see Risks: packaged .app env)
  idleTimeoutMs: number // 5 * 60_000
  blurGraceMs: number // 60_000
  heartbeatIntervalMs: number // 30_000
  activityThrottleMs: number // 5_000 (renderer-side)
}
```

## Tasks

### Task 1: HTTP client (fire-and-forget)
- **Files:** `src/main/time-tracker/client.ts` (create), `src/main/time-tracker/types.ts` (create)
- **Produces:**
  ```typescript
  export function createTrackerClient(baseUrl?: string): TrackerClient

  export interface TrackerClient {
    sendEvent(event: TrackerEvent, ctx: ProjectContext): Promise<void> // never rejects
    sendHeartbeat(workspacePath?: string): Promise<void> // never rejects
    isHealthy(): Promise<boolean> // GET /health, 2s timeout, never rejects
  }
  ```
- **Do:** `fetch` with `AbortSignal.timeout(3000)`; body per contract: `{ event, workspacePath: ctx.projectRootPath, projectRootPath, worktreePath, workspaceName, branch, timestamp: new Date().toISOString() }`. Every promise caught — a down service is a silent no-op.
- **Integrates with:** nothing — pure leaf module.
- **Verify:** `pnpm typecheck`; unit tests green.
- **Tests:** Yes — payload shape; never-rejects on fetch rejection (do NOT assert real timeout duration — `AbortSignal.timeout` uses real timers; mock fetch rejection instead).
- **Depends on:** None

### Task 2: Service auto-spawn (best-effort)
- **Files:** `src/main/time-tracker/service-spawn.ts` (create)
- **Produces:**
  ```typescript
  export async function ensureServiceRunning(client: TrackerClient): Promise<boolean>
  /** TIME_TRACKER_SERVICE_PATH env → newest ~/.vscode/extensions/diegosolorzano.time-tracker-*/dist/service.mjs → null */
  export function resolveServiceEntrypoint(): string | null
  ```
- **Do:** if `/health` fails, resolve entrypoint and spawn detached with `process.execPath` + `ELECTRON_RUN_AS_NODE=1` (plain `node` may not be on PATH inside Electron), `env: { ...process.env, START_SERVER: '1' }`, `stdio: 'ignore'`, `unref()`; wait ~2s, re-check. No entrypoint ⇒ return false silently (agent shell hooks can also spawn the service).
- **Integrates with:** Task 1.
- **Verify:** with the service stopped, call spawns it and `/health` returns ok.
- **Tests:** Yes — entrypoint resolution (env override / fallback / null); no spawn when already healthy (mock client).
- **Depends on:** Task 1

### Task 3: Tracker state machine (main process)
- **Files:** `src/main/time-tracker/tracker.ts` (create)
- **Produces:**
  ```typescript
  export interface TimeTracker {
    /** Throttled renderer ping (already context-built). Opens/switches block, resets idle. */
    activity(senderId: number, ctx: ProjectContext): void
    appFocus(): void // any Orca window gained OS focus
    appBlur(): void // all Orca windows lost OS focus
    suspend(): void // powerMonitor 'suspend' — force-close all open blocks
    resume(): void // powerMonitor 'resume' — re-health-check
    flush(): void // before-quit / window closed — deterministic blur of open blocks
    dispose(): void
  }

  export function createTimeTracker(
    client: TrackerClient,
    config?: Partial<TimeTrackerConfig>,
    now?: () => number // injectable clock
  ): TimeTracker
  ```
- **Do:** state keyed by `senderId` (`webContents.id` — the ONE identifier used end-to-end): `{ ctx, lastActivityAt, idle: boolean }`.
  - `activity()`: project changed (compare by `projectRootPath`, NOT `worktreePath`) → `blur(old)` + `focus(new)`; same project, different worktree → update ctx only (no churn); idle → `active`; first ping → `focus`. Always updates `lastActivityAt`.
  - Idle: one `setInterval(~30s)` — entries older than `idleTimeoutMs` and not yet idle → `idle(ctx)` once.
  - `appBlur()`: start `blurGraceMs` timer → on expiry, `blur` all open entries (mark closed). `appFocus()` cancels the timer; if entries were closed by grace/idle, next `activity()` reopens (`focus`/`active`).
  - `suspend()`: immediately `blur` all open entries (no grace) — prevents hours of phantom human time across laptop sleep. `resume()`: `ensureServiceRunning` once; blocks reopen on next activity.
  - `flush()`: `blur` all open entries synchronously-ish (fire the requests; don't await network).
  - Heartbeat: `setInterval(heartbeatIntervalMs)` → `sendHeartbeat(rootPath)` for EVERY distinct open `projectRootPath` (renews each block's `last_seen_at`); skip entirely when nothing open. Lazy `ensureServiceRunning` re-check at most once/min after a failed health state.
  - Timers `unref()`d; `dispose()` clears all.
- **Integrates with:** Tasks 1–2.
- **Verify:** unit tests with fake timers.
- **Tests:** Yes — full matrix below.
- **Depends on:** Task 1, Task 2

### Task 4: Wiring — IPC, window signals, powerMonitor, lifecycle
- **Files:** `src/main/time-tracker/wire.ts` (create), `src/main/index.ts` (modify ~3 lines), `src/preload/index.ts` (modify), `src/preload/api-types.ts` (modify)
- **Produces:**
  ```typescript
  // src/main/time-tracker/wire.ts — self-contained: avoids threading the tracker
  // through registerCoreHandlers' once-guarded 17-param signature.
  export function wireTimeTracker(): TimeTracker
  // - ipcMain.on('timeTracker:activity', (e, ping: ActivityPing) => { if (ping.remote) return;
  //     tracker.activity(e.sender.id, buildCtx(ping)) })  // buildCtx: basename via node:path
  // - app.on('browser-window-focus' → appFocus, 'browser-window-blur' → appBlur*)
  //   *appBlur only when BrowserWindow.getFocusedWindow() === null (app-level blur)
  // - powerMonitor.on('suspend' → suspend, 'resume' → resume)
  // - app.on('before-quit' → flush)
  // - fire-and-forget ensureServiceRunning() at startup

  // preload (api-types.ts):
  timeTracker: { reportActivity(ping: ActivityPing): void } // ipcRenderer.send
  ```
- **Do:** one `wireTimeTracker()` call added to `src/main/index.ts` after app ready — deliberately OUTSIDE `registerCoreHandlers` (once-guarded, 17 params; adding a dependency there maximizes upstream-merge conflicts). `ipcMain.on` (no response needed; deviation from the `handle` pattern is intentional and documented in the module header). Preload exposes the single `send` wrapper; respect AGENTS.md preload type-declaration conventions.
- **Integrates with:** Task 3; Electron `app`/`powerMonitor`; preload contextBridge.
- **Verify:** `pnpm typecheck`; dev run — activity reaches main (temporary debug log, removed before merge).
- **Tests:** No (thin glue — `buildCtx` extracted into `tracker.ts` or `types.ts` and unit-tested there: basename derivation, remote drop).
- **Depends on:** Task 3

### Task 5: Renderer activity hook
- **Files:** `src/renderer/src/hooks/useTimeTrackerActivity.ts` (create), `src/renderer/src/App.tsx` (modify — one hook call)
- **Produces:**
  ```typescript
  export function useTimeTrackerActivity(): void
  /** Pure, exported for tests */
  export function shouldReport(lastSentAt: number, now: number, throttleMs: number): boolean
  ```
- **Do:** `window.addEventListener` for `keydown`, `pointerdown`, `wheel` (passive, capture), throttled to 1 ping / 5s via refs (zero re-renders). On report, read store refs: active worktree (`useActiveWorktree`, `src/renderer/src/store/selectors.ts:191`) and its repo (`useRepoById`, `:178`); send `ActivityPing { repoPath: repo.path, remote: repo.connectionId != null, worktreePath: worktree.path, branch: worktree.branch ?? '' }`. No active worktree (home/settings) ⇒ no ping. NO path math in the renderer (no basename — main owns it).
- **Integrates with:** Task 4 preload API; store selectors.
- **Verify:** dev run — typing in agents-mode chat opens a human block (`curl localhost:47321/projects`).
- **Tests:** Yes — `shouldReport` throttle cases; ping-builder returns null without active worktree and flags `remote` correctly.
- **Depends on:** Task 4

### Task 6: E2E smoke verification (manual, scripted steps)
- **Files:** `docs-fork/time-tracking.md` (create — includes the verification script)
- **Do:** document and execute: 1) service stopped → open Orca → no errors; auto-spawn works (or silently doesn't, if no entrypoint); 2) type in agents mode → block opens for the repo; 3) switch worktree (same repo) → no churn; switch repo → blur+focus; 4) idle (lower `idleTimeoutMs` via dev env) → block closes; resume reopens; 5) kill service mid-session → Orca unaffected; 6) sleep the laptop 2 min → block closed at suspend, not inflated; 7) quit Orca → block closed immediately.
- **Verify:** all seven checks pass on the local build (`pnpm run build:mac` per FORK-NOTES).
- **Tests:** No (manual smoke; state machine unit-tested in Task 3).
- **Depends on:** Task 5

### Task 7: Agent documentation
- **Files:** `docs-fork/time-tracking.md` (extend), and in the tracker repo: `.claude/rules/agent-integrations.md` (modify), `AGENTS.md` (modify)
- **Do:** Orca side — module layout, contract, config envs (`TIME_TRACKER_BASE_URL`, `TIME_TRACKER_SERVICE_PATH`; note both are dev/shell-launch only — a GUI-launched packaged `.app` won't see shell exports), SSH-skip decision, rebase-survival map (all code in `src/main/time-tracker/` + 4 touch points: `index.ts` ~3 lines, preload ×2, App.tsx 1 line). Tracker repo — add a "Human reporters" note: `/events/*` now has two clients (VS Code extension, Orca fork) and where the Orca half lives. Separate commits per repo (different blast radius).
- **Verify:** a cold agent reading only docs can locate both halves.
- **Tests:** No
- **Depends on:** Task 6

## Test Matrix

### Shared Test Infrastructure
- **Framework:** vitest (Orca convention: `*.test.ts` next to sources)
- **Fixtures:** `makeCtx(overrides?)`, `makePing(overrides?)`; `FakeClient` recording `{event, ctx}`; injectable `now()` + `vi.useFakeTimers()`
- **Factories:** none beyond the above

### Acceptance Criteria → Test Mapping

| AC | Test Location | Case |
|----|--------------|------|
| Activity opens a block | `src/main/time-tracker/tracker.test.ts` | first activity sends focus |
| Repo switch reattributes | `tracker.test.ts` | blur(old)+focus(new) |
| Same-repo worktree switch = no churn | `tracker.test.ts` | ctx updated, no events |
| Idle after 5 min input silence | `tracker.test.ts` | idle fires once |
| Resume sends active | `tracker.test.ts` | post-idle activity → active |
| App-blur grace 60s | `tracker.test.ts` | cancel vs expiry |
| Suspend force-closes / resume re-checks | `tracker.test.ts` | suspend → blur immediate; resume → health |
| Quit flushes | `tracker.test.ts` | flush → blur all open |
| Heartbeat renews ALL open projects | `tracker.test.ts` | 2 projects ⇒ 2 heartbeats/tick |
| SSH repos not tracked | `tracker.test.ts` (buildCtx) + hook test | remote ping dropped / flagged |
| Service down = no-op | `client.test.ts` | never rejects on fetch rejection |

### Per-Task Test Cases

#### Task 1: client — `client.test.ts` (Unit)
| # | Case | Given | When | Then |
|---|------|-------|------|------|
| 1 | payload shape | ctx fixture | sendEvent('focus') | body: event, workspacePath=projectRootPath, branch, ISO timestamp |
| 2 | never rejects | fetch rejects | sendEvent / sendHeartbeat / isHealthy | resolve (void/false) |

#### Task 2: service-spawn — `service-spawn.test.ts` (Unit)
| # | Case | Given | When | Then |
|---|------|-------|------|------|
| 1 | env override | TIME_TRACKER_SERVICE_PATH | resolveServiceEntrypoint | env path |
| 2 | no entrypoint | nothing resolvable | ensureServiceRunning | false, no spawn |
| 3 | already healthy | isHealthy=true | ensureServiceRunning | true, no spawn |

#### Task 3: tracker — `tracker.test.ts` (Unit, fake timers)
| # | Case | Given | When | Then |
|---|------|-------|------|------|
| 1 | first activity | empty | activity(s1, ctxA) | focus(ctxA) |
| 2 | same project | open | activity ×N | exactly 1 focus |
| 3 | same repo, other worktree | ctxA open | activity(ctxA′ same root) | no events, ctx updated |
| 4 | switch repo | ctxA open | activity(ctxB) | blur(A) + focus(B) |
| 5 | idle | ctxA open | +5 min | idle(A) once |
| 6 | resume | idle | activity(ctxA) | active(A) |
| 7 | grace cancel | focused | appBlur, +30s appFocus | no blur |
| 8 | grace expiry | focused | appBlur, +61s | blur(A) |
| 9 | suspend | ctxA open | suspend() | immediate blur(A) |
| 10 | resume health | suspended | resume() | ensureServiceRunning called |
| 11 | flush | A,B open | flush() | blur(A), blur(B) |
| 12 | heartbeat all | A,B open | +30s tick | heartbeat(rootA) + heartbeat(rootB) |
| 13 | heartbeat skip | nothing open | +30s tick | no heartbeat |
| 14 | buildCtx remote | ping.remote=true | buildCtx/handler | dropped |
| 15 | buildCtx name | /x/y/repo | buildCtx | workspaceName='repo' |

#### Task 5: hook helpers — `useTimeTrackerActivity.test.ts` (Unit)
| # | Case | Given | When | Then |
|---|------|-------|------|------|
| 1 | throttle hold | lastSent 1s ago | shouldReport | false |
| 2 | throttle expiry | lastSent 6s ago | shouldReport | true |
| 3 | no worktree | no active worktree | ping builder | null |
| 4 | remote flag | repo.connectionId set | ping builder | remote: true |

### E2E Flows
1. Agents mode: type a prompt → repo gets an open human block → idle → closed with duration.
2. Two worktrees, same repo: switch between them → ONE logical project, no blur/focus churn.
3. Kill service mid-session → keep typing (no UI errors) → restart service → next activity reopens.

## Patterns to Reuse

- IPC/lifecycle: `src/main/ipc/app.ts` (handler module shape); self-contained wiring like `src/main/agent-awake-service.ts` (powerMonitor pattern)
- Preload: `src/preload/index.ts` contextBridge + `src/preload/api-types.ts` (respect AGENTS.md type-declaration rules)
- Store: `useActiveWorktree` / `useRepoById` (`src/renderer/src/store/selectors.ts:178,191`)
- Contract: `time-tracker-extension/.claude/rules/agent-integrations.md` + `service/src/routes/events.ts`
- Fork: `FORK-NOTES.md` (feat/* → personal/build; docs in `docs-fork/`)

## Risks

- **Upstream rebase conflicts** — all logic in new `src/main/time-tracker/`; touch points: `index.ts` ~3 lines, preload ×2, `App.tsx` 1 line. Wiring deliberately NOT inside `registerCoreHandlers` (once-guarded, 17 params — high-conflict surface).
- **Packaged `.app` env vars** — shell exports don't reach a GUI-launched app; `TIME_TRACKER_BASE_URL`/`SERVICE_PATH` are dev/launchd-only. Defaults work out of the box; an Orca-settings UI is deferred (documented).
- **Electron service spawn** — `process.execPath` + `ELECTRON_RUN_AS_NODE=1`; on failure, graceful degradation (agent shell hooks also auto-spawn).
- **Input-idle vs reading** — >5 min with zero input idles the block even with the window focused. Parity with the VS Code extension; scrolling counts as activity, so real reading rarely trips it.
- **Background agent worktrees** — human time accrues only to the SELECTED worktree's repo; watching other sessions requires selecting them (switches attribution). Their agent time is tracked independently by agent hooks — correct by design.
- **Service lifetime** — heartbeats stop when nothing is open; the service may shut down after 5 idle minutes and is respawned on demand (lazy re-check + agent hooks). Known, acceptable race.

## Review Notes

Adversarial review (Plan agent) incorporated:
- **[CRITICAL] SSH/remote repos**: explicit skip via `Repo.connectionId` guard + AC + tests (was unaddressed; violates Orca's "consider SSH" invariant).
- **[CRITICAL] suspend/resume**: powerMonitor integration added (Task 3/4), mirroring `agent-awake-service.ts`; prevents phantom human time across laptop sleep.
- **[CRITICAL] idle semantics**: input-idle trade-off now an explicit decision (parity with VS Code extension).
- **[WARNING] registerCoreHandlers**: wiring moved to a self-contained `wire.ts` called from `index.ts` — avoids the once-guarded 17-param signature entirely.
- **[WARNING] multi-window refcount**: dropped (singleton `mainWindow`); single consistent key = `webContents.id`; app-level focus/blur via `BrowserWindow.getFocusedWindow()`.
- **[WARNING] quit flush**: `flush()` on `before-quit` added + AC + test.
- **[WARNING] heartbeat**: now renews EVERY open project per tick.
- **[SUGGESTION] basename in renderer**: context building moved to main (Node `path`, cross-platform); renderer sends raw `ActivityPing`.
- **[SUGGESTION] fake-timer timeout test**: replaced with fetch-rejection test.
- **[SUGGESTION] packaged-app env**: documented limitation; settings UI deferred.
