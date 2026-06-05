# Cross-Model Review — orca-4671-nested-repo-warning (test-plan) — Round 1

**Feature ID:** orca-4671-nested-repo-warning
**Repo:** orca
**Issue:** stablyai/orca#4671
**Upstream:** .claude/plans/orca-4671-nested-repo-warning-tests.md
**Date:** 2026-06-04
**Status:** InReview
**Review:** real

---

## Summary
The test plan is strong and unusually concrete: it maps spec acceptance criteria to unit/integration coverage, validates IPC wiring, renderer toast behavior, WSL normalization, submodule exclusion, gitignore neutralization, and mock argument shape. It also incorporates prior adversarial findings well.

## Findings
- **[CRITICAL]** Timeout behavior is not directly tested. The spec says filesystem/scan timeout must proceed without warning/error, but the plan only covers `scan` rejecting/throwing. `scanNestedRepos` can return `{ timedOut: true, repos: [...] }`; a wrong implementation could still warn from partial timeout results. Add a detector test where injected scan returns `timedOut: true` and assert `null`.

- **[WARNING]** WSL mock strategy is under-specified for Vitest hoisting. `vi.mock('../wsl') solo en caso 12` can fail if the detector is imported before the mock is applied. Use a top-level hoisted mock with default `parseWslPath` returning `null`, override only in the WSL case, or use `vi.doMock` + dynamic import/resetModules.

- **[WARNING]** Performance contract “no git subprocess per directory” is not directly asserted. The plan checks canonical `ls-files` argv, but not call count. Add assertions that submodule filtering uses one `ls-files` call and one `.gitmodules` config call regardless of candidate count.

- **[WARNING]** The unhandled-rejection IPC case needs a concrete async drain and teardown. A listener alone can be flaky or non-falsifiable. Use `onTestFinished`/cleanup and wait at least one tick after the create rejection to prove no unhandled rejection fires.

- **[INFO]** Renderer coverage should include the combined-warning case: `localBaseRefRefresh` warning plus `nestedRepos` warning in the same create result. This guards against one toast path suppressing or overwriting the other.

## Verdict
REQUEST_CHANGES — coverage is mostly solid, but the explicit timeout acceptance criterion is untested and could let a wrong implementation pass.
