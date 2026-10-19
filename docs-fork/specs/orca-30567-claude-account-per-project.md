# Brief: Claude account per project

**Feature ID:** orca-30567-claude-account-per-project · **Repo:** orca · **Tier:** full · **Modifiers:** security-review, fork location `docs-fork/specs/` (the fork rule keeps `docs/` for upstream); upstream issue stablyai/orca#30567

## Problem

Orca routes every Claude launch on a host to one global account (`activeClaudeManagedAccountIdsByRuntime.host`).
A user with a work account and a personal account has to switch it by hand whenever they move between
projects; forgetting means billing and rate limits land on the wrong account. Session history is already
shared across accounts (upstream #24300), so the remaining gap is choosing the account per project.

## Approach

Mirror the existing per-project `gh` binding (`Repo.ghAccount`, `RepositoryGitHubAccountSection`):
an optional per-repo field, a select in Repository settings, resolved at spawn time.

Decisions:

1. **Storage: `Repo.claudeAccountId?: string | null`** — absent/null = use the global selection
   (today's behavior). Because: repos (git and folder workspaces) are already the per-project settings
   unit, persisted, synced over RPC with optional-field compatibility, and `ghAccount` proves the path.
   It stores an account **id**, never a path or credential.
2. **Resolution lives in `ClaudeProfileRouter`, keyed by an optional `repoId` on
   `ClaudeAccountSelectionTarget`.** `selectedProfile(target)` returns the repo's account when the repo
   has one **and** that id is in `claudeManagedAccounts`; otherwise the global host selection. Because:
   the router already owns routing, System-default coverage, setup and env; every consumer
   (`terminalEnv`, `launchEnv`, `prepareLaunch`, `preparation`) then follows the same rule. An id that
   is no longer registered falls back to global, so a removed account never breaks a launch.
3. **Per-repo pointer file.** The `claude` shell function re-reads the file named by
   `ORCA_CLAUDE_PROFILE_POINTER` on every launch. A repo with an override gets its own pointer
   `claude-profiles/selected-repo-<sha256(repoId)[:16]>`; `terminalEnv` hands that path to its panes.
   Unmapped repos keep `selected-host`. Because: the shell function stays untouched (bash/zsh/fish/pwsh),
   a later change of the repo's account reaches already-open panes on their next `claude`, and a global
   switch no longer moves a mapped project. The file name is a hash so no repo id reaches a path.
4. **Where `repoId` comes from:** both spawn preflights (`src/main/ipc/pty/ipc/spawn-preflight.ts`,
   `src/main/ipc/pty/runtime/spawn-preflight.ts`) derive it with `getRepoIdFromWorktreeId(worktreeId)`
   and pass `{ ...codexSelectionTarget, repoId }` to `withClaudeProfileTerminalEnv` and
   `prepareClaudeAuth`. The router reads the repo through an injected `getRepo(repoId)` (from the store),
   so `runtime-selection` stays settings-only.
5. **Scope v1: local host runtime only.** The override is ignored (global wins) for WSL targets, SSH repos
   (`connectionId`) and runtime-host repos (`executionHostId` `runtime:`/`ssh:`): those hosts own their
   accounts. The settings select is disabled there with a one-line reason.
6. **Explicit user `CLAUDE_CONFIG_DIR` still wins**, unchanged: the shell function already prefers it.
7. **Out of v1 (separate tasks):** status-bar / rate-limit views keep showing the global account;
   native structured chats and commit-message generation keep the global account; no pruning of stale
   ids on account removal (decision 2 makes them harmless).

## Tasks

1. **Type + persistence** — `src/shared/repo-types.ts` (`claudeAccountId?: string | null`),
   `repo-update-params.ts`, `repo-sanitization.ts` (non-empty string or removed),
   `repo-update-operations.ts` (null deletes), renderer `repo-update.ts`/`repo-state.ts`.
   Tests: sanitization keeps a string id, drops empty/non-string, null clears. Cut-line: v1-core
2. **Router resolution** — `runtime-selection.ts`: `ClaudeAccountSelectionTarget` gains `repoId?: string`.
   `ClaudeProfileRouter` args gain `getRepo?: (repoId: string) => Pick<Repo, 'claudeAccountId' | 'connectionId' | 'executionHostId'> | undefined`;
   `private selectedProfile(target?: ClaudeAccountSelectionTarget)`; `routedProfile`, `routedHome`,
   `launchEnv`, `terminalEnv`, `prepareLaunch`, `preparation` take the optional target. Wire `getRepo`
   where the router is built (`runtime-auth-service.ts` → account services). Tests: mapped repo routes to
   its account; unregistered id / no repo / SSH repo / WSL target fall back to global. Cut-line: v1-core
3. **Per-repo pointer** — `writePointer(target)` writes `selected-repo-<hash>` for mapped repos (same
   atomic write, 0600, compare-first) and `terminalEnv` returns its path; unmapped keeps `selected-host`.
   Tests: pointer content per repo, global switch leaves a mapped repo's pointer unchanged, remapping
   rewrites it. Cut-line: v1-core
4. **Spawn wiring** — both spawn preflights pass `repoId` into `withClaudeProfileTerminalEnv` and
   `prepareClaudeAuth`; `runtime-auth-service.prepareForClaudeLaunch(target)` forwards it for host.
   Tests: preflight passes the repo id derived from the worktree id. Cut-line: v1-core
5. **Settings UI** — `RepositoryClaudeAccountSection.tsx` next to the GitHub account section in
   `RepositoryPane.tsx`: select of registered accounts (email) + "Use global account" sentinel, disabled
   with reason for SSH/runtime-host repos; an unknown id renders as global. Add to `repository-search.ts`.
   Design-system tokens and `components/ui/select` only. Cut-line: v1-core
6. **Status bar follows the focused project's account.** Cut-line: fast-follow
7. **Native structured chats + commit-message generation use the project account.** Cut-line: fast-follow
8. **Prune `claudeAccountId` from repos when an account is removed.** Cut-line: v2

Test strategy: unit tests on sanitization, router resolution and pointer files (temp dirs, injected
settings/getRepo, no real Keychain); preflight tests with the existing pty-launch fixtures; one manual
check in the built app (two repos mapped to different accounts, `claude` in each shows its own account
via `/status`).

## Done when

- [ ] Repo field persists and sanitizes — evidence: `corepack pnpm exec vitest run --config config/vitest.config.ts src/main/persistence/tracking-repos` exits 0 with new cases
- [ ] Router routes a mapped repo to its account and falls back otherwise — evidence: new cases in `src/main/claude-accounts/claude-profile-router*.test.ts` pass
- [ ] Mapped repos get their own pointer file; global switch does not move them — evidence: pointer tests in the same suite pass
- [ ] Both spawn preflights pass the repo id — evidence: `rg -n "repoId" src/main/ipc/pty/ipc/spawn-preflight.ts src/main/ipc/pty/runtime/spawn-preflight.ts` matches and preflight tests pass
- [ ] Repository settings shows the Claude account select — evidence: `test -f src/renderer/src/components/settings/RepositoryClaudeAccountSection.tsx` and `rg -n RepositoryClaudeAccountSection src/renderer/src/components/settings/RepositoryPane.tsx` matches
- [ ] Typecheck, lint and tests pass — `corepack pnpm run typecheck` exits 0 (real exit code, not through heavy-run), `corepack pnpm run check:code-quality:changed` exits 0, `corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts src/main/ipc/pty src/main/persistence/tracking-repos` exits 0
- [ ] Security review recorded (skill `security-review`) with no open CRITICAL
- [ ] Agent docs: FORK-NOTES.md gains a "Parche de producto: cuenta de Claude por proyecto" section (fork patches are documented there, not in upstream AGENTS.md) — evidence: `rg -n "cuenta de Claude por proyecto" FORK-NOTES.md`. N/A new skill/rule: no new subsystem or always-on constraint; `src/main/claude-accounts/` has no AGENTS.md and this extends it without a new invariant beyond the router doc comment.

## Risks

- **Wrong account silently** if resolution and pointer disagree → both read the same `selectedProfile(target)`; tests cover a global switch with a mapped repo.
- **Upstream churn in `claude-profile-router.ts`** (rewritten often) → keep the change additive (optional target param), document in FORK-NOTES, aim it as an upstream PR on #30567.
- **Remote wire compatibility** → only an optional repo field; old peers ignore it.
- **Pointer file sprawl** → one tiny file per mapped repo; harmless, not pruned in v1.
