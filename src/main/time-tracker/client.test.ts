import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrackerClient } from './client'
import type { ProjectContext } from './types'

function makeCtx(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    projectRootPath: '/repos/nodo-ia',
    worktreePath: '/repos/nodo-ia',
    workspaceName: 'nodo-ia',
    branch: 'main',
    ...overrides
  }
}

describe('createTrackerClient', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the contract payload shape on sendEvent', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const client = createTrackerClient('http://localhost:47321')

    const delivered = await client.sendEvent('focus', makeCtx())

    expect(delivered).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:47321/events/focus')
    const body = JSON.parse(init.body)
    expect(body.workspacePath).toBe('/repos/nodo-ia')
    expect(body.projectRootPath).toBe('/repos/nodo-ia')
    expect(body.worktreePath).toBe('/repos/nodo-ia')
    expect(body.workspaceName).toBe('nodo-ia')
    expect(body.branch).toBe('main')
    expect(body.sourceName).toBe('orca')
    // ISO 8601 UTC timestamp
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('never rejects and resolves false when fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const client = createTrackerClient()

    await expect(client.sendEvent('blur', makeCtx())).resolves.toBe(false)
    await expect(client.sendHeartbeat('/repos/nodo-ia')).resolves.toBe(false)
    await expect(client.isHealthy()).resolves.toBe(false)
  })

  it('resolves false on non-2xx responses', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const client = createTrackerClient()

    await expect(client.sendEvent('idle', makeCtx())).resolves.toBe(false)
  })

  it('sends heartbeat with optional workspacePath', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const client = createTrackerClient('http://localhost:47321')

    await expect(client.sendHeartbeat('/repos/nodo-ia')).resolves.toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:47321/events/heartbeat')
    expect(JSON.parse(init.body)).toEqual({ workspacePath: '/repos/nodo-ia' })

    await client.sendHeartbeat()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({})
  })

  it('isHealthy reports true on a 2xx /health', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const client = createTrackerClient('http://localhost:47321')

    await expect(client.isHealthy()).resolves.toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:47321/health')
  })
})
