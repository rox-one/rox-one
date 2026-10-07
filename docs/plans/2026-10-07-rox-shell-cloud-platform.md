# ROX shell UX, platform defaults, cloud runs, secrets — implementation plan

**Goal:** Deliver the 2026-10-07 product spec: left/right chrome parity (SE-style), inspector/panel behavior, branding (`app-icon.zip`), Inter typography, meetings layout fix, cloud runs (Daytona) working from UI, `~/rox` identity path, tool-icons path, and PocketID-era per-user secret provisioning design + first slice.

**Spec:** User message 2026-10-07 (screenshots + `app-icon.zip`); prior SE parity context in session history.

**Authority and constraints:**
- TestCT network checkpoint **closed** — no Tailscale/ACL changes.
- Do not store operator plaintext API keys in git; Daytona operator key via `~/rox/cloud-runs.env` / server `service-secrets.env` only.
- `~/rox` vs `~/.rox`: code today defaults to **hidden** `~/.rox` (`ROX_CONFIG_DIR_NAME` in `packages/shared/src/identity/manifest.ts`). User requests **visible** `~/rox/` — requires explicit migration task (T-02); do not silently break existing installs.
- Ghostty terminal: **candidate** — verify embed path before promising; fallback xterm/PTY panel if Ghostty not wired.

**Architecture (chosen):**
- **Shell:** `WorkspaceSurfaceHost` + `ActivityRail` (left modes) + optional `WorkspaceIconRail` → replace workspace rail with **mode-only gray icon rail** per spec; settings + collapse at bottom.
- **Inspector:** `InspectorHost` + `inspector-model.ts` — default **panel hidden**; new **action rail** (new session / task / event / note / browser / terminal) replaces info+browser toggles; edge-reveal + pin reuses `useEdgeRevealPanel` pattern from SE parity.
- **Panels:** `PanelHost` / panel-stack atoms — adjacent wide panels, focus on open; terminal split under **first** panel column only.
- **Cloud:** `packages/cloud-runner` `DaytonaProvider` + `CloudRunsSettingsPage` + `CloudRunsChip`; fix `[object Object]` errors via structured error serialization.
- **Secrets:** Today — local `credentials.enc` + `service-secrets.env` + builtin MCP seed (`packages/shared/src/sources/`); **no** central user DB in desktop app yet. PocketID track = new `docs/pocket-sso/` + server-side entitlement DB (task T-18 scout).

**Current state (verified 2026-10-07, re-audit):**
- Branch `feat/super-engineering-ui-parity` @ `f4a520d2b` (+ local fixes); credentials: legacy-token fallback path in `4f2612511`.
- `inspectorVisibleAtom` default **`false`**; info rail removed from knowledge inspector.
- `WorkspaceIconRail` suppressed when unified shell / workbench chrome active (`workspace-rail.ts` + `App.tsx`).
- Icons at `apps/electron/resources/icon.{icns,png}`; user archive `/Users/t/Downloads/app-icon.zip`.
- `AppearanceSettingsPage` tool-icons path still references `.craft-agent` in copy + `EditPopover`.
- `featureWorkbenchHarnessInspectorV1Atom` defaults **off** in storage; user wants tab+inspector panel **on** by default.

## Task graph

| ID | Deliverable | Owner | Depends on | Owned files | Verification |
|---|---|---|---|---|---|
| T-00 | Rox cold-start smoke | Lead | — | — | `cp .bak→credentials.enc`; `bun run electron:build:main`; launch electron; **0** `resolve-local-ws-token` errors |
| T-01 | App icon bundle | Lead | — | `apps/electron/resources/icon.*`, `workspace-icon.png`, `electron-builder.yml` | `ls resources/icon.icns`; macOS About shows new art after rebuild |
| T-02 | Config dir `~/rox` decision + migration | Lead | — | `packages/shared/src/config/paths.ts`, `identity/manifest.ts`, migration doc | `bun test packages/shared/src/config/__tests__/env.test.ts` |
| T-03 | Inspector default hidden + no info rail | Lead | T-01 | `atoms/unified-shell.ts`, `inspector-model.ts`, `InspectorHost.tsx` | `bun test apps/electron/src/renderer/platform/__tests__/inspector-model.test.ts`; manual: no info panel on home/settings |
| T-04 | Right inspector action rail | Lead | T-03 | `InspectorHost.tsx`, new `InspectorActionRail.tsx`, i18n | Manual: 5 actions open **adjacent** panel; browser width ≥ `PANEL_MIN_WIDTH` |
| T-05 | Left mode rail (gray icons only) | Lead | T-01 | `ActivityRail.tsx`, `WorkspaceIconRail.tsx`, `workspace-rail.ts`, `AppearanceSettingsPage` | Manual: only Home…Inbox + settings + collapse; no workspace icons |
| T-06 | Sidebar chrome layout (gear vs profile) | Lead | T-05 | `SidebarChrome.tsx`, `ProfileStrip.tsx` | Manual: profile card lower; gear left of collapse |
| T-07 | Edge-reveal + pin (L/R) | Lead | T-04,T-05 | `useEdgeRevealPanel.ts`, `WorkspaceSurfaceHost.tsx` | `bun test` inspector-layout + edge-reveal tests |
| T-08 | Browser cookie default + lifecycle | Lead | T-04 | `browser-cookie-auto-import.ts`, `InspectorBrowserPane.tsx`, `browser-pane-manager.ts` | No consent modal; hide destroys webview |
| T-09 | Meetings record button overlap | Lead | T-03 | meetings page layout CSS/components | Manual: «Начать запись» visible on Встречи |
| T-10 | Inter font global | Lead | T-01 | `packages/ui/src/styles/index.css`, font load in electron | Computed style `font-family` includes Inter |
| T-11 | Kanban custom status on drop | Lead | — | `AppearanceSettingsPage.tsx`, `kanbanColumnStatusAtom` | UI: combobox allows custom text + persist |
| T-12 | Tool icons path + in-app editor | Lead | T-02 | `AppearanceSettingsPage.tsx`, `EditPopover.tsx`, `main/index.ts` seed path | Path shows `~/rox/tool-icons/`; table loads mappings |
| T-13 | Experimental defaults (inspector tabs, unified shell) | Lead | T-03 | `unified-shell.ts`, `WorkbenchChromeSettings.tsx` | Fresh profile: harness inspector **on** |
| T-14 | Zen shell availability | Lead | — | `ZenShellSettings.tsx`, `shell-material.ts` | Toggle enabled on macOS dev build |
| T-15 | Device diagnostics icon-only + module panel | Lead | T-04 | device diagnostics TopBar consumer | Icon opens panel right of current |
| T-16 | Cloud runs UI fix + Daytona default | Lead | T-00 | `CloudRunsSettingsPage.tsx`, `CloudRunsChip.tsx`, cloud handlers | Settings cloud runs: no `[object Object]`; list loads |
| T-17 | Cloud runs runtime manifest doc | Lead | T-16 | `docs/cloud-runs-runtime.md` | User sign-off on package list |
| T-18 | Secrets inventory + PocketID DB scout | Scout | — | `docs/plans/2026-10-07-secrets-model.md` | Table of keys, code paths, proposed schema |
| T-19 | Per-user secret provisioning (server) | Lead | T-18 | server-core handlers, new migration | Integration test: new user receives rotated refs |
| T-20 | Ghostty terminal panel | Candidate | T-04 | terminal embed layer | Spike: split panel under panel[0] or document blocker |
| T-21 | Screen map doc (user review) | Lead | — | `docs/design/rox-screen-map-ru.md` | User comments in chat |

## Task T-00: Rox cold-start smoke

- **Produces:** Restored `~/.rox/credentials.enc` or documented legacy-token-only mode.
- **Verification:** `rg "resolve-local-ws-token failed" ~/Library/Logs/@rox/electron/main.log` → **0** lines after ⌘Q relaunch.

## Task T-01: App icon bundle

- **Work:** Unzip `/Users/t/Downloads/app-icon.zip`; copy `AppIcon.icns` → `resources/icon.icns`, `icon-1024.png` → `resources/icon.png`, `workspace-icon.png` from `icon-512.png`; rebuild Assets.car if macOS 26 pipeline requires (`build/afterPack.cjs`).
- **Verification:** `file resources/icon.icns`; packaged app Dock icon matches PNG #4.

## Task T-03: Inspector default hidden

- **Interfaces:** `inspectorVisibleAtom` default `false`; `normalizeInspectorSection` fallback `browser` or keep section but **never auto-open**; remove `info` from `KNOWLEDGE_INSPECTOR_SECTION_IDS` / rail.
- **Verification:** Regression test: fresh storage → `visible === false`; UI observation on settings + notes.

## Task T-04: Right inspector action rail

- **Order (top→bottom):** New session (+), New task, New event, New note, Open browser; bottom: terminal, spacer, collapse (mirror left).
- **Panel open:** `openPanelAdjacent({ type, width: SIDE_PANEL_DEFAULT_WIDTH })` + focus panel id.
- **Verification:** `rox-readiness-ui-001` navigation tests updated; manual multi-panel row.

## Task T-05: Left mode rail

- **Work:** Default `workspaceSelectorRail` **false**; hide `WorkspaceIconRail` when unified shell on; style `RailRow` muted (`text-foreground/45`) matching plus icon.
- **Verification:** `workspace-rail.test.ts`; screenshot parity.

## Task T-16: Cloud runs

- **Work:** Fix `setLoadError(String(error))` → serialize `CloudRunError` JSON; enable `provider: daytona` by default when `DAYTONA_API_KEY` in `cloud-runs.env`; wire chip `listCloudRuns`.
- **Verification:** `bun test packages/cloud-runner/src/__tests__/daytona-provider.test.ts`; Settings → Облачные запуски loads config.

## Task T-17: Cloud runtime bundle (default sandbox)

**Proposed default image contents (for user sign-off):**
1. Base: Daytona snapshot (Ubuntu LTS) + `bun` + `node20` + `git` + `curl` + `jq` + `ripgrep`.
2. Rox agent: `omp` CLI + pinned `@oh-my-pi/pi-coding-agent` + bundled skills subset.
3. MCP: exa, firecrawl, brave, langfuse (stdio) — keys injected via **server** proxy, not baked in image.
4. Env: `ROX_API_KEY` (per-user ref), `DAYTONA_API_KEY` (operator), `UV_PYTHON=3.12`.
5. Bootstrap order: sync workspace → seed MCP configs → `omp --mode rpc` health → run subtasks.

## Task T-18: Secrets model (scout)

**Known keys (code references):**
| Key / secret | Where resolved | Per-user today |
|---|---|---|
| `ROX_API_KEY` | `omp-first-run.ts`, agent env | User paste / env |
| `DAYTONA_API_KEY` | `cloud-runs.env`, secretRef | Operator file |
| `DEEPGRAM_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `BRAVE_API_KEY`, `E2B_API_KEY`, `TAVILY_API_KEY` | `server-services.ts` | Shared backend file |
| LiveKit keys | meetings/voice modules | Scout T-18 |
| MCP account secrets | credential manager + builtin seed | Workspace-local vault |

**DB today:** Desktop = SQLite under `~/.rox/workspaces/<id>/` + encrypted `credentials.enc`; **no** multi-user server DB in electron app. PocketID = future **hosted** user row + encrypted secret blobs.

## Decisions and alternatives

| Topic | Choice | Alternative rejected |
|---|---|---|
| Config home | Migrate to `~/rox` with one-time import from `~/.rox` | Keep `.rox` only — rejects user spec |
| Info panel | Remove from rail entirely | Keep hidden section — user said delete |
| Terminal | Ghostty spike (T-20) | Bottom terminal under whole shell — user rejected |
| Cloud provider | Daytona only | CF/Modal fallback — user specified Daytona |

## Delivery verification

1. Run targeted tests listed per task.
2. Manual pass: Mode bar screens × inspector × cloud settings × meetings record CTA.
3. Independent review: `plan-review.md` checklist for T-04/T-16/T-18.

## Progress and recovery

| Task | State | Evidence |
|---|---|---|
| T-00 | done | credentials `.bak` / legacy token |
| T-01 | done | `5e839a627` icons |
| T-02 | done | `resolveConfigDir` prefers `~/rox`; migration doc |
| T-03 | done | inspector hidden; no info rail |
| T-04 | done | `InspectorActionRail` + compose listeners |
| T-05 | done | gray rail, settings row, workspace rail default off |
| T-06 | done | `SidebarChrome` spacing |
| T-07 | done | edge zones L/R + pin control |
| T-08 | done | cookies default; destroy imported webview on unmount |
| T-09 | done | meetings `pb-16` |
| T-10 | done | Inter default sans |
| T-11 | done | kanban custom status field |
| T-12 | done | tool-icons under config dir |
| T-13 | done | unified shell + harness inspector defaults on |
| T-14 | done | Zen native availability probe |
| T-15 | done | device CPU icon chip |
| T-16–T-17 | done | cloud runs errors + `docs/cloud-runs-runtime.md` |
| T-18 | done | `2026-10-07-secrets-model.md` |
| T-19 | done | `user-secrets-provision.ts` + unit test |
| T-20 | documented | `ghostty-terminal-spike.md` (blocked) |
| T-21 | done | `docs/design/rox-screen-map-ru.md` |

**Next action:** User UI pass on screen map; optional Ghostty/PTY column split.
