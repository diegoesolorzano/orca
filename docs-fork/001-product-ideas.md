# Ideas de producto / mejoras sobre el fork

Backlog informal de diferenciacion. Cuando una idea madure, pasa por `/feature-spec`.

## 001 — Workspaces multi-repo (agrupacion en sidebar)

**Fecha:** 2026-06-04
**Origen:** flujo real del usuario con WP-Maintain.

Orca modela proyecto = 1 repo git (o 1 folder plano). No existe el concepto de
workspace multi-root estilo VS Code: una carpeta "hub" (ej. `WP-Maintain`) que agrupa
varios sub-repos/symlinks (sitios WP en `sites/`, repos cliente en `CLIENTES-GIT/...`).

Hoy eso obliga a registrar cada sub-repo como proyecto suelto en el sidebar, perdiendo
la agrupacion logica — y los worktrees de un sub-repo nunca aparecen bajo el hub.

**Idea:** grupos/workspaces en el sidebar — un nodo padre (definible por carpeta o
manual) que contiene N proyectos git, cada uno con sus worktrees. Equivalente al
`.code-workspace` de VS Code.

**Anclas en el codigo:** `src/main/repo-worktrees.ts` (listado por repo),
`src/shared/repo-kind.ts` (kinds `git`/`folder`), sidebar en
`src/renderer/src/components/sidebar/`.

## 002 — Worktrees conscientes de meta-repos (repos anidados)

**Fecha:** 2026-06-04
**Estado parte 1 (deteccion + warning):** IMPLEMENTADA — PR upstream
[stablyai/orca#4677](https://github.com/stablyai/orca/pull/4677) (issue #4671),
rama `feat/nested-repo-warning`, mergeada a `personal/build`. Artefactos:
`docs-fork/specs/orca-4671-nested-repo-warning.md` + `.claude/plans/`.
**Estado parte 2 (worktrees companion):** pendiente — ESTA es la feature que el
usuario realmente quiere (la parte 1 solo avisa). Probable diferenciacion del fork
(opinable para upstream, salvo que reaccionen al PR #4677 pidiendo mas).

**Decisiones de diseño abiertas para el `/feature-spec` de la parte 2** (planteadas
en sesion 2026-06-05, sin resolver):
1. **Ramas**: al worktrear el padre con rama `feat/x`, ¿que rama se crea en cada
   repo anidado? ¿La misma `feat/x`? ¿Desde que base de cada anidado?
2. **Montaje**: worktree del anidado en su ruta relativa DENTRO del worktree padre
   (`<wt>/frontend`) — el directorio puede existir vacio o estar gitignoreado.
3. **Remocion ordenada**: anidados primero, sin destruir trabajo sin commit
   (modelo manual ya en el skill global `worktree-remove` 0.2.0).
4. **Fallo a mitad**: anidado 2 de 3 falla → ¿rollback total o estado parcial?
5. **UX**: ¿automatico, opt-in en el composer, o boton "Create companion
   worktrees" en el toast de la parte 1?

**Base tecnica lista**: el detector (`detectUntrackedNestedRepos`), el tipo
`NestedRepoWarning` y el toast de la parte 1 son los insumos directos.
**Origen:** lavasport-app (meta-repo: root orquestador + `frontend/` y `backend/` como
repos git independientes anidados). Mismo patron que cubren los skills globales
`worktree-add` 1.3.0 / `worktree-remove` 0.2.0.

`git worktree` solo materializa lo trackeado por el repo donde corre: un worktree del
meta-repo NO contiene el codigo de los repos anidados, y el setup command auto-detectado
por Orca (install en el root) solo cubre al padre. El usuario crea el worktree creyendo
que tiene el proyecto completo y encuentra carpetas vacias.

**Idea (incremental):**
1. Deteccion + warning: al crear un worktree, buscar `.git` anidados no trackeados
   (`find <toplevel> -mindepth 2 -maxdepth 3 -name .git`, excluyendo `node_modules`) y
   advertir que esos directorios no estaran en el worktree.
2. Worktrees compuestos: ofrecer crear tambien un worktree por repo anidado, montado en
   su ruta relativa dentro del worktree padre (y removerlos en orden anidados-primero al
   borrar, sin destruir trabajo sin commit).

**Posicionamiento:** es generico y candidato a upstream (issue/PR aparte — NUNCA mezclarlo
con el PR #4626, que es un bugfix quirurgico). Si upstream no lo quiere, es diferenciacion
del fork.

**Anclas en el codigo:** `src/main/git/worktree.ts` (`addWorktree`/`removeWorktree`),
deteccion de setup command, `WorktreeVisibilityDialog.tsx` como referencia de dialogos
de decision en la creacion.
