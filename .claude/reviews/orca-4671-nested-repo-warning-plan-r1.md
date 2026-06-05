# Cross-Model Review — orca-4671-nested-repo-warning (plan) — Round 1

**Feature ID:** orca-4671-nested-repo-warning
**Repo:** orca
**Issue:** stablyai/orca#4671
**Upstream:** .claude/plans/orca-4671-nested-repo-warning-plan.md
**Date:** 2026-06-04
**Status:** InReview
**Review:** real

---

## Summary
The plan adds a backend detector for untracked nested Git repos during local worktree creation, filters out submodules, returns a typed `nestedRepos` warning in `CreateWorktreeResult`, and shows a renderer toast after successful creation. It correctly reuses the existing `scanNestedRepos` traversal and identifies important gotchas around absolute scanner paths, `.gitignore` pruning, and submodule filtering.

## Findings
- **[CRITICAL]** `.claude/plans/orca-4671-nested-repo-warning-plan.md:118-126` — WSL/Windows path handling is incomplete. `gitExecFileAsync(['rev-parse', '--show-toplevel'])` will run through the WSL-aware runner for WSL UNC repos, but `gitExecFileAsync` does not translate arbitrary stdout paths back to UNC (`src/main/git/runner.ts:498-506`; only a specific helper translates `worktree` output at `runner.ts:1020`). That means `toplevel` may be `/home/...`, which Node fs scanning cannot read from a Windows Electron process. Suggested fix: if `parseWslPath(repoPath)` is non-null, convert the returned Linux toplevel with `toWindowsWslPath(toplevel, distro)` before passing it to `scanNestedRepos` / `fs.readFile`, and add a test for WSL UNC input.

- **[WARNING]** `.claude/plans/orca-4671-nested-repo-warning-plan.md:128-135` — The plan normalizes candidate paths for comparison, but the `git ls-files --stage -- ...relPaths` argv is still described as using native `path.relative` output. On Windows that can produce backslash pathspecs like `packages\api`; Git output and `.gitmodules` paths are slash-relative. Suggested fix: introduce one canonical repo-relative slash path list immediately after relativization, use it for `ls-files` argv, gitlink Set keys, `.gitmodules` comparison, sorting, and display.

- **[WARNING]** `.claude/plans/orca-4671-nested-repo-warning-plan.md:128-130` — The `ls-files --stage` parser is line-based. Git’s docs state that without `-z`, pathnames with unusual characters are quoted according to `core.quotePath`; this can break parsing for tabs/newlines/quoted bytes. Suggested fix: use `git ls-files -z --stage -- ...` and parse NUL-terminated records, or use a `--format` that is unambiguous with `-z`.

- **[WARNING]** `.claude/plans/orca-4671-nested-repo-warning-plan.md:130-132` — Direct `.gitmodules` parsing is underspecified. Git documents `.gitmodules` as git-config syntax, not a simple key/value file. A regex for `path = ...` can miss valid syntax or comments/quoting edge cases. Suggested fix: either use `git config --file .gitmodules --get-regexp '^submodule\..*\.path$'` defensively, or explicitly plan parser tests for CRLF, spaces, comments, and quoted subsection names.

- **[WARNING]** `.claude/plans/orca-4671-nested-repo-warning-plan.md:194-198` — The proposed IPC concurrency test seam is wrong for the existing test file. `src/main/ipc/worktrees.test.ts:99-107` mocks `../git/worktree`, so `createLocalWorktree` will call `addWorktreeMock` / `addSparseWorktreeMock`, not `gitExecFileAsync(['worktree','add',...])`. Suggested fix: assert ordering against `addWorktreeMock` / `addSparseWorktreeMock`, or write a lower-level non-mocked test elsewhere.

- **[WARNING]** `.claude/plans/orca-4671-nested-repo-warning-plan.md:224-243` — Task ordering around fork docs and integration is muddled. Task 8 depends on Task 9 for the PR number, but Task 9 also includes merging to `personal/build` and rebuilding before Task 8 updates `docs-fork/001-product-ideas.md`. This conflicts with the local fork rule that personal docs stay on `personal/build` and never reach upstream (`.claude/rules/fork-workflow.md:25,30`). Suggested fix: split Task 9 into “open upstream PR” and “merge/rebuild personal build”, then run Task 8 after PR creation but before final `personal/build` verification/rebuild.

- **[INFO]** `.claude/plans/orca-4671-nested-repo-warning-plan.md:146-164` — The detector tests are mostly mocked. The plan asserts injected `readTextFile: async () => ''`, but it does not clearly require one test exercising the real scanner’s `.gitignore` pruning behavior with the override. Suggested fix: add a focused fake-filesystem or temp-dir test proving an ignored nested repo is found when the override is used.

- **[INFO]** `.claude/plans/orca-4671-nested-repo-warning-plan.md:203-221` — Toast copy and placement are reasonable and reuse the existing `showLocalBaseRefRefreshToast` pattern at `src/renderer/src/store/slices/worktrees.ts:74-98,1132`. Keep the helper type-only import from shared types and avoid introducing new design tokens, consistent with `AGENTS.md`.

## Verdict
REQUEST_CHANGES — the architecture is mostly sound, but WSL path translation and the incorrect IPC test seam need to be fixed before implementation.
