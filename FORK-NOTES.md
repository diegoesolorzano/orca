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

## Parche de producto: agentes `minimax` / `zai` (y wrapper `kimi`)

Reconocimiento en Orca de "agentes" que en realidad son **Claude Code apuntando a
otro backend** vía wrappers en `~/.local/bin`:

- `kimi`    → `exec -a kimi claude`     (backend api.kimi.com)
- `minimax` → `exec -a minimax claude`  (backend api.minimax.io, modelo MiniMax-M3)
- `zai`     → `exec -a zai claude`      (backend api.z.ai, modelo GLM)

Clave: Orca reconoce el agente por el **nombre del proceso en foreground**
(`getForegroundProcess` → `recognizeAgentProcess`). `exec -a <nombre>` fija `argv[0]`,
así el proceso se llama `kimi`/`minimax`/`zai` en vez de `claude` y Orca los distingue.

- `kimi` ya existe en el catálogo upstream (`TUI_AGENT_CONFIG.kimi`) — no requirió código.
- `minimax` y `zai` son parche del fork. Para agregar OTRO wrapper igual, replica el
  patrón en estos archivos (el typecheck caza los `Record<TuiAgent>` exhaustivos que falten):
  `src/shared/types.ts` (union `TuiAgent`), `src/shared/tui-agent-config.ts`
  (`promptInjectionMode:'argv'` + `--prefill`, porque por debajo ES Claude Code),
  `src/shared/agent-kind.ts`, `src/shared/telemetry-events.ts` (`AGENT_KIND_VALUES`),
  `src/shared/tui-agent-selection.ts`, `src/renderer/src/lib/agent-catalog.tsx`,
  `src/renderer/src/lib/agent-status.ts` (record de iconos),
  `src/shared/tui-agent-display-names.ts`, y `src/shared/skills-cli-agent-keys.ts`
  (`Record<TuiAgent, string|null>`; para los wrappers va **`null`**: cada uno apunta
  `CLAUDE_CONFIG_DIR` a su propio dir, así que el target `claude-code` escribiría las
  skills donde nunca las leen).
- El ícono NO se empaqueta: `agent-catalog.tsx` declara `faviconDomain` (ej. `z.ai`) y
  Orca arma `https://www.google.com/s2/favicons?domain=<dominio>` — el logo lo sirve el
  sitio del proveedor. Requiere red; sin ella cae al placeholder.
- **Ojo con los `switch` sin `default`:** el fork agrega la acción `redrawActivePane`
  (Mod+Alt+L) a `TerminalShortcutAction`. Archivos nuevos de upstream que hacen switch
  exhaustivo sobre esa unión SIN `default` (hoy
  `components/dashboard-popout/preview-terminal-key-handler.ts`) rompen el typecheck
  hasta clasificar la acción del fork. El typecheck lo caza; no es opcional.
- NO se tocó el subsistema de rate-limits/cuotas (fetcher propio de cada proveedor):
  MiniMax no expone esa API, así que no aparece en el panel de uso del status bar.
- Genera conflicto menor de merge en `types.ts`/`tui-agent-config.ts` al traer upstream;
  reaplicar la entrada `minimax`.

### Para que aparezcan en el panel de Actividad/agentes (hooks)

El ícono del tab (reconocimiento por proceso) es INDEPENDIENTE del panel de
Actividad. El panel se alimenta de `agentStatusByPaneKey`, que para una sesión
lanzada a mano se llena SOLO cuando el hook de Claude de Orca hace POST al
servidor loopback. Orca instala ese hook únicamente en `~/.claude/settings.json`
(`src/main/claude/hook-settings.ts` — hardcoded, ignora `CLAUDE_CONFIG_DIR`).

Los wrappers exportan `CLAUDE_CONFIG_DIR=~/.claude-<provider>`, así que el Claude
que arrancan lee OTRO `settings.json` sin el hook → nunca postea → la sesión no
aparece en Actividad (aunque el ícono del tab sí salga). El hook es env-driven
(`ORCA_PANE_KEY` / `ORCA_AGENT_HOOK_PORT` / `ORCA_AGENT_HOOK_TOKEN`, ya inyectadas
en toda terminal de Orca), así que basta con REPLICAR sus entradas en el
`settings.json` de cada provider dir.

- Script: `scripts/fork-sync-provider-hooks.sh` — copia (idempotente,
  drift-proof) solo los hooks de Orca de `~/.claude/settings.json` a
  `~/.claude-{zai,kimi,minimax}/settings.json`, preservando los settings propios
  de cada provider. Correr tras cada update de Orca (por si cambia el set de
  hooks) y reiniciar las sesiones de wrapper para que lo tomen.
- El hook postea `agentType: 'claude'` (siempre). El fork luego lo re-etiqueta al
  wrapper real (`zai`/`kimi`/`minimax`) al agrupar por Agente vía
  `effectiveActivityAgentType` + `paneForegroundAgentByPaneKey` (ver el parche del
  panel de Actividad más abajo). Los dos arreglos se complementan: el hook lo hace
  APARECER; el override lo muestra con su nombre real.
- Limitación: solo panes locales. El foreground read (que da el nombre real) no
  corre sobre SSH, así que un wrapper remoto agruparía como Claude.

## Parche de producto: panel de Actividad (agrupar, selector, renombrar)

Tres ajustes en `src/renderer/src/components/activity/ActivityPrototypePage.tsx`:

1. **Wrappers propios (kimi/minimax/zai) aparecen en "group by Agent".** El panel
   agrupaba por `entry.agentType`, que viene del hook de Claude Code — y como los
   wrappers SON `claude` por debajo, el hook reporta `agentType: 'claude'` y todos
   caían en el mismo grupo "Claude". Fix: `effectiveActivityAgentType()` prefiere la
   identidad del proceso en foreground (`paneForegroundAgentByPaneKey`, que sí
   reconoce `zai`/`kimi`/`minimax` por `exec -a <nombre>`) cuando el hook solo conoce
   el `claude` genérico. `buildActivityEvents` recibe ese map y lo aplica en los tres
   sitios de `agentType` (live, migration-unsupported, retained).
   - Limitación: el foreground read es solo para panes LOCALES (`isTrackablePtyId`
     excluye SSH), así que un wrapper sobre SSH sigue agrupando como Claude.
   - Tests: `ActivityPrototypePage.test.ts` ("groups a Claude Code wrapper under its
     foreground process identity").
2. **El selector Status/Project/Worktree/Agent persiste.** Era `useState('status')`
   puro → se reseteaba al desmontar/montar el panel. Ahora se guarda en `localStorage`
   (`orca.activity.groupBy`) vía `readPersistedActivityGroupBy`/`writePersistedActivityGroupBy`.
3. **Renombrar la sesión desde la fila.** Doble clic en la línea del *task title* de
   una fila (`ThreadRow`) abre un input inline; Enter confirma vía
   `setTabCustomTitle(tab.id, …, { recordInteraction: true })`, Escape cancela. Reusa
   el mismo `customTitle` que ya gana en `paneTitleForEntry` (y en el tab bar).
   Copia i18n: `fork.activity.renameSession`.
   - **`ThreadRow` es de upstream y lo rediseñan seguido** (en 1.4.176 pasó a
     workspaceTitle como línea principal + taskTitle secundaria + `ActivityProjectLabel`).
     Estrategia de merge: **tomar el `ThreadRow` de upstream completo** y reaplicar
     encima solo los hooks de rename y el bloque del taskTitle. No intentar conservar
     el layout viejo del fork.
   - Upstream renderiza la línea de taskTitle solo si difiere del workspaceTitle; el
     fork la renderiza también mientras `isRenaming`, si no el rename desaparecería
     justo en las filas donde coinciden.

### Prerrequisito: los wrappers deben emitir hooks

El ícono del tab (reconocimiento por proceso) es INDEPENDIENTE de aparecer en el panel.
Ver la sección de agentes: sin `scripts/fork-sync-provider-hooks.sh` los wrappers NO
aparecen en Actividad aunque el agrupado por Agente esté bien resuelto.

## Parche de producto: sidebar — sin branch duplicado en título y subtítulo

En `src/renderer/src/components/sidebar/WorktreeCard.tsx`, sin título custom el
`displayName` se auto-siembra al branch, así que la tarjeta mostraba el branch
como TÍTULO y otra vez como SUBTÍTULO (identity) — redundante. Upstream lo hace a
propósito (test `WorktreeCard.compact-hover` esperaba 3× el branch).

- Fix: `branchMatchesVisibleTitle` (título visible === branch) apaga el subtítulo
  del branch. Un booleano único `showIdentitySubtitleInNewCard` alimenta tanto el
  render como `hasDetailedMetaRowContent` (si no, quedaba una meta-row vacía).
  También se filtra el path legacy `showBranch`.
- NO se afectan: títulos custom, títulos de PR/Linear/issue, ni el detached HEAD
  (`Detached HEAD @ <sha>`), porque todos difieren del branch — ahí el subtítulo
  sigue aportando.
- El título YA es renombrable (doble clic en la tarjeta, o el atajo
  `workspace.rename`) → se guarda en `worktree.displayName` vía `updateWorktreeMeta`.
- Conflicto de merge probable con upstream: se ajustaron 3 aserciones de tests
  upstream que fijaban la conducta redundante (`WorktreeCard.compact-hover` 3→2,
  y dos en `WorktreeCard.quick-actions` con títulos custom para desacoplarlos del
  caso de deduplicación). Al traer upstream, reaplicar la conducta del fork.

## Parche de producto: confirmación al salir (Cmd+Q)

Upstream salta a propósito el diálogo de cierre en Cmd+Q (`isQuitting`) — solo confirma
al cerrar la ventana con la X y únicamente si hay procesos locales corriendo. El fork hace
que **Cmd+Q siempre pida confirmación**, con **cancelación segura**.

- Flujo: `app before-quit` → `window 'close'` (preventDefault) → IPC `window:close-requested`
  `{isQuitting}` → el renderer muestra el diálogo → `window:confirm-close` (cerrar) o
  `window:quit-aborted` (cancelar).
- Cancelación segura: **todo** el teardown de servicios se movió de `before-quit` a
  `will-quit`, que solo corre en una salida real. `before-quit` deja solo el latch
  reversible `isQuitting=true`; `window:quit-aborted` lo limpia vía `onQuitAborted`.
  Así cancelar un Cmd+Q deja Orca 100% funcional.
  - **Invariante al mergear upstream:** si upstream agrega teardown nuevo a
    `before-quit`, hay que MOVERLO a `will-quit`. Hoy son `rateLimits.stop()`,
    `agentAwakeService`, `unsubscribeAgentAwakeStatusChanges`, y (desde 1.4.176)
    `desktopRelayService.fenceAndCloseNow()` +
    `runtimeRpc.setMobileRelayPairingProvider(null)`. Lo único que queda en
    `before-quit` es el latch y logging inocuo (`isQuittingForUpdate`).
- Archivos: `src/renderer/src/components/Terminal.tsx` (diálogo + texto condicional +
  `cancelWindowClose`), `src/preload/index.ts` + `api-types.ts` + `web/web-preload-api.ts`
  (`abortWindowClose`), `src/main/window/createMainWindow.ts` (canal `window:quit-aborted`),
  `src/main/index.ts` (teardown movido a `will-quit`).
- Desde 1.4.176 el fork ADOPTA `confirmNativeWindowClose` de upstream (dispara un
  `beforeunload` cancelable y aborta si un guard lo veta) y solo conserva su
  `proceedToNativeWindowClose` propio, que abre el diálogo siempre que
  `isQuitting || hasRunningProcesses`. No volver a despachar el `beforeunload`
  no-cancelable que tenía el fork antes: se pierde el veto de los guards.

## Parche de producto: time tracking humano (`src/main/time-tracker/`)

Feature propia del fork: reporta actividad humana (foco/idle por worktree) a un
servicio local de time tracking, para distinguir en su Timeline las sesiones de Orca
de las de VS Code (`sourceName: 'orca'`).

- Wiring: `wireTimeTracker(store)` en `src/main/index.ts`, **fuera** de
  `registerCoreHandlers` a propósito (esa función está once-guarded y con firma muy
  ancha; pasarle el tracker maximizaría los conflictos de merge).
- Flujo: el renderer (`hooks/useTimeTrackerActivity.ts`) manda pings por
  `ipcMain.on('timeTracker:activity')` (fire-and-forget, `.on` no `.handle`) →
  `buildCtx` resuelve repo/worktree/branch → `client.ts` postea al servicio.
- Servicio: `http://localhost:47321` por defecto; configurable con
  `TIME_TRACKER_BASE_URL` / `TIME_TRACKER_SERVICE_PATH` /
  `TIME_TRACKER_IDLE_MS` / `TIME_TRACKER_BLUR_GRACE_MS` / `TIME_TRACKER_HEARTBEAT_MS`.
  `service-spawn.ts` hace health-check y, si está caído, lo levanta detached.
- Si el servicio no está corriendo, TODO es un no-op silencioso: `client.ts` nunca
  rechaza. Nunca debe bloquear ni romper Orca.
- **Invariante (crash real, no teórico):** `client.ts` usa `fetch` global (undici) y solo
  lee `res.ok`. Un response body sin consumir puede **tumbar el proceso entero**
  (orca#8695), así que cada llamada hace `await cancelUnreadResponseBody(res)` antes de
  leer `res.ok`. El guard `src/main/global-fetch-call-site-audit.test.ts` lo verifica:
  al agregar o mover una llamada a `fetch` aquí hay que actualizar su conteo en
  `AUDITED_GLOBAL_FETCH_LINES` (`main/time-tracker/client.ts` → 2).
- Copias i18n nuevas usan claves `fork.terminal.quitConfirm.*` con fallback en inglés
  (`translate` cae al fallback si la clave no existe; no rompe el pipeline i18n).

## Estado upstream

- Issue original: stablyai/orca#4566 (de otro usuario, mismo problema)
- Nuestro PR: **stablyai/orca#4626** (`Fixes #4566`) — sigue **OPEN** al 2026-08-07.
- **Novedad (2026-07-20):** el maintainer `brennanb2025` tomó la rama, la rebaseó sobre
  `main` y endureció la implementación: comparte el estado git-crypt del repo (con copia
  no-clobber cuando no hay symlinks), resuelve layouts linked/separate/bare, **cubre la
  ruta del relay SSH** (que era limitación conocida nuestra) y hace rollback tanto del
  setup como del checkout. O sea: está en manos de ellos, no nuestras — no tocar la rama.
  - CodeRabbit dejó 2 warnings abiertos: que el PR no implementa el "pre-create hook"
    que pedía el issue #4566, y que el alcance creció al relay SSH. Si piden acción,
    es ahí.
- **Verificado el 2026-08-07:** upstream/main NO tiene git-crypt en `src/` (cero
  coincidencias). El fork DEBE seguir cargando el parche. No asumir que ya se mergeó
  solo porque el PR lleva meses abierto — verificar con
  `git grep -l "git-crypt" upstream/main -- src/`.
- Nota: la idea de "volver al Orca oficial y abandonar este build" quedó derogada — el
  fork es base de producto permanente (ver "Estrategia de fork de producto").

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
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run build:mac   # genera dist/mac-arm64/Orca.app
./scripts/fork-swap-app.sh                             # swap del .app en /Applications
```

`scripts/fork-swap-app.sh` (fork-only, portatil: resuelve el repo relativo a si
mismo) hace el swap con validaciones: falla si no existe el build ANTES de borrar
el .app instalado, imprime la version, y avisa si el build no lleva la firma
`Orca Fork Local Signing` (evita re-pedir permisos). Equivale al swap manual:

```bash
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

- **Firma local estable (TCC no re-pide permisos en cada rebuild).** El build dev
  se firmaba ad-hoc (`identityName=-`), y macOS liga los permisos de privacidad
  (Accesibilidad, pantalla, micrófono, automatización) al cdhash de la firma —
  que cambia en cada compilación, por eso re-preguntaba. Solución: firmar cada
  build con un certificado autofirmado **estable** de code-signing.
  - Certificado (creado una vez, vive en el llavero `login`):
    `Orca Fork Local Signing` (autofirmado, EKU Code Signing, 10 años, trust de
    usuario via `security add-trusted-cert -p codeSign`). NO requiere Apple
    Developer ni notarización.
  - Recrearlo si se pierde: `openssl req -x509` con EKU codeSigning →
    `openssl pkcs12 -export` → `security import -T /usr/bin/codesign` →
    `security add-trusted-cert -r trustRoot -p codeSign -k login.keychain`.
  - El build lo usa vía `config/electron-builder.config.cjs` →
    `identity: isMacRelease ? undefined : 'Orca Fork Local Signing'`. Compilar con
    `CSC_IDENTITY_AUTO_DISCOVERY=false` para que no busque un Developer ID.
  - Tras cambiar a la firma estable, hay que conceder los permisos UNA vez más
    (la firma nueva ≠ la ad-hoc anterior); a partir de ahí persisten entre swaps.
  - La primera firma puede abrir un diálogo del llavero ("codesign quiere usar la
    clave") → elegir **Permitir siempre**.

- **Auto-updater: neutralizado funcionalmente (parche del fork).** El build SI
  recibe el feed oficial y muestra "Update Available" — se conserva a proposito
  como NOTIFICACION de releases upstream — pero NO descarga ni instala. Flag
  unica: `src/shared/fork-build.ts` → `FORK_SELF_UPDATE_DISABLED`. Capas:
  - `src/main/updater.ts`: el flag entra como primer término del
    `autoInstallOnAppQuit` de upstream (`!FORK_SELF_UPDATE_DISABLED && …`) — nada se
    aplica al salir. Al mergear, upstream reescribe esa línea seguido; reaplicar el
    término, no restaurar la asignación vieja del fork.
  - `src/main/window/attach-main-window-services.ts`: IPC `updater:download` y
    `updater:quitAndInstall` no-opean en modo fork (limite de entrada; la logica
    core de updater.ts queda intacta para sus tests).
  - UI: `UpdateCard.tsx` (`ForkUpdateAvailableCard` + `handleUpdate` no-op) y
    `GeneralUpdateSettingsSection.tsx` (oculta "Install Update"/"Restart to
    Update", texto fork-aware).
  - **`ForkUpdateAvailableCard` es un componente APARTE, a propósito.** Antes el fork
    reescribía `SimpleCardContent` in situ, pero esa es la tarjeta de instalación de
    upstream (botón "Update", copy "is ready") — chocaba en cada merge y rompía su
    contrato de props. Hoy `SimpleCardContent` queda idéntico a upstream y el fork
    hace early-return a su propia tarjeta (solo notifica, sin botón de install).
    No volver a mezclarlas.
  - Los builds locales (`status.source === 'local'`) no llevan link de release notes:
    su versión no existe en GitHub. La tarjeta del fork respeta `isLocalBuild`.
  - Tests de upstream que asumen descarga (`updater.test.ts`,
    `updater.headless-serve-install.test.ts`, `UpdateCard.error-card.test.tsx`) están
    hechos fork-aware con `FORK_SELF_UPDATE_DISABLED`, no desactivados.
  Historico: la neutralizacion previa era SOLO el texto `ForkUpdateNotice`; el
  boton de Settings seguia descargando (de ahi el "1.4.64 is ready"). Si quedo
  algo staged, limpiar `~/Library/Caches/com.stablyai.orca.ShipIt`.
  Actualizar SIEMPRE via skill `orca-fork-update` (merge + rebuild).
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
pnpm install --frozen-lockfile          # deps NUEVAS: hacerlo ANTES de correr tests
pnpm run typecheck                      # caza los Record<TuiAgent> y switches nuevos
npx vitest run --config config/vitest.config.ts src/main/git/   # el fix de git-crypt
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run build:mac
./scripts/fork-swap-app.sh              # en una terminal FUERA de Orca
./scripts/fork-sync-provider-hooks.sh   # re-sincroniza hooks de kimi/minimax/zai
```

### Qué esperar en un merge grande (referencia: 1.4.122 → 1.4.176, 2170 commits)

- ~18 conflictos, TODOS en archivos con parches del fork. La mayoría son uniones
  triviales de imports; los caros son `Terminal.tsx`, `UpdateCard.tsx`,
  `ActivityPrototypePage.tsx` e `index.ts`.
- **Regla general:** cuando upstream reestructura un componente/función que el fork
  parchea, **tomar la versión de upstream completa y reaplicar el parche encima**, en
  vez de conservar la estructura vieja del fork. Sale más barato y evita perderse fixes
  de upstream (ej. en 1.4.176 upstream eliminó un override de `verifyUpdateCodeSignature`
  que desactivaba la verificación Authenticode — un fix de seguridad).
- **El typecheck es el mejor detector de integración**, no solo de tipos: caza los
  `Record<TuiAgent>` nuevos (`skills-cli-agent-keys.ts`) y los `switch` sin `default`
  sobre uniones que el fork extiende (`preview-terminal-key-handler.ts`).
- **Tests que fallan tras el merge, clasificados:**
  - *Mocks desactualizados* del fork (ej. upstream envolvió `addWorktree` en
    `runWithGitReadCacheInvalidation`, o agregó `timeout` a un exec) → actualizar el
    mock/aserción; es mantenimiento.
  - *Tests de upstream que asumen conducta que el fork cambia a propósito* (descargar
    updates) → hacerlos fork-aware con `FORK_SELF_UPDATE_DISABLED`, NO borrarlos.
  - *Guards de upstream que cazan un bug real del fork* → arreglar el código del fork
    (así salió el crash de undici en `time-tracker/client.ts`).
  - *Ambientales en macOS*: `config/scripts/check-root-directory-entries.test.mjs`
    falla siempre en local — su script usa `declare -A`, que necesita bash 4+ y macOS
    trae 3.2. No es del fork; el CI de upstream corre Linux. Ignorable.
  - `src/main/runtime/orchestration-cli-subprocess.test.ts` usa `out/cli/index.js`; si
    está viejo falla. Correr `pnpm run build:cli` antes.
- El commit del merge puede necesitar `--no-verify`: lint-staged intenta lintear los
  ~9000 archivos del merge y oxlint muere. Correr typecheck completo + `npx oxlint`
  sobre los archivos editados a mano ANTES de saltarse el hook.

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
