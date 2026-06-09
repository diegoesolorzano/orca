# Feature: WebGL terminal glyph-atlas corruption recovery

**Feature ID:** orca-5031-webgl-atlas-recovery
**Repo:** orca
**Issue:** stablyai/orca#5031
**Upstream:** none
**Date:** 2026-06-09
**Status:** Approved

> Ubicacion no canonica deliberada: la regla del fork prohibe escribir en `docs/`
> (pertenece a upstream), por eso este spec vive en `docs-fork/specs/`.

> Decisiones cerradas (usuario, 2026-06-09; ajustadas tras review cross-model r1):
> atajo por defecto **`Mod+Alt+L`** (el `Mod+Alt+R` propuesto choca con
> `workspace.rename` en macOS; `Mod+Alt+L` esta verificado libre en darwin/linux/
> win32); auto-limpieza al recuperar foco (FR-4) **INCLUIDA en v1, incondicional**;
> paleta de comandos **FUERA de v1** — la unica paleta de Orca (Cmd+J) es de acciones
> de workspace, no un command palette generico; la descubribilidad va por Settings →
> Shortcuts.

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
- [ ] FR-3: Atajo de teclado configurable — accion nueva `terminal.redraw` en el
  registro de keybindings con default `Mod+Alt+L` (libre en las 3 plataformas),
  `allowInTerminal: true`, descubrible/reasignable en Settings → Shortcuts.
- [ ] ~~FR-4: Auto-limpieza del atlas al recuperar foreground~~ **DESCARTADO en
  implementacion (2026-06-09)**: la transicion a foreground YA destruye y recrea WebGL
  (`use-terminal-pane-global-effects.ts`: `isVisible` → `suspendRendering()` al ocultar
  / `resumeRendering()` al mostrar), reconstruyendo el atlas desde cero. Por eso el
  workaround de "cambiar de tab" funciona hoy. Limpiar el atlas en esa transicion seria
  redundante. La falla real persiste SOLO mientras el pane se queda en primer plano
  redibujando — caso que cubre el comando manual (FR-1/2/3). Auto-recuperacion en
  primer plano sostenido requeriria una heuristica sin señal fiable (no hay evento de
  corrupcion) → fuera de alcance.
- [ ] FR-5: Routing del comando definido: solo actua si el tab activo es de terminal
  (`activeTabType === 'terminal'`) con un `PaneManager` montado y un pane activo
  (`getActivePane()`); en cualquier otro caso (editor/browser/sin pane) es no-op
  silencioso. Nunca lanza si el addon fue dispuesto.

## Acceptance Criteria

Unidades verificables en test (la "corrupción del atlas" real no se sintetiza en unit;
se valida que se invocan las primitivas correctas + protocolo manual abajo):

- **Given** un pane WebGL (addon presente), **When** se invoca `redrawPane`, **Then**
  se llama `webglAddon.clearTextureAtlas()` y luego `terminal.refresh(0, rows-1)`.
- **Given** un pane en renderer DOM (sin addon), **When** se invoca `redrawPane`,
  **Then** se llama `refresh` y NO `clearTextureAtlas`, sin lanzar.
- **Given** un addon cuyo `clearTextureAtlas` lanza, **When** se invoca `redrawPane`,
  **Then** el error se traga y `refresh` igual corre (best-effort).
- **Given** el tab activo NO es de terminal (editor/browser), **When** se invoca
  `redrawActivePane`, **Then** no-op silencioso (no toca ningun pane).
- **Given** el tab activo es de terminal sin pane activo, **When** se invoca, **Then**
  no-op silencioso.
- **Given** el atajo `Mod+Alt+L`, **When** el usuario lo busca en Settings → Shortcuts,
  **Then** aparece con titulo "Redraw terminal" y grupo, y es re-asignable.
- **(FR-5 routing)** **Given** un tab que NO es de terminal, **When** se intenta el
  atajo, **Then** no actua — implicito: el keydown handler de terminal solo corre en un
  tab de terminal (no requiere guard explicito).

### Protocolo de reproduccion manual (obligatorio antes de cerrar)

1. Correr un agente con spinner (Claude Code) en un pane hasta ver glifos corruptos.
2. Invocar el atajo `Mod+Alt+L` → el pane se repinta correcto sin cambiar de tab.

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
  terminal", grupo Terminal, `allowInTerminal: true`, default
  `platformBindings(['Mod+Alt+L'])`).
- [ ] Handler en el dispatcher de shortcuts (`Terminal.tsx`, donde se resuelve
  `keybindingMatchesAction` y se accede al `manager`): al matchear `terminal.redraw`,
  `e.preventDefault()` + `manager.redrawActivePane()`. Verificar en el plan si la
  accion necesita entrada en `terminal-shortcut-policy.ts` (`resolveTerminalShortcutAction`)
  por ser scope terminal.
- [ ] Paleta de comandos: **fuera de v1** (la Cmd+J es de acciones de workspace; mal
  fit para un redraw de pane). Descubribilidad por Settings → Shortcuts.

### Renderer — auto-recuperacion (FR-4): DESCARTADA
- ~~Gancho de foreground~~ — redundante: la transicion a foreground ya destruye/recrea
  WebGL (suspend/resume por visibilidad). Ver FR-4 arriba.

### Testing
- [ ] Unit: `redrawPane` con addon presente (llama clear+refresh), sin addon (solo
  refresh), con addon cuyo clear lanza (traga error, igual hace refresh).
- [ ] Unit: `redrawActivePane` — sin pane activo → no-op.
- [ ] Unit: la accion `terminal.redraw` existe en el registro con default `Mod+Alt+L`,
  `group: 'Terminal Panes'`, `scope: 'terminal'` (sin `allowInTerminal`, igual que
  `terminal.clear`).
- [ ] Unit: `resolveTerminalShortcutAction` resuelve `terminal.redraw` (evento con
  `metaKey+altKey` en darwin / `ctrlKey+altKey` en no-mac) → `{ type:
  'redrawActivePane' }`.

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

Ninguna abierta. Resoluciones (usuario 2026-06-09 + ajuste por review cross-model r1):
1. **Atajo por defecto:** `Mod+Alt+L` (el `Mod+Alt+R` propuesto chocaba con
   `workspace.rename` en macOS). ✅
2. **FR-4 (auto-on-focus):** incluida en v1, incondicional, gated a transicion de
   foreground. ✅
3. **Paleta de comandos:** fuera de v1 (Cmd+J es workspace-scoped, mal fit);
   descubribilidad por Settings → Shortcuts. ✅

## Review Notes

- 2026-06-09 · spec-reviewer (cross-model) · round 1 · REQUEST_CHANGES · incorporate-and-stop · `.claude/reviews/orca-5031-webgl-atlas-recovery-r1.md`
  - [CRITICAL] colision `Mod+Alt+R`/`workspace.rename` (darwin) → cambiado a `Mod+Alt+L` (verificado libre).
  - [W] FR-4 con wording condicional contradictorio → ahora incondicional en v1.
  - [W] paleta ambigua → fuera de v1 (Cmd+J es workspace-scoped).
  - [W] routing "sin pane activo" → definido por `activeTabType==='terminal'` + PaneManager montado + `getActivePane()`.
  - [W] transicion de auto-clear imprecisa → solo foreground de tab/pane, idempotente por flag, no eventos `focus` del DOM.
  - [W] aceptacion no automatable → dividida en unidades verificables (clear/refresh/errores) + protocolo manual.
  - [I] confirmado: no ampliar rangos complex-script; añadir test de `resolveTerminalShortcutAction` si la accion es terminal-scoped.
