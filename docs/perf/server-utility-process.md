# #1586 — RPC server in an Electron utilityProcess (slice 1)

Status: **experimental, off by default** (`ROX_SERVER_UTILITY_PROCESS=1`).

## What slice 1 does

- `apps/electron/src/main/server-host.ts` forks the standalone server-core
  bootstrap (`packages/server/src/index.ts`, bundled with
  `bun run build:server-host-worker` → `apps/electron/dist/server-host-worker.cjs`)
  into `electron.utilityProcess`.
- Main waits for the `CRAFT_SERVER_URL=` readiness line, then sets
  `CRAFT_SERVER_URL` / `CRAFT_SERVER_TOKEN`. Startup then follows the existing
  **thin-client** path (`isClientOnly` in `main/index.ts`, `preload/bootstrap.ts`)
  and its WS reconnect.
- Supervision: crash → restart with exponential backoff (500 ms × 2ⁿ, cap 30 s);
  a run ≥ 60 s resets the counter; give up after 5 consecutive crashes. Port and
  token are pinned across restarts so renderer reconnects land.
- Ready timeout 30 s (child killed → counted as a crash). If the first start
  fails, main logs and falls back to the in-process server (env untouched).
- Clean shutdown on quit: `{type:'shutdown'}` over `parentPort` → server's
  existing `shutdown()` (messaging dispose, `instance.stop()`); `kill()` after 5 s.
- Event-loop gate (PERF-01): with `ROX_PERF=1`, 30 s after start main logs
  `[perf] server-host loop-delay gate pass|fail|no-data p99=… budget=…`
  (budget `ROX_SERVER_UTILITY_PROCESS_LOOP_BUDGET_MS`, default 50). Report-only.

Flag off: `server-host.ts` is never imported; the only change on the default
path is two `if (process.env.ROX_SERVER_UTILITY_PROCESS)` checks. The
`parentPort` listener added to `packages/server` is inert outside a utilityProcess.

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

- `build:server-host-worker` bundles the bun-targeted server for Node (no
  `bun:` APIs, native deps resolve inside the asar/unpacked layout).
- `CRAFT_RPC_PORT=0` binds a free port and the readiness line reports it.
- Window shell still paints first (the fork is awaited before windows exist
  when the flag is on — measure the cost with the startup bench).
- Kill the child (`kill <pid>`) → renderer reconnects after restart.
- Quit leaves no orphan process; `[perf] … gate` line appears with `ROX_PERF=1`.
