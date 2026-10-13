# ROX desktop: process/thread map and main-loop blockers

Baseline: `perf/program-setup-20261013` (= origin/main `4abca797f` + docs). Read-only static analysis; no
profiling was run. Costs are estimated as entity count × synchronous syscalls (or CPU work) per entity.
Epic: rox-one/rox-one#1596 (children #1560–#1591).

**Short version.** Almost everything runs on one thread: the Electron main process. `server-core`
(629 `server.handle(RPC_CHANNELS…)` registrations, plus 74 `ipcMain.handle/on` in `apps/electron/src/main`)
runs in-process. The worst post-startup blockers are synchronous whole-collection rescans that RPCs trigger:
session import, the notes vault index, and the skills catalog. These are O(N) or O(N×M) synchronous file
reads with no yield points. Only two `worker_threads` exist, and each is one-shot. There is no pool, no
task queue and no concurrency limiter.

---

## 1. Process/thread inventory

| # | Process / thread | Spawned at | What runs there | Communication |
|---|---|---|---|---|
| 1 | **Electron main process (Node event loop)** | `apps/electron/src/main/index.ts` | Window/menu/tray; `bootstrapServer` in-process (`index.ts:1302`), `new SessionManager()` (`index.ts:1340`), all core RPC handlers (`index.ts:1464` → `registerCoreRpcHandlers`), extra handlers (`index.ts:1900-1922`), messaging gateway (`index.ts:1405-1428`); ConfigWatcher per workspace (`SessionManager.ts:2353`, recursive `fs.watch` of the whole workspace at `packages/shared/src/config/watcher.ts:421` and config dir at `:396`); skills discovery (`packages/shared/src/skills/storage.ts:466`); notes vault index (SQLite, `packages/server-core/src/knowledge/vault-index.ts`); session projection SQLite (`server-core/src/state/sessions-projection.ts`); ripgrep search orchestration (`server-core/src/services/search.ts:261`); OMP RPC stdout parsing (`packages/shared/src/agent/omp-rpc-transport.ts:65,111`); browser panes control (`browser-pane-manager.ts:442-485`); thumbnail protocol (`thumbnail-protocol.ts:73,88`); local embeddings (`server-core/src/memory/episodic-memory.ts:133-136`); 27 `setInterval` timers (e.g. foreign auto-import every 15 min `session-foreign-auto-import.ts:25-26`, browser-data auto-import `browser-data-auto-import.ts:141`, memory idle 60 s `MemoryService.ts:441`, tray 30 s `index.ts:2144`, transport heartbeats `transport/server.ts:1625`) | WebSocket RPC server (`ws`, `transport/server.ts:10,847,863`) on 127.0.0.1 to the preload's `WsRpcClient` (`apps/electron/src/preload/bootstrap.ts`, `apps/electron/src/transport/client.ts`); `ipcMain` for desktop-only calls |
| 2 | **Renderer: main window(s)** | `window-manager.ts:248`, `index.ts:1112,1217,1993` | React UI (`apps/electron/src/renderer`). **No web workers**: no `new Worker` in `apps/electron/src/renderer` or `packages/ui/src`. Markdown/Shiki run on the UI thread (#1590). Only `SessionList` opts into windowing (`SessionList.tsx:1491`). `SkillsListPanel` renders every skill through `EntityPanel` (`SkillsListPanel.tsx:363-364`) with no `virtualize` (#1578) | WS RPC (JSON envelopes) through the preload; `contextBridge` |
| 3 | Renderer: browser panes | `WebContentsView` in `browser-pane-manager.ts:442,460,471,485,2293-2314` | Web pages, plus toolbar preload (`dist/browser-toolbar-preload.cjs`) | Electron IPC; CDP (`browser-cdp.ts`) |
| 4 | Renderer: auxiliary windows | `page-thumbnailer.ts:112` / `page-thumbnail-host.ts:40` (offscreen thumbnails), `open-design-window.ts:41`, `voice/overlay-owner.ts:93` | Page thumbnails, Open Design, voice overlay | IPC |
| 5 | **worker_thread: bundled-skills merge** | `packages/shared/src/skills/bundled-background.ts:64`; entry `bundled-sync.worker.ts` → `dist/bundled-skills-worker.cjs` (`index.ts:803-804`) | One-shot hash-merge of the bundled skill packs (~5.7k files / ~95 MB, `bundled-background.ts:4-5`) after first paint. If the script is missing it falls back to **inline on main** (`:189-202`) | `workerData` in, one `postMessage` result out (`bundled-sync.worker.ts:13`) |
| 6 | **worker_thread: browser-intel unfurl** | `packages/browser-intel/src/workers/unfurlWorker.ts:249`, host `apps/electron/src/main/browser-intel/index.ts:145-177`; entry `browser-intel/worker.ts` → `dist/browser-intel-worker.cjs` | URL unfurl loop on its own SQLite handle (opened by path, `worker.ts:20-35`). Runs 30 s after start, then every 6 h (`browser-intel/index.ts:46-47`) | `workerData` plus progress/done/error messages; `abort` message inward (`worker.ts:40-42`) |
| 7 | **utilityProcess: Extension Host** (one per workspace) | `extension-host-manager.ts:217` (`utilityProcess.fork`), `:835` | craft-sandbox extension modules, with a scrubbed env (`extension-host/protocol.ts:84`) | `stdio:'pipe'` plus a message protocol (`extension-host/protocol.ts:14`); 5 s RPC timeout |
| 8 | Child: **OMP agent per session** | `packages/shared/src/agent/omp-agent.ts:1036` (`--mode rpc` at `:934`); a second spawn at `:2785` | Agent runtime | stdin/stdout JSON lines, parsed on main (`omp-rpc-transport.ts:65,111`) |
| 9 | Child: Pi agent server | `packages/shared/src/agent/pi-agent.ts:508` | Pi SDK sessions | stdio |
| 10 | Child: Claude Agent SDK `claude` binary | spawned by the SDK (`claude-agent.ts:877-890`) | Claude sessions | SDK stdio |
| 11 | Child: MCP stdio servers | `packages/shared/src/mcp/client.ts:10,138` (`StdioClientTransport`); builtin MCP `server-core/src/sources/builtin-mcp-startup.ts:150` | Source tools | MCP JSON-RPC over stdio, via `McpClientPool` |
| 12 | Child: WhatsApp / Discord workers | `messaging-gateway/src/adapters/whatsapp/index.ts:162`, `discord/index.ts:167` (`ELECTRON_RUN_AS_NODE`) | Baileys / discord.js | Framed stdout (`whatsapp/index.ts:167-172`) |
| 13 | Child: login-shell env probe | `apps/electron/src/main/shell-env.ts:240` (async `execFile`) | `$SHELL -l -i -c env` | stdout |
| 14 | Child: git | **sync** `execFileSync` in `packages/shared/src/git/exec.ts:35`, `git/workspace.ts:53,58` | status / branch / diff / config | blocks main until exit (timeout 5 s, `exec.ts:8`) |
| 15 | Child: ripgrep | `server-core/src/services/search.ts:261` (async `spawn`) | Search | stdout stream |
| 16 | Child: misc. | calendar helper `calendar/register-helper.ts:80`, local ASR `meetings/local-asr.ts:86`, ssh tunnel `ssh-tunnel/ssh-tunnel.ts:155`, OpenClaw `server-core/src/openclaw/runtime-manager.ts:437`, credential probes **sync** `credentials/backends/secure-storage.ts:143-177,261-269`, codesign **sync** `auto-update.ts:92,98`, Windows `reg` **sync** `network-proxy.ts:94` | — | stdio |
| 17 | Native threads inside main | libuv pool (async fs, crypto, zlib); onnxruntime intra-op threads for embeddings (`episodic-memory.ts:133`) | — | — |
| 18 | Headless server (alternative host) | `server-core/src/bootstrap/headless-start.ts` | Same `server-core` on one Bun/Node loop; bundled-skills sync **always inline** (no `workerScript`, `headless-start.ts:480-482`) | WS RPC |

There is no hardware-aware sizing anywhere. Only `render-profile.ts:52-67` reads `os.cpus()`/`os.totalmem()`, and
it uses them only to pick the render profile (weak = <7.5 GB or ≤4 cores, `shared/render-profile.ts:57-59`).
There is no `availableParallelism` call and no battery or thermal signal (no `powerMonitor.isOnBatteryPower`
in `apps/electron/src/main`).

---

## 2. Main-loop blockers after startup (ranked)

"Sync" means the whole operation runs inside one macrotask: `fs.*Sync`, synchronous SQLite, or `execFileSync`.
`async` handlers whose body has no real `await` still block until they return.

| Rank | Offender (file:line) | Trigger: RPC / event | Frequency | Cost model |
|---|---|---|---|---|
| 1 | **Foreign session import batch**: `server-core/src/handlers/rpc/session-foreign-import.ts:87-122` (cap `MAX_FOREIGN_PERSIST = 5_000`, `:32`) → `persistForeignSession` (`shared/src/sessions/import-persist.ts:150`) | `sessions.FOREIGN_PERSIST` (user import); the same path from auto-import (`session-foreign-auto-import.ts:204-237`, 20 s after start then every 15 min, yields per item at `:237`) | per import | Per item: sync read and per-line `JSON.parse` of the transcript (`import-convert.ts:60-64,166`); `sha256(JSON.stringify(messages))` (`import-persist.ts:79`); on a ledger miss, `findPersistedSource` **reads and parses every previously imported session** (`import-persist.ts:82-88,131-140`) → **O(N×S)**. Then `ingestImportedSession` per result (`SessionManager.ts:3559-3575`) recomputes the projection cookie (readdir plus S `statSync`, `sessions-projection.ts:149-160`) and, when stale, runs a full `listStoredSessions` → O(N×S) again. The RPC loop has **no yield**. N=5,000 imports into a workspace with S=2,000 sessions ≈ 10⁷ stats, plus N full transcript parses |
| 2 | **Notes: `ensureVaultIndex` on every read**: `server-core/src/handlers/rpc/notes.ts:726-757,790` → `vault-index.ts:659-697` → `rebuildInto` `:605-633` | `notes.LIST`, `notes.SEARCH`, `notes.GET_BACKLINKS` (also reached via `listNotes` in rename/create at `notes.ts:824,1018`) | every note-list/search/backlinks call, i.e. every switch into Notes | Recursive `readdirSync` of the vault (`:410-445`); `statSync` + `SELECT` per note (`:548-561`). Then `reindexNamedEntities` **unconditionally deletes all entities and `readFileSync`s every note** to re-extract entities (`:458-485`), even when nothing changed. Bounds: `MAX_NOTES = 4_000`, `MAX_NOTE_BYTES = 2 MB` (`:48-49`), so up to 4,000 file reads plus regex extraction in one sync SQLite transaction per call (#1574) |
| 3 | **Skills catalog walk**: `shared/src/skills/storage.ts:466-553` | `skills.GET` (`handlers/rpc/skills.ts:63-85`, `includeOmp`); post-mutation broadcast (`skills.ts:56-60`); ConfigWatcher skills-dir change (`config/watcher.ts:780-817`); `onSkillChange` → full reload (`SessionManager.ts:2292-2297`); every user message `extractSkillPaths` (`agent/base-agent.ts:1017`); every OMP spawn (`omp-agent.ts:576,590` → `eligibility.ts:382`); tool-icon lookup (`SessionManager.ts:743`), automations (`:11522`), task create (`:5953`), bundled-sync broadcast per workspace (`headless-start.ts:487`) | cached 5 min (`storage.ts:351`); any watcher event invalidates it (`watcher.ts:815`) | Per skill: `readSkillInstructions` does 2 `realpathSync`, then `lstatSync` of every ancestor, then **two** `assertPaths` passes (2 realpath + D×(lstat+realpath) each), open/fstat/read/fstat/lstat (`skills/read-instructions.ts:10-71`). That is ≈ 6+2D realpaths + 3D lstats; at depth D≈6, about 35 syscalls before Node's JS realpath walks components. Plus `gray-matter` (`storage.ts:171`) and `findIconFile` with up to 7 `existsSync` (`utils/icon.ts:92-99`, `icon-constants.ts:24`). **10,000 skills ≈ 400k+ sync syscalls and 10k YAML parses.** Also O(A×(W+P)) `.some()` scans (`storage.ts:534`) and a separate OMP gray-matter scan (`omp-discovery.ts:58-100`, 60 s TTL) |
| 4 | **Bundled-skills merge inline fallback**: `skills/bundled-background.ts:200-202` | first launch or bundle change | once per launch where the stamp mismatches | Hashes ~5.7k files / ~95 MB (`:4-5`) on main whenever `workerScript` is missing. That is **always the case in `electron:dev`** (`scripts/electron-dev.ts` never builds `bundled-skills-worker.cjs`) and **always the case headless** (`headless-start.ts:480`) |
| 5 | **Session open**: `SessionManager.ts:3714-3737` → `loadStoredSession` → `readSessionJsonl` (`shared/src/sessions/jsonl.ts:122-125`) | `sessions.GET_MESSAGES` (`handlers/rpc/sessions.ts:197`) | every switch to a session that is not yet loaded | `readFileSync` of the whole transcript, `split`, then a `JSON.parse` per line. The full message array then goes through the codec deep-copy and `JSON.stringify` (row 9). CPU ∝ transcript MB (#1589) |
| 6 | **Git via `execFileSync`**: `git/exec.ts:34-41`; snapshot = up to 7 sequential sync gits (`git/workspace.ts:40-41,53,58,72,84,119-140`) | `git.GET_STATUS` / `GET_BRANCH` / `GET_WORKSPACE_SNAPSHOT` (`server-core/handlers/rpc/system.ts:208-230`; duplicate in `apps/electron/src/main/handlers/system.ts:133,150`); called from `SessionGitPanel.tsx:18`, `use-working-directory-state.ts:102` | per panel open / working-dir change | Main is frozen for the whole git run, up to 5 s per call (`exec.ts:8`), so up to 35 s for a snapshot. A large repo's `git status` takes 100 ms to seconds |
| 7 | **Notes import**: `server-core/src/knowledge/notes-import.ts:47-90` (scan), `:211-275` (materialize), `:120-140` (lstat every path component) | `notesImport.PREVIEW` / `EXECUTE` (`handlers/rpc/notes-import.ts:67-95`) | per import (EXECUTE scans again) | up to `MAX_FILES = 500` × `MAX_FILE_BYTES = 5 MB` (`notes-import.ts:20-24`) sync read + `writeFileSync`, all in one handler turn |
| 8 | **`loadStoredConfig` is uncached**: `shared/src/config/storage.ts:914-926`; `getWorkspaces` `:1892-1916`; `getWorkspaceByNameOrId` `:1935` | nearly every RPC handler (316 call sites of `getWorkspaceByNameOrId`/`getWorkspaces`/`loadStoredConfig` in server-core/shared/main); per skill with a `requires.config` key (`skills/eligibility.ts:151-160`) | every RPC | journal recovery check + `existsSync` + `readFileSync(config.json)` + `JSON.parse` + `sha256` (`:1033`) + per-workspace `findIconFile` (7 `existsSync`) + `statSync`. Small per call, but paid on every call |
| 9 | **Transport codec deep walk**: `server-core/src/transport/codec.ts:69-89,141-143`; `transport/server.ts:1603,1710` | every RPC response and push | always | Allocates a deep copy of every payload (`Object.fromEntries(Object.entries(...))`), then `JSON.stringify`. Example: `skills.CHANGED` with 10k summaries per workspace (`SessionManager.ts:2889`) (#1588) |
| 10 | **`listSessions` scan**: `shared/src/sessions/storage.ts:363-400` | labels/statuses CRUD (`labels/crud.ts:341`, `statuses/crud.ts:165,185`), `storage.ts:700,863,870`, boot fallback (`SessionManager.ts:1500-1503`), import ingest (row 1) | per mutation / stale projection | ≈9 syscalls per session: `recoverSessionJournal` exists+readdir (`journal-recover.ts:20-29`), exists, header open/read (`jsonl.ts:99-104`), `listPlanFiles` exists+readdir (`storage.ts:1118-1125`, called from `headerToMetadata` `:425`), `statSync`. The fast path `listSessionsFromHeaders` (`:461-478`) still does plan readdir + stat per session |
| 11 | **ConfigWatcher**: recursive `fs.watch` on the workspace (`config/watcher.ts:421`) includes `sessions/` | every write under the workspace (session journals while streaming) | continuous during agent runs | event routing plus debounced handlers; a skills-dir change does readdir + `loadSkill` per new folder + a full catalog walk (`watcher.ts:790-817`) (#1587) |
| 12 | **OMP stream parsing**: `omp-rpc-transport.ts:65,111`; transcript read `omp-agent.ts:759` | every agent event, × concurrent sessions | streaming | `JSON.parse` per line on main, then re-encoded per WS push (row 9) |
| 13 | **Local embeddings**: `server-core/src/memory/episodic-memory.ts:104-136` | memory jobs (`MemoryService.ts:441` idle check) | background | `@xenova/transformers` tokenization and tensor glue on the main JS thread |
| 14 | **Credential store unlock**: `credentials/backends/secure-storage.ts:124-125` (`pbkdf2Sync`, 100k iterations), `spawnSync`/`execSync` probes `:143-177,261-269` | first credential access | once per process (cached `:485-519`), but often lazy, i.e. after startup | ~50–150 ms of CPU plus blocking child processes |
| 15 | **Extension and meetings stores**: `extension-host/descriptors.ts:220` (read + hash each entry), `meetings/local-store.ts:137,211-216` (readdir + read per meeting) | extension (re)load; meetings list | per open | linear in extensions / meetings |

---

## 3. Worker-pool candidates (CPU-bound, or self-contained IO+CPU jobs)

Size the shared pool as `max(1, min(4, os.availableParallelism() - 2))`: leave one core for main and one for
the renderer. Clamp to 1 when `isWeakHardware()` is true (`shared/render-profile.ts:73`) or the render
profile is `performance` (low-power). Add `powerMonitor.isOnBatteryPower()` as a further clamp. Spawn
workers lazily and idle them out after ~30 s so a quiet app holds zero workers.

| Job | Current location | Why a worker | Input → output |
|---|---|---|---|
| Skills catalog scan (all tiers + gray-matter + icon lookup) | `skills/storage.ts:466-553`, `omp-discovery.ts:58-100` | 10k × (≈35 syscalls + YAML parse); purely data in, data out | roots + disabled set → `SkillSummary[]` (bodies dropped, as `toSkillSummaries` already does) |
| Vault (re)index: parse + entity extraction | `vault-index.ts:543-633`, `vault-markdown.ts` | regex/markdown parse of up to 4,000 notes; SQLite can be opened by path in the worker (same pattern as browser-intel `worker.ts:20-35`) | notesRoot + changed paths → counts |
| Foreign session conversion + fingerprint | `import-convert.ts`, `import-persist.ts:79` | `JSON.parse` of large JSONL + sha256 of the re-stringified messages | sourcePath → converted messages / hash (main does the ledger and ingest in one batch) |
| Large transcript parse | `sessions/jsonl.ts:122-125` | CPU ∝ MB; only for files above a threshold (e.g. >2 MB) | path → messages (or a tail window, #1589) |
| Bundled-skills merge | already a worker (`bundled-sync.worker.ts`) | move onto the pool and fix the dev/headless fallback | as today |
| Embeddings | `episodic-memory.ts:133` | model inference | text[] → Float32Array[] (transferable) |
| Renderer: markdown/Shiki | renderer UI thread | #1590: a **web worker** in the renderer, not `worker_threads` | — |

The codec deep walk (row 9) is **not** a pool candidate: serialization must happen on the sending thread.
Fix it with the #1588 fast path, which skips the walk when the payload contains no `Uint8Array`.

## 4. IO-to-async candidates (IO-bound: make async + batched; don't use threads)

| Item | Change |
|---|---|
| `loadStoredConfig` / `getWorkspaces` (`config/storage.ts:914,1892`) | Memoize on `(mtimeMs, size)` of `config.json`, invalidated by the existing config watcher (`watcher.ts:396-404`). Removes the read + parse + sha256 from ~every RPC |
| Git (`git/exec.ts:35`, `git/workspace.ts:53,58`) | `execFile` (async) + per-cwd single-flight + 1–2 s result cache; run the snapshot's 7 commands concurrently |
| Notes `ensureVaultIndex` (`notes.ts:729,740,751,790`) | Do not rebuild on read. Serve from SQLite, update incrementally from the notes watcher, and run `reindexNamedEntities` only for changed documents (#1574) |
| Foreign import (`session-foreign-import.ts:102-122`) | Build `sourcePath → sessionId` once per batch (replaces the `findPersistedSource` scan); `await setImmediate` between items; call `ingestImportedSession` once per batch with one projection rebuild; one `sessions.CHANGED` push instead of N `session_created` |
| `listSessions` / `headerToMetadata` (`storage.ts:363-425`) | Store `planCount` and `transcriptBytes` in the projection (`sessions-projection.ts`) instead of readdir + stat per session; `fs.promises` with a concurrency limit for the cold path |
| `readSkillInstructions` (`read-instructions.ts:10-71`) | Keep the TOCTOU guard for **detail reads** (`loadSkillDetails`), but list scans only need `name`/`description`. Use one `realpathSync.native`, one open+read, no ancestor walk; replace `findIconFile`'s 7 probes with the `readdir` result already in hand |
| Notes import (`notes-import.ts:211-275`) | `fs.promises` with bounded concurrency (e.g. 8) and progress events; do not re-scan in EXECUTE |
| ConfigWatcher (`watcher.ts:421`) | Exclude `sessions/**` from the recursive watch, or watch only the subtrees it handles (#1587) |

**Concurrency primitive.** Nothing exists in production code. There is no `p-limit`, `p-queue`, `piscina`,
`tinypool`, `workerpool` or semaphore under `packages/*/src` or `apps/electron/src`. The only hits are vendored
skills under `apps/electron/resources/skills/**` and an ad-hoc wave loop in `marketplace/stats.ts:178-180`.
Related pieces: `EventQueue` (`agent/backend/event-queue.ts:16`) is an agent event buffer, and
`persistence-queue.ts` (sessions) serializes writes. Neither is a general limiter. Add one small
`limit(n)` / `TaskQueue` helper in `packages/shared/src/utils/` and a `WorkerPool` built on it.

---

## 5. How workers are built and resolved (dev vs packaged)

| Worker | Source | Build (packaged path) | Dev (`bun run electron:dev`) | Runtime resolution | Packaged inclusion |
|---|---|---|---|---|---|
| bundled-skills | `packages/shared/src/skills/bundled-sync.worker.ts` | `scripts/electron-build-main.ts:37-38,378-405`: esbuild `--bundle --platform=node --format=cjs --external:electron` → `apps/electron/dist/bundled-skills-worker.cjs` (called at `:436`) | **Not built** by `scripts/electron-dev.ts`, so a stale file or (on a clean tree) the inline main-thread fallback | `join(__dirname, 'bundled-skills-worker.cjs')` (`index.ts:804`); `existsSync` gate (`bundled-background.ts:189`) | `files: dist/**/*` (`electron-builder.yml:22`); `asar: false` (`:98`) |
| browser-intel unfurl | `apps/electron/src/main/browser-intel/worker.ts` | `apps/electron/package.json:19` `build:main-worker` (esbuild CJS, externals electron / `bun:*` / claude SDK), part of `apps/electron` `build` (`:27`) and `smoke:browser-intel-worker` (root `package.json:72`) | **Not built** by `electron-dev.ts` | `join(__dirname, 'browser-intel-worker.cjs')` (`browser-intel/index.ts:44,147`) | explicitly listed (`electron-builder.yml:29`). **But** root `electron:build` (`package.json:99`), which `build-dmg.sh:211` / `build-linux.sh:186` / `scripts/build/common.ts:848` use, does not run `build:main-worker` (see Risks) |
| Extension Host (utilityProcess) | `apps/electron/src/main/extension-host/worker.ts` | `electron-build-main.ts:343-376` → `dist/extension-host-worker.cjs`; `apps/electron/package.json:40` | **Built and watched** (`electron-dev.ts:621-633`) | `defaultWorkerPath()` tries `__dirname`, then `../../dist`, then `cwd/apps/electron/dist` (`extension-host-manager.ts:184-200`) | `dist/**/*` |
| WhatsApp / Discord (child processes) | `packages/messaging-*-worker/src/worker.ts` | `electron-build-main.ts:256-341`, `scripts/build-wa-worker.ts`, `build-discord-worker.ts` | built once at dev start (`electron-dev.ts:197-227,467-471`) | `app.isPackaged ? resourcesPath/... : cwd/packages/.../dist/worker.cjs` (`index.ts:1415-1426`) | `extraResources` (`electron-builder.yml:195-200,310-315,355-360`) |

Tests: `bun test` never loads the bundles. The hosts expose seams: `runInWorker` (`bundled-background.ts:58`)
and `__setUnfurlWorkerEntryForTests` (`browser-intel/index.ts:86`), which tests feed with a generated CJS file
(`apps/electron/src/main/__tests__/browser-intel.test.ts:205-218`). The packaging invariant is enforced by
`apps/electron/scripts/perf/__tests__/worker-packaging.test.ts`: the worker must stay outside `app.asar` and
main must resolve it via `join(__dirname, …)`.

### Recipe for a new worker script (works in dev, `bun test` and packaged)

1. **Entry** at `packages/<pkg>/src/<name>.worker.ts`. Import only a dependency-light core module (see the
   `browser-intel/worker.ts:11-15` note about the Claude SDK's `import.meta.url` crashing CJS bundles). No
   top-level `await`. Read `workerData`, reply through `parentPort`.
2. **Bundle** in **both** `scripts/electron-build-main.ts` (next to `buildBundledSkillsWorker`, output
   `join(DIST_DIR, '<name>-worker.cjs')`, `--platform=node --format=cjs --external:electron`, then
   `verifyJsFile`) **and** `scripts/electron-dev.ts` (an `esbuild.context(...).watch()` like the
   extension-host block at `:621-633`). Today's gap is exactly this second step.
3. **Resolve** from main with `join(__dirname, '<name>-worker.cjs')`; main is bundled to `dist/main.cjs`, so
   `__dirname` is `dist/` in dev and packaged alike. Pass the path into shared code as an option (like
   `workerScript`) instead of resolving inside `packages/shared`, because shared code also runs headless
   and in tests.
4. **Package**: `dist/**/*` already ships it and `asar: false`. If ASAR is ever enabled, add it to
   `asarUnpack` and rewrite the path to `app.asar.unpacked`; extend `worker-packaging.test.ts` with the new
   file name.
5. **Tests**: inject a `runInWorker`-style seam. Under `bun test`, `new Worker('<path>.worker.ts')` also
   works directly on the TS source, so a test can point the seam at the source file without a build.
6. **Headless**: pass a path too (headless-start currently passes none, so it always runs inline), or keep
   an explicit inline fallback that yields (`setImmediate`) between chunks.

---

## 6. Risks

- **Dev does not exercise the worker path.** `electron-dev.ts` builds neither `bundled-skills-worker.cjs`
  nor `browser-intel-worker.cjs`, so dev measurements show inline hashing on main (`bundled-background.ts:200`),
  or a stale worker from an old build, and the unfurl worker fails. Perf numbers from dev are not
  representative.
- **The packaged browser-intel worker may be missing.** `electron-builder.yml:29` lists
  `dist/browser-intel-worker.cjs`, but the root `electron:build` chain (`package.json:99`) used by
  `build-dmg.sh:211` / `build-linux.sh:186` / `scripts/build/common.ts:848` never runs `build:main-worker`.
  Needs verification against a real artifact.
- **ASAR is off** (`electron-builder.yml:98`). Every worker path assumes plain files; enabling ASAR (e.g. for
  startup I/O) breaks `worker_threads` resolution unless `asarUnpack` is added.
- **Worker data contract.** Only structured-clone data can cross. Live SQLite handles throw `DataCloneError`
  (`browser-intel/index.ts:140-144`). Module caches are per thread, so main must invalidate its own caches
  after a worker writes (`bundled-background.ts:175-178`). Skills and vault workers need the same discipline.
- **SQLite concurrency.** Moving vault indexing to a worker means two connections to the same DB. That
  requires WAL and a single-writer rule; `vault-index.ts` already manages `-wal`/`-shm` files (`:185-187`).
- **Security guards.** `readSkillInstructions`' TOCTOU checks (`read-instructions.ts:31-67`) exist for
  agent-facing reads. Loosening them for list scans must keep detail and agent reads strict.
- **#1586 overlap.** Running server-core in a `utilityProcess` would take every row of §2 off the Electron UI
  loop, but not off the server-core loop: RPC latency would still suffer. The async and pool work in §3–§4 is
  needed in both architectures, and the pool must also work in headless mode.
- **Thermal behavior.** With more parallelism, 10k-skill scans or 4k-note indexes could peg every core at
  once. The pool must cap concurrency, run at lower priority where possible, and honor the low-power
  profile and battery state.
- **Renderer side.** Even with a cheap backend, `SkillsListPanel` mounts every row (`SkillsListPanel.tsx:363`,
  no `virtualize`). Main-process fixes alone will not stop the 10k-skill overheating (#1578).
