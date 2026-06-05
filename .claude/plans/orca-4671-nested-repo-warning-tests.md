# Test Plan: Nested-repo (meta-repo) warning on worktree creation

**Feature ID:** orca-4671-nested-repo-warning
**Repo:** orca
**Issue:** stablyai/orca#4671
**Upstream:** .claude/plans/orca-4671-nested-repo-warning-plan.md
**Date:** 2026-06-04
**Status:** Tested
**Test framework:** vitest (`config/vitest.config.ts`)

## Test Infrastructure

### Prerequisites
- Ninguno nuevo — vitest ya configurado; todos los patrones de mocking existen.

### Patrones existentes (verificados)
- **Mock del runner git:** `vi.hoisted` + `vi.mock('./runner', ...)` —
  `src/main/git/worktree-git-crypt.test.ts:3-21`.
- **Mock del modulo wsl:** `vi.mock('../wsl', ...)` para forzar `parseWslPath`
  non-null — NECESARIO porque `parseWslPath` retorna `null` fuera de win32
  (`src/main/wsl.ts:19-21`); sin mock, el caso WSL no corre en CI macOS/Linux.
- **Toast del slice VIA STORE ACTION:** el template exacto es
  `src/renderer/src/store/slices/worktrees.test.ts:1280-1316` — mock de
  `window.api.worktrees.create` que resuelve el resultado, `store.getState().
  createWorktree(...)`, assert sobre `toast.warning`. Las funciones de toast del
  slice son privadas y NO importables.
- **Tests de createLocalWorktree (IPC):** `src/main/ipc/worktrees.test.ts` (mockea
  `../git/worktree`; el create se ejercita via `registerWorktreeHandlers` →
  `handlers['worktrees:create']`).
- **Temp-dir real:** patron `tempRoot()` de `nested-repo-discovery.test.ts` para
  los casos que necesitan fs real.

### Seam de inyeccion (amendment al plan, Task 3)
`detectUntrackedNestedRepos(repoPath, deps?)` acepta un segundo parametro opcional
`deps` (scan + git exec inyectables, default = produccion). Sin el seam, los casos
unit no son cableables (la funcion construye su filesystem internamente). Ademas la
relativizacion usa un helper PURO de strings (strip del prefijo toplevel +
normalizacion de ambos separadores) en vez de `path.relative` — `path.relative`
POSIX no trata `\` como separador, lo que haria el caso Windows intesteable fuera
de Windows y fragil en runtime.

### Shared Fixtures
- `makeAbsoluteCandidate(toplevel, rel)`: `NestedRepoCandidate` con path ABSOLUTO
  (mocks nunca devuelven relativos — ocultaria el bug absoluto-vs-relativo).
- `lsFilesZOutput(entries: Array<{mode, path}>)`: salida NUL-terminada
  `<mode> <oid> <stage>\t<path>\0`.
- Temp-dir builder (casos de integracion): arbol real con `frontend/.git`,
  `.gitignore` conteniendo `frontend/`.

## Test Suites

### Tests for Task 2: Factory del filesystem del scanner

**Files:** `src/main/project-groups/nested-repo-discovery.test.ts` (existente, NO
se modifica — regresion) + caso nuevo de factory (puede vivir en el mismo archivo
o junto a los tests del detector)
**Type:** Unit (regresion) + Integration (factory real)

| # | Case | Given | When | Then | Type |
|---|------|-------|------|------|------|
| 1 | regresion del refactor | suite existente del scanner | correr sin modificar | 100% verde | unit |
| 2 | factory real | temp-dir con `sub/.git` real | `scanNestedRepos` con `createLocalNestedRepoScanFilesystem()` | encuentra `sub` | integration |

**Por que el caso 2:** la regresion solo prueba que `scanNestedRepos` no cambio;
el factory nuevo (path de produccion real con fs) quedaria con CERO cobertura
directa sin este caso.

---

### Tests for Task 3: detectUntrackedNestedRepos

**File:** `src/main/git/nested-repo-warning.test.ts` (nuevo)
**Type:** Unit (deps inyectadas) + 2 integracion (temp-dir real)
**Contract under test:**
```typescript
export async function detectUntrackedNestedRepos(
  repoPath: string,
  deps?: NestedRepoDetectionDeps  // seam de test; default = produccion
): Promise<NestedRepoWarning | null>
```
Mocks: runner git (`vi.mock('./runner')`); **`vi.mock('../wsl')` a NIVEL TOP del
archivo** (vitest hoisting — un mock por-caso no intercepta un modulo ya
importado): default `parseWslPath: () => null` (comportamiento no-WSL para todos
los casos) y override del mock SOLO dentro del caso 12; scan inyectado via `deps`
en los unit (candidatos SIEMPRE absolutos).

#### Cases

| # | Case | Given | When | Then | Type |
|---|------|-------|------|------|------|
| 1 | happy path | scan → `[<tl>/frontend, <tl>/backend]`; ls-files sin gitlinks; sin .gitmodules | detect | `{ paths: ['backend/','frontend/'], truncated: false, moreCount: 0 }` (toEqual, orden alfabetico) | unit |
| 2 | gitlink staged excluido | candidato `<tl>/sub`; ls-files -z → modo 160000 `sub` | detect | `null` | unit |
| 3 | mezcla gitlink + no trackeado | `sub` (160000) y `frontend` | detect | solo `frontend/` | unit |
| 3b | **argv canonico de ls-files** | candidatos absolutos `<tl>/backend`, `<tl>/frontend` | detect | el mock del runner recibio `['ls-files','-z','--stage','--','backend','frontend']` — pathspecs RELATIVOS canonicos, jamas absolutos (guardia directa del bug absoluto-vs-relativo; el output-only no atrapa un compare por basename) | unit |
| 3c | **conteo de subprocesos** | 12 candidatos | detect | exactamente UNA llamada `ls-files` + UNA `git config --file` (+ el `rev-parse` inicial) sin importar el numero de candidatos — contrato de perf FR-5 "sin subprocesos git por directorio" | unit |
| 4 | .gitmodules-only excluido | ls-files vacio; `git config --file .gitmodules --get-regexp` → `submodule.sub2.path sub2` | detect | `null` | unit |
| 4b | forma de .gitmodules vs canonica | `.gitmodules` declara `sub2/` (trailing slash) o `sub2\x` estilo Windows | detect | la exclusion normaliza la forma del config a la canonica antes de comparar (pin del contrato de matching) | unit |
| 5 | .gitmodules ausente | mock `git config --file` lanza (exit non-zero) | detect | candidatos NO excluidos; pipeline sigue | unit |
| 6 | sin anidados | scan → `[]` | detect | `null` | unit |
| 7 | cap + remainder real | 12 candidatos | detect | 10 paths, `truncated: true`, `moreCount: 2` | unit |
| 7b | piso en el cap del scanner | scan devuelve 100 candidatos y `truncated: true` | detect | 10 paths, `truncated: true`, `moreCount: 90` (piso documentado) | unit |
| 8 | rev-parse lanza | mock toplevel rechaza | detect | `null` (nunca rechaza) | unit |
| 9 | ls-files lanza | mock ls-files rechaza | detect | `null` | unit |
| 10 | scan lanza | scan inyectado rechaza | detect | `null` | unit |
| 10b | scan con timeout parcial | scan resuelve `{ timedOut: true, repos: [2 candidatos] }` | detect | `null` — el AC de timeout exige NO warning; una implementacion que avise desde resultados parciales debe fallar este test | unit |
| 11 | separadores Windows | toplevel `C:\repo`, candidato `C:\repo\packages\api` (strings, helper puro — corre en cualquier OS) | detect | pathspec `packages/api`; display `packages/api/` | unit |
| 12 | WSL UNC | `vi.mock('../wsl')`: `parseWslPath` → `{distro}` non-null, `toWindowsWslPath` spy; rev-parse → `/home/u/repo` | detect | el path que llega al scan es el traducido por `toWindowsWslPath` | unit |
| 13 | opciones acotadas | spy sobre el scan inyectado | detect | `{ maxDepth: 3, maxRepos: 100, timeoutMs: 5000 }` + filesystem con `isSelectedPathGitRepo()` → false y `readTextFile()` → '' | unit |
| 14 | candidato fuera del toplevel | scan → `''`/`../x` | detect | descartado sin romper | unit |
| 15 | gitignore neutralizado (REAL) | **temp-dir real**: `.gitignore` con `frontend/` + `frontend/.git` real; scanner real + factory real; solo el runner git mockeado | detect (deps default salvo git) | `frontend/` presente — el override de `readTextFile` vence el pruning real | integration |
| 16 | parser -z con paths raros | ls-files -z con path con espacio y tab | detect | parseado correcto (NUL, sin quoting) | unit |

#### Fixtures
- `lsFilesZOutput`, `makeAbsoluteCandidate`, temp-dir builder (caso 15: patron
  `tempRoot()` del scanner — fs real chico, no "fs real grande").

#### Assertions
- Forma exacta (`toEqual`); 3b y 13 assertan ARGUMENTOS de los spies (argv/opciones),
  no solo outputs.

---

### Tests for Task 5: Wiring en createLocalWorktree

**File:** `src/main/ipc/worktrees.test.ts` (existente, casos nuevos)
**Type:** Integration (handler via `registerWorktreeHandlers`)
**Nota de seam:** el wiring vive en `src/main/ipc/worktree-remote.ts:1582`
(`createLocalWorktree`), NO en `worktrees.ts`. El `vi.mock` del detector usa el
specifier tal como lo importa `worktree-remote.ts` (`'../git/nested-repo-warning'`
— coincide porque test y modulo viven en `src/main/ipc/`). **Verificar el import
real despues de implementar Task 5** — si el specifier difiere, el mock no
intercepta y los casos fallan en seco (señal clara, no silenciosa).

| # | Case | Given | When | Then | Type |
|---|------|-------|------|------|------|
| 1 | attach | detector mock → warning | create local | `result.nestedRepos` igual al warning | integration |
| 2 | absent | detector mock → `null` | create local | `'nestedRepos' in result === false` | integration |
| 3 | concurrencia | detector mock con `invocationCallOrder` | create local | detector invocado ANTES que `addWorktreeMock`/`addSparseWorktreeMock` | integration |
| 4 | detector rechaza | detector mock rejects | create local | create resuelve normal sin campo | integration |
| 4b | **rechazo + throw temprano** | detector mock rejects Y el create falla antes del await (ej. `addWorktreeMock` lanza) | create local | el create lanza SU error y NO hay unhandled rejection — mecanica concreta: registrar listener `process.on('unhandledRejection')` con teardown garantizado (`onTestFinished`/`finally` que hace `removeListener`), y tras el rechazo del create **drenar al menos un macrotick** (`await new Promise(setImmediate)`) antes de assertar que el listener no disparo; sin el drain el caso es no-falsificable | integration |
| 5 | remote NO invoca | repo con `connectionId` (via `createRemoteWorktree`) | create | detector NO invocado — el riesgo real de mis-wiring (ambos paths viven en `worktree-remote.ts`); folder-mode se descarta como caso: bypassa `createLocalWorktree` estructuralmente y seria trivialmente verde | integration |

---

### Tests for Task 7: Toast del renderer

**File:** `src/renderer/src/store/slices/worktrees.test.ts` (existente — los casos
van JUNTO al test del toast de `localBaseRefRefresh`, lineas 1280-1316, que es el
template exacto). NO se crea archivo nuevo ni se exporta la funcion privada.
**Type:** Unit (slice via store action)
**Mecanica:** mock de `window.api.worktrees.create` resolviendo
`{ worktree, nestedRepos: {...} }` → `store.getState().createWorktree(...)` →
assert `toast.warning`.

| # | Case | Given | When | Then | Type |
|---|------|-------|------|------|------|
| 1 | toast con paths | create resuelve `nestedRepos: { paths: ['backend/','frontend/'], truncated: false, moreCount: 0 }` | createWorktree | `toast.warning('Workspace created without nested repos', ...)`; description contiene `backend/, frontend/` y 'only contains files tracked by the parent repo' | unit |
| 2 | truncated | `truncated: true, moreCount: 2` | createWorktree | description contiene 'and 2 more' | unit |
| 3 | sin campo | create resuelve sin `nestedRepos` | createWorktree | `toast.warning` NO llamado con ese titulo | unit |
| 4 | warnings combinados | create resuelve `localBaseRefRefresh` (skipped) Y `nestedRepos` a la vez | createWorktree | AMBOS toasts disparan — ninguno suprime/sobrescribe al otro | unit |

## E2E Flows

(Manuales — Deploy Checklist; no hay arnes E2E de Electron en CI para este flujo.)

1. **Meta-repo:** crear worktree de lavasport-app desde la UI → toast con los
   directorios; worktree creado normal.
2. **Repo normal:** sin toast nuevo, creacion identica.
3. **Repo con submodule:** sin toast.

## Execution Order

Todo es unit/integration con mocks o temp-dirs propios — vitest corre los archivos
en paralelo por defecto, sin restricciones de orden:
- `src/main/git/nested-repo-warning.test.ts` (nuevo)
- `src/main/project-groups/nested-repo-discovery.test.ts` (regresion + caso factory)
- `src/main/ipc/worktrees.test.ts` (casos nuevos)
- `src/renderer/src/store/slices/worktrees.test.ts` (casos nuevos)

## Review Notes

Revision adversarial (subagente Plan, 2026-06-04) — cambios incorporados:
- **[CRITICAL] Task 7 era incableable**: `showNestedReposToast` es privada del
  slice → los casos van via store action en el `worktrees.test.ts` del renderer
  (template verificado en l.1280-1316), sin archivo nuevo ni export forzado.
- **[CRITICAL] Seam de inyeccion inexistente**: el detector construye su
  filesystem internamente → amendment al plan: parametro opcional `deps`; ademas
  relativizacion con helper puro de strings (no `path.relative`, intesteable
  cross-platform); caso 15 pasa a temp-dir real.
- **[CRITICAL] Folder-mode trivialmente verde**: bypassa `createLocalWorktree`
  estructuralmente → reemplazado por caso remote (`connectionId`), el mis-wiring
  plausible.
- **[CRITICAL] Factory sin cobertura**: la regresion no ejercita el factory nuevo
  → caso 2 de Task 2 (temp-dir real).
- **[CRITICAL] Specifier del mock IPC asumido** → nota explicita de verificacion
  post-Task 5.
- **[W] WSL intesteable off-Windows** (verificado `wsl.ts:19`: gate win32) → caso
  12 mockea `../wsl`.
- **[W] Casos nuevos**: 3b (argv canonico — guardia real del bug
  absoluto-vs-relativo), 4b (forma .gitmodules vs canonica), 7b (piso del
  moreCount en el cap), 4b-IPC (unhandled rejection que distingue launch-site
  `.catch`).
- **[W] Parallelizacion**: framing A/B eliminado (no comunicaba nada); lista de
  archivos corregida (incluye el slice del renderer, que faltaba).

- 2026-06-04 · Plan subagent (adversarial) · round 1 · REQUEST_CHANGES → incorporado

Review cross-model (test-reviewer/GPT via OpenCode, round 1, REQUEST_CHANGES) —
cambios incorporados:
- **[CRITICAL] timeout parcial sin test**: caso 10b — scan resuelve `{ timedOut:
  true, repos: [...] }` → `null` (una implementacion que avise desde resultados
  parciales falla).
- **[W] hoisting del mock wsl**: `vi.mock('../wsl')` a nivel top con default
  no-WSL, override solo en el caso 12.
- **[W] conteo de subprocesos**: caso 3c — exactamente una `ls-files` + una
  `git config --file` sin importar candidatos (contrato FR-5).
- **[W] mecanica del unhandled-rejection**: caso 4b con teardown garantizado +
  drain de un macrotick.
- **[I] toasts combinados**: caso 4 del renderer — `localBaseRefRefresh` +
  `nestedRepos` simultaneos, ambos disparan.

- 2026-06-04 · test-reviewer · round 1 · REQUEST_CHANGES · incorporate-and-stop · `.claude/reviews/orca-4671-nested-repo-warning-tests-r1.md`
