# Plan: Nested-repo (meta-repo) warning on worktree creation

**Feature ID:** orca-4671-nested-repo-warning
**Repo:** orca
**Issue:** stablyai/orca#4671
**Upstream:** docs-fork/specs/orca-4671-nested-repo-warning.md
**Date:** 2026-06-04
**Status:** Planned

## Overview

Deteccion delgada sobre el scanner existente (`scanNestedRepos` de
`src/main/project-groups/nested-repo-discovery.ts`) + filtro de submodules, expuesta
como campo tipado en `CreateWorktreeResult` y consumida como toast en el slice del
renderer. Rama `feat/nested-repo-warning` desde `main` (upstream-first, PR referencia
stablyai/orca#4671).

**Gotchas de reuso (verificados en codigo y por review adversarial):**
1. `scanNestedRepos` retorna temprano (`selectedPathKind: 'git_repo'`, cero repos)
   cuando el path ES un repo git. Se inyecta `filesystem.isSelectedPathGitRepo: ()
   => false` para traversar dentro del repo.
2. `NestedRepoCandidate.path` es **ABSOLUTO** (`joinPath` desde la raiz del scan,
   `nested-repo-discovery.ts:321,329`). `git ls-files --stage` emite paths
   **relativos al toplevel**. Todo matching/normalizacion debe relativizar primero
   (`path.relative(toplevel, candidate)`) — comparar sin relativizar nunca matchea.
3. El scanner **respeta `.gitignore`** para podar el traversal — y el caso mas comun
   de meta-repo tiene los repos anidados gitignoreados (falso negativo fatal). Se
   inyecta `filesystem.readTextFile: async () => ''` para neutralizar las ignore
   rules en este uso (los skip-dirs hardcodeados — `node_modules`, VCS dirs — y el
   no-follow de symlinks NO dependen de gitignore y se conservan).
4. Trailing slash en pathspecs de gitlinks: verificado git 2.50 — `ls-files --stage
   -- frontend/` SI devuelve el gitlink `frontend`. No es riesgo; el riesgo real es
   el punto 2.

## Sprint Goal

> Al crear un worktree local de un repo que contiene repos git anidados no
> trackeados (sin contar submodules), Orca lo crea normal y muestra un toast
> listando esos directorios; en cualquier otro caso no cambia nada.

### Done when

- [ ] Given repo padre con `frontend/.git` y `backend/.git` no trackeados (incluso gitignoreados), when se crea un worktree, then la creacion tiene exito y aparece toast listando `frontend/`, `backend/`
- [ ] Given el unico repo anidado es un submodule (gitlink 160000 en el indice O declarado en `.gitmodules`), when se crea un worktree, then NO hay warning
- [ ] Given repo sin anidados, when se crea, then `nestedRepos` ausente y sin toast
- [ ] Given `node_modules/**/.git` o symlink a dir con `.git` externo, when se crea, then no cuentan
- [ ] Given 12 anidados no trackeados, when se crea, then toast lista 10 + "and 2 more" (`truncated: true`, remainder real)
- [ ] Given fallo fs o timeout del scan, when se crea, then creacion normal sin warning ni error
- [ ] Given Windows, paths del toast usan `/` con trailing `/`
- [ ] All tests pass (`src/main/git/`, `src/main/project-groups/`, `src/main/ipc/worktrees.test.ts`, slice renderer; typecheck + lint limpios)
- [ ] No regressions in existing functionality

## Shared Types

```typescript
// src/shared/types.ts — añadir junto a CreateWorktreeResult
export type NestedRepoWarning = {
  /** Repo-relative paths, '/'-normalized, trailing '/'; max 10 shown. */
  paths: string[]
  /** True when more nested repos exist beyond the displayed cap. */
  truncated: boolean
  /** Count of additional repos beyond `paths` (0 when not truncated). */
  moreCount: number
}

// CreateWorktreeResult gains:
//   nestedRepos?: NestedRepoWarning
```

## Tasks

### Task 1: Tipo compartido `NestedRepoWarning`
- **Files:** `src/shared/types.ts` (modify)
- **Produces:**
  ```typescript
  export type NestedRepoWarning = { paths: string[]; truncated: boolean; moreCount: number }
  // y en CreateWorktreeResult: nestedRepos?: NestedRepoWarning
  ```
- **Do:** Definir el tipo junto a los warning-types existentes (zona de
  `WorktreeLineageWarning`, ~linea 392) con docstring de normalizacion; agregar el
  campo opcional a `CreateWorktreeResult` (~linea 1623).
- **Integrates with:** consumido por Tasks 3, 5, 7.
- **Verify:** `pnpm typecheck` pasa.
- **Tests:** No (solo tipos).
- **Depends on:** None

### Task 2: Factory exportable del filesystem local del scanner
- **Files:** `src/main/project-groups/nested-repo-discovery.ts` (modify)
- **Produces:**
  ```typescript
  export function createLocalNestedRepoScanFilesystem(): NestedRepoScanFilesystem
  // y export type NestedRepoScanFilesystem (hoy es type privado)
  ```
- **Do:** Refactor PURO y quirurgico: mover el objeto filesystem default inline
  (lineas ~222-229) a una funcion exportada que `scanNestedRepos` usa cuando no se
  inyecta filesystem; exportar el type `NestedRepoScanFilesystem`. Cero cambio de
  comportamiento. (Aislado en su propia task/commit para que el PR upstream muestre
  el refactor separado del feature.)
- **Integrates with:** Task 3 lo consume para override parcial.
- **Verify:** `npx vitest run --config config/vitest.config.ts
  src/main/project-groups/` — los tests existentes del scanner siguen verdes sin
  modificarse.
- **Tests:** No (cubierto por tests existentes del scanner).
- **Depends on:** None (paralelizable con Task 1)

### Task 3: `detectUntrackedNestedRepos`
- **Files:** `src/main/git/nested-repo-warning.ts` (create)
- **Produces:**
  ```typescript
  import type { NestedRepoWarning } from '../../shared/types'
  /** Never throws and never rejects; resolves null when there is nothing to warn about. */
  export async function detectUntrackedNestedRepos(
    repoPath: string,
    deps?: NestedRepoDetectionDeps // seam de test (scan inyectable); default = produccion
  ): Promise<NestedRepoWarning | null>
  export const NESTED_REPO_DISPLAY_CAP = 10
  ```
  **Amendments del test-plan review:** (a) parametro opcional `deps` — sin seam,
  los unit tests no son cableables (la funcion construye su filesystem
  internamente); (b) la relativizacion del paso 3 usa un helper PURO de strings
  (strip del prefijo toplevel + normalizacion de ambos separadores `\`/`/`) en vez
  de `path.relative` — `path.relative` POSIX no trata `\` como separador, lo que
  haria el comportamiento Windows intesteable y fragil.
- **Do:** Pipeline (envuelto entero en try/catch → null):
  1. **Toplevel:** `gitExecFileAsync(['rev-parse', '--show-toplevel'], { cwd:
     repoPath })` — ancla de TODA relativizacion (no asumir `repoPath === toplevel`).
     **WSL (Windows):** el runner es WSL-aware para ejecutar, pero NO traduce stdout
     arbitrario de vuelta a UNC (`runner.ts:498-506`); si `parseWslPath(repoPath)`
     (de `src/main/wsl.ts:18`) es non-null, convertir el toplevel Linux con
     `toWindowsWslPath(toplevel, distro)` (`wsl.ts:63`) ANTES de usarlo en
     `scanNestedRepos`/fs — sin esto, el scan fs fallaria silenciosamente en repos
     WSL UNC.
  2. **Scan:** `scanNestedRepos({ path: toplevel, options: { maxDepth: 3, maxRepos:
     100, timeoutMs: 5000 }, filesystem: { ...createLocalNestedRepoScanFilesystem(),
     isSelectedPathGitRepo: () => false, readTextFile: async () => '' } })` —
     el `readTextFile` vacio neutraliza el pruning por `.gitignore` (gotcha 3);
     `maxRepos: 100` (default del scanner) para poder computar el remainder real.
  3. **Relativizar + canonicalizar (UNA sola lista):** cada `candidate.path`
     (ABSOLUTO, gotcha 2) → `relative(toplevel, candidate.path)` (`path` nativo del
     OS) → convertir separadores a `/` INMEDIATAMENTE. Esa lista canonica
     slash-relativa es la UNICA forma usada de aqui en adelante: argv de
     `ls-files`, keys del Set de gitlinks, comparacion `.gitmodules`, orden y
     display (en Windows, pasar `packages\api` como pathspec a git seria fragil).
     Descartar el caso borde `''`/fuera del toplevel.
  4. **Filtro submodules:** (a) UNA llamada `gitExecFileAsync(['ls-files', '-z',
     '--stage', '--', ...canonicalPaths], { cwd: toplevel })`; parsear registros
     NUL-terminados `<mode> <oid> <stage>\t<path>` (sin `-z`, `core.quotePath`
     cita paths con caracteres raros y rompe el parser line-based); armar `Set` de
     paths con modo `160000`. (b) Submodules declarados aun no staged (spec FR-1):
     `gitExecFileAsync(['config', '--file', '.gitmodules', '--get-regexp',
     '^submodule\\..*\\.path$'], { cwd: toplevel })` — parser git-config real, no
     regex casero sobre el archivo (sintaxis con comentarios/quoting); exit code
     non-zero cuando el archivo no existe → tratar como vacio. Descartar candidatos
     presentes en (a) o (b).
  5. **Display:** trailing `/` sobre la forma canonica; ordenar alfabeticamente
     (orden estable para tests y UX).
  6. **Cap:** si quedan > 10 → `paths` = primeros 10, `truncated: true`,
     `moreCount` = total − 10 (si el scan mismo reporto `truncated` a 100,
     `moreCount` es un piso — aceptable). Si 0 → null.
- **Integrates with:** `scanNestedRepos` + factory (Task 2), `gitExecFileAsync`.
- **Verify:** unit tests del Task 4 en verde.
- **Tests:** Yes (Task 4).
- **Depends on:** Task 1, Task 2

### Task 4: Tests de `detectUntrackedNestedRepos`
- **Files:** `src/main/git/nested-repo-warning.test.ts` (create)
- **Produces:** suite vitest con `scanNestedRepos`/factory mockeados (o filesystem
  inyectado) y `gitExecFileAsync` mockeado via `vi.mock` del runner (patron de
  `worktree-git-crypt.test.ts`). **Los mocks del scanner DEBEN devolver paths
  ABSOLUTOS** (como el scanner real) — un mock con paths relativos pasaria en verde
  con codigo roto en produccion.
- **Do:** Casos: (a) dos anidados no trackeados → `{ paths:
  ['backend/','frontend/'], truncated: false, moreCount: 0 }`; (b) candidato con
  modo 160000 en ls-files (salida `-z` NUL-terminada) → excluido; solo gitlinks →
  null; (b2) candidato declarado solo en `.gitmodules` (mock de `git config --file
  .gitmodules`) → excluido; `.gitmodules` ausente (exit non-zero) → no excluye
  nada; (c) sin anidados → null; (d) 12 anidados → 10 paths, truncated:true,
  moreCount:2; (e) `gitExecFileAsync` lanza → null; (f) scan lanza → null; (g)
  candidatos con separadores Windows (`\\`) → pathspecs de ls-files y matching en
  forma canonica `/`, display con `/` + trailing `/`; (g2) repo WSL UNC
  (`parseWslPath` non-null) → el toplevel se traduce con `toWindowsWslPath` antes
  del scan; (h) spy de opciones del scanner: depth=3, maxRepos=100, timeout=5000, y
  el filesystem inyectado neutraliza `readTextFile` e `isSelectedPathGitRepo`; (i)
  **integracion con el scanner REAL** (no mockeado) sobre filesystem fake/temp-dir:
  un anidado gitignoreado por el padre ES encontrado gracias al override de
  `readTextFile` (prueba el pruning real, no solo que la opcion se pasa).
- **Verify:** `npx vitest run --config config/vitest.config.ts
  src/main/git/nested-repo-warning.test.ts` verde.
- **Tests:** —
- **Depends on:** Task 3

### Task 5: Wiring en `createLocalWorktree`
- **Files:** `src/main/ipc/worktree-remote.ts` (modify)
- **Produces:**
  ```typescript
  // dentro de createLocalWorktree (l.~1582), al inicio:
  const nestedReposPromise = detectUntrackedNestedRepos(repo.path).catch(() => null)
  // y justo antes del unico return de funcion (l.~2045):
  const nestedRepos = await nestedReposPromise
  // ...incluir `...(nestedRepos ? { nestedRepos } : {})` en el objeto retornado
  ```
- **Do:** Lanzar la promesa al entrar (concurrente con fetch/worktree add), con
  `.catch(() => null)` defensivo en el launch site — los throw-paths intermedios de
  la funcion (~1610, ~1665) dejarian la promesa sin await y un reject seria
  unhandled rejection. Await antes del UNICO return de funcion (verificado: l.2045;
  el `return` de ~1956 es interno a un closure de `timing.timeSync`). No tocar
  `createRemoteWorktree` ni `createFolderWorkspace`. Comentario "Why" breve.
- **Integrates with:** Task 3; `CreateWorktreeResult` (Task 1).
- **Verify:** typecheck + test del Task 6.
- **Tests:** Yes (Task 6).
- **Depends on:** Task 3

### Task 6: Test del wiring IPC
- **Files:** `src/main/ipc/worktrees.test.ts` (modify — confirmado: es el archivo
  que cubre `createLocalWorktree`)
- **Do:** Mockear `detectUntrackedNestedRepos` (vi.mock del modulo Task 3): (a)
  devuelve warning → el resultado del create lo incluye; (b) devuelve null → campo
  ausente; (c) concurrencia: ese archivo mockea `../git/worktree`
  (`worktrees.test.ts:99-107`), asi que el seam correcto es el orden entre el mock
  de `detectUntrackedNestedRepos` y `addWorktreeMock`/`addSparseWorktreeMock` (NO
  `gitExecFileAsync(['worktree','add',...])`, que nunca se invoca alli).
- **Verify:** suite verde.
- **Tests:** —
- **Depends on:** Task 5

### Task 7: Toast en el renderer
- **Files:** `src/renderer/src/store/slices/worktrees.ts` (modify)
- **Produces:**
  ```typescript
  function showNestedReposToast(warning: NestedRepoWarning | undefined): void
  ```
- **Do:** Junto a `showLocalBaseRefRefreshToast` (patron y call-site
  `worktrees.ts:1132`): si `warning` existe, `toast.warning('Workspace created
  without nested repos', { description })` — description: paths separados por coma
  + (si `truncated`) ` and ${moreCount} more` + "The new worktree only contains
  files tracked by the parent repo." Llamarla tras
  `showLocalBaseRefRefreshToast(...)` con `result.nestedRepos`. Nota: el call-site
  es compartido con creates remote/folder — inocuo porque solo
  `createLocalWorktree` adjunta el campo (ausente → no-op); dejarlo dicho en el
  comentario.
- **Integrates with:** `CreateWorktreeResult.nestedRepos` (Task 1).
- **Verify:** test del slice + verificacion manual (Deploy Checklist del spec).
- **Tests:** Yes — en el `src/renderer/src/store/slices/worktrees.test.ts`
  EXISTENTE, via store action (`window.api.worktrees.create` mockeado →
  `createWorktree` → assert `toast.warning`; template en l.1280-1316). La funcion
  es privada del slice — NO se exporta ni se crea archivo de test nuevo.
- **Depends on:** Task 1 (paralelizable con 2-6)

### Task 8: Verificacion completa y PR upstream
- **Files:** — (git, rama `feat/nested-repo-warning`)
- **Do:** Los Tasks 1-7 se implementan en `feat/nested-repo-warning` creada desde
  `main` actualizado (`git fetch upstream && git checkout -b feat/nested-repo-warning
  upstream/main`). Commits atomicos sin referencias AI, con el refactor del scanner
  (Task 2) en commit propio. Al cerrar: suites de `src/main/git/`,
  `src/main/project-groups/`, `src/main/ipc/worktrees.test.ts`, slice renderer +
  `pnpm typecheck` + lint en archivos tocados; push a origin; `gh pr create --repo
  stablyai/orca` referenciando #4671 (handle X @diegoesolorzano como en PR #4626).
  Esta rama NUNCA recibe archivos personales (`docs-fork/`, `.claude/`) — regla
  fork-workflow.
- **Verify:** PR abierto y suites verdes.
- **Tests:** —
- **Depends on:** Tasks 1-7

### Task 9: Docs del fork + estado del backlog (en `personal/build`)
- **Files:** `docs-fork/001-product-ideas.md` (modify)
- **Do:** En `personal/build`: marcar la parte 1 de la idea §002 como "en PR
  upstream" con link al PR recien abierto; la parte 2 queda pendiente.
  (AGENTS.md/rules del repo: N/A para upstream — ya evaluado en el spec.)
- **Verify:** doc actualizado, commit en `personal/build`.
- **Tests:** No.
- **Depends on:** Task 8 (numero de PR)

### Task 10: Merge a `personal/build` + rebuild local
- **Files:** — (git)
- **Do:** `git checkout personal/build && git merge feat/nested-repo-warning`;
  correr `npx vitest run --config config/vitest.config.ts src/main/git/` (regla
  fork-workflow pre-build); rebuild local (skill `orca-fork-update` o `pnpm run
  build:mac`) y swap del .app.
- **Verify:** build local con el feature; toast visible creando un worktree de un
  meta-repo real (lavasport-app o WP-Maintain con repo anidado de prueba); repo con
  submodules NO avisa.
- **Tests:** —
- **Depends on:** Task 8 (la rama lista); Task 9 puede ir antes o despues

## Test Matrix

### Shared Test Infrastructure
- **Framework:** vitest (`config/vitest.config.ts`)
- **Fixtures:** mocks de `scanNestedRepos`/filesystem (paths ABSOLUTOS, como el
  real); mock de `gitExecFileAsync` via `vi.mock` del runner (patron
  `worktree-git-crypt.test.ts`)
- **Factories:** builder de candidatos absolutos por toplevel

### Acceptance Criteria → Test Mapping

| AC | Test Location | Case |
|----|--------------|------|
| anidados no trackeados (incl. gitignoreados) → toast | `nested-repo-warning.test.ts` (a,i) + slice test 1 | happy path |
| submodule (gitlink o .gitmodules) → no warning | `nested-repo-warning.test.ts` (b,b2) | submodule excluded |
| sin anidados → campo ausente, sin toast | (c) + IPC (b) + slice 3 | null path |
| node_modules / symlink → no cuentan | tests existentes del scanner + (h) | bounded traversal |
| 12 anidados → 10 + "and 2 more" | (d) + slice 2 | cap + remainder |
| fallo fs / timeout → creacion normal | (e,f) + IPC (b) | never rejects |
| Windows separators → `/` y matching correcto | (g) | normalization |
| wiring create → incluye campo, concurrente | IPC (a,c) | attach + concurrency |

### Per-Task Test Cases

#### Task 3/4: detectUntrackedNestedRepos
**File:** `src/main/git/nested-repo-warning.test.ts`
**Type:** Unit
**Contract under test:**
```typescript
export async function detectUntrackedNestedRepos(repoPath: string): Promise<NestedRepoWarning | null>
```
Casos (a)-(i) detallados en Task 4.

#### Task 5/6: wiring createLocalWorktree
**Contract:** `CreateWorktreeResult.nestedRepos?: NestedRepoWarning`

| # | Case | Given | When | Then | Type |
|---|------|-------|------|------|------|
| 1 | attach | detect → warning | create | result.nestedRepos presente | unit |
| 2 | absent | detect → null | create | campo ausente | unit |
| 3 | concurrente | spies de orden | create | detect invocado antes de `worktree add` | unit |

#### Task 7: toast renderer
| # | Case | Given | When | Then | Type |
|---|------|-------|------|------|------|
| 1 | toast | nestedRepos con 2 paths | create resuelve | toast.warning con ambos | unit |
| 2 | truncated | truncated, moreCount:2 | create resuelve | description incluye "and 2 more" | unit |
| 3 | sin warning | undefined | create resuelve | no toast nuevo | unit |

### E2E Flows
1. Crear worktree de meta-repo (manual, Deploy Checklist): toast visible con paths.
2. Crear worktree de repo normal: sin toast nuevo, creacion identica a antes.
3. Crear worktree de repo con submodule: sin toast.

## Patterns to Reuse

- Traversal: `src/main/project-groups/nested-repo-discovery.ts` (`scanNestedRepos`,
  filesystem inyectable; sus tests como referencia de mocking).
- Git exec: `src/main/git/runner.ts` (`gitExecFileAsync` — ya envuelto en
  `withGitSpan`, sin telemetria extra que agregar); mocking como en
  `src/main/git/worktree-git-crypt.test.ts`.
- Toast post-create: `showLocalBaseRefRefreshToast` y su call-site
  (`src/renderer/src/store/slices/worktrees.ts:1132`).
- Comentarios "Why" breves (AGENTS.md); sin `max-lines` disables; relativizar con
  `path.relative` nativo PRIMERO y convertir separadores a `/` DESPUES (regla
  cross-platform).

## Risks

- **Refactor del scanner (Task 2) es el mayor riesgo de scope para upstream** —
  mantenerlo refactor puro, commit separado, tests existentes intactos.
- **Matching absoluto-vs-relativo**: el bug que el review detecto; mitigado con
  toplevel explicito + mocks con paths absolutos (un mock "comodo" con relativos
  ocultaria el bug).
- **`.gitignore` neutralizado solo en este uso**: project-groups conserva su
  comportamiento (el override es por-llamada via filesystem inyectado).
- **`moreCount` es piso si hay >100 anidados** (cap del scanner) — aceptable,
  documentado en el codigo.
- **Upstream pide otra UX** (dialogo pre-create): la deteccion (Task 3) sobrevive
  tal cual; solo cambiaria el consumidor.

## Review Notes

Revision adversarial (subagente Plan, 2026-06-04) — cambios incorporados:
- **[CRITICAL] paths absolutos**: `NestedRepoCandidate.path` es absoluto y
  `ls-files` emite relativos → Task 3 ahora resuelve toplevel (`rev-parse
  --show-toplevel`), relativiza antes de comparar/normalizar; tests exigen mocks
  con paths absolutos.
- **[WARNING] `.gitignore` pruning**: el scanner podaria repos anidados
  gitignoreados (el caso mas comun) → se neutraliza inyectando `readTextFile: ()
  => ''`; AC y test nuevos (i).
- **[WARNING] "and N more" violaba el spec**: scan ahora con maxRepos=100 y
  `moreCount` real en el tipo (`{ paths, truncated, moreCount }`).
- **[WARNING] refactor del filesystem**: separado en Task 2 propio (commit propio,
  riesgo upstream contenido).
- **[Missing] `.gitmodules`**: filtro ampliado — gitlinks staged (ls-files) +
  declarados en `.gitmodules` (lectura fs directa, sin segunda llamada git).
- **[SUGGESTION]** `.catch(() => null)` en el launch site (throw-paths intermedios);
  Task 6 fijado a `src/main/ipc/worktrees.test.ts` (confirmado); seam de
  concurrencia definido (orden entre mocks); verificado que el unico return de
  funcion es l.~2045.
- Verificado por el reviewer: trailing slash en pathspecs de gitlinks NO es
  problema (git 2.50); call-site del toast compartido es inocuo (campo solo lo
  adjunta el path local).

Review cross-model (plan-reviewer/GPT via OpenCode, round 1, REQUEST_CHANGES) —
cambios incorporados:
- **[CRITICAL] WSL**: `rev-parse --show-toplevel` en repos WSL UNC devuelve path
  Linux que el fs de Windows no puede leer → Task 3 traduce con
  `parseWslPath`/`toWindowsWslPath` (`src/main/wsl.ts`) + test (g2).
- **[W] Forma canonica unica**: relativizar y pasar a `/` INMEDIATAMENTE; la lista
  canonica alimenta pathspecs, Set de gitlinks, `.gitmodules`, orden y display.
- **[W] `ls-files -z`**: parser NUL-terminado (sin `-z`, `core.quotePath` cita
  paths raros y rompe el line-based).
- **[W] `.gitmodules` via `git config --file`**: parser real de git-config en vez
  de regex casero.
- **[W] Seam del test IPC corregido**: `worktrees.test.ts` mockea `../git/worktree`
  → asserts contra `addWorktreeMock`, no contra `gitExecFileAsync`.
- **[W] Tasks 8/9/10 reordenadas**: PR upstream / docs del fork (personal/build) /
  merge+rebuild separados — los docs personales nunca tocan la rama del PR.
- **[I] Test de integracion (i)** con el scanner real para el override de
  `.gitignore`.

- 2026-06-04 · plan-reviewer · round 1 · REQUEST_CHANGES · incorporate-and-stop · `.claude/reviews/orca-4671-nested-repo-warning-plan-r1.md`
