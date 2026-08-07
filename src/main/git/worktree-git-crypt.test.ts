import type * as FsPromises from 'fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { gitExecFileAsyncMock, gitExecFileSyncMock, translateWslOutputPathsMock } = vi.hoisted(
  () => ({
    gitExecFileAsyncMock: vi.fn(),
    gitExecFileSyncMock: vi.fn(),
    translateWslOutputPathsMock: vi.fn((output: string) => output)
  })
)

const { statMock, cpMock, resolveGitDirMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
  cpMock: vi.fn(),
  resolveGitDirMock: vi.fn()
}))

vi.mock('./runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock,
  gitExecFileSync: gitExecFileSyncMock,
  translateWslOutputPaths: translateWslOutputPathsMock
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return { ...actual, stat: statMock, cp: cpMock }
})

vi.mock('./status', () => ({
  resolveGitDir: resolveGitDirMock,
  runWithGitReadCacheInvalidation: <T,>(run: () => Promise<T>) => run()
}))

import { join } from 'path'
import { addWorktree } from './worktree'

const REPO = '/repo'
const WORKTREE = '/repo-feature'
const BRANCH = 'feature/test'
const REPO_GIT_CRYPT = join(REPO, '.git', 'git-crypt')
const WORKTREE_GIT_DIR = join(REPO, '.git', 'worktrees', 'repo-feature')

const statDirectory = { isDirectory: () => true }
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

const resolveRemoteBase = () => {
  gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: 'abc123\n' }) // rev-parse refs/remotes/origin/main^{commit}
}

describe('addWorktree on git-crypt repos', () => {
  beforeEach(() => {
    gitExecFileAsyncMock.mockReset()
    gitExecFileSyncMock.mockReset()
    translateWslOutputPathsMock.mockClear()
    statMock.mockReset()
    cpMock.mockReset()
    resolveGitDirMock.mockReset()
    resolveGitDirMock.mockResolvedValue(WORKTREE_GIT_DIR)
    cpMock.mockResolvedValue(undefined)
  })

  it('keeps plain creation untouched when the repo has no git-crypt dir', async () => {
    statMock.mockRejectedValue(enoent()) // both layout probes miss
    resolveRemoteBase()
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // worktree add
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // config --local --replace-all branch.<branch>.base
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: 'true\n' }) // push.autoSetupRemote already set

    await addWorktree(REPO, WORKTREE, BRANCH, 'origin/main')

    expect(gitExecFileAsyncMock.mock.calls[1]?.[0]).toEqual([
      'worktree',
      'add',
      '--no-track',
      '-b',
      BRANCH,
      WORKTREE,
      'refs/remotes/origin/main'
    ])
    expect(cpMock).not.toHaveBeenCalled()
    expect(gitExecFileAsyncMock.mock.calls.map((call) => call[0])).not.toContainEqual([
      'checkout',
      BRANCH
    ])
  })

  it('defers checkout, copies the keys into the worktree git dir, then checks out', async () => {
    statMock.mockResolvedValueOnce(statDirectory) // <repo>/.git/git-crypt exists
    resolveRemoteBase()
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // worktree add --no-checkout
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // checkout in worktree
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // config --local --replace-all branch.<branch>.base
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: 'true\n' }) // push.autoSetupRemote already set

    await addWorktree(REPO, WORKTREE, BRANCH, 'origin/main')

    expect(gitExecFileAsyncMock.mock.calls[1]).toEqual([
      [
        'worktree',
        'add',
        '--no-checkout',
        '--no-track',
        '-b',
        BRANCH,
        WORKTREE,
        'refs/remotes/origin/main'
      ],
      { cwd: REPO, timeout: 180_000 }
    ])
    expect(cpMock).toHaveBeenCalledWith(REPO_GIT_CRYPT, join(WORKTREE_GIT_DIR, 'git-crypt'), {
      recursive: true,
      force: false
    })
    expect(gitExecFileAsyncMock.mock.calls[2]).toEqual([['checkout', BRANCH], { cwd: WORKTREE }])
  })

  it('probes the bare-repo layout when <repo>/.git has no git-crypt dir', async () => {
    statMock.mockRejectedValueOnce(enoent()) // <repo>/.git/git-crypt missing
    statMock.mockResolvedValueOnce(statDirectory) // <repo>/git-crypt exists (bare)
    resolveRemoteBase()
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // worktree add --no-checkout
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // checkout in worktree
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // config --local --replace-all branch.<branch>.base
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: 'true\n' }) // push.autoSetupRemote already set

    await addWorktree(REPO, WORKTREE, BRANCH, 'origin/main')

    expect(cpMock).toHaveBeenCalledWith(
      join(REPO, 'git-crypt'),
      join(WORKTREE_GIT_DIR, 'git-crypt'),
      {
        recursive: true,
        force: false
      }
    )
  })

  it('copies keys but leaves checkout to the caller when noCheckout is requested', async () => {
    statMock.mockResolvedValueOnce(statDirectory) // <repo>/.git/git-crypt exists
    resolveRemoteBase()
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // worktree add --no-checkout
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // config --local --replace-all branch.<branch>.base
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: 'true\n' }) // push.autoSetupRemote already set

    await addWorktree(REPO, WORKTREE, BRANCH, 'origin/main', false, true)

    const worktreeAddArgs = gitExecFileAsyncMock.mock.calls[1]?.[0] as string[]
    expect(worktreeAddArgs.filter((arg) => arg === '--no-checkout')).toHaveLength(1)
    expect(cpMock).toHaveBeenCalledWith(REPO_GIT_CRYPT, join(WORKTREE_GIT_DIR, 'git-crypt'), {
      recursive: true,
      force: false
    })
    // Why: sparse creation runs its own checkout after sparse-checkout setup.
    expect(gitExecFileAsyncMock.mock.calls.map((call) => call[0])).not.toContainEqual([
      'checkout',
      BRANCH
    ])
  })

  it('copies keys when checking out an existing branch into a worktree', async () => {
    statMock.mockResolvedValueOnce(statDirectory) // <repo>/.git/git-crypt exists
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // worktree add --no-checkout
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // checkout in worktree

    await addWorktree(REPO, WORKTREE, BRANCH, BRANCH, false, false, {
      checkoutExistingBranch: true
    })

    expect(gitExecFileAsyncMock.mock.calls).toEqual([
      [['worktree', 'add', '--no-checkout', WORKTREE, BRANCH], { cwd: REPO, timeout: 180_000 }],
      [['checkout', BRANCH], { cwd: WORKTREE }]
    ])
    expect(cpMock).toHaveBeenCalledWith(REPO_GIT_CRYPT, join(WORKTREE_GIT_DIR, 'git-crypt'), {
      recursive: true,
      force: false
    })
  })

  it('rolls back the half-created worktree when the deferred checkout fails', async () => {
    const beforeRemoval = `worktree ${REPO}\nHEAD abc123\nbranch refs/heads/main\n\nworktree ${WORKTREE}\nHEAD def456\nbranch refs/heads/${BRANCH}\n`
    const afterPrune = `worktree ${REPO}\nHEAD abc123\nbranch refs/heads/main\n`
    statMock.mockResolvedValueOnce(statDirectory) // <repo>/.git/git-crypt exists
    resolveRemoteBase()
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // worktree add --no-checkout
    gitExecFileAsyncMock.mockRejectedValueOnce(new Error('smudge filter git-crypt failed')) // checkout
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: beforeRemoval }) // worktree list before remove
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // worktree remove
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // worktree prune
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: afterPrune }) // worktree list after prune
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' }) // branch -D (rollback force-deletes the fresh branch)

    await expect(addWorktree(REPO, WORKTREE, BRANCH, 'origin/main')).rejects.toThrow(
      'smudge filter git-crypt failed'
    )

    expect(gitExecFileAsyncMock.mock.calls.map((call) => call[0])).toContainEqual([
      'worktree',
      'remove',
      '--force',
      WORKTREE
    ])
    expect(gitExecFileAsyncMock.mock.calls.map((call) => call[0])).toContainEqual([
      'branch',
      '-D',
      '--',
      BRANCH
    ])
  })
})
