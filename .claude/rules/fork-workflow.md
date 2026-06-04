# Fork Workflow (diegoesolorzano/orca)

Este es un FORK personal de stablyai/orca, no un proyecto propio. Antes de cualquier
cambio aqui, leer `FORK-NOTES.md` (rama `personal/build`) — es la fuente de verdad.

## Rama de trabajo

**SIEMPRE trabajar parado en `personal/build`.** Es la unica rama donde viven los
archivos personales (FORK-NOTES.md, esta regla) y desde donde se compila el build local.

| Rama | Regla |
|------|-------|
| `personal/build` | Rama por defecto para TODO: verificar, compilar, parchear, documentar |
| `fix/git-crypt-worktree-create` | Rama del PR upstream #4626 — NO tocar salvo feedback de maintainers; NO mezclar archivos personales |
| `main` | Espejo de upstream — solo `git merge --ff-only upstream/main`, nunca commits directos |

## Invariantes

- Nuevos parches propios: rama `fix/*` o `feat/*` desde `main` (si van a PR upstream)
  y luego merge a `personal/build`; o commit directo en `personal/build` si son solo personales.
- NUNCA rebasear `personal/build` (esta pusheada a origin); integrar upstream por merge.
- NUNCA dejar que FORK-NOTES.md o `.claude/` lleguen a una rama de PR upstream.
- Updates de upstream y recompilacion: usar el skill global `orca-fork-update`.
- Antes de compilar tras un merge: correr `npx vitest run --config config/vitest.config.ts src/main/git/`.
- Si el PR #4626 ya se mergeo upstream: este fork es obsoleto — volver al Orca oficial.
