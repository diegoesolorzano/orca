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
  mas friccion, mas superficie de UI, y opinable para upstream. El toast post-create
  reusa un patron existente (`CreateWorktreeResult.warning` → toast, como el aviso de
  fast-forward en `store/slices/worktrees.ts:95`).
- Parte 2 (worktrees companion por repo anidado) queda en el backlog del fork
  (`docs-fork/001-product-ideas.md` §002).

## Requirements

- [ ] FR-1: Al crear un worktree de un repo git local, detectar repos git anidados
  dentro del toplevel del repo origen que no esten trackeados por el (escaneo de
  `.git` con profundidad acotada, excluyendo `node_modules` y el propio `.git`).
- [ ] FR-2: Si existen, el resultado de creacion incluye un warning estructurado con
  la lista de rutas relativas de los repos anidados.
- [ ] FR-3: El renderer muestra un toast de advertencia post-creacion: el worktree no
  incluye los archivos de esos directorios.
- [ ] FR-4: La deteccion nunca bloquea ni hace fallar la creacion (fallos del scan →
  silencio, creacion normal).

## Acceptance Criteria

- **Given** un repo padre con `frontend/.git` y `backend/.git` no trackeados,
  **When** se crea un worktree desde Orca, **Then** la creacion tiene exito y aparece
  un toast listando `frontend/`, `backend/`.
- **Given** un repo sin repos anidados, **When** se crea un worktree, **Then** no hay
  warning nuevo ni overhead perceptible.
- **Given** un repo con `node_modules/**/.git`, **When** se crea un worktree,
  **Then** esos no cuentan como repos anidados.
- **Given** un fallo de filesystem durante el scan, **When** se crea un worktree,
  **Then** la creacion procede sin warning y sin error.

## Scope

### Main process
- [ ] `src/main/git/nested-repos.ts` (nuevo) — `detectNestedRepos(repoPath):
  Promise<string[]>`: scan fs puro, profundidad ≤3, exclusiones (`node_modules`,
  `.git`), cap de resultados, nunca lanza.
- [ ] `src/main/ipc/worktrees.ts` — en `createLocalWorktree` (path local no-folder),
  correr la deteccion y adjuntar el resultado a `CreateWorktreeResult`.

### Shared
- [ ] `src/shared/types.ts` — campo nuevo opcional en `CreateWorktreeResult`
  (ej. `nestedRepos?: string[]`).

### Renderer
- [ ] `src/renderer/src/store/slices/worktrees.ts` — toast de advertencia
  post-create (mismo patron que el de fast-forward).

### Testing
- [ ] Unit: `src/main/git/nested-repos.test.ts` — anidados presentes / ausentes /
  excluidos / profundidad / error fs.
- [ ] Unit: handler IPC adjunta el campo (siguiendo `worktrees.test.ts`).

## Design Decisions

- **Toast post-create, no dialogo pre-create**: reusa el canal `warning` existente y
  su UX; cero friccion nueva; PR pequeno con mas probabilidad de merge. Si upstream
  pide gate pre-create, la deteccion es reutilizable tal cual.
- **Deteccion en el momento de crear (no cacheada en el repo)**: el layout puede
  cambiar; el scan acotado es barato.
- **Solo repos git locales**: folder-mode no crea worktrees; repos SSH requeririan
  scan remoto (fuera de alcance, anotado).
- **Campo tipado nuevo en vez de concatenar a `warning: string`**: el renderer puede
  formatear la lista y futuras UIs (parte 2) lo consumen estructurado.

## UI Changes

Toast de advertencia tras crear el workspace: titulo tipo "Workspace created without
nested repos" y descripcion listando los directorios (ej. `frontend/, backend/`) con
la aclaracion de que el worktree solo contiene lo trackeado por el repo padre. Sin
cambios en el composer.

## Out of Scope

- Worktrees companion de repos anidados (parte 2 del issue — backlog del fork).
- Deteccion en repos SSH/remotos.
- Ajustes al setup command auto-detectado.
- Bloqueo o confirmacion pre-creacion.

## Agent Readiness

- **AGENTS.md / rules / skills**: no aplica para upstream (su repo, sus
  convenciones). En el fork: la mitigacion operativa ya existe en los skills globales
  `worktree-add` 1.3.0 / `worktree-remove` 0.2.0; este feature cierra el gap de la UI
  de Orca. Nota en `docs-fork/001-product-ideas.md` §002 al embarcar.

## Risks

- **Perf en repos enormes** → profundidad ≤3, exclusion de `node_modules`, cap de
  resultados, y corre en paralelo al resto del create.
- **Upstream prefiere otra direccion** (ej. el pre-create hook del issue #4566) → el
  PR es pequeno y la funcion de deteccion sobrevive a cualquier reshape; mientras
  tanto vive en `personal/build`.
- **Rollback** → feature aditivo y aislado; revertir el commit lo elimina sin residuo.

## Deploy Checklist

- [ ] Tests: `npx vitest run --config config/vitest.config.ts src/main/git/` +
  suite de `src/main/ipc/worktrees.test.ts` en verde; `pnpm typecheck` y lint limpios
  en archivos tocados.
- [ ] Rama `feat/nested-repo-warning` desde `main` (upstream-first), PR a
  stablyai/orca referenciando #4671.
- [ ] Merge de la rama a `personal/build` + rebuild local (`orca-fork-update`).
- [ ] Verificacion manual: crear worktree de lavasport-app (o WP-Maintain con un repo
  anidado de prueba) y ver el toast.

## Open Questions

- Toast con accion (boton para registrar el repo anidado como proyecto): diferido a
  v2 / parte 2.
