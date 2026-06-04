import { describe, expect, it } from 'vitest'
import { buildPing, shouldReport } from './useTimeTrackerActivity'

describe('shouldReport', () => {
  it('holds while inside the throttle window', () => {
    expect(shouldReport(1_000, 2_000, 5_000)).toBe(false)
  })

  it('reports once the throttle window has elapsed', () => {
    expect(shouldReport(1_000, 6_500, 5_000)).toBe(true)
  })

  it('reports when nothing has been sent yet', () => {
    expect(shouldReport(0, 1, 5_000)).toBe(true)
  })
})

describe('buildPing', () => {
  it('returns null without an active worktree', () => {
    expect(buildPing(null)).toBe(null)
  })

  it('sends IDs only — no paths', () => {
    const ping = buildPing({ id: 'repo-1::/wt/a', repoId: 'repo-1' })
    expect(ping).toEqual({ repoId: 'repo-1', worktreeId: 'repo-1::/wt/a' })
  })
})
