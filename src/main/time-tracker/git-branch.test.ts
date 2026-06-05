import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBranchResolver } from './git-branch'

describe('createBranchResolver', () => {
  const execMock = vi.fn()
  let nowMs = 0

  beforeEach(() => {
    execMock.mockReset()
    nowMs = 0
  })

  it('resolves the branch via git and caches it per worktree', async () => {
    execMock.mockResolvedValue('main\n')
    const resolve = createBranchResolver(execMock, () => nowMs)

    await expect(resolve('/wt/a')).resolves.toBe('main')
    await expect(resolve('/wt/a')).resolves.toBe('main')
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it('re-resolves after the cache TTL expires', async () => {
    execMock.mockResolvedValueOnce('main\n').mockResolvedValueOnce('feature\n')
    const resolve = createBranchResolver(execMock, () => nowMs)

    await expect(resolve('/wt/a')).resolves.toBe('main')
    nowMs = 61_000
    await expect(resolve('/wt/a')).resolves.toBe('feature')
    expect(execMock).toHaveBeenCalledTimes(2)
  })

  it('returns an empty branch when git fails', async () => {
    execMock.mockRejectedValue(new Error('not a repo'))
    const resolve = createBranchResolver(execMock, () => nowMs)

    await expect(resolve('/wt/a')).resolves.toBe('')
  })
})
