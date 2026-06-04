// Shared contracts for the time-tracker integration (fork feature).
// Contract reference: time-tracker-extension service `/events/*` routes.

export type ProjectContext = {
  /** Canonical repo root (Repo.path) — logical project key; collapses worktrees. */
  projectRootPath: string
  /** Physical checkout (Worktree.path). Equals projectRootPath for the main worktree. */
  worktreePath: string
  /** basename(projectRootPath), derived in main (Node path, OS-aware). */
  workspaceName: string
  /** Current branch of the worktree ('' if unknown). */
  branch: string
}

/** Raw ping from the renderer — IDs only. Main resolves Repo/Worktree from the
 *  Store (source of truth) and decides remote-skip itself; it never trusts
 *  renderer-provided paths or flags. */
export type ActivityPing = {
  repoId: string
  worktreeId: string
}

export type TrackerEvent = 'focus' | 'blur' | 'idle' | 'active'

export type TimeTrackerConfig = {
  baseUrl: string
  idleTimeoutMs: number
  blurGraceMs: number
  heartbeatIntervalMs: number
  activityThrottleMs: number
}

export const DEFAULT_TIME_TRACKER_CONFIG: TimeTrackerConfig = {
  baseUrl: process.env.TIME_TRACKER_BASE_URL ?? 'http://localhost:47321',
  idleTimeoutMs: Number(process.env.TIME_TRACKER_IDLE_MS) || 5 * 60_000,
  blurGraceMs: Number(process.env.TIME_TRACKER_BLUR_GRACE_MS) || 60_000,
  heartbeatIntervalMs: Number(process.env.TIME_TRACKER_HEARTBEAT_MS) || 30_000,
  activityThrottleMs: 5_000
}
