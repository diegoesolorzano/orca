import { spawn } from 'node:child_process'
import { globSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { TrackerClient } from './client'

const SPAWN_SETTLE_MS = 2_000

/** Resolution order: TIME_TRACKER_SERVICE_PATH env → newest installed
 *  VS Code time-tracker extension bundle → null (tracking degrades gracefully;
 *  the agent shell hooks can also auto-spawn the service). */
export function resolveServiceEntrypoint(): string | null {
  // An explicit env override is honored as-is (the user asked for it).
  const envPath = process.env.TIME_TRACKER_SERVICE_PATH
  if (envPath) {
    return envPath
  }

  const pattern = path.join(
    homedir(),
    '.vscode',
    'extensions',
    'diegosolorzano.time-tracker-*',
    'dist',
    'service.mjs'
  )
  const candidates = globSync(pattern).sort()
  return candidates.at(-1) ?? null
}

/** Health-check; if down, best-effort spawn of the service, detached.
 *  Resolves true iff the service is healthy after the attempt. */
export async function ensureServiceRunning(client: TrackerClient): Promise<boolean> {
  if (await client.isHealthy()) {
    return true
  }

  const entrypoint = resolveServiceEntrypoint()
  if (!entrypoint) {
    return false
  }

  try {
    // Why process.execPath + ELECTRON_RUN_AS_NODE: plain `node` is not on PATH
    // inside a packaged Electron app; the Electron binary doubles as node.
    const child = spawn(process.execPath, [entrypoint], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', START_SERVER: '1' }
    })
    child.unref()
  } catch {
    return false
  }

  await new Promise((resolve) => setTimeout(resolve, SPAWN_SETTLE_MS))
  return client.isHealthy()
}
