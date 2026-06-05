# Cross-Model Review — orca-4671-nested-repo-warning — Round 1

**Feature ID:** orca-4671-nested-repo-warning
**Repo:** orca
**Issue:** stablyai/orca#4671
**Upstream:** docs-fork/specs/orca-4671-nested-repo-warning.md
**Date:** 2026-06-04
**Status:** InReview
**Review:** real

---

## Summary
The spec proposes adding a local worktree-creation warning when the source repo contains independent nested Git repositories that will not be materialized in the new parent worktree. It adds bounded main-process detection, a structured result field, and a renderer toast, while keeping creation non-blocking and deferring companion worktrees to a future feature.

## Findings
- **[CRITICAL]** FR-1 / acceptance criteria — “repos git anidados … que no estén trackeados” is the core behavior, but the spec only describes scanning for `.git` markers. That will also match tracked submodules/gitlinks or other intentionally tracked nested Git layouts, producing false warnings. Suggested fix: explicitly require parent-index filtering, e.g. detect nested Git markers, then exclude paths known to the parent as submodules/gitlinks/tracked paths via Git, and add acceptance criteria for a tracked submodule that must not warn.

- **[WARNING]** Requirement/implementation fit — the spec says it will reuse an existing `CreateWorktreeResult.warning → toast` pattern, but the current renderer path only shows a toast for `localBaseRefRefresh`; `CreateWorktreeResult.warning` is not currently consumed in `worktrees.ts`. Suggested fix: specify the exact renderer behavior for the new structured field and add a renderer unit test proving the toast fires from `nestedRepos`, independent of the existing `warning?: string`.

- **[WARNING]** Scope misses existing nested-repo scanner — the codebase already has `src/main/project-groups/nested-repo-discovery.ts` with bounded scanning, skip dirs, symlink avoidance, bare-repo markers, `.gitignore` handling, SSH abstractions, and tests. The spec proposes a new `src/main/git/nested-repos.ts` without explaining why existing scanner logic should not be reused/adapted. Suggested fix: either require reuse/extraction of shared scanner primitives, or justify a separate implementation and define how the two scanners stay behaviorally aligned.

- **[WARNING]** Acceptance criterion “no overhead perceptible” is not measurable. Suggested fix: replace with objective constraints such as max depth, max result count, max scan duration/timeout, no Git subprocess per directory except final parent-index filtering, and test with mocked traversal to prove bounded work.

- **[WARNING]** Result cap is mentioned but not specified. Suggested fix: define the cap value and user-facing behavior when truncated, e.g. list first N relative paths and include “and X more” or a `nestedReposTruncated: boolean` field.

- **[WARNING]** Path normalization is underspecified for cross-platform support. The toast examples use POSIX-style `frontend/`, `backend/`, but Node path scans on Windows can produce backslashes. Suggested fix: require repo-relative display paths normalized to forward slashes with trailing `/`, and add a Windows/path-separator unit test.

- **[WARNING]** Symlink behavior is not stated. A filesystem scan for nested `.git` directories can accidentally follow symlinked directories outside the repo or create surprising warnings. Suggested fix: explicitly require not following symlinked directories during traversal, matching the existing nested repo scanner’s safety pattern.

- **[WARNING]** Scan timing is internally inconsistent. Scope says run detection in `createLocalWorktree`, while Risks says it “corre en paralelo al resto del create.” Suggested fix: specify whether the scan starts before, during, or after `git worktree add`, what it may overlap with, and whether scan completion is awaited before returning the IPC result.

- **[INFO]** The spec gets the UX shape right: post-create warning is low-friction, additive, and aligns with the fact that worktree creation should still succeed.

- **[INFO]** The out-of-scope list is clear on companion worktrees, SSH/remote detection, setup-command changes, and pre-create blocking.

## Verdict
REQUEST_CHANGES — the feature direction is sound, but the spec must define “untracked nested repo” precisely, avoid false positives for submodules/tracked nested layouts, and tighten measurable scan/toast behavior before planning.
