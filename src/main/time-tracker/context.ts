import path from 'node:path'
import type { ActivityPing, ProjectContext } from './types'

/** Narrow lookup over the Store — injected so tests need no real Store. */
export type ContextLookup = {
  getRepoById(id: string): { id: string; path: string; connectionId?: string | null } | undefined
  getWorktreeById(id: string): { path: string; branch?: string } | undefined
}

/** Resolves an ActivityPing against the Store (main is the source of truth —
 *  renderer-provided paths/flags are never trusted). Returns null (no
 *  tracking) when the repo/worktree is unknown or the repo is remote (SSH):
 *  remote paths would register phantom local projects in the tracker. */
export function buildCtx(ping: ActivityPing, lookup: ContextLookup): ProjectContext | null {
  const repo = lookup.getRepoById(ping.repoId)
  if (!repo || repo.connectionId != null) {
    return null
  }

  const worktree = lookup.getWorktreeById(ping.worktreeId)
  if (!worktree) {
    return null
  }

  return {
    projectRootPath: repo.path,
    worktreePath: worktree.path,
    workspaceName: path.basename(repo.path),
    branch: worktree.branch ?? ''
  }
}
