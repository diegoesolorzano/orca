import { describe, expect, it, vi, beforeEach } from 'vitest'
import { toast } from 'sonner'
import { showNestedReposToast } from './nested-repos-toast'

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))

// Fork feature: warn after a local create when the meta-repo has nested git repos
// the worktree does not materialize.
describe('fork: showNestedReposToast', () => {
  beforeEach(() => {
    vi.mocked(toast.warning).mockClear()
  })

  it('does nothing without a warning', () => {
    showNestedReposToast(undefined)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('warns and lists the untracked nested repos', () => {
    showNestedReposToast({ paths: ['backend/', 'frontend/'], truncated: false, moreCount: 0 })
    const description = vi.mocked(toast.warning).mock.calls.at(-1)?.[1]?.description
    expect(description).toContain('backend/, frontend/')
    expect(description).toContain('only contains files tracked by the parent repo')
  })

  it('appends the remainder count when the list is truncated', () => {
    showNestedReposToast({ paths: ['a/', 'b/'], truncated: true, moreCount: 3 })
    const description = vi.mocked(toast.warning).mock.calls.at(-1)?.[1]?.description
    expect(description).toContain('and 3 more')
  })
})
