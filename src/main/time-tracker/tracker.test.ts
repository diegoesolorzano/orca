import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerClient } from './client'
import { createTimeTracker, type TimeTracker } from './tracker'
import type { ProjectContext, TrackerEvent } from './types'

const { ensureServiceRunningMock } = vi.hoisted(() => ({
  ensureServiceRunningMock: vi.fn()
}))

vi.mock('./service-spawn', () => ({
  ensureServiceRunning: ensureServiceRunningMock
}))

function makeCtx(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    projectRootPath: '/repos/a',
    worktreePath: '/repos/a',
    workspaceName: 'a',
    branch: 'main',
    ...overrides
  }
}

type RecordedEvent = {
  event: TrackerEvent
  ctx: ProjectContext
}

function makeFakeClient(deliver: () => boolean = () => true) {
  const events: RecordedEvent[] = []
  const heartbeats: (string | undefined)[] = []
  const client: TrackerClient = {
    sendEvent: vi.fn((event: TrackerEvent, ctx: ProjectContext) => {
      events.push({ event, ctx })
      return Promise.resolve(deliver())
    }),
    sendHeartbeat: vi.fn((workspacePath?: string) => {
      heartbeats.push(workspacePath)
      return Promise.resolve(true)
    }),
    isHealthy: vi.fn().mockResolvedValue(true)
  }
  return { client, events, heartbeats }
}

const CONFIG = {
  idleTimeoutMs: 5 * 60_000,
  blurGraceMs: 60_000,
  heartbeatIntervalMs: 30_000
}

describe('createTimeTracker', () => {
  let tracker: TimeTracker | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    ensureServiceRunningMock.mockReset()
    ensureServiceRunningMock.mockResolvedValue(true)
  })

  afterEach(() => {
    tracker?.dispose()
    tracker = null
    vi.useRealTimers()
  })

  it('sends focus on the first activity', async () => {
    const { client, events } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(0)

    expect(events).toEqual([{ event: 'focus', ctx: makeCtx() }])
  })

  it('does not resend focus for repeated activity on the same project', async () => {
    const { client, events } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(1_000)
    tracker.activity(1, makeCtx())
    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(0)

    expect(events.filter((e) => e.event === 'focus')).toHaveLength(1)
  })

  it('updates context without churn when switching worktrees of the same repo', async () => {
    const { client, events } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(0)
    tracker.activity(1, makeCtx({ worktreePath: '/worktrees/a-feature', branch: 'feature' }))
    await vi.advanceTimersByTimeAsync(0)

    expect(events).toHaveLength(1) // only the original focus
  })

  it('sends blur(old) + focus(new) when switching repos', async () => {
    const { client, events } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)
    const ctxB = makeCtx({
      projectRootPath: '/repos/b',
      worktreePath: '/repos/b',
      workspaceName: 'b'
    })

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(0)
    tracker.activity(1, ctxB)
    await vi.advanceTimersByTimeAsync(0)

    expect(events.map((e) => [e.event, e.ctx.workspaceName])).toEqual([
      ['focus', 'a'],
      ['blur', 'a'],
      ['focus', 'b']
    ])
  })

  it('sends idle once after the idle timeout', async () => {
    const { client, events } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(CONFIG.idleTimeoutMs + 60_000)

    expect(events.filter((e) => e.event === 'idle')).toHaveLength(1)
  })

  it('sends active when activity resumes after idle', async () => {
    const { client, events } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(CONFIG.idleTimeoutMs + 60_000)
    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(0)

    expect(events.at(-1)).toEqual({ event: 'active', ctx: makeCtx() })
  })

  it('does not blur when refocused within the grace period', async () => {
    const { client, events } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(0)
    tracker.appBlur()
    await vi.advanceTimersByTimeAsync(30_000)
    tracker.appFocus()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(events.filter((e) => e.event === 'blur')).toHaveLength(0)
  })

  it('blurs open projects when the grace period expires', async () => {
    const { client, events } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(0)
    tracker.appBlur()
    await vi.advanceTimersByTimeAsync(CONFIG.blurGraceMs + 1_000)

    expect(events.filter((e) => e.event === 'blur')).toHaveLength(1)
  })

  it('force-closes open blocks immediately on suspend', async () => {
    const { client, events } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(0)
    tracker.suspend()
    await vi.advanceTimersByTimeAsync(0)

    expect(events.at(-1)?.event).toBe('blur')
  })

  it('re-checks service health on resume', async () => {
    const { client } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    tracker.resume()
    await vi.advanceTimersByTimeAsync(0)

    expect(ensureServiceRunningMock).toHaveBeenCalled()
  })

  it('flush blurs every open project', async () => {
    const { client, events } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)
    const ctxB = makeCtx({
      projectRootPath: '/repos/b',
      worktreePath: '/repos/b',
      workspaceName: 'b'
    })

    tracker.activity(1, makeCtx())
    tracker.activity(2, ctxB)
    await vi.advanceTimersByTimeAsync(0)
    tracker.flush()
    await vi.advanceTimersByTimeAsync(0)

    const blurs = events.filter((e) => e.event === 'blur').map((e) => e.ctx.workspaceName)
    expect(blurs.sort()).toEqual(['a', 'b'])
  })

  it('heartbeats every open project per tick', async () => {
    const { client, heartbeats } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)
    const ctxB = makeCtx({
      projectRootPath: '/repos/b',
      worktreePath: '/repos/b',
      workspaceName: 'b'
    })

    tracker.activity(1, makeCtx())
    tracker.activity(2, ctxB)
    await vi.advanceTimersByTimeAsync(CONFIG.heartbeatIntervalMs + 1_000)

    expect(heartbeats).toContain('/repos/a')
    expect(heartbeats).toContain('/repos/b')
  })

  it('skips heartbeats when nothing is open', async () => {
    const { client, heartbeats } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    await vi.advanceTimersByTimeAsync(CONFIG.heartbeatIntervalMs * 3)

    expect(heartbeats).toHaveLength(0)
  })

  it('re-sends focus on next activity when the opening event was not delivered', async () => {
    let healthy = false
    const { client, events } = makeFakeClient(() => healthy)
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx()) // focus attempted, not delivered
    await vi.advanceTimersByTimeAsync(1_000)
    healthy = true
    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(0)

    expect(events.filter((e) => e.event === 'focus')).toHaveLength(2)
  })

  it('re-emits focus for unconfirmed entries after resume()', async () => {
    let healthy = false
    const { client, events } = makeFakeClient(() => healthy)
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(1_000)
    healthy = true
    tracker.resume()
    await vi.advanceTimersByTimeAsync(0)

    expect(events.filter((e) => e.event === 'focus')).toHaveLength(2)
  })

  it('senderClosed blurs the project and stops its heartbeats', async () => {
    const { client, events, heartbeats } = makeFakeClient()
    tracker = createTimeTracker(client, CONFIG)

    tracker.activity(1, makeCtx())
    await vi.advanceTimersByTimeAsync(0)
    tracker.senderClosed(1)
    await vi.advanceTimersByTimeAsync(0)

    expect(events.at(-1)?.event).toBe('blur')
    heartbeats.length = 0
    await vi.advanceTimersByTimeAsync(CONFIG.heartbeatIntervalMs * 2)
    expect(heartbeats).toHaveLength(0)
  })
})
