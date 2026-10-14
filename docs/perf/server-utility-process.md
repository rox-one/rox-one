# #1586 — RPC server in an Electron utilityProcess (slice 1)

Status: **experimental, off by default** (`ROX_SERVER_UTILITY_PROCESS=1`).

## What slice 1 does

- `apps/electron/src/main/server-host.ts` forks the standalone server-core
  bootstrap (`packages/server/src/index.ts`) into `electron.utilityProcess`.
- **Worker build**: `bun run build:server-host-worker`
  (`scripts/build-server-host-worker.ts`, called by `build` / `build:win` but
  **opt-in**: it only builds when `ROX_BUILD_SERVER_HOST_WORKER=1`, otherwise it
  is a no-op) → minified `apps/electron/dist/server-host-worker.mjs` (~45 MB).
  If the flag is set at runtime but the worker file is missing, main logs
  `server-host: worker not found … using in-process server` and makes no fork
  attempts.
  - **ESM, not CJS**: the server entry uses top-level await (esbuild rejects it
    for CJS). The banner provides `require` / `__filename` / `__dirname`
    (needed by bundled CJS deps, e.g. `@larksuiteoapi/node-sdk`).
  - Bun-only `import.meta.dir` is defined to `__dirname`; `bun:*` stays external
    and is only reached behind runtime guards. The build fails on any static
    `bun:` import. `Bun.*` references in the bundle are guarded at runtime.
  - SQLite uses `node:sqlite` → needs Electron's Node (v24 in Electron 44).
    Box smoke test: under `ELECTRON_RUN_AS_NODE=1` the bundle passes the
    sqlite capability probe, binds `CRAFT_RPC_PORT=0`, and prints its ready
    line in ~1.6 s. Plain Node 20 fails (no `node:sqlite`).
  - Externals match `build:main` (claude-agent-sdk, onnxruntime-node,
    transformers, sharp): resolved from the app's node_modules at runtime.
  - Default builds don't contain the worker, so there is no size cost unless
    you opt in.
  - `build:validate` points at a non-existent `scripts/validate-assets.ts`
    (already broken on main), so validation lives inside the build script.
- **Readiness and handoff**: main waits for the `CRAFT_SERVER_URL=` line.
  Thin-client mode gets URL and token from `getServerHostConfig()` (main),
  and the preload gets them over the sync IPC `__server-host:config`, which
  answers only a Rox window's own webContents. They are **never** written to
  `process.env`. The preload only asks when `ROX_SERVER_UTILITY_PROCESS` is in
  its env, so with the flag off it makes no IPC call.
- **Token and env hygiene**: a fresh random token per app session lives only
  in the supervisor. The child gets an allowlisted env:
  - OS basics, locale, proxy and CA vars;
  - `CRAFT_*` and `ROX_*`, minus any URL, token or flag;
  - `*_API_KEY` and `*_BASE_URL`;
  - its token, host and port, and resources/version paths.
- **Before the first readiness**: fail fast. At most 2 attempts with a 10 s
  ready timeout each, then main falls back to the in-process server with the
  same behaviour as with the flag off. A fork that throws counts as a failed
  attempt.
- **After the first readiness**:
  - restarts with exponential backoff (500 ms × 2ⁿ, cap 30 s) and a 30 s ready
    timeout;
  - the port is pinned so the renderer's WS reconnect lands on the same URL;
  - only a run that became ready **and** lasted ≥ 60 s resets the counter, so
    fork throws and never-ready runs always count and give-up is guaranteed
    (after 5 crashes).
- **On give-up**: Rox shows an error box and calls `app.relaunch()` with
  `--rox-no-server-utility-process` (and deletes the flag from env), then
  `app.exit(0)`, so the next run uses the in-process server.
  - Chosen over picking a new port because the renderer's thin-client URL is
    fixed at preload eval.
  - Busy-port risk is low: Node `listen` sets SO_REUSEADDR, so TIME_WAIT does
    not block a rebind.
- **Clean shutdown on quit**: `{type:'shutdown'}` over `parentPort` calls the
  server's own `shutdown()`. If the child hasn't exited after 5 s, it is
  killed. If no `exit` event arrives 2 s after the kill, it is treated as
  exited so quit never hangs. A stop during startup logs "start aborted by
  shutdown", not a fallback.
- **Event-loop gate (PERF-01)**: with `ROX_PERF=1`, 30 s after start main logs
  `[perf] server-host loop-delay gate pass|fail|no-data p99=… budget=…`.
  The budget is `ROX_SERVER_UTILITY_PROCESS_LOOP_BUDGET_MS`, default 50.
  The gate only reports; it never changes routing.

Flag off: `server-host.ts` is never imported. There is no IPC, the preload
skips its config call, and the `isClientOnly` and win32 checks evaluate
exactly as before.

## Handler inventory — what must stay in main

In-process today, GUI mode calls `registerAllRpcHandlers` = core handlers
(`@rox/server-core/handlers/rpc`) + the Electron-only GUI handlers below. The
utilityProcess child runs the **standalone server**, i.e. core handlers only.
**Slice 1 does not bridge the GUI handlers** — with the flag on, these channels
are unavailable (same as the existing thin-client mode). Bridging is slice 2.

| File (`apps/electron/src/main/handlers/`) | ~channels | Why main-only | Bridge plan |
|---|---|---|---|
| `system.ts` (GUI part) | 42 total | dialogs, shell.openExternal, app/menu, power, notifications | main-side RPC server on a 2nd local port, or renderer → main IPC |
| `workspace.ts` | 7 | BrowserWindow open/focus, window ↔ workspace binding | main IPC (needs WindowManager) |
| `browser.ts` | 26 | BrowserPaneManager (WebContentsView) | main; child forwards agent-driven pane ops via `parentPort` request/response |
| `browser-intel.ts` | 6 | reads live pane webContents | main, same as browser |
| `settings.ts` | 7 | nativeTheme, login items, app settings | main IPC |
| `native-integration.ts` | 12 | macOS native APIs | main IPC |
| `clipboard-history.ts` | 12 | `electron.clipboard` monitor | main; capture events pushed to child |
| `voice-clipboard.ts` | 1 | clipboard write | main IPC |
| `extension-host.ts`, `extension-surface.ts` | 17 + 5 | spawns own utilityProcess per workspace, views | main |
| `siyuan.ts`, `zed-themes.ts` | 6 + 2 | local app integrations / file pickers | main IPC (could move later) |
| `workgraph.ts` | 35 | main-owned WorkGraph kernel + GitHub credential fabric | move kernel into child, or proxy |
| `keeper/register.ts` | — | Keeper GUI | main IPC |

Also main-only and wired in `main/index.ts` outside RPC: credential vault
restore (safeStorage/Keychain), network proxy apply, OAuth deep links,
`setSessionPlatform` / image processor (nativeImage), messaging gateway, Open
Design runtime, auto-update, quit guards.

Suggested bridge (slice 2): main keeps a small `RpcServer` for the GUI channels;
the preload's thin-client transport routes by channel prefix (core → child WS,
GUI → main). Agent-side calls that need main (browser panes, notifications)
go child → main over `parentPort` with request ids and timeouts.

## Needs validation on macOS

- The packaged app: the worker forks from inside asar, externals and native
  deps resolve, and `CRAFT_RESOURCES_PATH` / `CRAFT_BUNDLED_ASSETS_ROOT` are
  correct. Messaging workers, uv and bun all depend on these.
- The renderer env contains `ROX_SERVER_UTILITY_PROCESS`, so the preload asks
  for the config.
- The give-up relaunch comes back in-process: force it with a worker that
  exits immediately.
- An opt-in build (`ROX_BUILD_SERVER_HOST_WORKER=1 bun run build`) packages
  the worker, and a default build runs with the flag set but logs the missing
  worker and stays in-process.
- Window shell still paints first (the fork is awaited before windows exist
  when the flag is on — measure the cost with the startup bench).
- Kill the child (`kill <pid>`) → renderer reconnects after restart.
- Quit leaves no orphan process; `[perf] … gate` line appears with `ROX_PERF=1`.
