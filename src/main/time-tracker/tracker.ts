import type { TrackerClient } from './client'
import { ensureServiceRunning } from './service-spawn'
import { DEFAULT_TIME_TRACKER_CONFIG, type ProjectContext, type TimeTrackerConfig } from './types'

export type TimeTracker = {
  /** Throttled renderer ping (context already resolved by main). Opens or
   *  switches the project block and resets the idle clock. */
  activity(senderId: number, ctx: ProjectContext): void
  /** Any Orca window gained OS focus. */
  appFocus(): void
  /** All Orca windows lost OS focus. */
  appBlur(): void
  /** powerMonitor 'suspend' — force-close all open blocks (no grace). */
  suspend(): void
  /** powerMonitor 'resume' — re-health-check and re-emit unconfirmed opens. */
  resume(): void
  /** BrowserWindow 'closed' — blur + drop that sender's state. */
  senderClosed(senderId: number): void
  /** before-quit — deterministic blur of all open blocks. */
  flush(): void
  dispose(): void
}

type SenderState = {
  ctx: ProjectContext
  lastActivityAt: number
  /** Block believed open on the service side (focus/active delivered). */
  open: boolean
  /** Last block-opening event got a 2xx from the service. */
  delivered: boolean
}

const IDLE_CHECK_INTERVAL_MS = 30_000

export function createTimeTracker(
  client: TrackerClient,
  config?: Partial<TimeTrackerConfig>,
  now: () => number = Date.now
): TimeTracker {
  const cfg: TimeTrackerConfig = { ...DEFAULT_TIME_TRACKER_CONFIG, ...config }
  const senders = new Map<number, SenderState>()
  let blurTimer: NodeJS.Timeout | null = null
  let disposed = false

  function open(state: SenderState, event: 'focus' | 'active'): void {
    state.open = true
    state.delivered = false
    void client.sendEvent(event, state.ctx).then((ok) => {
      state.delivered = ok
    })
  }

  function close(state: SenderState, event: 'blur' | 'idle'): void {
    if (!state.open) {
      return
    }
    state.open = false
    state.delivered = false
    void client.sendEvent(event, state.ctx)
  }

  function cancelBlurTimer(): void {
    if (blurTimer) {
      clearTimeout(blurTimer)
      blurTimer = null
    }
  }

  const idleInterval = setInterval(() => {
    const cutoff = now() - cfg.idleTimeoutMs
    for (const state of senders.values()) {
      if (state.open && state.lastActivityAt <= cutoff) {
        close(state, 'idle')
      }
    }
  }, IDLE_CHECK_INTERVAL_MS)
  idleInterval.unref?.()

  const heartbeatInterval = setInterval(() => {
    const roots = new Set<string>()
    for (const state of senders.values()) {
      if (state.open) {
        roots.add(state.ctx.projectRootPath)
      }
    }
    for (const root of roots) {
      void client.sendHeartbeat(root)
    }
  }, cfg.heartbeatIntervalMs)
  heartbeatInterval.unref?.()

  return {
    activity(senderId, ctx) {
      if (disposed) {
        return
      }
      const existing = senders.get(senderId)

      if (!existing) {
        const state: SenderState = { ctx, lastActivityAt: now(), open: false, delivered: false }
        senders.set(senderId, state)
        open(state, 'focus')
        return
      }

      existing.lastActivityAt = now()

      if (existing.ctx.projectRootPath !== ctx.projectRootPath) {
        // Repo switch: close the old logical project, open the new one.
        close(existing, 'blur')
        existing.ctx = ctx
        open(existing, 'focus')
        return
      }

      // Same logical project — keep the freshest worktree/branch context.
      existing.ctx = ctx

      if (!existing.open) {
        open(existing, 'active')
      } else if (!existing.delivered) {
        // The opening event never reached the service (it was down) — re-emit
        // so recovery is real instead of assumed.
        open(existing, 'focus')
      }
    },

    appFocus() {
      cancelBlurTimer()
    },

    appBlur() {
      cancelBlurTimer()
      blurTimer = setTimeout(() => {
        blurTimer = null
        for (const state of senders.values()) {
          close(state, 'blur')
        }
      }, cfg.blurGraceMs)
      blurTimer.unref?.()
    },

    suspend() {
      cancelBlurTimer()
      for (const state of senders.values()) {
        close(state, 'blur')
      }
    },

    resume() {
      void ensureServiceRunning(client).then((healthy) => {
        if (!healthy || disposed) {
          return
        }
        for (const state of senders.values()) {
          if (state.open && !state.delivered) {
            open(state, 'focus')
          }
        }
      })
    },

    senderClosed(senderId) {
      const state = senders.get(senderId)
      if (!state) {
        return
      }
      close(state, 'blur')
      senders.delete(senderId)
    },

    flush() {
      cancelBlurTimer()
      for (const state of senders.values()) {
        close(state, 'blur')
      }
    },

    dispose() {
      disposed = true
      cancelBlurTimer()
      clearInterval(idleInterval)
      clearInterval(heartbeatInterval)
      senders.clear()
    }
  }
}
