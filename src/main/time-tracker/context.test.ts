import { describe, expect, it } from 'vitest'
import { buildCtx, type ContextLookup } from './context'

function makeLookup(overrides: Partial<ContextLookup> = {}): ContextLookup {
  return {
    getRepoById: (id) =>
      id === 'repo-1' ? { id: 'repo-1', path: '/repos/nodo-ia', connectionId: null } : undefined,
    getWorktreeById: (id) =>
      id === 'wt-1' ? { path: '/worktrees/nodo-ia-feature', branch: 'feature-x' } : undefined,
    ...overrides
  }
}

describe('buildCtx', () => {
  it('resolves a local repo + worktree into a ProjectContext', () => {
    const ctx = buildCtx({ repoId: 'repo-1', worktreeId: 'wt-1' }, makeLookup())

    expect(ctx).toEqual({
      projectRootPath: '/repos/nodo-ia',
      worktreePath: '/worktrees/nodo-ia-feature',
      workspaceName: 'nodo-ia',
      branch: 'feature-x'
    })
  })

  it('drops pings for remote (SSH) repos', () => {
    const lookup = makeLookup({
      getRepoById: () => ({ id: 'repo-1', path: '/remote/repo', connectionId: 'ssh-1' })
    })

    expect(buildCtx({ repoId: 'repo-1', worktreeId: 'wt-1' }, lookup)).toBe(null)
  })

  it('drops pings when the repo or worktree is unknown', () => {
    expect(buildCtx({ repoId: 'nope', worktreeId: 'wt-1' }, makeLookup())).toBe(null)
    expect(buildCtx({ repoId: 'repo-1', worktreeId: 'nope' }, makeLookup())).toBe(null)
  })

  it('falls back to an empty branch when the worktree has none', () => {
    const lookup = makeLookup({
      getWorktreeById: () => ({ path: '/repos/nodo-ia' })
    })

    const ctx = buildCtx({ repoId: 'repo-1', worktreeId: 'wt-1' }, lookup)
    expect(ctx?.branch).toBe('')
  })
})
