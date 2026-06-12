# Notas del fork — diegoesolorzano/orca

Fork **permanente** de [stablyai/orca](https://github.com/stablyai/orca): base para desarrollo
de producto propio encima de Orca (licencia MIT, atribucion requerida). No es un fork temporal —
sobrevive al merge del PR #4626.

> Este archivo vive SOLO en la rama `personal/build`. Nunca debe llegar a una rama de PR.

## Estrategia de fork de producto

- **Upstream-first:** todo parche que upstream pueda aceptar (fixes, mejoras genericas) va por
  PR upstream — cada merge alla es mantenimiento que nos quitamos. El fork guarda SOLO la
  diferenciacion de producto que upstream no aceptaria.
- **Parches pequenos y modulares:** cada feature propia en su rama `feat/*`, mergeada a
  `personal/build`. Minimiza superficie de conflicto en cada sync con upstream.
- **Docs de producto:** en `docs-fork/` (separado de `docs/` upstream para evitar conflictos).

## Por que existe este fork

`git worktree add` falla en repos con git-crypt: las keys viven en el git dir del repo
principal (`.git/git-crypt/`), pero el worktree nuevo tiene su propio git dir sin keys,
y el smudge filter aborta durante el checkout del add. Orca creaba worktrees con
`git worktree add` directo, asi que en repos encriptados (ej. nodo-ia, multi-key
`default` + `agente`) la creacion nunca completaba. Un setup script post-create no
puede arreglarlo porque el fallo ocurre ANTES de que corra.

## El fix

`src/main/git/worktree.ts` — espejo del patron ya existente en `addSparseWorktree`:

1. Detecta `git-crypt/` en el git dir del repo (probe de filesystem, layouts normal y bare)
2. Si existe → `git worktree add --no-checkout`
3. Copia `.git/git-crypt/` completo (todas las keys) al git dir del worktree
4. `git checkout <branch>` en el worktree
5. Si el checkout diferido falla → rollback (worktree remove + branch -D)

Tests: `src/main/git/worktree-git-crypt.test.ts` (6 casos).
Limitacion conocida: solo path local; el relay SSH (`src/relay/git-handler-worktree-ops.ts`)
quedo sin cambios porque solo dispone de un ejecutor `git` (sin file ops remotas).

## Parche de producto: agente `minimax` (y wrapper `kimi`)

Reconocimiento en Orca de dos "agentes" que en realidad son **Claude Code apuntando a
otro backend** vía wrappers en `~/.local/bin`:

- `kimi`   → `exec -a kimi claude`     (backend api.kimi.com)
- `minimax`→ `exec -a minimax claude`  (backend api.minimax.io, modelo MiniMax-M3)

Clave: Orca reconoce el agente por el **nombre del proceso en foreground**
(`getForegroundProcess` → `recognizeAgentProcess`). `exec -a <nombre>` fija `argv[0]`,
así el proceso se llama `kimi`/`minimax` en vez de `claude` y Orca los distingue.

- `kimi` ya existe en el catálogo upstream (`TUI_AGENT_CONFIG.kimi`) — no requirió código.
- `minimax` es parche del fork. Archivos tocados (replican el patrón de `kimi`):
  `src/shared/types.ts` (union `TuiAgent`), `src/shared/tui-agent-config.ts`
  (`promptInjectionMode:'argv'` + `--prefill`, porque por debajo ES Claude Code),
  `src/shared/agent-kind.ts`, `src/shared/telemetry-events.ts` (`AGENT_KIND_VALUES`),
  `src/shared/tui-agent-selection.ts`, `src/renderer/src/lib/agent-catalog.tsx`,
  `src/renderer/src/lib/agent-status.ts` (record de iconos).
- NO se tocó el subsistema de rate-limits/cuotas (fetcher propio de cada proveedor):
  MiniMax no expone esa API, así que no aparece en el panel de uso del status bar.
- Genera conflicto menor de merge en `types.ts`/`tui-agent-config.ts` al traer upstream;
  reaplicar la entrada `minimax`.

## Parche de producto: confirmación al salir (Cmd+Q)

Upstream salta a propósito el diálogo de cierre en Cmd+Q (`isQuitting`) — solo confirma
al cerrar la ventana con la X y únicamente si hay procesos locales corriendo. El fork hace
que **Cmd+Q siempre pida confirmación**, con **cancelación segura**.

- Flujo: `app before-quit` → `window 'close'` (preventDefault) → IPC `window:close-requested`
  `{isQuitting}` → el renderer muestra el diálogo → `window:confirm-close` (cerrar) o
  `window:quit-aborted` (cancelar).
- Cancelación segura: el teardown de servicios (`rateLimits.stop()`, `agentAwakeService`)
  se movió de `before-quit` a `will-quit`, que solo corre en una salida real. `before-quit`
  deja solo el latch reversible `isQuitting=true`; `window:quit-aborted` lo limpia vía
  `onQuitAborted`. Así cancelar un Cmd+Q deja Orca 100% funcional.
- Archivos: `src/renderer/src/components/Terminal.tsx` (diálogo + texto condicional +
  `cancelWindowClose`), `src/preload/index.ts` + `api-types.ts` + `web/web-preload-api.ts`
  (`abortWindowClose`), `src/main/window/createMainWindow.ts` (canal `window:quit-aborted`),
  `src/main/index.ts` (teardown movido a `will-quit`).
- Copias i18n nuevas usan claves `fork.terminal.quitConfirm.*` con fallback en inglés
  (`translate` cae al fallback si la clave no existe; no rompe el pipeline i18n).

## Estado upstream

- Issue original: stablyai/orca#4566 (de otro usuario, mismo problema)
- Nuestro PR: **stablyai/orca#4626** (`Fixes #4566`)
- Cuando el PR se mergee y salga release: volver al Orca oficial y abandonar este build.

## Ramas

| Rama | Proposito | Regla |
|------|-----------|-------|
| `fix/git-crypt-worktree-create` | Rama del PR upstream | NO tocar salvo feedback de maintainers; sin archivos personales |
| `personal/build` | Build local (fix + estas notas + futuros parches propios) | Aqui se compila; aqui se integran updates de upstream |
| `main` | Espejo de upstream/main | Solo fast-forward desde upstream |

Remotes: `origin` = diegoesolorzano/orca · `upstream` = stablyai/orca

## Build e instalacion (macOS arm64)

```bash
pnpm install
pnpm run build:mac           # genera dist/mac-arm64/Orca.app
# swap:
osascript -e 'quit app "Orca"' ; sleep 2
rm -rf /Applications/Orca.app   # (el build anterior del fork; el oficial 1.4.30 esta respaldado)
cp -R dist/mac-arm64/Orca.app /Applications/Orca.app
xattr -dr com.apple.quarantine /Applications/Orca.app
open -a Orca
```

- Backup del oficial 1.4.30: `dist/Orca-1.4.30-official-backup.app`
- Los datos de Orca (repos, worktrees, settings, accounts) viven en
  `~/Library/Application Support/orca/` y `~/.orca/` — sobreviven cualquier swap del .app.

## Consideraciones del build propio

- **Auto-updater: neutralizado a nivel UI (parche del fork).** El build del fork SI
  recibe el feed de updates oficial de Stably y muestra la tarjeta "Update
  Available" — se conserva a proposito como NOTIFICACION de releases upstream, pero
  el boton de instalar fue removido (commit `feat(fork): disable in-app update
  install...` en `UpdateCard.tsx`): instalarlo reemplazaria el build del fork por el
  binario oficial y se perderian los parches locales. Actualizar SIEMPRE via el
  flujo de abajo (skill `orca-fork-update`). Nota: Settings puede conservar su
  propio boton de update — no usarlo. Neutralizacion del feed a nivel builder:
  pendiente en `docs-fork/001-product-ideas.md` §003 (Chiwi nivel 1).
- **Sin firma/notarizacion de Stably**: primera apertura puede requerir aprobacion en
  Ajustes → Privacidad y Seguridad (por eso el `xattr -dr com.apple.quarantine`).
- **Version**: el build hereda la version del package.json upstream al momento del merge
  (ej. 1.4.45) — no confundir con releases oficiales de la misma version.
- **Setup script por repo** (Settings → Repository): para nodo-ia basta `pnpm install`;
  el fix ya copia las keys durante la creacion del worktree.
- **Borrar worktrees desde Orca NO re-homea transcripts de Claude** — si el worktree tuvo
  sesiones de Claude que valgan, usar el skill `worktree-remove` en su lugar.
- **Verificacion pendiente menor**: leer un archivo de la key `default` (ej. `secrets/`)
  en un worktree real creado por Orca (la key `agente` ya se verifico empiricamente).

## Flujo de actualizacion sin romper el build

```bash
git checkout main
git fetch upstream
git merge --ff-only upstream/main      # espejo limpio
git checkout personal/build
git merge main                          # integra upstream al build personal
pnpm install                            # deps pueden haber cambiado
pnpm run build:mac
# swap del .app (ver arriba)
```

- Conflicto probable: `src/main/git/worktree.ts` si upstream toca esa zona.
  - Si el conflicto es porque **mergearon nuestro PR**: resolver quedandose con la
    version de upstream (el fix ya viene incluido). El fork sigue vivo — solo se
    simplifica: un parche menos que cargar en los merges.
  - Si es otro cambio: resolver conservando el fix (defer checkout + copia de keys).
- Nunca rebasear `fix/git-crypt-worktree-create` despues de abierto el PR salvo
  que los maintainers lo pidan.
- El backup `dist/Orca-1.4.30-official-backup.app` y la nota de "volver al oficial"
  aplicaban a la etapa de fork temporal; con el fork como base de producto, el build
  propio es el permanente.
