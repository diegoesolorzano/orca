import { useEffect, useRef } from 'react'
import { useActiveWorktree } from '../store/selectors'

const ACTIVITY_THROTTLE_MS = 5_000

/** Pure, exported for tests. */
export function shouldReport(lastSentAt: number, now: number, throttleMs: number): boolean {
  // 0 = nothing sent yet — the first signal always reports.
  return lastSentAt === 0 || now - lastSentAt >= throttleMs
}

/** Pure, exported for tests. IDs only — main resolves paths from the Store. */
export function buildPing(
  worktree: { id: string; repoId: string } | null
): { repoId: string; worktreeId: string } | null {
  if (!worktree) {
    return null
  }
  return { repoId: worktree.repoId, worktreeId: worktree.id }
}

/** Window-level human-activity reporter for the time-tracker integration
 *  (fork feature). Mount once at the App root. Listens to generic input
 *  signals — keydown, pointerdown, wheel — so agents mode (chat, diff review),
 *  the editor and terminals are all covered without per-component wiring.
 *  Throttled via refs: zero re-renders, max one IPC ping per 5s. */
export function useTimeTrackerActivity(): void {
  const activeWorktree = useActiveWorktree()
  const worktreeRef = useRef<{ id: string; repoId: string } | null>(null)
  worktreeRef.current = activeWorktree
    ? { id: activeWorktree.id, repoId: activeWorktree.repoId }
    : null
  const lastSentAtRef = useRef(0)

  useEffect(() => {
    const report = (): void => {
      const now = Date.now()
      if (!shouldReport(lastSentAtRef.current, now, ACTIVITY_THROTTLE_MS)) {
        return
      }
      const ping = buildPing(worktreeRef.current)
      if (!ping) {
        return
      }
      lastSentAtRef.current = now
      window.api.timeTracker.reportActivity(ping)
    }

    window.addEventListener('keydown', report, { capture: true, passive: true })
    window.addEventListener('pointerdown', report, { capture: true, passive: true })
    window.addEventListener('wheel', report, { capture: true, passive: true })
    return () => {
      window.removeEventListener('keydown', report, { capture: true })
      window.removeEventListener('pointerdown', report, { capture: true })
      window.removeEventListener('wheel', report, { capture: true })
    }
  }, [])
}
