# Startup critical path — process start → first paint → FMP → interactive

Worktree: `perf/program-setup-20261013` (= `origin/main` 4abca797f + docs). Read-only static analysis; no
timings were measured (machine overloaded) — every cost below is derived from code (call counts, loop
bounds, sync/async). All line numbers are against this tree.

## 0. TL;DR

- **Already landed** (commits 69a9d4ab4 "shell-first boot (PERF-01/03)", a564ac4ee "PERF-02 skills",
  866af92df "no OAuth refresh at startup", 7a573aea1/bc775c924 spawn-env gates): the BrowserWindow is now
  created right after `whenReady` and **before** the server bootstrap (`index.ts:673-733`); the macOS login
  shell is async + cached (`index.ts:14`, `shell-env.ts:308-348`); bundled-skills sync is a stamp check
  gated on `renderer:first-paint` and runs in a worker (`index.ts:803-811`); boot connection listing uses
  `{refresh:false}` (`App.tsx:1019,1035`).
- **So first paint (splash) is no longer gated on the server.** What gates **FMP** (`renderer:fmp`,
  `App.tsx:521`, = `appState==='ready' && sessionsLoaded`) is `publishWsPort()` at **`index.ts:2021`**:
  the renderer's first WS RPC cannot be sent until it fires (`preload/bootstrap.ts:139-146,160` →
  `__await-ws-port`, `index.ts:704-709`). Everything between `index.ts:735` and `index.ts:2021` — ~1,300
  lines of serial main-process init including `bootstrapServer` → `await sm.initialize()` and
  `await messagingHandle.initializeWorkspaces()` — is therefore on the FMP critical path.
- After the port is published the renderer runs a **5-round serial RPC waterfall** (≈9 RPCs) before
  `appState='ready'`, then ≈12 more RPCs racing `getSessions` (the FMP gate), including a **cold
  synchronous `loadAllSkills`** on the server main thread (10k skills ⇒ ≥10k file reads, plus an O(N·M)
  collision loop) that is likely queued **ahead of** `getSessions`.

## 1. Main process critical path (execution order)

Legend — Gate: **W** = before `main:window-created`; **P** = before the WS port is published (⇒ before
any renderer RPC ⇒ before FMP); **F** = races FMP; **—** = after/independent. IO: D = disk, N = network,
C = child process, CPU = pure compute.

Note on ordering: the main bundle is ESM compiled by esbuild, so **all static imports (lines 1-195, ~95
import statements incl. `SessionManager` 12k LOC, `@rox/server-core/handlers/rpc`, `@rox/messaging-gateway`,
`@rox/server-core/service`, …) evaluate before the first statement of `index.ts` body**. `main:entry`
fires inside the first import (`startup-marks.ts:137`); `main:shell-env` (`index.ts:17`) is effectively
"whole main module graph evaluated" (as documented at `shared/startup-perf.ts:13`).

| # | Step | file:line | sync/async | IO | Gate | Perf mark |
|---|------|-----------|-----------|----|------|-----------|
| 1 | startup-marks import, event-loop histogram | `startup-marks.ts:137-146` | sync | — | W | `main:entry` |
| 2 | Evaluate full static import graph (~95 imports) | `index.ts:1-195` | sync | D (require) | W | (between entry and shell-env) |
| 3 | macOS shell env: delete legacy cache, read cache (`readFileSync`), apply; spawn login shell in background | `index.ts:14`, `shell-env.ts:325-348`, `:208` | sync read + async `execFile` | D, C(bg) | W (read only) | `main:shell-env` (`index.ts:17`) |
| 4 | Register spawn gate (agents await env) | `index.ts:16`, `:1323-1325` | sync | — | W | — |
| 5 | Main i18n setup + persisted language read | `index.ts:38-42` | sync | D | W | — |
| 6 | machineId sha256, `initTelemetry`, `track('app_launched')` | `index.ts:57-82` | sync (egress batched) | CPU, N(bg) | W | — |
| 7 | OEM layout probe (`existsSync`) | `index.ts:92-100` | sync | D | W | — |
| 8 | `log.initialize()` | `index.ts:198` | sync | D | W | — |
| 9 | CLI env block: ~6 `existsSync`, `readdirSync` of python toolchain dir, PATH rewrite | `index.ts:217-293` | sync | D | W | — |
| 10 | Browser-intel runtime init | `index.ts:299-303` | sync | — | W | — |
| 11 | `setName`, userData override (`mkdirSync`) | `index.ts:357-373` | sync | D | W | — |
| 12 | `setAsDefaultProtocolClient` ×2 (rox, craftagents) | `index.ts:391-396` | sync | OS (registry/LaunchServices) | W | — |
| 13 | Node-level proxy apply (not awaited) | `index.ts:400` | async | D | — | — |
| 14 | `registerThumbnailScheme` (only privileged scheme) | `index.ts:404`, `thumbnail-protocol.ts:107` | sync | — | W | — |
| 15 | Single-instance lock | `index.ts:424-458` | sync | OS lock | W | — |
| 16 | Visible-home migration (`runVisibleHomeBoot`) | `index.ts:465-481` | sync | D | W | — |
| 17 | `app.whenReady()` | `index.ts:631` | async | — | W | — |
| 18 | Entities flag durable copy load + IPC | `index.ts:640-654` | sync | D | W | — |
| 19 | mark app-ready; renderer-mark IPC | `index.ts:656-664` | sync | — | W | `main:app-ready` |
| 20 | `setBundledAssetsRoot` | `index.ts:671` | sync | — | W | — |
| 21 | `new WindowManager`, 5 preload IPC handlers (`__get-*`, `__await-ws-port`, `__project-authority:resolve`) | `index.ts:685-725` | sync | — | W | — |
| 22 | `createInitialWindows`: `loadWindowState` (D), `getWorkspaces` (D), first-run workspace seed | `index.ts:484-580` | sync | D | W | — |
| 23 | `new BrowserWindow({show:false})`, `loadFile(renderer/index.html)` (`file://`, no V8 code cache) | `window-manager.ts:248-290,451` | sync create, async load | D | **W ends** | `main:window-created` (`window-manager.ts:290`) |
| 24 | Application menu | `index.ts:730` | sync | — | P | — |
| 25 | **Windows only**: `await initializeWindowsBootstrap` (cached, parallel `--version` probes on miss; repair deferred to first paint) | `index.ts:735-771` | async | D, C (on cache miss) | **P** | `main:win-bootstrap:start/end` |
| 26 | `await tryRestoreVaultFromBackup` → vault init, **`pbkdf2Sync` 100k iters** (once) | `index.ts:774-782`, `secure-storage.ts:125,643` | async wrapper, sync KDF | D, CPU | **P** | — |
| 27 | `initializeBackendHostRuntime`, PowerShell validator root | `index.ts:784-794` | sync | D | P | — |
| 28 | `initializeDocs()` (seed) | `index.ts:797` | sync | D | P | — |
| 29 | Skills: claim + `resolveBundledSkillsTarget()` (config read); real work after `renderer:first-paint` | `index.ts:803-811`, `bundled-background.ts:151-170` | sync claim, async job | D (small) | P (claim only) | `main:skills-sync:start/end/inline` |
| 30 | `initializeReleaseNotes`, `ensureDefaultPermissions`, `ensureToolIcons`, `ensurePresetThemes` (first-run copies; existence checks after) | `index.ts:814-823` | sync | D | P | — |
| 31 | `registerThumbnailHandler` | `index.ts:826` | sync | — | P | — |
| 32 | `await applyConfiguredProxySettings()` (Electron session proxy) | `index.ts:830` | async | D | **P** | — |
| 33 | Renderer session policy, dock icon (`nativeImage.createFromPath`), badge | `index.ts:834-865` | sync | D | P | — |
| 34 | OpenDesign runtime + IPC | `index.ts:872-880` | sync | — | P | — |
| 35 | Notifications, BrowserPaneManager | `index.ts:890-896` | sync | — | P | — |
| 36 | 3× `await import()` voice modules + overlay host | `index.ts:898-924` | async | D | P | — |
| 37 | Meetings, local meetings, mail, telegram-link, Google calendar, Apple calendar IPC | `index.ts:925-954` | sync | D | P | — |
| 38 | `createElectronPlatform`, storage/diagnostics IPC, `__telemetry-config` handler | `index.ts:957-1010` | sync | — | P | — |
| 39 | `await import('./surface-routes-ipc')`, dialog/file IPC | `index.ts:1041-1142` | async | — | P | — |
| 40 | Native replica IPC (`realpathSync(CONFIG_DIR)`) | `index.ts:1146-1150` | sync | D | P | — |
| 41 | Windows: `await validateGitBashPath` (stat), `checkVCRedistInstalled` (existsSync) | `index.ts:1154-1181` | async/sync | D | P | — |
| 42 | `await import('./power-manager')`, WorkGraph kernel, OpenClaw security composition + IPC | `index.ts:1184-1261` | async/sync | — | P | — |
| 43 | `await import('@rox/shared/config')`, `getServerConfig()`, optional TLS `readFileSync` | `index.ts:1264-1290` | async/sync | D | P | — |
| 44 | **`await bootstrapServer(...)`** ↓ | `index.ts:1302-1510` | async | — | **P** | — |
| 44a | apply platform; `bootstrapConfigArtifacts` (ensureConfigDir, `ensureContextDocs`, toolchain `ensureAll` fire-and-forget) | `headless-start.ts:531-533,435-462` | sync (+bg) | D, N/C(bg) | P | — |
| 44b | `ensureGlobalConfigExists`, `acquireServerLock` (read/write lock file, PID probe) | `headless-start.ts:534-535,362-410` | sync | D | P | — |
| 44c | State writer lock + **`openStateStore` (SQLite create + migrate)** | `headless-start.ts:540-548` | sync | D | P | — |
| 44d | `initModelRefreshService`, `new SessionManager`, visitor access, hooks ingress | `headless-start.ts:550-583` | sync | — | P | — |
| 44e | `realpathSync`, `NativeAuthority`, `NativeJournal`, `CollaborationSyncService` | `headless-start.ts:591-619` | sync | D | P | — |
| 44f | `new WsRpcServer`, **`await wsServer.listen()`** | `headless-start.ts:621-664` | async | net bind | P | — |
| 44g | `await startNativeSidecar` (only if enabled) | `headless-start.ts:667`, `native/supervisor.ts:251-259` | async | C | P | — |
| 44h | `createHandlerDeps` (pocket accounts, browser creds, **messaging bootstrap**, drive) | `headless-start.ts:674`, `index.ts:1355-1460` | sync | D | P | — |
| 44i | `registerAllRpcHandlers` (+ clipboard monitor) | `headless-start.ts:690`, `index.ts:1463-1474` | sync | — | P | — |
| 44j | **`await sm.initialize()`** ↓ | `headless-start.ts:694`, `SessionManager.ts:3024-3060` | async | — | **P** | — |
| 44j-1 | LLM config migrations, `seedDefaultLlmConnection`, `migrateLegacyCredentials` | `SessionManager.ts:3027-3037` | async | D | P | — |
| 44j-2 | **`reinitializeAuth()` → `getValidClaudeOAuthToken` refreshes an expired Anthropic OAuth token over the network** | `SessionManager.ts:3040,2990`, `auth/state.ts:232-238` | async | D, **N (if expired)** | **P** | — |
| 44j-3 | Per workspace `setupConfigWatcher`: builtin MCP seed, load/save workspace config, `ConfigWatcher.start` (recursive `fs.watch`, `scanSources`, **`scanSkills` = 1 `statSync` per skills entry**, `scanAppThemes`), `recoverAutomationOccurrences`, `new AutomationSystem` | `SessionManager.ts:3046-3049,2179-2370`, `watcher.ts:269-328,747-753` | sync | D | **P** | `perf.span('configWatcher.start')` (debug only) |
| 44j-4 | `loadSessionsFromDisk`: per workspace headers projector or full `listStoredSessions` scan; per session `createManagedSession` + `resolveSessionConnection` | `SessionManager.ts:3052,3063-3128,1495-1504` | sync | D | **P** | — |
| 44k | `modelRefreshService.startAll()`, `scheduleBundledSkillsSync` (joins in-flight job) | `headless-start.ts:696-700` | sync start, async work | N(bg) | P | — |
| 45 | mark server-ready | `index.ts:1512` | — | — | — | `main:server-ready` |
| 46 | Node-mode coordinator (opt-in) | `index.ts:1526-1543` | async | — | — | — |
| 47 | **`await messagingHandle.initializeWorkspaces(localWorkspaceIds)`** | `index.ts:1555-1578` | async | D (+workers if enabled) | **P** | — |
| 48 | ~400 lines of IPC registration (workspace, SSH, cross-server, project authority, TLS enrollment, server config, `__get-ws-port`, `__resolve-local-ws-token`) + 2 dynamic imports (`./ssh-tunnel/ipc`) | `index.ts:1583-1980` | sync (+async imports) | — | P | — |
| 49 | Event sinks; `await import('./menu')`, `await import('./notifications')` | `index.ts:1982-1986` | async | — | P | — |
| 50 | Quick composer (global shortcut), dock menu | `index.ts:1991-2017` | sync | OS | P | — |
| 51 | **`publishWsPort(instance.port)`** → renderer RPCs unblocked | `index.ts:2021`, `:339-343` | sync | — | **P ends** | `main:ws-port-handed` (on hand-off, `index.ts:707/1756`) |
| 52 | Service manager: `await import('./auto-update')`, **`await serviceManager.getStatus()`** (launchctl runner), onboarding decision | `index.ts:2028-2093` | async | C | F (main loop) | — |
| 53 | Tray + 30 s status poll | `index.ts:2114-2150` | async | C | F | — |
| 54 | `await credentialManager.checkHealth()` | `index.ts:2166-2178` | async | D | F | — |
| 55 | `await initPowerManager()` | `index.ts:2183-2184` | async | — | — | — |
| 56 | `checkForUpdatesOnLaunch()` (packaged) | `index.ts:2220-2223` | async | N | — | — |
| 57 | Skills stamp check (+ worker merge on mismatch) after `renderer:first-paint` | `bundled-background.ts:170-203` | async (worker) | D | — | `main:skills-sync:*` |
| 58 | Windows bootstrap repair after first paint (if needed) | `index.ts:753-770` | async | C | — | — |

## 2. Renderer path

### 2.1 Entry graph

- `index.html:5` CSP (allows `file:`, `thumbnail:`), inline CSS spinner `#_loader` (`index.html:21-33`) — the
  true first pixels are this static loader, painted once `ready-to-show` reveals the window
  (`window-manager.ts:310-336`).
- `bootstrap.ts`: polyfills, `installStaleChunkReload`, two localStorage migrations, then
  **`await preloadRendererLocales()` → `import('./main')`** (`bootstrap.ts:37-43`) — a serial
  fetch-then-evaluate step, mitigated by `<link rel="modulepreload">` (`vite.config.ts:173-211`).
- `main.tsx`: `./lib/startup-perf` first (`renderer:script-start`, `startup-perf.ts:155`), then **static**
  `App` (3,060 LOC) and ~25 other static imports (`main.tsx:1-28`). Boot manifest: **48 boot chunks /
  2,255 source modules** in the startup closure (`boot-manifest.json`, `bootChunks`, `bootSources`).
  Lazy: QuickComposer (`main.tsx:216`), onboarding runtime default (`App.tsx:1015`), browser preview.
- `createRoot().render()` + `markFirstPaintAfterCommit()` (`main.tsx:221-238`). With `appState==='loading'`
  `App` returns `<SplashScreen/>` (`App.tsx:2699-2701`) ⇒ **`renderer:first-paint` = splash**, not data.

### 2.2 Synchronous IPC during preload/module eval (each blocks the renderer until main's loop is free)

`preload/bootstrap.ts`: `__get-web-contents-id` (`:77`), `__get-ws-port` (`:139`, unanswered on a
shell-first boot because the listener is only registered at `index.ts:1748`), `__get-workspace-id`
(`:148/151`), `__get-local-client-proof` (`:152`), `__get-workspace-remote-config` (`:193`),
`__telemetry-config` (`:670`; handler registered late at `index.ts:1008`, after awaits at
`index.ts:748,774,830,898`); plus `entities:syncLinksState` (`:750`) from `seedEntitiesLinksGate()`
(`main.tsx:206`) and one more `__get-workspace-id` per connect in `resolveTarget` (`:159`).
**Total: 7 `sendSync` before the first render**, then async `__await-ws-port`, `__resolve-local-ws-token`,
`__project-authority:resolve` (`:143,163,207`).

### 2.3 RPCs issued before FMP (`renderer:fmp`)

Module eval (before first render): `getShellSnapshot` (`render-profile-dom.ts:49` →
`shell-appearance-subscription.ts:20`), `changeLanguage` IPC (`main.tsx:56`),
`getGamificationProfile` (`main.tsx:90`), IndexedDB restore of the query cache (`main.tsx:210`).

`App` initialize effect (`App.tsx:933-1096`) — **serial rounds, all queued until `publishWsPort`**:

| Round | RPCs | file:line |
|------|------|-----------|
| 1 (parallel) | `getWindowWorkspace`, `getOrgIdentity`, `getRoxCloudState` | `App.tsx:953-957` |
| (retry) | `waitForTransportConnected` (≤12 s) + re-reads if round 1 failed | `App.tsx:966-985` |
| 2 (local authority) | `getSetupNeeds` | `App.tsx:994` |
| 3 | dynamic import + `ensureRoxRuntimeDefault` → `listLlmConnectionsWithStatus({refresh:false})` | `App.tsx:1015-1022`, `rox-runtime-default.ts:83` |
| 4 (only if 3 didn't read) | `listLlmConnectionsWithStatus({refresh:false})` | `App.tsx:1035` |
| 5 (parallel) | `getOrgIdentity`, `getWindowWorkspace`, `getRoxCloudState` (re-validation) | `App.tsx:1044-1048` |

⇒ **≥4 serial round-trips, 8-9 RPCs to reach `appState='ready'`** (`App.tsx:1078`).

Ready commit (same React commit mounts `AppShell` under the splash, `App.tsx:2866`; child effects run
before parent effects):

- `AppShell`: `getSources` (`AppShell.tsx:1212`), **`getSkills`** (`AppShell.tsx:1655`) → server
  `loadAllSkills(..., {includeOmp:true, includeShadowedOmp:true})` (`rpc/skills.ts:81`) — synchronous;
  cold cache at launch (`storage.ts:350-351,480-483`); reads OMP + global + app-managed + workspace +
  project skill dirs; collision check `workspaceSkills.some(...)` inside the app-skills loop
  (`storage.ts:532-534`) is O(N_app·N_ws). Blocks the main event loop (= the WS server) while it runs.
- `App` (`App.tsx:416-428`): `getOrgIdentity`, `getWindowWorkspace` (personal-task scope).
- `App` (`App.tsx:1129-1174`): `getWorkspaces`, `getNotificationsEnabled`, **`getSessions`**
  (`App.tsx:682,1153` — the FMP gate via `setSessionsLoaded`, `App.tsx:719`), `getAllDrafts`, `getAppTheme`;
  `getSystemWarnings` is preload-local.
- `App` (`App.tsx:1194-1198` → `refreshLlmConnections` `App.tsx:855-884`): `getOrgIdentity`,
  **`listLlmConnectionsWithStatus()` with the default `refresh:true`** (`llm-connections.ts:162,658`),
  `getWorkspaceSettings`.

**Count before FMP: ≈24 WS RPCs + 7 `sendSync` + 3 IPC invokes, ≥5 serial round-trips**, with
`getSkills` likely ahead of `getSessions` in the server's queue.

## 3. Existing instrumentation

Defined in `apps/electron/src/shared/startup-perf.ts:10-37`; recorded by `startup-marks.ts` (ring buffer
256, `performance.mark`, `globalThis.__roxStartupPerf`, one `[perf] startup …` line + `ROX_PERF_OUT` JSON
with `ROX_PERF=1`, `startup-marks.ts:99-124`); consumed by `apps/electron/scripts/perf/startup-bench.ts:75-82`.

| Mark | Emitted at |
|------|-----------|
| `main:entry` | `startup-marks.ts:137` |
| `main:shell-env` | `index.ts:17` |
| `main:app-ready` | `index.ts:656` |
| `main:window-created` | `window-manager.ts:290` |
| `main:win-bootstrap:start/end` | `index.ts:736,749` |
| `main:server-ready` | `index.ts:1512` |
| `main:ws-port-handed` | `index.ts:707` (async path), `index.ts:1756` (sync path) |
| `main:skills-sync:start/end/inline` | `index.ts:805,809,808` |
| `renderer:script-start` | `renderer/lib/startup-perf.ts:155` |
| `renderer:first-paint` | `startup-perf.ts:89-91` ← `main.tsx:238` |
| `renderer:fmp` | `startup-perf.ts:94-97` ← `App.tsx:521` |
| `renderer:interactive:<appState>` | `App.tsx:525` (fires when leaving `loading`, i.e. *before* FMP) |
| `nav:*` | `startup-perf.ts:107-128` (forwarded only with `ROX_PERF=1`) |

Budgets: window-created 300/500 ms, FMP 800/1500 ms (darwin/win), bench report-only
(`startup-perf.ts:69-84`). **Gaps**: no marks for credential vault (row 26), `sm.initialize` and its
sub-steps (44j-1…4), messaging init (47), `publishWsPort` itself (51), renderer `appState='ready'`, or
`getSessions` round-trip — the 44→51 span is opaque in the timeline. `configWatcher.start` spans
(`watcher.ts:274`) only log in debug mode.

## 4. Per-issue status

### #1561 — Skills sync: fingerprint short-circuit, worker, after first paint
- **Done**: build-time fingerprint / stat stamp (`bundled-fingerprint.ts:69-89`, `bundled-core.ts`
  `isBundledSkillsSyncCurrent`); gate on `renderer:first-paint` (`index.ts:805`); worker
  (`bundled-background.ts:61-82`, `index.ts:804`); double call removed — headless joins the in-flight job
  (`bundled-background.ts:152`, `headless-start.ts:479-493`); CHANGED events (`headless-start.ts:485-487`);
  agents wait ≤10 s only on stamp miss (`bundled-background.ts:120-131`, `index.ts:1324`).
- **Still on the critical path**: only `resolveBundledSkillsTarget()` (config read) at claim time
  (`bundled-background.ts:163`, row 29) — negligible.
- **Remaining**: (a) unstamped/dev bundles walk + `lstatSync` ~5.7k files on the **main thread** after
  paint (`bundled-fingerprint.ts:84-87` via `bundled-background.ts:186`) — move into the worker;
  (b) inline fallback still runs the full merge on main (`bundled-background.ts:202`); (c) the post-sync
  broadcast does a synchronous `loadAllSkills` per local workspace on main (`headless-start.ts:486`);
  (d) bench evidence for the acceptance criteria, then close.

### #1562 — Non-blocking platform environment
- **Done**: macOS cache-first apply + background capture + spawn gate (`index.ts:14-17`,
  `shell-env.ts:308-348`, `index.ts:1323-1325`); Windows cached parallel probes, `bootstrap.ps1` only in
  background after first paint with backoff + spawn gate (`index.ts:747-770`,
  `windows-bootstrap.ts:102-116`).
- **Still on the critical path (Windows)**: `await initializeWindowsBootstrap` sits between window
  creation and `bootstrapServer` (`index.ts:748`), so on a probe-cache miss the child-process probes delay
  `publishWsPort` ⇒ FMP. `validateGitBashPath`/`checkVCRedistInstalled` (`index.ts:1154-1181`) are cheap
  stat/existsSync but also serial before the server.
- **Remaining**: start the Windows read concurrently with `bootstrapServer` (only spawns await it);
  macOS: nothing material (sync cache read + legacy unlink, `shell-env.ts:325-329`).

### #1563 — Boot path without network (LLM connections without OAuth refresh)
- **Done**: `{refresh:false}` + background refresh + `llmConnections.CHANGED`
  (`llm-connections.ts:162-197,654-738`); boot callers use it (`App.tsx:1019,1035`,
  `rox-runtime-default.ts:83`); duplicate listing on ready skipped (`App.tsx:1070-1076,1155-1158`).
- **Still on the critical path**: (1) `refreshLlmConnections` (`App.tsx:873`) calls
  `listLlmConnectionsWithStatus()` with default `refresh:true` and fires at boot from the
  `windowWorkspaceId` effect (`App.tsx:1194-1198`) right after `setWindowWorkspaceId` (`App.tsx:1068`) ⇒
  per-OAuth-connection vault read + possible network refresh racing FMP; same at `App.tsx:1159` when not
  pre-published. (2) **Server side, outside the issue's current scope**: `sm.initialize()` →
  `reinitializeAuth()` → `getValidClaudeOAuthToken` performs a network refresh for an expired default
  Anthropic OAuth connection (`SessionManager.ts:3040,2990`; `auth/state.ts:232-238`) **before
  `publishWsPort`** (`headless-start.ts:694` → `index.ts:2021`).
- **Remaining**: pass `{refresh:false}` in `refreshLlmConnections` (or skip it on the boot commit); make
  `reinitializeAuth` at boot use the stored token without refresh and refresh after paint.

### #1572 — Paint-first boot: snapshot, async handshake, StartupScheduler
- **Done (via PERF-01 69a9d4ab4)**: window created right after `whenReady` + lock (`index.ts:673-733`);
  async port hand-off `__await-ws-port` (`index.ts:704-709`, `preload/bootstrap.ts:139-146`).
- **Not done**: no `StartupScheduler` / lanes, no `boot-snapshot.json`, no `boot:snapshot` /
  `bootstrap:snapshot` RPC, no `module.enableCompileCache()` (0 matches in repo). Preload still has
  **7 `sendSync`** (§2.2; target 0). The `App.tsx:933-1096` waterfall remains (≥4 serial rounds, 8-9
  RPCs; target ≤2 RPCs pre-paint). Server "listen first" is only nominal: `listen()` happens at
  `headless-start.ts:664`, but the port is published after `sm.initialize()` (44j), messaging init
  (`index.ts:1566`) and ~400 lines of IPC registration (`index.ts:1580-2021`). Messaging gateway, credential
  health, power manager, service status, model refresh are not deferred to an afterPaint lane
  (`index.ts:1566,2076,2170,2184`, `headless-start.ts:696`).
- **Remaining**: essentially the whole issue minus window-first.

### #1573 — V8 code cache (app:// scheme) and main compile cache
- **Done**: nothing. Renderer still `loadFile` → `file://` (`window-manager.ts:451,453,467,487`); the
  only privileged scheme is `thumbnail` without `codeCache` (`thumbnail-protocol.ts:107-118`); no
  `enableCompileCache`. Electron is `^44.7.0` (`package.json:162`), so the `codeCache` privilege is
  available. Note `registerSchemesAsPrivileged` may be called once — `app` must join the thumbnail call.
- **Remaining**: whole scope — `app://` + `codeCache:true`, `protocol.handle` for renderer assets, CSP
  (`index.html:5` `file:` img-src/object-src) and `isTrustedRoxRendererUrl` (`index.ts:584-604`, checks
  `file:`), device-diagnostics path (`index.ts:984`), plus main compile cache.

## 5. Ranked changes (expected time saved on the FMP/interactive path)

Estimates are qualitative (no measurement possible here); rank = (size of serial span removed) × (how
many launches pay it).

1. **Publish the WS port immediately after `listen()` + handler registration; move `sm.initialize()`
   behind `initGate`** (`headless-start.ts:694` → background; `index.ts:2021` → right after
   `bootstrapServer` returns, before `index.ts:1555`). Handlers already wait on `initGate`
   (`SessionManager.ts:3055`). Removes 44j (migrations, auth, per-workspace watchers + `scanSkills`
   statSync, session scan) and messaging init from the pre-RPC span; lets the 5-round renderer
   waterfall overlap server init. **Largest win: every launch, scales with workspaces × sessions × skills.**
2. **Move the ~1,000 lines of pre-server main init (`index.ts:735-1300`) behind the bootstrap or into an
   afterPaint lane** — vault PBKDF2 (`index.ts:774`, ~100k-iter sync KDF), proxy apply (`:830`),
   voice/meetings/mail/calendar/OpenClaw/WorkGraph wiring (`:898-1261`), Windows bootstrap (`:748`). Start
   `bootstrapServer` right after window creation; register non-critical IPC lazily. **Every launch; tens
   to hundreds of ms of main-loop time; seconds on Windows probe-cache miss.**
3. **Collapse the renderer boot waterfall into one `bootstrap:snapshot` RPC (#1572)** (`App.tsx:933-1096`)
   and drop the final re-validation round (`App.tsx:1044-1048`) in favour of an epoch. 4-5 serial
   round-trips → 1, ≈9 RPCs → 1. **Every launch; each round is gated by a busy main loop.**
4. **Defer `getSkills`/`getSources` until after FMP and make `loadAllSkills` cheap**
   (`AppShell.tsx:1212,1655`; `rpc/skills.ts:81`; `storage.ts:532-534` O(N·M) → `Set` lookup; scan in a
   worker or cache on disk; `watcher.ts:747-753` → `readdirSync({withFileTypes:true})`). With 10k skills
   this is ≥10k file reads synchronously on the WS thread, likely queued before `getSessions`.
   **Directly addresses the owner's 10k-skills complaint; large on big skill sets.**
5. **Remove the network from the pre-port path**: boot `reinitializeAuth` without refresh
   (`SessionManager.ts:2990`) and `refresh:false` in `refreshLlmConnections` (`App.tsx:873`). **Up to
   network RTT/timeout (seconds) on launches with an expired OAuth token.**
6. `app://` + V8 code cache for the 48-chunk / 2,255-module startup graph (#1573,
   `window-manager.ts:451`), and `module.enableCompileCache()` for the ~95-import main graph (rows 2). **Warm
   starts; issue targets ≥30 % script-eval reduction.**
7. Replace the 7 preload `sendSync` with one async `invoke('server:ready')` returning
   `{port, proof, workspaceId, remoteConfig, telemetry, entitiesState}` (`preload/bootstrap.ts:77-193,670,750`).
   Each sync call stalls the renderer behind whatever the main loop is doing (rows 25-50).
8. Add the missing marks (vault, `sm.initialize` sub-steps, messaging, `publishWsPort`, renderer
   `ready`, `getSessions` RTT) so the 44→51 span is measurable before/after 1-5.
