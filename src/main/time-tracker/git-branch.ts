import { execFile } from 'node:child_process'

const CACHE_TTL_MS = 60_000
const GIT_TIMEOUT_MS = 2_000

export type ExecBranch = (worktreePath: string) => Promise<string>

function execGitBranch(worktreePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: worktreePath, timeout: GIT_TIMEOUT_MS },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })
}

/** Branch lookup with a per-worktree TTL cache — activity pings arrive every
 *  few seconds and must not spawn a git process each time. Failures resolve
 *  to '' (branch is display metadata; tracking must never break on it). */
export function createBranchResolver(
  exec: ExecBranch = execGitBranch,
  now: () => number = Date.now
): (worktreePath: string) => Promise<string> {
  const cache = new Map<string, { branch: string; at: number }>()

  return async (worktreePath) => {
    const hit = cache.get(worktreePath)
    if (hit && now() - hit.at < CACHE_TTL_MS) {
      return hit.branch
    }

    let branch = ''
    try {
      branch = (await exec(worktreePath)).trim()
    } catch {
      branch = ''
    }
    cache.set(worktreePath, { branch, at: now() })
    return branch
  }
}
