import { DEFAULT_TIME_TRACKER_CONFIG, type ProjectContext, type TrackerEvent } from './types'

export type TrackerClient = {
  /** Resolves true iff the service acknowledged (2xx). Never rejects —
   *  a down service must be a silent no-op that never blocks Orca. */
  sendEvent(event: TrackerEvent, ctx: ProjectContext): Promise<boolean>
  sendHeartbeat(workspacePath?: string): Promise<boolean>
  isHealthy(): Promise<boolean>
}

const EVENT_TIMEOUT_MS = 3_000
const HEALTH_TIMEOUT_MS = 2_000

async function post(url: string, body: unknown, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    return res.ok
  } catch {
    return false
  }
}

export function createTrackerClient(
  baseUrl: string = DEFAULT_TIME_TRACKER_CONFIG.baseUrl
): TrackerClient {
  return {
    sendEvent(event, ctx) {
      return post(
        `${baseUrl}/events/${event}`,
        {
          event,
          workspacePath: ctx.projectRootPath,
          projectRootPath: ctx.projectRootPath,
          worktreePath: ctx.worktreePath,
          workspaceName: ctx.workspaceName,
          branch: ctx.branch,
          timestamp: new Date().toISOString()
        },
        EVENT_TIMEOUT_MS
      )
    },

    sendHeartbeat(workspacePath) {
      return post(
        `${baseUrl}/events/heartbeat`,
        workspacePath ? { workspacePath } : {},
        EVENT_TIMEOUT_MS
      )
    },

    async isHealthy() {
      try {
        const res = await fetch(`${baseUrl}/health`, {
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
        })
        return res.ok
      } catch {
        return false
      }
    }
  }
}
