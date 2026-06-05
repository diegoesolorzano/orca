import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'
import type { Store } from '../persistence'
import { createTrackerClient } from './client'
import { buildCtx, type ContextLookup } from './context'
import { createBranchResolver } from './git-branch'
import { ensureServiceRunning } from './service-spawn'
import { createTimeTracker, type TimeTracker } from './tracker'
import type { ActivityPing } from './types'

// Self-contained wiring for the time-tracker integration (fork feature).
// Deliberately registered OUTSIDE registerCoreHandlers: that function is
// once-guarded with a very wide signature, and threading a tracker through it
// maximizes upstream-merge conflicts. Uses ipcMain.on (not .handle) — the
// activity ping is fire-and-forget and needs no response.
export function wireTimeTracker(store: Store): TimeTracker {
  const client = createTrackerClient()
  const tracker = createTimeTracker(client)
  const resolveBranch = createBranchResolver()

  const lookup: ContextLookup = {
    getRepoById: (id) => store.getRepo(id),
    // The worktree path is embedded in the worktree id (`${repoId}::${path}`);
    // folder-workspace instance suffixes are stripped for filesystem use.
    getWorktreeById: (id) => {
      const parsed = splitWorktreeIdForFilesystem(id)
      return parsed ? { path: parsed.worktreePath } : undefined
    }
  }

  ipcMain.on('timeTracker:activity', (event, ping: ActivityPing) => {
    if (!ping || typeof ping.repoId !== 'string' || typeof ping.worktreeId !== 'string') {
      return
    }
    const base = buildCtx(ping, lookup)
    if (!base) {
      return
    }
    const senderId = event.sender.id
    void resolveBranch(base.worktreePath).then((branch) => {
      tracker.activity(senderId, { ...base, branch })
    })
  })

  app.on('browser-window-created', (_event, window) => {
    const senderId = window.webContents.id
    window.on('closed', () => tracker.senderClosed(senderId))
  })

  app.on('browser-window-focus', () => tracker.appFocus())
  app.on('browser-window-blur', () => {
    // Per-window blur fires when focus moves BETWEEN Orca windows too — only
    // treat it as app blur when no Orca window holds focus anymore.
    setImmediate(() => {
      if (BrowserWindow.getFocusedWindow() === null) {
        tracker.appBlur()
      }
    })
  })

  powerMonitor.on('suspend', () => tracker.suspend())
  powerMonitor.on('resume', () => tracker.resume())
  app.on('before-quit', () => tracker.flush())

  // Best-effort: bring the service up so the first activity lands.
  void ensureServiceRunning(client)

  return tracker
}
