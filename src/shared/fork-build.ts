// Fork (diegoesolorzano/orca): product-base build flags.
//
// In-app self-update is disabled because installing the official release would
// silently overwrite /Applications/Orca.app and drop every local patch
// (git-crypt fix, minimax agent, Cmd+Q confirm, …). The fork still CHECKS and
// NOTIFIES about new upstream releases — the user updates by merging upstream
// and rebuilding (orca-fork-update skill), never by downloading the official
// binary. Keep this as a single shared flag so main (download/install
// neutralization) and the renderer (UpdateCard copy) stay in sync.
export const FORK_SELF_UPDATE_DISABLED = true

/** Short, user-facing reason shown in the update notification UI. */
export const FORK_SELF_UPDATE_DISABLED_REASON =
  'Fork build: in-app updates are disabled (installing the official release would drop local patches). Update by merging upstream and rebuilding (orca-fork-update).'
