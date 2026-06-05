import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as nodeFs from 'node:fs'
import type { TrackerClient } from './client'

const { spawnMock, globSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  globSyncMock: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof nodeFs>()
  return { ...actual, globSync: globSyncMock, existsSync: () => true }
})

import { ensureServiceRunning, resolveServiceEntrypoint } from './service-spawn'

function makeClient(healthySequence: boolean[]): TrackerClient {
  const seq = [...healthySequence]
  return {
    sendEvent: vi.fn().mockResolvedValue(true),
    sendHeartbeat: vi.fn().mockResolvedValue(true),
    isHealthy: vi.fn(() => Promise.resolve(seq.shift() ?? false))
  }
}

describe('resolveServiceEntrypoint', () => {
  beforeEach(() => {
    globSyncMock.mockReturnValue([])
    delete process.env.TIME_TRACKER_SERVICE_PATH
  })

  afterEach(() => {
    delete process.env.TIME_TRACKER_SERVICE_PATH
  })

  it('prefers the TIME_TRACKER_SERVICE_PATH env override', () => {
    process.env.TIME_TRACKER_SERVICE_PATH = '/custom/service.mjs'
    expect(resolveServiceEntrypoint()).toBe('/custom/service.mjs')
  })

  it('returns null when nothing is resolvable', () => {
    expect(resolveServiceEntrypoint()).toBe(null)
  })
})

describe('ensureServiceRunning', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockReturnValue({ unref: vi.fn() })
    globSyncMock.mockReturnValue([])
    delete process.env.TIME_TRACKER_SERVICE_PATH
  })

  it('does not spawn when the service is already healthy', async () => {
    const client = makeClient([true])
    await expect(ensureServiceRunning(client)).resolves.toBe(true)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('returns false without spawning when no entrypoint resolves', async () => {
    const client = makeClient([false])
    await expect(ensureServiceRunning(client)).resolves.toBe(false)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('spawns the resolved entrypoint as a detached node process', async () => {
    vi.useFakeTimers()
    process.env.TIME_TRACKER_SERVICE_PATH = '/custom/service.mjs'
    const client = makeClient([false, true])

    const promise = ensureServiceRunning(client)
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe(true)

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = spawnMock.mock.calls[0]
    expect(cmd).toBe(process.execPath)
    expect(args).toEqual(['/custom/service.mjs'])
    expect(opts.detached).toBe(true)
    expect(opts.env.START_SERVER).toBe('1')
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBe('1')
    vi.useRealTimers()
  })
})
