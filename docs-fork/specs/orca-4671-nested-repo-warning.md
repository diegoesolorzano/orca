# Feature: Nested-repo (meta-repo) warning on worktree creation

**Feature ID:** orca-4671-nested-repo-warning
**Repo:** orca
**Issue:** stablyai/orca#4671
**Upstream:** none
**Date:** 2026-06-04
**Status:** Approved

> Ubicacion no canonica deliberada: la regla del fork prohibe escribir en `docs/`
> (pertenece a upstream), por eso este spec vive en `docs-fork/specs/` en vez de
> `docs/specs/`. Aprobado por el usuario en sesion 2026-06-04.

## Problem Statement

En repos con layout meta-repo (repo padre + repos git independientes anidados en
subdirectorios no trackeados), un worktree del padre no materializa el codigo de los
anidados. Orca lo crea sin avisar y el usuario aterriza en un arbol sin el codigo de
la aplicacion, sin pista de por que.

## Background

- Caso real: `lavasport-app` (root orquestador + `frontend/` y `backend/`
  independientes). El setup command auto-detectado (`pnpm install` del root) refuerza
  la ilusion de proyecto completo.
- Alternativa evaluada y descartada (por ahora): dialogo bloqueante pre-creacion —
  mas friccion, mas superficie de UI, y opinable para upstream. El warning
  post-create es aditivo y no bloquea.
- **El codebase ya tiene un scanner de repos anidados**:
  `src/main/project-groups/nested-repo-discovery.ts` (`scanNestedRepos`) con
  profundidad acotada (1-8), skip-dirs, no-follow de symlinks, deteccion de
  bare-repo markers y conciencia de submodules, con tests propios. Este feature lo
  REUSA en vez de crear un scanner paralelo.
- Parte 2 (worktrees companion por repo anidado) queda en el backlog del fork
  (`docs-fork/001-product-ideas.md` §002).

## Definicion: "repo anidado no trackeado"

Un directorio bajo el toplevel del repo origen que contiene un marker de repo git
(`.git` dir o file) y que NO esta registrado en el indice del padre como submodule/
gitlink (modo `160000`) ni listado en `.gitmodules`. Los submodules trackeados son
layouts intencionales que git worktree SI materializa (como gitlinks) — no deben
generar warning.

## Requirements

- [ ] FR-1: Al crear un worktree de un repo git local, detectar repos git anidados
  **no trackeados** (segun la definicion anterior) dentro del toplevel del repo
  origen, reusando `scanNestedRepos` y filtrando submodules/gitlinks contra el
  indice del padre.
- [ ] FR-2: Si existen, `CreateWorktreeResult` incluye un campo estructurado:
  `nestedRepos?: { paths: string[]; truncated: boolean }` — rutas relativas al
  toplevel, normalizadas a `/` con trailing `/` (tambien en Windows), maximo 10
  (`truncated: true` si se omitieron mas).
- [ ] FR-3: El renderer muestra un toast de advertencia post-creacion consumiendo
  `nestedRepos` (canal propio — `warning?: string` existente NO se consume hoy en el
  slice y no se toca), listando las rutas y "and X more" si `truncated`.
- [ ] FR-4: La deteccion nunca bloquea ni hace fallar la creacion: el scan corre
  **concurrente** al `git worktree add` (lanzado al entrar a `createLocalWorktree`,
  awaited justo antes de devolver el resultado IPC); cualquier error del scan →
  `nestedRepos` ausente, creacion normal.
- [ ] FR-5: Limites objetivos del scan: profundidad ≤3, skip-dirs del scanner
  existente (`node_modules`, `.git`, etc.), sin seguir symlinks, sin subprocesos git
  por directorio (solo UNA consulta al indice del padre para el filtro de
  submodules), timeout interno de 5s (timeout → sin warning).

## Acceptance Criteria

- **Given** un repo padre con `frontend/.git` y `backend/.git` no trackeados,
  **When** se crea un worktree desde Orca, **Then** la creacion tiene exito y aparece
  un toast listando `frontend/`, `backend/`.
- **Given** un repo cuyo unico repo anidado es un **submodule trackeado**
  (gitlink en el indice / entrada en `.gitmodules`), **When** se crea un worktree,
  **Then** NO hay warning.
- **Given** un repo sin repos anidados, **When** se crea un worktree, **Then**
  `nestedRepos` esta ausente y no se muestra toast.
- **Given** un repo con `node_modules/**/.git` o un symlink a un directorio con
  `.git` externo, **When** se crea un worktree, **Then** esos no cuentan.
- **Given** 12 repos anidados no trackeados, **When** se crea un worktree, **Then**
  el toast lista 10 y "and 2 more" (`truncated: true`).
- **Given** un fallo de filesystem o timeout del scan, **When** se crea un worktree,
  **Then** la creacion procede sin warning y sin error.
- **Given** Windows, **When** se crea un worktree de un meta-repo, **Then** las rutas
  del toast usan `/` (ej. `frontend/`), no `\`.

## Scope

### Main process
- [ ] `src/main/git/nested-repo-warning.ts` (nuevo, delgado) —
  `detectUntrackedNestedRepos(repoPath)`: invoca `scanNestedRepos` (reuso de
  `src/main/project-groups/nested-repo-discovery.ts`; extraer primitivas compartidas
  alli si hace falta, manteniendo UNA sola implementacion de traversal), filtra
  submodules/gitlinks con una consulta al indice del padre, normaliza paths, aplica
  cap=10 y timeout=5s. Nunca lanza.
- [ ] `src/main/ipc/worktrees.ts` — en `createLocalWorktree`: lanzar la deteccion
  concurrente al create, await antes del return, adjuntar `nestedRepos` si hay.

### Shared
- [ ] `src/shared/types.ts` — `CreateWorktreeResult.nestedRepos?: { paths: string[];
  truncated: boolean }`.

### Renderer
- [ ] `src/renderer/src/store/slices/worktrees.ts` — handler de toast para
  `nestedRepos` (patron de `showLocalBaseRefToast`, que consume
  `localBaseRefRefresh`; `warning?: string` NO es el canal — hoy nadie lo consume).

### Testing
- [ ] Unit `src/main/git/nested-repo-warning.test.ts`: anidados no trackeados /
  submodule trackeado excluido / sin anidados / skip-dirs / symlinks no seguidos /
  cap+truncated / timeout y error fs → ausente / normalizacion de separadores
  (mock de traversal para probar trabajo acotado, sin fs real grande).
- [ ] Unit IPC (`worktrees.test.ts` style): el handler adjunta `nestedRepos`.
- [ ] Unit renderer: el toast dispara desde `nestedRepos` (incluye caso truncated),
  independiente de `warning?: string`.

## Design Decisions

- **Toast post-create, no dialogo pre-create**: aditivo, friccion cero, PR pequeno.
  Si upstream pide gate pre-create, la deteccion es reutilizable tal cual.
- **Reusar `scanNestedRepos`, no duplicar traversal**: ya resuelve depth/skip/
  symlinks/bare-markers y tiene tests; dos scanners divergirian. El modulo nuevo es
  solo el filtro de submodules + shaping del resultado.
- **Filtro de submodules contra el indice del padre**: distingue meta-repo accidental
  (warn) de submodules intencionales (no warn) — sin esto el warning daria falsos
  positivos en repos con submodules.
- **Campo tipado `{ paths, truncated }`**: formateable, testeable, y la parte 2 lo
  consume estructurado. No se reusa `warning?: string` (hoy sin consumidor; texto
  plano no permite truncation UX).
- **Scan concurrente + awaited**: no agrega latencia perceptible (el create domina) y
  el resultado IPC queda completo — el renderer no necesita un canal de eventos
  aparte.
- **Deteccion on-create (no cacheada)**: el layout puede cambiar; el scan acotado es
  barato.
- **Solo repos git locales**: folder-mode no crea worktrees; repos SSH requeririan
  scan remoto (fuera de alcance).

## UI Changes

Toast de advertencia tras crear el workspace: titulo tipo "Workspace created without
nested repos" y descripcion listando hasta 10 rutas relativas (`frontend/, backend/`)
+ "and X more" si hay truncamiento, aclarando que el worktree solo contiene lo
trackeado por el repo padre. Sin cambios en el composer.

## Out of Scope

- Worktrees companion de repos anidados (parte 2 del issue — backlog del fork).
- Deteccion en repos SSH/remotos.
- Ajustes al setup command auto-detectado.
- Bloqueo o confirmacion pre-creacion.
- Consumir/retirar el campo legacy `warning?: string`.

## Agent Readiness

- **AGENTS.md / rules / skills**: no aplica para upstream (su repo, sus
  convenciones). En el fork: la mitigacion operativa ya existe en los skills globales
  `worktree-add` 1.3.0 / `worktree-remove` 0.2.0; este feature cierra el gap de la UI
  de Orca. Nota en `docs-fork/001-product-ideas.md` §002 al embarcar.

## Risks

- **Falsos positivos con submodules** → filtro contra el indice del padre + AC
  dedicado (submodule trackeado no warn).
- **Perf en repos enormes** → limites objetivos de FR-5 (depth ≤3, skip-dirs, cap,
  timeout 5s, una sola consulta git) + test de trabajo acotado con traversal mockeado.
- **Upstream prefiere otra direccion** (ej. el pre-create hook del issue #4566) → el
  PR es pequeno y la deteccion sobrevive a cualquier reshape; mientras tanto vive en
  `personal/build`.
- **Rollback** → feature aditivo y aislado; revertir el commit lo elimina sin residuo.

## Deploy Checklist

- [ ] Tests: `npx vitest run --config config/vitest.config.ts src/main/git/
  src/main/project-groups/` + suites de `src/main/ipc/worktrees.test.ts` y el slice
  renderer en verde; `pnpm typecheck` y lint limpios en archivos tocados.
- [ ] Rama `feat/nested-repo-warning` desde `main` (upstream-first), PR a
  stablyai/orca referenciando #4671.
- [ ] Merge de la rama a `personal/build` + rebuild local (`orca-fork-update`).
- [ ] Verificacion manual: crear worktree de lavasport-app (o WP-Maintain con un repo
  anidado de prueba) y ver el toast; verificar un repo con submodules NO avisa.

## Open Questions

- Toast con accion (boton para registrar el repo anidado como proyecto): diferido a
  v2 / parte 2.

## Review Notes

- 2026-06-04 · spec-reviewer · round 1 · REQUEST_CHANGES · incorporate-and-stop · `.claude/reviews/orca-4671-nested-repo-warning-r1.md`
