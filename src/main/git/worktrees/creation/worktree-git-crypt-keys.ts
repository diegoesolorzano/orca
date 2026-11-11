import { cp, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gitExecFileAsync } from '../../command-runner/git-exec-file'
import { resolveGitDir } from '../../source-control/resolve-git-dir'
import { removeWorktree } from '../removal/worktree-removal'

// Fork patch (git-crypt worktree create, upstream PR #4626); see FORK-NOTES.md.

/**
 * git-crypt keeps its unlocked keys under `<git dir>/git-crypt/`. A linked
 * worktree gets its own git dir (`.git/worktrees/<name>/`) created without
 * keys, so the smudge filter fails during `git worktree add`'s checkout and
 * creation never completes. Returns the repo's git-crypt dir when present.
 */
async function getGitCryptKeysDir(repoPath: string): Promise<string | null> {
  // Why: filesystem probe instead of `git rev-parse --git-common-dir` — the
  // main repo's git dir is `<repoPath>/.git` (or the repo itself when bare),
  // and skipping the subprocess keeps creation fast on non-git-crypt repos.
  for (const gitDir of [join(repoPath, '.git'), repoPath]) {
    try {
      const candidate = join(gitDir, 'git-crypt')
      if ((await stat(candidate)).isDirectory()) {
        return candidate
      }
    } catch {
      // Why: missing path — keep probing the bare-repo layout.
    }
  }
  return null
}

async function copyGitCryptKeysToWorktree(
  gitCryptDir: string,
  worktreePath: string
): Promise<void> {
  const worktreeGitDir = await resolveGitDir(worktreePath)
  // Why: copies every key (multi-key repos use --key-name filters); force=false
  // keeps anything already present in the worktree's git dir authoritative.
  await cp(gitCryptDir, join(worktreeGitDir, 'git-crypt'), { recursive: true, force: false })
}

export type GitCryptWorktreeAddPlan = { gitCryptDir: string | null; deferCheckout: boolean }

export async function planGitCryptWorktreeAdd(
  repoPath: string,
  noCheckout: boolean
): Promise<GitCryptWorktreeAddPlan> {
  const gitCryptDir = await getGitCryptKeysDir(repoPath)
  return { gitCryptDir, deferCheckout: gitCryptDir !== null && !noCheckout }
}

/** Copies the keys, then runs the checkout that `addWorktree` deferred, rolling back on failure. */
export async function finishGitCryptWorktreeCheckout(
  plan: GitCryptWorktreeAddPlan,
  args: {
    repoPath: string
    worktreePath: string
    branch: string
    checkoutWorkersArgs: string[]
    createdBranch: boolean
  }
): Promise<void> {
  if (!plan.gitCryptDir) {
    return
  }
  await copyGitCryptKeysToWorktree(plan.gitCryptDir, args.worktreePath)
  if (!plan.deferCheckout) {
    return
  }
  try {
    await gitExecFileAsync([...args.checkoutWorkersArgs, 'checkout', args.branch], {
      cwd: args.worktreePath
    })
  } catch (error) {
    // Why: mirror addSparseWorktree's rollback — a fileless worktree is
    // half-created state the user would otherwise clean up manually.
    try {
      await removeWorktree(args.repoPath, args.worktreePath, true, {
        deleteBranch: args.createdBranch,
        forceBranchDelete: args.createdBranch
      })
    } catch {
      // Why: surface the original checkout failure, not the cleanup one.
    }
    throw error
  }
}
