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
