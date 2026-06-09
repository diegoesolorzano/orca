# Feature: WebGL terminal glyph-atlas corruption recovery

**Feature ID:** orca-5031-webgl-atlas-recovery
**Repo:** orca
**Issue:** stablyai/orca#5031
**Upstream:** none
**Date:** 2026-06-09
**Status:** Approved

> Ubicacion no canonica deliberada: la regla del fork prohibe escribir en `docs/`
> (pertenece a upstream), por eso este spec vive en `docs-fork/specs/`.

> Decisiones cerradas (usuario, 2026-06-09): atajo por defecto **`Mod+Alt+R`**;
> auto-limpieza al recuperar foco (FR-4) **INCLUIDA en v1**; listar en la paleta de
> comandos **si existe** (a verificar en el plan).

## Problem Statement

Los terminales que corren un agente/TUI con spinner de alta frecuencia (Claude Code,
Codex) se corrompen visualmente: cajas de reemplazo, barras de progreso desalineadas,
glifos basura. El PTY esta sano — solo el render WebGL quedo corrupto. Hoy solo se
arregla cambiando de tab (que reconstruye WebGL). No hay forma de recuperarlo a
voluntad.

## Background

Causa raiz confirmada en codigo (issue #5031):

- El atlas de texturas de glifos de xterm WebGL se corrompe en redibujado rapido
  **sin** que la GPU levante un evento de context-loss.
- Las DOS recuperaciones existentes no cubren este caso:
  1. `onContextLoss` (`pane-webgl-renderer.ts:104`) solo dispara con perdida real de
     contexto GPU — aqui nunca dispara.
  2. `terminalOutputPrefersDomRenderer` (`terminal-complex-script.ts`) cae a DOM para
     rangos "de riesgo" (arabe/CJK/emoji/RTL/U+FFFD), pero los glifos de TUIs de
     agente NO estan en ese set: braille U+2800–28FF, box-drawing U+2500–257F, blocks
     U+2588. Confirmado: ninguno se detecta → el pane se queda en WebGL.

`@xterm/addon-webgl@0.20.0-beta.219` expone `clearTextureAtlas()` — primitiva de
recuperacion natural (reconstruye el atlas perezosamente).

Alternativa descartada: **ampliar los rangos de riesgo** con braille/box-drawing.
Empujaria permanentemente a DOM (mas lento) justo a los TUIs de agente, que es el caso
de uso principal del usuario. Mal trade-off. Una primitiva de recuperacion arregla
TODAS las causas de corrupcion sin sacrificar GPU; VS Code tiene un "redraw" manual
equivalente.

## Requirements

- [ ] FR-1: Comando **"Redraw terminal"** que recupera el pane activo: limpia el atlas
  WebGL (`clearTextureAtlas()`) y fuerza `refresh(0, rows-1)`.
- [ ] FR-2: El comando funciona aunque el pane este en DOM (sin WebGL): solo hace
  `refresh`, sin error.
- [ ] FR-3: Atajo de teclado configurable (accion nueva en el registro de keybindings)
  + descubrible en Settings → Shortcuts.
- [ ] FR-4: (Opcional v1, ver Open Questions) auto-limpieza del atlas al recuperar
  foco/visibilidad de un pane WebGL — seguro de vida pasivo.
- [ ] FR-5: No-op seguro: si no hay pane activo o el addon fue dispuesto, no lanza.

## Acceptance Criteria

- **Given** un pane WebGL con el atlas corrupto, **When** el usuario invoca "Redraw
  terminal" (atajo o paleta), **Then** el atlas se limpia y el contenido se repinta
  correcto sin cambiar de tab.
- **Given** un pane en renderer DOM, **When** se invoca el comando, **Then** hace
  `refresh` y no llama `clearTextureAtlas` (no existe addon) ni lanza.
- **Given** ningun pane activo (editor/browser enfocado), **When** se invoca el comando
  desde la paleta, **Then** no-op silencioso.
- **Given** el atajo nuevo, **When** el usuario lo busca en Settings → Shortcuts,
  **Then** aparece con titulo y grupo, y es re-asignable.
- **(si FR-4)** **Given** un pane WebGL que recupera foco/visibilidad, **When** vuelve
  a primer plano, **Then** se limpia el atlas una vez (sin loop, sin parpadeo).

## Scope

### Renderer — recuperacion del renderer
- [ ] `src/renderer/src/lib/pane-manager/pane-webgl-renderer.ts` — funcion nueva
  `redrawPane(pane)`: `pane.webglAddon?.clearTextureAtlas()` (try/catch) seguido de
  `pane.terminal.refresh(0, pane.terminal.rows - 1)`. No lanza.
- [ ] `src/renderer/src/lib/pane-manager/pane-rendering-control.ts` — `redrawPaneById(
  panes, paneId)`.
- [ ] `src/renderer/src/lib/pane-manager/pane-manager.ts` — metodo publico
  `redrawPane(paneId)` y `redrawActivePane()` (usa `getActivePane()`).

### Renderer — comando / atajo
- [ ] `src/shared/keybindings.ts` — accion nueva `terminal.redraw` (titulo "Redraw
  terminal", grupo Terminal/Tabs, `allowInTerminal: true`, default binding — ver Open
  Questions).
- [ ] Handler en el dispatcher de shortcuts (`Terminal.tsx` o `TerminalPane.tsx`,
  donde vive el `manager`): al matchear `terminal.redraw`, llamar
  `manager.redrawActivePane()`.
- [ ] (Paleta de comandos: si existe un registro Cmd-J/quick-actions que liste
  acciones, añadir la entrada — verificar en plan.)

### Renderer — auto-recuperacion (si FR-4 entra)
- [ ] Gancho en el path de foco/visibilidad del pane (reuso del lugar que ya llama
  `reattachWebglIfNeeded`/`refresh` al volver a foreground) → `clearTextureAtlas` una
  sola vez por transicion.

### Testing
- [ ] Unit: `redrawPane` con addon presente (llama clear+refresh), sin addon (solo
  refresh), con addon que lanza (no propaga).
- [ ] Unit: `redrawActivePane` sin pane activo → no-op.
- [ ] Unit: la accion `terminal.redraw` existe en el registro con default binding.
- [ ] (si FR-4) Unit del gancho de foco: limpia una vez, no en loop.

## Design Decisions

- **Recuperacion, no clasificacion**: limpiar el atlas cubre toda causa de corrupcion;
  ampliar rangos de glifos es whack-a-mole y penaliza el caso de uso principal.
- **Manual primero (comando)**: superficie minima, recuperacion garantizada,
  determinista, y toca codigo que el workstream `term-speed-2` de upstream NO esta
  refactorizando → mergeable y de bajo conflicto en el fork. VS Code valida el patron.
- **`clearTextureAtlas` + `refresh`, no recrear WebGL**: recrear el addon puede entrar
  en loop de context-loss (el propio codigo lo advierte, `:106`); limpiar el atlas es
  barato y xterm lo reconstruye perezosamente.
- **Fork-first**: se construye y usa en el fork ya; el PR upstream se retiene hasta que
  baje la churn de `term-speed-2` (12 PRs abiertos hoy sobre este subsistema).

## UI Changes

- Nueva entrada en Settings → Shortcuts: "Redraw terminal" (grupo Terminal), con su
  binding por defecto, re-asignable.
- Al invocar: el contenido del terminal se repinta en sitio. Sin diálogo, sin toast —
  recuperacion silenciosa. (Opcional: micro-feedback visual; default = ninguno.)

## Out of Scope

- Ampliar los rangos de `terminalOutputPrefersDomRenderer`.
- Detección automática de corrupción del atlas (no hay señal fiable sin context-loss;
  por eso el camino es manual + auto-on-focus best-effort).
- Recrear/reinicializar el contexto WebGL completo.
- Cambios al pipeline de batching de output (upstream ya lo ataca en #4785/87/89).

## Agent Readiness

- **Rules/skills/AGENTS.md**: N/A para upstream. En el fork: registrar el nuevo atajo
  en `docs-fork/` (backlog §00X) al embarcar; sin rule nueva.
- **Discoverability**: la accion aparece en Settings → Shortcuts por sí sola.

## Risks

- **Atajo en conflicto con uno existente** → elegir un binding libre (Open Questions);
  el registro de keybindings detecta colisiones en Settings.
- **`clearTextureAtlas` no recupera en algún stack GPU** → el `refresh` posterior es el
  fallback; si aun así falla, el toggle GPU→DOM en Settings sigue disponible.
- **Conflicto con el refactor `term-speed-2`** → superficie mínima y aislada; el PR
  upstream se retiene hasta que asiente.
- **Rollback**: feature aditivo (comando + método); revertir el commit lo elimina sin
  residuo.

## Deploy Checklist

- [ ] Tests de las zonas tocadas (`src/renderer/src/lib/pane-manager/`, keybindings) +
  `pnpm typecheck` + lint limpios.
- [ ] Rama `feat/webgl-atlas-recovery` desde `upstream/main`.
- [ ] Merge a `personal/build` + rebuild local (`orca-fork-update`).
- [ ] PR upstream a stablyai/orca #5031 — **EN PAUSA** hasta que baje la churn de
  `term-speed-2` (decision del usuario).
- [ ] Verificacion manual: reproducir el glitch con un agente y confirmar que el atajo
  lo recupera sin cambiar de tab.

## Open Questions

(Resueltas por el usuario 2026-06-09 — ver bloque bajo el header)

1. **Atajo por defecto:** `Mod+Alt+R`. ✅
2. **FR-4 (auto-on-focus):** incluida en v1. ✅
3. **Paleta de comandos:** sí, listar "Redraw terminal" si existe el registro
   (verificar en plan). ✅
