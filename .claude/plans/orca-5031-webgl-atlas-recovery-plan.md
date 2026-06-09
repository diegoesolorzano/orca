# Plan: WebGL terminal glyph-atlas corruption recovery

**Feature ID:** orca-5031-webgl-atlas-recovery
**Repo:** orca
**Issue:** stablyai/orca#5031
**Upstream:** docs-fork/specs/orca-5031-webgl-atlas-recovery.md
**Date:** 2026-06-09
**Status:** Planned

## Overview

Comando manual "Redraw terminal" que recupera un pane WebGL con atlas corrupto sin
cambiar de tab: `webglAddon.clearTextureAtlas()` + `terminal.refresh()`. Sigue el
patron end-to-end de la accion existente `terminal.clear` (keybinding → policy →
keyboard-handlers → método del PaneManager). Rama `feat/webgl-atlas-recovery` desde
`upstream/main`. **FR-4 (auto-on-focus) descartado**: la transicion a foreground ya
recrea WebGL (suspend/resume por visibilidad) — limpiar el atlas ahi seria redundante.

## Sprint Goal

> El usuario puede recuperar un terminal WebGL con glifos corruptos invocando un atajo
> (`Mod+Alt+L`) que limpia el atlas y repinta, sin cambiar de tab; en panes DOM o sin
> pane activo el comando es no-op seguro.

### Done when

- [ ] `redrawPane` con addon WebGL → llama `clearTextureAtlas()` + `refresh(0, rows-1)`
- [ ] `redrawPane` en pane DOM (sin addon) → solo `refresh`, sin lanzar
- [ ] `redrawPane` con `clearTextureAtlas` que lanza → traga error, igual hace `refresh`
- [ ] `redrawActivePane` sin pane activo → no-op
- [ ] accion `terminal.redraw` existe con default `Mod+Alt+L`, `group: 'Terminal Panes'`, `scope: 'terminal'` (sin `allowInTerminal`)
- [ ] `resolveTerminalShortcutAction` resuelve `terminal.redraw` → `{ type: 'redrawActivePane' }`
- [ ] el atajo aparece y es reasignable en Settings → Shortcuts
- [ ] All tests pass
- [ ] No regressions in existing functionality

## Shared Types

```typescript
// src/renderer/src/components/terminal-pane/terminal-shortcut-policy.ts
// Añadir a la union TerminalShortcutAction:
//   | { type: 'redrawActivePane' }
```
(No hay tipos cross-cutting nuevos; el resto son firmas de funciones por tarea.)

## Tasks

### Task 1: `redrawPane` en el renderer WebGL
- **Files:** `src/renderer/src/lib/pane-manager/pane-webgl-renderer.ts` (modify)
- **Produces:**
  ```typescript
  export function redrawPane(pane: ManagedPaneInternal): void
  ```
- **Do:** Si `pane.webglAddon` existe, llamar `pane.webglAddon.clearTextureAtlas()`
  dentro de try/catch (tragar error — algun stack GPU puede no implementarlo bien).
  Luego SIEMPRE `pane.terminal.refresh(0, pane.terminal.rows - 1)` dentro de try/catch
  (el pane pudo ser dispuesto). Nunca lanza. Comentario "Why" breve (recupera atlas
  corrupto sin context-loss — issue #5031). Reusa el patron de
  `refreshTerminalAfterWebglAttach` (mismo archivo) para el refresh defensivo.
- **Integrates with:** `ManagedPaneInternal.webglAddon` / `.terminal`.
- **Verify:** unit tests de Task 7.
- **Tests:** Yes (Task 7).
- **Depends on:** None

### Task 2: `redrawPaneById` en rendering-control
- **Files:** `src/renderer/src/lib/pane-manager/pane-rendering-control.ts` (modify)
- **Produces:**
  ```typescript
  export function redrawPaneById(panes: Map<number, ManagedPaneInternal>, paneId: number): void
  ```
- **Do:** Buscar el pane en el map; si existe, `redrawPane(pane)`. Mismo patron que
  `markPaneComplexScriptOutput`/`setPaneGpuRenderingState` (mismo archivo). Importar
  `redrawPane` de `./pane-webgl-renderer`.
- **Integrates with:** Task 1.
- **Verify:** typecheck + tests de Task 7.
- **Tests:** Yes (cubierto indirectamente; el unit principal es Task 1 + Task 8).
- **Depends on:** Task 1

### Task 3: Métodos públicos en PaneManager
- **Files:** `src/renderer/src/lib/pane-manager/pane-manager.ts` (modify)
- **Produces:**
  ```typescript
  redrawPane(paneId: number): void
  redrawActivePane(): void
  ```
- **Do:** `redrawPane(paneId)` → `redrawPaneById(this.panes, paneId)`. `redrawActivePane()`
  → `const pane = this.getActivePane() ?? this.getPanes()[0]; if (pane) this.redrawPane(pane.id)`
  (mismo fallback `getActivePane() ?? getPanes()[0]` que usan los handlers de terminal).
  Colocar junto a `markPaneHasComplexScriptOutput` (l.243). Importar `redrawPaneById`.
- **Integrates with:** Task 2; consumido por Task 6.
- **Verify:** typecheck + tests de Task 8.
- **Tests:** Yes (Task 8).
- **Depends on:** Task 2

### Task 4: Accion de keybinding `terminal.redraw`
- **Files:** `src/shared/keybindings.ts` (modify)
- **Produces:**
  ```typescript
  // union KeybindingActionId: añadir 'terminal.redraw'
  // entrada nueva en el array de definiciones (forma EXACTA de terminal.clear,
  // verificada en keybindings.ts:691):
  //   { id: 'terminal.redraw', title: 'Redraw terminal', group: 'Terminal Panes',
  //     scope: 'terminal', searchKeywords: ['redraw','repaint','glyph','atlas',
  //     'corrupt','webgl','refresh'], defaultBindings: platformBindings(['Mod+Alt+L']) }
  ```
- **Do:** Añadir el id a la union `KeybindingActionId` (~l.25) y la definicion al
  registro junto a `terminal.clear` (l.691). `group: 'Terminal Panes'` y `scope:
  'terminal'` (valores confirmados; NO `'Terminal'`). **Sin `allowInTerminal`** —
  `terminal.clear` no lo usa; el resolver es `scope === 'terminal' || allowInTerminal`
  (keybindings.ts:1255), asi que en una accion scope-terminal el flag es muerto.
  `Mod+Alt+L` verificado libre en darwin/linux/win32.
- **Integrates with:** Task 5/6 (resolución y handler).
- **Verify:** typecheck; test de Task 9.
- **Tests:** Yes (Task 9).
- **Depends on:** None (paralelizable con 1-3)

### Task 5: Resolución en terminal-shortcut-policy
- **Files:** `src/renderer/src/components/terminal-pane/terminal-shortcut-policy.ts` (modify)
- **Produces:**
  ```typescript
  // TerminalShortcutAction += { type: 'redrawActivePane' }
  ```
- **Do:** Añadir el miembro a la union `TerminalShortcutAction` (l.31) y, dentro de
  `resolveTerminalShortcutAction`, un bloque
  `if (keybindingMatchesAction('terminal.redraw', event, platform, keybindings)) {
  return { type: 'redrawActivePane' } }` junto al de `terminal.clear` (l.60).
- **Integrates with:** Task 4 (action id), Task 6 (consumidor).
- **Verify:** typecheck; test de Task 9.
- **Tests:** Yes (Task 9).
- **Depends on:** Task 4

### Task 6: Handler en keyboard-handlers
- **Files:** `src/renderer/src/components/terminal-pane/keyboard-handlers.ts` (modify)
- **Do:** Tras el bloque `action.type === 'clearActivePane'` (l.~290), añadir
  `if (action.type === 'redrawActivePane') { e.preventDefault();
  e.stopImmediatePropagation(); manager.redrawActivePane(); return }`. Mismo estilo
  que el de clear pero llamando al método del manager (que ya resuelve el pane activo).
- **Integrates with:** Task 3 (`manager.redrawActivePane`), Task 5 (action type).
- **Verify:** typecheck; test de Task 10.
- **Tests:** Yes (Task 10).
- **Depends on:** Task 3, Task 5

### Task 7: Tests de `redrawPane`
- **Files:** `src/renderer/src/lib/pane-manager/pane-webgl-renderer.redraw.test.ts` (create)
- **Do:** Construir un `pane` mock (`{ webglAddon, terminal: { rows, refresh } }`).
  Casos: (a) addon presente → `clearTextureAtlas` llamado 1x + `refresh(0, rows-1)`;
  (b) `webglAddon = null` → `refresh` llamado, sin acceso a clear, sin lanzar; (c)
  `clearTextureAtlas` lanza → no propaga y `refresh` igual corre; (d) `refresh` lanza →
  no propaga. Seguir el patron de mocking de `pane-lifecycle.test.ts` (mismo dir).
- **Verify:** `npx vitest run --config config/vitest.config.ts src/renderer/src/lib/pane-manager/pane-webgl-renderer.redraw.test.ts`
- **Tests:** —
- **Depends on:** Task 1

### Task 8: Tests de los métodos del PaneManager
- **Files:** `src/renderer/src/lib/pane-manager/pane-manager.redraw.test.ts` (CREATE —
  no existe `pane-manager.test.ts`; los tests son feature-scoped como
  `pane-lifecycle.test.ts`).
- **Do:** Casos: `redrawActivePane` con pane activo → invoca el camino de redraw sobre
  ese pane; sin panes → no-op (no lanza); `redrawPane(idInexistente)` → no-op. Construir
  el manager con su constructor real y panes mock, o mockear `redrawPaneById`/
  `getActivePane` segun el patron de `pane-lifecycle.test.ts`.
- **Verify:** vitest del archivo en verde.
- **Tests:** —
- **Depends on:** Task 3

### Task 9: Tests de keybinding + policy
- **Files:** `src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts`
  (EXISTE — extender el describe de `resolveTerminalShortcutAction`, que ya tiene el
  caso `Mod+K → clearActivePane` como molde) + assert sobre el array de
  `src/shared/keybindings.ts`.
- **Do:** (a) registro: `terminal.redraw` existe con default `Mod+Alt+L`,
  `group: 'Terminal Panes'`, `scope: 'terminal'`; (b) policy: evento con AMBOS
  modificadores — darwin `{ key: 'l', code: 'KeyL', metaKey: true, altKey: true }` y
  variante no-mac `{ ..., ctrlKey: true, altKey: true }` — `resolveTerminalShortcutAction`
  devuelve `{ type: 'redrawActivePane' }`. (NO copiar el caso `Mod+K` verbatim: ese usa
  un solo modificador.)
- **Verify:** vitest en verde.
- **Tests:** —
- **Depends on:** Task 4, Task 5

### Task 10: Handler — wiring sin test dedicado
- **Files:** `src/renderer/src/components/terminal-pane/keyboard-handlers.ts` (ya tocado
  en Task 6).
- **Do:** NO se crea test de dispatch del handler: `keyboard-handlers.test.ts` solo
  cubre helpers puros (`matchSearchNavigate`, etc.) — no hay arnes que invoque el
  closure del keydown, y el dispatch de `clearActivePane` (molde directo) tampoco esta
  testeado. La cobertura real del redraw queda en Task 7 (`redrawPane`), Task 8 (método
  del manager) y Task 9 (policy resuelve la accion). El handler es 3 lineas de wiring
  identicas a `clearActivePane`; se valida por el protocolo manual (Task 13). Construir
  un arnes de dispatch a medida es desproporcionado y sin precedente en el repo.
- **Verify:** cubierto por Tasks 7-9 + verificacion manual.
- **Tests:** No (justificado arriba).
- **Depends on:** Task 6

### Task 11: Docs del fork + backlog
- **Files:** `docs-fork/001-product-ideas.md` (modify)
- **Do:** Añadir idea §004 "Recuperacion atlas WebGL" marcada IMPLEMENTADA con link al
  PR (cuando exista) e issue #5031; nota de que FR-4 quedo descartado por redundante.
  (AGENTS.md/rules: N/A upstream.)
- **Verify:** doc actualizado, commit en `personal/build`.
- **Tests:** No.
- **Depends on:** Task 13 (numero de PR) — o sin link si el PR queda en pausa.

### Task 12: Verificación + PR upstream (EN PAUSA)
- **Files:** — (git, rama `feat/webgl-atlas-recovery`)
- **Do:** Tasks 1-10 en `feat/webgl-atlas-recovery` desde `upstream/main`. Commits
  atomicos sin referencias AI. Suite de `src/renderer/src/lib/pane-manager/` +
  `terminal-pane` + keybindings, `pnpm typecheck`, lint limpios. Push a origin. **El
  `gh pr create` upstream queda EN PAUSA** (decision del usuario: esperar a que baje la
  churn de `term-speed-2`); dejar la rama lista y el cuerpo del PR redactado en el plan.
- **Verify:** rama pusheada, suites verdes.
- **Tests:** —
- **Depends on:** Tasks 1-10

### Task 13: Merge a `personal/build` + rebuild
- **Files:** — (git)
- **Do:** `git checkout personal/build && git merge feat/webgl-atlas-recovery`; correr
  `npx vitest run --config config/vitest.config.ts src/main/git/` (regla fork-workflow
  pre-build) + la suite del feature; rebuild (`pnpm run build:mac`) + swap del .app.
- **Verify:** build local con el comando; protocolo de reproduccion manual del spec
  (glitch → atajo → repinta).
- **Tests:** —
- **Depends on:** Task 12

## Test Matrix

### Shared Test Infrastructure
- **Framework:** vitest (`config/vitest.config.ts`)
- **Fixtures:** `pane` mock `{ webglAddon?: { clearTextureAtlas: vi.fn() },
  terminal: { rows: number, refresh: vi.fn() } }`; `manager` mock con
  `getActivePane`/`getPanes`/`redrawPane`.
- **Patrones:** mocking de pane-manager como `pane-lifecycle.test.ts`; policy/handler
  como los tests existentes de `terminal-shortcut-policy`/`keyboard-handlers`.

### Acceptance Criteria → Test Mapping

| AC | Test | Caso |
|----|------|------|
| addon → clear+refresh | `pane-webgl-renderer.redraw.test.ts` | (a) |
| DOM → solo refresh | id. | (b) |
| clear lanza → traga + refresh | id. | (c) |
| sin pane activo → no-op | `pane-manager.redraw.test.ts` | activePane null |
| accion existe default Mod+Alt+L | policy/keybindings test | registry |
| policy resuelve redraw | policy test | resolve |
| handler llama manager | keyboard-handlers test | dispatch |

### Per-Task Test Cases

#### Task 1/7: redrawPane
**File:** `pane-webgl-renderer.redraw.test.ts` — Unit
**Contract:** `export function redrawPane(pane: ManagedPaneInternal): void`

| # | Caso | Given | When | Then |
|---|------|-------|------|------|
| 1 | webgl | addon presente | redrawPane | clearTextureAtlas 1x + refresh(0,rows-1) |
| 2 | dom | webglAddon null | redrawPane | refresh llamado, sin clear, sin throw |
| 3 | clear lanza | clearTextureAtlas throws | redrawPane | no propaga, refresh igual corre |
| 4 | refresh lanza | refresh throws | redrawPane | no propaga |

#### Task 3/8: PaneManager
| # | Caso | Given | When | Then |
|---|------|-------|------|------|
| 1 | activo | pane activo | redrawActivePane | redraw sobre ese pane |
| 2 | vacio | sin panes | redrawActivePane | no-op, no throw |
| 3 | id inexistente | id no en map | redrawPane(id) | no-op |

#### Task 4-6/9-10: keybinding + policy + handler
| # | Caso | Given | When | Then |
|---|------|-------|------|------|
| 1 | registry | array keybindings | leer | `terminal.redraw` con Mod+Alt+L, allowInTerminal |
| 2 | policy | evento Mod+Alt+L | resolve | `{ type: 'redrawActivePane' }` |
| 3 | handler | action redrawActivePane | keydown | manager.redrawActivePane + preventDefault |

### E2E / Manual
- Protocolo manual del spec (Task 13): glitch real con agente → atajo → repinta sin
  cambiar tab. No hay arnes E2E para corrupcion de atlas (no se sintetiza).

## Patterns to Reuse

- Accion terminal end-to-end: `terminal.clear` — `keybindings.ts` (def) →
  `terminal-shortcut-policy.ts` (`resolveTerminalShortcutAction` → `clearActivePane`) →
  `keyboard-handlers.ts` (dispatch). Copiar esa cadena exacta.
- Refresh defensivo: `refreshTerminalAfterWebglAttach` en `pane-webgl-renderer.ts`.
- Método público del manager: `markPaneHasComplexScriptOutput` (l.243) como molde.
- Comentarios "Why" breves (AGENTS.md); cross-platform `platformBindings`.

## Risks

- **`clearTextureAtlas` no recupera en algun stack GPU** → el `refresh` posterior es el
  fallback; si aun falla, el toggle GPU→DOM en Settings sigue disponible. Bajo riesgo.
- **Conflicto con `term-speed-2`** → superficie minima (comando aislado), PR upstream en
  pausa; el merge a `personal/build` es nuestro y controlado.
- **`scope`/`group` exactos de las acciones terminal** → verificar el shape de
  `terminal.clear` al implementar Task 4 (no inventar campos).
- **Archivos de test exactos** (Task 9/10) → confirmar al implementar si existen
  `terminal-shortcut-policy.test.ts`/`keyboard-handlers.test.ts` o crear nuevos.

## Review Notes

Revision adversarial (subagente Plan, 2026-06-09) — incorporado:
- **[CRITICAL] `group`**: era `'Terminal'` (crearia grupo huerfano en Settings) →
  `'Terminal Panes'` (valor real de todas las acciones terminal, verificado).
- **[CRITICAL] `allowInTerminal`**: removido — `terminal.clear` no lo usa; con
  `scope: 'terminal'` es muerto (resolver `scope==='terminal' || allowInTerminal`).
- **[CRITICAL] Task 10**: no existe arnes de dispatch del handler en
  `keyboard-handlers.test.ts` (solo helpers puros) y `clearActivePane` tampoco esta
  testeado → re-scope: sin test dedicado del handler; cobertura por Tasks 7-9 +
  manual. Construir el arnes seria desproporcionado.
- **[W] Spec FR-4 contradictorio**: corregido en el spec (AC/Scope/Testing/protocolo/
  Open Q) — FR-4 descartado de forma consistente.
- **[W] Task 8**: confirma CREATE (`pane-manager.test.ts` no existe).
- **[W] Task 9**: extiende el `terminal-shortcut-policy.test.ts` existente; evento con
  AMBOS modificadores (meta+alt darwin / ctrl+alt no-mac), no copiar el caso `Mod+K`.
- **[I] verificado**: `clearTextureAtlas(): void` tipado en `WebglAddon`
  (0.20.0-beta.219) y `pane.webglAddon: WebglAddon | null` → Task 1 typecheck-ok;
  try/catch sigue justificado (panes dispuestos / quirks GPU).
- **FR-5**: el guard "tab no-terminal → no-op" es implicito (el keydown handler de
  terminal solo corre en tabs de terminal); documentado, sin task extra.

## PR Body (redactado, para cuando se abra)

> **fix(terminal): add a manual "Redraw terminal" command to recover from WebGL
> glyph-atlas corruption (#5031)**
>
> Agent/TUI spinners (braille U+2800–28FF, box-drawing U+2500–257F, blocks U+2588)
> are not in the complex-script DOM-fallback ranges, so those panes stay on WebGL;
> rapid redraw corrupts the glyph atlas with no context-loss event, and nothing
> recovers it until the pane is hidden+shown. This adds a `terminal.redraw` command
> (default Mod+Alt+L, rebindable) that calls `clearTextureAtlas()` + `refresh()` on the
> active pane — recover in place without switching tabs. No change to the complex-script
> ranges (would push agent TUIs permanently to the slower DOM renderer). Follows the
> existing `terminal.clear` action wiring.
