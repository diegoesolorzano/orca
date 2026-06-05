# Time tracking (fork feature)

Orca reporta **tiempo humano** al servicio local del time-tracker
(`http://localhost:47321`), con el mismo contrato `/events/*` que la extensión
de VS Code. El tracking de **agentes** NO vive aquí — lo hacen los hooks de
cada agente (Claude/Codex/OpenCode) fuera de Orca.

Contrato de referencia: `time-tracker-extension/.claude/rules/agent-integrations.md`
y `time-tracker-extension/service/src/routes/events.ts`.

## Módulo

Todo el código vive en `src/main/time-tracker/` + un hook de renderer:

| Archivo | Rol |
|---|---|
| `types.ts` | Contratos (`ProjectContext`, `ActivityPing`, config + env overrides) |
| `client.ts` | HTTP fire-and-forget (`sendEvent`/`sendHeartbeat`/`isHealthy`); nunca rechaza; `sourceName: 'orca'` |
| `tracker.ts` | Máquina de estados: focus/blur/idle/active, gracia de blur 60s, idle 5 min, heartbeat 30s de TODOS los proyectos abiertos, suspend/resume, flush determinista, re-emit de focus si el evento de apertura no se entregó |
| `context.ts` | `buildCtx(ping, lookup)` — resuelve Repo/Worktree desde el Store; **descarta repos SSH** (`Repo.connectionId != null`) y IDs desconocidos; basename en main (cross-platform) |
| `git-branch.ts` | Branch por worktree con caché TTL 60s (`git rev-parse --abbrev-ref HEAD`) |
| `service-spawn.ts` | Health-check + spawn del servicio (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`) |
| `wire.ts` | Cableado: IPC `timeTracker:activity`, focus/blur de app, `powerMonitor` suspend/resume, `before-quit`, `closed` por ventana |
| `src/renderer/src/hooks/useTimeTrackerActivity.ts` | keydown/pointerdown/wheel a nivel `window`, throttle 5s, manda SOLO IDs (`repoId`, `worktreeId`) |

## Decisiones de diseño

- **El renderer no es confiable**: manda solo IDs; main resuelve paths y decide
  el skip SSH desde el Store.
- **Atribución = worktree activo**: la sesión seleccionada define el proyecto;
  worktrees del mismo repo colapsan al proyecto canónico (`Repo.path`) — sin
  churn de blur/focus al cambiar entre worktrees hermanos.
- **Idle = 5 min sin input** (paridad con la extensión de VS Code). Scroll y
  clicks cuentan como actividad.
- **Nunca bloquear Orca**: todo HTTP es fire-and-forget con timeout; un
  servicio caído es un no-op silencioso. La entrega se trackea (`delivered`)
  para re-emitir `focus` cuando el servicio vuelve.
- **Suspend cierra al instante** (sin gracia) — evita horas fantasma de
  "tiempo humano" con la laptop dormida.

## Configuración (solo dev / lanzamiento desde shell)

Una `.app` lanzada desde el Dock NO ve exports del shell — estos envs aplican
solo en dev o lanzando el binario desde terminal:

| Env | Default |
|---|---|
| `TIME_TRACKER_BASE_URL` | `http://localhost:47321` |
| `TIME_TRACKER_SERVICE_PATH` | autodetect del bundle de la extensión VS Code |
| `TIME_TRACKER_IDLE_MS` | 300000 |
| `TIME_TRACKER_BLUR_GRACE_MS` | 60000 |
| `TIME_TRACKER_HEARTBEAT_MS` | 30000 |

## Mapa de rebase (supervivencia a syncs con upstream)

Código nuevo aislado en `src/main/time-tracker/` (+ hook). Puntos de contacto
con código upstream — revisar SOLO estos en conflictos:

1. `src/main/index.ts` — import + `wireTimeTracker(store)` (2 líneas)
2. `src/preload/index.ts` — grupo `timeTracker` en `api`
3. `src/preload/api-types.ts` — tipo del grupo
4. `src/renderer/src/App.tsx` — import + `useTimeTrackerActivity()` (2 líneas)

El cableado va deliberadamente FUERA de `registerCoreHandlers` (función
once-guarded de ~17 parámetros, superficie de conflicto máxima).

## Verificación (smoke)

1. Servicio detenido → abrir Orca → sin errores; el servicio se auto-levanta.
2. Escribir en agents mode → `curl localhost:47321/projects` muestra bloque
   `human` abierto con `sourceName: 'orca'` en el proyecto del repo canónico.
3. Cambiar entre worktrees del mismo repo → sin eventos; cambiar de repo →
   blur del viejo + focus del nuevo.
4. Idle (bajar `TIME_TRACKER_IDLE_MS` en dev) → bloque cierra; actividad
   reabre (`active`).
5. Matar el servicio a mitad de sesión → Orca inafectado; al volver el
   servicio el tracking se reanuda.
6. Dormir la laptop → bloque cerrado al suspend, sin inflarse.
7. Cmd+Q / cerrar ventana → bloque cerrado de inmediato.

Ejecutado 2026-06-04 (checks 1-3 y 5 en vivo; 4, 6 y 7 cubiertos por unit
tests en `src/main/time-tracker/*.test.ts` — 38 casos con fake timers).
