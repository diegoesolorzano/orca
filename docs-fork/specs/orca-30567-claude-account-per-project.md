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
   has one, that id is in `claudeManagedAccounts`, **and** its `managedAuthRuntime` is not `wsl`;
   otherwise the global host selection. Because: the router already owns routing, System-default
   coverage, setup and env; every consumer (`terminalEnv`, `launchEnv`, `prepareLaunch`, `preparation`)
   then follows one rule. An unregistered or WSL id falls back to global, so a removed account never
   breaks a launch.
3. **Per-repo pointer files, kept current by the router.** The `claude` shell function re-reads the file
   named by `ORCA_CLAUDE_PROFILE_POINTER` on every launch. A repo with an override gets
   `claude-profiles/selected-repo-<sha256(repoId)[:16]>`, and `terminalEnv`/`launchEnv` hand that path to
   its panes; unmapped repos keep `selected-host`. A new `publishRepoPointers()` rewrites **every existing**
   `selected-repo-*` file to its repo's current resolution (the global home when unmapped/unregistered;
   deleted when no accounts remain). It runs from `publish()` (so every global switch and account
   add/remove reaches it) and after any repo update that touches `claudeAccountId`. Because: open panes
   keep their pointer path for life, so the file — not the env — must follow remaps, unmaps and account
   removal; the shell function stays untouched (bash/zsh/fish/pwsh). The file name is a hash, so no repo
   id reaches a path.
4. **Where `repoId` comes from:** both spawn preflights (`src/main/ipc/pty/ipc/spawn-preflight.ts`,
   `src/main/ipc/pty/runtime/spawn-preflight.ts`) derive it with `getRepoIdFromWorktreeId(worktreeId)`
   when a `worktreeId` exists (it is optional; none → global) and pass `{ ...codexSelectionTarget, repoId }`
   to `withClaudeProfileTerminalEnv` and `prepareClaudeAuth`, so the auth `envPatch` spread over the pane
   env carries the same repo pointer. Agent Teams leader launches
   (`terminal-split-source-authority.ts` `prepareClaudeAgentTeamsLeaderForHandle`) resolve the worktree
   from the pane handle and pass the same target. The router reads repos through an injected
   `getRepo(repoId)`; `ClaudeRuntimeAuthService`'s store type widens from `getSettings` to include
   `getRepo`.
5. **Scope v1: local desktop host only.** The override is ignored (global wins) for WSL targets, SSH repos
   (`connectionId`), runtime-host repos (`executionHostId` `runtime:`/`ssh:`), and in orcad: its router
   (`orcad-account-services.ts`) is built without `getRepo`, because a server's accounts belong to that
   server. The settings select is disabled for SSH/runtime-host repos with a one-line reason.
6. **Explicit user `CLAUDE_CONFIG_DIR` still wins**, unchanged: the shell function already prefers it.
7. **Out of v1 (separate tasks), still on the global account:** status bar / rate-limit views; native
   structured chats and commit-message generation; the old-terminal banner (`claude-old-terminal.ts`,
   `systemDefaultRunsAnotherAccount`) and the diff-panel notice (`claude-diff-panel-notice.ts`,
   `routedHome`); repository-settings search entry; pruning stale ids on account removal (decision 2
   makes them harmless) and pre-setup of mapped accounts in `publish()` (first launch sets up on demand
   through `prepareLaunch`).

## Tasks

1. **Repo field + persistence** — `src/shared/repo-types.ts` (`claudeAccountId?: string | null`);
   `src/shared/rpc-contract/repo-update-params.ts` (zod key, else silently dropped);
   `repo-sanitization.ts` (non-empty string or removed); `repo-hydration.ts` (sanitize on load);
   `repo-update-operations.ts`, `repo-lifecycle-operations.ts`, `runtime-repository-settings-controller.ts`
   (null clears); `src/main/ipc/repos/repo-update-handler.ts`; renderer `repo-update.ts`/`repo-state.ts`.
   Tests: sanitization, hydration of a bad value, IPC update with string / empty / null. Cut-line: v1-core
2. **Router resolution** — `runtime-selection.ts`: `ClaudeAccountSelectionTarget` gains `repoId?: string`.
   `ClaudeProfileRouter` args gain
   `getRepo?: (repoId: string) => Pick<Repo, 'claudeAccountId' | 'connectionId' | 'executionHostId'> | undefined`;
   `private selectedProfile(target?)`; `routedProfile`, `routedHome`, `launchEnv`, `terminalEnv`,
   `prepareLaunch`, `preparation` take the optional target. Tests (one each): mapped repo → its account;
   unregistered id → global; WSL-runtime account id → global; no repo / no repoId → global; SSH repo →
   global; WSL target → global. Cut-line: v1-core
3. **Router wiring** — `runtime-auth-service.ts` store type gains `getRepo`, passed to the router;
   `prepareForClaudeLaunch(target)` forwards `repoId` for host; desktop account services pass the store's
   `getRepo`; orcad passes none. Test: service forwards the target. Cut-line: v1-core
4. **Per-repo pointer + `publishRepoPointers()`** — `writePointer(target)` writes `selected-repo-<hash>`
   for mapped repos (atomic, 0600, compare-first); `publish()` calls `publishRepoPointers()`; zero accounts
   deletes them; repo updates touching `claudeAccountId` trigger it. Tests: per-repo content; global switch
   leaves a mapped pointer; remap rewrites; unmap rewrites to the global home; account removal rewrites to
   global; zero accounts deletes. Cut-line: v1-core
5. **Spawn wiring** — both preflights pass `repoId` (guarded for a missing `worktreeId`). Tests: the
   target received by `withClaudeProfileTerminalEnv` and `prepareClaudeAuth` carries the repo id; the
   resulting `envPatch` pointer is the repo pointer; no worktree → `selected-host`. Cut-line: v1-core
6. **Agent Teams wiring** — `prepareClaudeAgentTeamsLeaderForHandle` passes `{ runtime: 'host', repoId }`.
   Test: leader auth for a mapped repo uses its account. Cut-line: v1-core
7. **Settings select** — `RepositoryClaudeAccountSection.tsx` next to the GitHub account section in
   `RepositoryPane.tsx`: registered host accounts (email) + "Use global account" sentinel; disabled with
   reason for SSH/runtime-host repos; an unknown id renders as global; choosing global sends null.
   Design-system tokens and `components/ui/select` only. Tests: unknown id → global, disabled for SSH and
   runtime-host, global → null. Cut-line: v1-core
8. **Repository-settings search entry** (`repository-search.ts`). Cut-line: fast-follow
9. **Status bar follows the focused project's account.** Cut-line: fast-follow
10. **Native structured chats + commit-message generation use the project account.** Cut-line: fast-follow
11. **Old-terminal banner and diff-panel notice take the project target.** Cut-line: fast-follow
12. **Prune `claudeAccountId` on account removal; pre-set-up mapped accounts in `publish()`.** Cut-line: v2

Test strategy: unit tests with temp dirs and injected settings/`getRepo` (no real Keychain) for
persistence, router and pointers; existing pty-launch fixtures for preflights and Agent Teams; renderer
component tests for the select; one manual check in the built app: two repos mapped to different
accounts, `claude` then `/status` in each shows its own account, then a remap reaches an already-open pane.

## Done when

- [ ] Repo field sanitizes, hydrates and updates over IPC — evidence: new cases pass in `corepack pnpm exec vitest run --config config/vitest.config.ts src/main/persistence/tracking-repos src/main/ipc/repos`
- [ ] Mapped repo routes to its account — evidence: router test "mapped repo" passes
- [ ] Unregistered id falls back to global — evidence: router test passes
- [ ] WSL-runtime account id falls back to global — evidence: router test passes
- [ ] No repo / no repoId falls back to global — evidence: router test passes
- [ ] SSH repo and WSL target fall back to global — evidence: router tests pass
- [ ] Router gets `getRepo` in the desktop, not in orcad — evidence: runtime-auth-service test passes and `rg -n "getRepo" src/main/orcad/orcad-account-services.ts` has no match
- [ ] Pointer per mapped repo; global switch leaves it — evidence: pointer tests pass
- [ ] Remap, unmap, account removal and zero accounts rewrite/delete repo pointers — evidence: one passing test each
- [ ] Both preflights pass the repo id and the auth `envPatch` carries the repo pointer — evidence: preflight tests pass (including "no worktree → selected-host")
- [ ] Agent Teams leader uses the project account — evidence: test passes
- [ ] Settings select behaves (unknown → global, disabled for SSH/runtime-host, global → null) — evidence: component tests pass and `rg -n RepositoryClaudeAccountSection src/renderer/src/components/settings/RepositoryPane.tsx` matches
- [ ] Typecheck — `corepack pnpm run typecheck` exits 0 (real exit code, not through heavy-run)
- [ ] Lint — `corepack pnpm run check:code-quality:changed` exits 0
- [ ] Tests — `corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts src/main/ipc/pty src/main/persistence/tracking-repos src/main/ipc/repos src/main/runtime/terminal` exits 0
- [ ] Security review recorded (skill `security-review`) with no open CRITICAL
- [ ] Agent docs: FORK-NOTES.md gains "Parche de producto: cuenta de Claude por proyecto" (fork patches are documented there, not in upstream AGENTS.md) — evidence: `rg -n "cuenta de Claude por proyecto" FORK-NOTES.md`. N/A new skill/rule: no new subsystem or always-on constraint; `src/main/claude-accounts/` has no AGENTS.md and the invariant (pointer files follow the router's resolution) lives in the router's doc comment.

## Risks

- **Wrong account silently** if resolution and pointer disagree → both read `selectedProfile(target)`; `publishRepoPointers()` runs on every publish; tests cover remap/unmap/removal.
- **Trust boundary** → the account id and worktree id come from the renderer. Ids are checked against registered host accounts and `describeClaudeProfile` rejects anything outside `^[a-zA-Z0-9_-]+$` (`claude-profile-paths.ts:57`); the pointer name is a hash. Recorded in the security review.
- **Upstream churn in `claude-profile-router.ts`** → additive change (optional target), FORK-NOTES entry, aim it as an upstream PR on #30567.
- **Remote wire compatibility** → only an optional repo field; an older remote runtime drops it silently, which is acceptable because the select is disabled for runtime-host repos.
