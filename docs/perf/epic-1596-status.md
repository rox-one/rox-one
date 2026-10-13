# Epic #1596 — perf ticket implementation status on `main`

Snapshot: worktree `perf/program-setup-20261013` = `origin/main` `4abca797f` + 1 docs commit. Read-only audit, 2026-10-13.
Method: issue body/acceptance criteria → merged PRs (`gh pr list --search`, PR bodies) → code read in the worktree.
Nothing was built, run or tested; "unverifiable from code" = needs a CI/bench measurement.

Important provenance notes
- PR #1601 (P1-A startup: #1560/#1561/#1562) shows **CLOSED**, but it landed through the integration merge PR #1604 (merge commit `4d57d4982`, `git merge-base --is-ancestor 4d57d4982 HEAD` → yes). Its `Closes #1560/#1561/#1562` therefore never fired.
- PR #1603 (P1-B) merged directly; it covers the core of #1563 but only says "covers", so #1563 stayed open.
- PRs #1636 / #1642 ("advisor-plans PERF-01..08") use a **different** PERF numbering (advisor audit), not the epic keys. Relevant overlaps: "PERF-01 shell-first boot" (#1642, → #1572) and "PERF-05 windowed SessionList / notes windowing" (#1636, #1642, #1671, → #1578).
- `PERF-UI-PLAN.md` (the spec every ticket cites, budgets §1, gates §6) is **not in the repository** (`ls PERF-UI-PLAN.md` → missing).

## Summary

| Ticket | Key | Status | Merged PRs | Unmet criteria (short) |
|---|---|---|---|---|
| #1560 | PERF-01 marks + bench | PARTIAL | #1601 via #1604, #1696 (warmup probe) | No Windows/datasets in CI; no baselines (plan file absent); no `getPerfReport`/Settings panel; rpc-counter has no latency/bytes; no seed fixture; marks cost unmeasured |
| #1561 | PERF-02 skills sync | PARTIAL (functionally complete) | #1601 via #1604 | Bench does not *assert* "no skills-sync span before window"; >50 ms block bound unverifiable; inline fallback runs on main thread |
| #1562 | PERF-03 platform env | PARTIAL | #1601 via #1604 | macOS cache miss/expired → login shell spawned at module load, before window; no bench assertion; Windows ≤500 ms unverifiable |
| #1563 | PERF-20 LLM list w/o refresh | PARTIAL (code complete) | #1603 (via #1604 train) | "0 network calls before first paint" bench missing; background refresh not explicitly gated on paint |
| #1572 | PERF-08 paint-first boot | PARTIAL (≈20 %) | #1601 via #1604, #1642 (shell-first) | 9 preload `sendSync`; no boot snapshot, StartupScheduler, `bootstrap:snapshot` RPC, compile cache; no epoch tests; no gates |
| #1573 | PERF-19 V8 code cache | NOT STARTED | — | All (still `loadFile` file://; no `app://`, no compile cache) |
| #1574 | PERF-21 notes tasks/journal/index | PARTIAL (≈15 %) | #1618 (renderer slice) | No `notes:listTasks`; journal replayed from seq 0 every call; vault index refreshed on every LIST; local mode still `readNote` loop; no bench |
| #1575 | PERF-05 re-render storms | NOT STARTED | — | All (context value not memoized; 33 whole-map subscribers; Feed 1.5 s refetch; Inbox counts unmemoized) |
| #1576 | PERF-09 query cache | PARTIAL (≈60 %) | #1618 | Skills/sources/calendar/mail/agent-center not migrated; only notes-list + agents-catalog persisted |
| #1577 | PERF-10 keep-alive/warm-up | PARTIAL (≈85 %) | #1696 (refresh of closed #1620), #1710 | p95 gates run on a simulator, not the app; warm-up probe report-only; note-row prefetch dropped; Mail/Focus/Meetings pollers ungated |
| #1578 | PERF-11 virtualize lists | PARTIAL (≈25 %) | #1636, #1642, #1671 | Only SessionList + notes sidebar windowed; no shared `VirtualList`; Inbox/Feed/calendar not virtualized; no 10k-row gate |
| #1579 | PERF-12 events not polling | PARTIAL (≈20 %) | #1696 (poller gating) | Polls still exist (60 s); no inbox `CHANGED`; no central scheduler; 26 renderer files with ungated `setInterval` |
| #1586 | PERF-13 utilityProcess server | NOT STARTED | — | All |
| #1587 | PERF-17 append-only journal | NOT STARTED | — | All |
| #1588 | PERF-15 transport fast path | NOT STARTED | — | All |
| #1589 | PERF-14 chat tail/virtual/rAF | NOT STARTED | — | All |
| #1590 | PERF-16 worker highlighting | NOT STARTED | (#1603 lazy Shiki is PERF-04 scope) | All |
| #1591 | PERF-18 memory LRUs/watchdog | NOT STARTED | — | All |

Strictly DONE (every criterion satisfied in code): **none**. Close candidates if bench-only criteria are re-homed to #1560: #1561, #1563.

---

## #1560 — [Perf P1] Startup and navigation perf marks + real-Electron bench in CI

Scope: main + renderer marks, event-loop histogram, perf report surfaces, rpc-counter extensions, seed fixture, real Electron bench (mac + Windows, 2 datasets), budgets per plan §1, bundle-stats job.

What exists
- `apps/electron/src/main/startup-marks.ts` (146 lines): ring buffer (`MAX_MARKS = 256`, :19-28), `performance.mark`, `__roxStartupPerf` hook (:132-135), `main:entry` at :137, `monitorEventLoopDelay` (:139-146) — **only when `ROX_PERF=1`**, one-line log + `ROX_PERF_OUT` JSON (:99-124).
- Mark names in `apps/electron/src/shared/startup-perf.ts:10-37`: `main:entry/shell-env/app-ready/win-bootstrap:*/server-ready/window-created/ws-port-handed/skills-sync:{start,end,inline}`, `renderer:script-start/first-paint/fmp`. Call sites: `main/index.ts:17,656,707,736,749,805,808-809,1512,1756`, `window-manager.ts:290`.
  - Ticket names missing: `server:listen`, `server:sessions-listed`, `server:ready` (only `main:server-ready`), `renderer:snapshot-hydrated`, `session:{id}:{click,painted}`.
- Renderer: `renderer/lib/startup-perf.ts` (script-start :155, first-paint :90, fmp :96, route switch `endRouteSwitch` :113 used at `MainContentPanel.tsx:243`, `window.__roxPerf.dump` :151-152); `renderer:interactive:*` at `App.tsx:525`. Longtask observer exists only for the simulator (`renderer/perf/observers.ts:24-42`, used by `perf/runner.ts:34`).
- Bench: `apps/electron/scripts/perf/startup-bench.ts` (234 lines; not the ticket's `tests/perf/electron-bench.ts`), `perf:startup` (`package.json:56`); report-only, `--strict` optional (:205, :231). Warm-up probe `perf:warmup-probe` (`package.json:57`).
- CI: `.github/workflows/perf-budgets.yml` — `electron-startup` job report-only (`continue-on-error: true`, :95-98), `warmup-probe` (:127-145), `renderer-dom-budgets` (:149-160). **All jobs `runs-on: [self-hosted, macos-toolchain]`** (:61, :96, :129, :150); no Windows job.
- Bundle gate: `.github/workflows/bundle-size.yml:4` (2.5 MB), `scripts/check-bundle-size.ts:53` (`MAX_NEW_CHUNK_BYTES = 2_500_000`) — from #1636, not this ticket; no locale ≤ 1.5 MB check, no `rollup-plugin-visualizer`.

Missing
- `diagnostics:getPerfReport`, Settings → Diagnostics → Performance: no matches in `apps/` / `packages/`.
- `rpc-call-counter.ts` (76 lines) only counts calls (:34-51); no per-channel latency, payload bytes, or "RPCs before first paint".
- `scripts/bench/seed-fixture.ts`, `tests/perf/electron-bench.ts`: absent.
- `PerfBudget` `platform`/`dataset`: absent (`renderer/perf/budgets.ts:1-79` has neither; budgets still "Wave 0").

Criteria
- [ ] CI prints every plan §1 metric for Mac **and Windows** on **both datasets** — unmet (mac-only jobs, no datasets).
- [ ] Baselines recorded in PERF-UI-PLAN.md — unmet (file not in repo).
- [~] Budgets report-only; per-metric gates per §6 — report-only is true (`perf-budgets.yml:95-98`); gate switch-on schedule not implementable without §6.
- [ ] Marks add < 1 ms (measured) — unverifiable from code; no measurement artefact.

Verdict: **PARTIAL** — mark infrastructure and a mac report-only bench exist; Windows, datasets, reporting UI, rpc metrics and baselines remain.

## #1561 — [Perf P1] Skills sync: fingerprint short-circuit, worker thread, after first paint

Scope: O(1) sync stamp; worker_thread on mismatch after first paint; `skills.CHANGED`; remove double call.

Evidence
- Stamp: `packages/shared/src/skills/bundled-core.ts:226-320` (`SYNC_STAMP_FILE`, disabled list, state-file size/mtime :242-262, `isBundledSkillsSyncCurrent` :311). Build-time content fingerprint `bundled-fingerprint.ts:47-89` (packaged: one small read; dev: stat walk, no content reads).
- Worker: `bundled-sync.worker.ts` (15 lines) runs `runBundledSkillsSyncJob`; scheduler `bundled-background.ts:151-205` — gate → stamp → worker → inline fallback (:202).
- After first paint: `main/index.ts:803-811` (`after: whenStartupMark(rendererFirstPaint)`); gate timeout 15 s (`bundled-background.ts:170`).
- Double call removed: `claimAmbientBundledSkillsSync` + join of in-flight job (`bundled-background.ts:152-156`); headless path joins at `headless-start.ts:480`.
- CHANGED: `headless-start.ts:483-488` pushes `bundledSkills.CHANGED` + per-workspace `skills.CHANGED` on `synced`.
- Tests: `packages/shared/src/skills/__tests__/bundled-sync-stamp.test.ts` — 15 cases (:69-264) incl. "next launch is skipped without hashing" (:69), user edits preserved (:96), real worker entry (:214), agent wait (:222-264).

Criteria
- [x] Unchanged version ⇒ 0 files hashed — met (`…stamp.test.ts:69`; behavioural check, not fs spies as the ticket asked).
- [~] Version change ⇒ worker after first-paint; never blocks main > 50 ms — worker + gate met (`index.ts:805`, `bundled-background.ts:189-198`); the 50 ms bound is unverifiable; the inline fallback (`:202`) runs the full merge on the main thread.
- [x] User edits preserved — `…stamp.test.ts:96`.
- [~] Bench: no skills-sync span in `main:entry → window-created` — structurally true (gate = renderer first paint, after window creation at `index.ts:726`), but `startup-bench.ts` only reports `skillsInlineMs` (:67, :82); no assertion.

Merged PRs: #1601 (closed) via #1604.
Verdict: **PARTIAL, functionally complete** — remaining: a bench assertion (belongs with #1560).

## #1562 — [Perf P1] Non-blocking platform environment (macOS shell env, Windows toolchain)

Evidence
- macOS: `shell-env.ts` — cache keyed by `$SHELL` + size/mtime of 7 rc files (:92, :174-182), 24 h TTL (:93), secret filtering (:85, :164); `startShellEnvLoad` applies cache synchronously (:328-338); async `execFile` capture (:240).
  - Complete, fresh cache: refresh deferred 3 s (:368-372).
  - **Cache miss / expired / incomplete: `refresh()` is called immediately (:373-374)**, i.e. at module evaluation via `index.ts:14`, before `app.whenReady` and the window.
- Spawn gate: `registerSpawnEnvGate('shell-env', …)` `index.ts:15`; `packages/shared/src/toolchain/spawn-readiness.ts` (67 lines); 12 non-test `whenSpawnEnvReady(` call sites.
- Windows: bootstrap now after window creation (`index.ts:726` window, `:735-771` bootstrap); parallel + cached probes (`windows-bootstrap.ts:95-116`, probe cache keyed by app version :52-66); `bootstrap.ps1` only via `scheduleWindowsBootstrapRepair` after first paint with backoff (`index.ts:753-770`, `windows-bootstrap.ts:250-313`, backoff :132, 1 h doubling to 7 d per :251).
- `ToolchainStatusBanner.tsx` exists with test `__tests__/toolchain-status-banner.test.ts`.
- Tests: `main/__tests__/startup-readiness-wiring.test.ts`, `main/__tests__/windows-bootstrap.test.ts`, `toolchain/__tests__/spawn-readiness.test.ts`, `builtin-mcp-startup.test.ts`.

Criteria
- [ ] No child-process spawn in `main:entry → main:window-created` (asserted in bench) — **unmet**: on first launch, an expired cache (>24 h) or a cache with filtered secret keys (`cacheComplete` false, :339), the login shell is spawned before the window; the bench has no spawn assertion.
- [~] Windows w/o jq/yq: window ≤ 500 ms; `bootstrap.ps1` never on startup path — `bootstrap.ps1` off path: met (`index.ts:747`, comment "never runs bootstrap.ps1 here"); ≤ 500 ms unverifiable (no Windows CI).
- [x] Agents still get full login PATH — gate + tests above.

Merged PRs: #1601 via #1604. Verdict: **PARTIAL** — defer the macOS cold-cache spawn past window creation and add the bench assertion.

## #1563 — [Perf P1] Boot path without network: list LLM connections without OAuth refresh

Evidence
- `{refresh:false}` option: `packages/server-core/src/handlers/rpc/llm-connections.ts:162-170`; background single-flight refresh + `llmConnections.CHANGED` push `:172-196` (`setTimeout(…, 0)`, per-slug set :172-182).
- Boot callers: `rox-runtime-default.ts:53-54, 82-83`; `App.tsx:1019, 1035` pass `{ refresh: false }`.
- Tests: `rpc/__tests__/llm-connections-startup-refresh.test.ts` — 5 cases (:80 refresh:false + background, :97 legacy, :106 failure surfaced, :118/:128 single-flight); also `onboarding/__tests__/rox-runtime-default.test.ts`, `lib/__tests__/startup-caller-boundary.test.ts`.

Criteria
- [ ] Zero network calls before `renderer:first-paint` (bench with network logging) — unverifiable/unimplemented bench; note the background refresh fires on the next tick after the listing (`:183-195`), not explicitly after paint.
- [x] Expired tokens refresh within 5 s after paint, UI updates via CHANGED — refresh at t+0 and push (`:185-187`); renderer relies on CHANGED (`App.tsx:1155`).
- [x] Unit tests for refresh:false and background refresh — present.

Merged PRs: #1603 (merged 2026-10-08; body: "covers the core of #1563"). Verdict: **PARTIAL (code complete)** — only the network-logging bench remains.

## #1572 — [Perf P2] Paint-first boot: boot snapshot, async server handshake, StartupScheduler

Evidence (met)
- Window before server bootstrap: `main/index.ts:673-733` ("PERF-01 shell-first boot"; `createInitialWindows` :726, then vault/proxy/server). Landed via #1601/#1604 and #1642 (`69a9d4ab4`).
- Async port: `ipcMain.handle('__await-ws-port')` `index.ts:704-709`; preload falls back to it `preload/bootstrap.ts:139-145`.
- `initGate` in `SessionManager.ts:1683, 1741, 3054-3057` (pre-existing).

Missing
- Preload still has **9** `ipcRenderer.sendSync` calls (`preload/bootstrap.ts:77, 107, 139, 148, 152, 193, 265, 670, 750`), incl. `__get-ws-port` (:139) and the entities flag `entities:syncLinksState` (:750).
- No `boot-snapshot.json`, `boot:snapshot`, `bootstrap:snapshot`, `StartupScheduler`, `epoch`, `module.enableCompileCache`; `packages/server-core/src/handlers/rpc/bootstrap.ts` absent (all greps empty).

Criteria
- [ ] Window ≤ 300/500 ms — unverifiable; CI says runner medians 1563–2633 ms vs ×4 budget (`shared/startup-perf.ts` comment above `STARTUP_BUDGETS`).
- [ ] FMP ≤ 0.8/1.5 s; interactive ≤ 1.5/2.5 s — unverifiable; no snapshot hydration.
- [ ] ≤ 2 RPCs before paint; 0 `sendSync` — unmet (9 sendSync; no counter for pre-paint RPCs).
- [ ] Epoch-mismatch tests — unmet.
- [ ] Security review of handshake proof/snapshot — unmet (no snapshot).
- [ ] CI gates enforce — unmet (`perf-budgets.yml:95-98` report-only).

Verdict: **PARTIAL (≈20 %)** — only the shell-first window ordering and async port wait.

## #1573 — [Perf P2] V8 code cache for renderer (app://) and main (compile cache)

Evidence: renderer still loaded via `window.loadFile(join(__dirname,'renderer/index.html'))` (`window-manager.ts:451, 453, 467, 487`); only privileged scheme is `thumbnail` without `codeCache` (`thumbnail-protocol.ts:107-121`); CSP still `script-src 'self'` with `file:`/`thumbnail:` img-src (`renderer/index.html:6`); no `enableCompileCache`.
Criteria: all three unmet (bench/e2e). Merged PRs: none. Verdict: **NOT STARTED**.

## #1574 — [Perf P2] Notes: tasks projection, incremental native journal, watcher-driven vault index

Evidence
- No `notes:listTasks` channel/handler (grep: only unrelated MCP/skill code).
- Native journal: `nativeNoteEntities` pulls from `afterSequence = 0` in pages of 100 on every call (`rpc/notes.ts:1509-1524`); called by LIST and 4 other paths (`:1580, 1637, 1709, 1881`). No snapshot cache.
- Vault index: `notes.LIST` local path calls `refreshVaultIndex(notesRoot)` every time (`rpc/notes.ts:1889` → `ensureVaultIndex` → `rebuildInto(db, root, false)` `vault-index.ts:659-688`).
- Renderer (from #1618): principal mode extracts tasks from listed content, 0 `readNote` (`NotesPage.tsx:1050-1059`); local mode still issues one `readNote` per changed note (`:1071`).

Criteria
- [ ] 3,000 notes: ≤ 3 RPCs, no `readNote` loop, ≤ 300 ms (native **and** local) — principal-mode loop removed; local loop remains; timing unverifiable.
- [ ] `notes:listTasks` payload ≤ 256 KB — unmet (no RPC).
- [ ] notes-list-bench — unmet (none found).

Merged PRs: #1618 (refs #1576, PERF-09 slice). Verdict: **PARTIAL (≈15 %)**.

## #1575 — [Perf P2] Kill re-render storms

Evidence
- `NavigationContext.Provider value={{ … }}` inline object (`contexts/NavigationContext.tsx:1566-1583`) → new value per render; provider subscribes to whole map `useAtomValue(sessionMetaMapAtom)` (:222-223). No actions/state split.
- No per-session meta selectors (`selectAtom` absent in `atoms/sessions.ts`; only `sessionAtomFamily` :174, `backgroundTasksAtomFamily` :794). **33** renderer files subscribe to the whole `sessionMetaMapAtom`.
- Feed meta-triggered refetch still present: `FeedPage.tsx:361-368` (1500 ms debounce on any `sessionMap` change).
- Inbox counts unmemoized: `pages/inbox/InboxQueue.tsx:185-193` — `filterInbox` 5× via `countFor` + 1× blocking + 1× per kind (`EVERY_KIND`+activity kinds) per render.

Criteria: all four unmet/unverifiable. Merged PRs: none. Verdict: **NOT STARTED**.

## #1576 — [Perf P2] One shared persisted client cache

Evidence
- Deps: `@tanstack/react-query ^5.104.1`, `idb-keyval ^6.3.0` (`apps/electron/package.json:61, 70`).
- `renderer/lib/query/*` (983 lines): `client.ts:38-43` (`staleTime: Infinity`, `gcTime` 30 min :12), `event-bridge.ts`, `keys.ts`, `persist.ts`, `shared-read.ts`, `notes-cache.ts`.
- Keys (`keys.ts:9-30`): `workspace-work`, `notes-list`, `notes-tasks`, `agents-catalog`, `feed`, `inbox`. Consumers: `useInboxItems.ts`, `useWorkspaceWork.ts`, `shell-warmup.ts`, `AgentProfilesView.tsx`, `FeedPage.tsx`, `NotesPage.tsx:61`.
- Persisted: only `notes-list` + `agents-catalog` (`persist.ts:16`), `content` projected out (:73-77), buster `rox-query-v2` (:18), one workspace per principal.
- Tests: `lib/query/__tests__/` 5 files; `query-cache.test.tsx:73` (one request per key), `:161` (one workspace, metadata domains only), `:310` (revisit paints with zero reads), `:420` (runtime starts before first render).

Criteria
- [~] Revisit of migrated surfaces = 0 blocking fetches — met for the migrated set (`:310`); skills summaries, sources, calendar, mail, AgentCenter not migrated (no `lib/query` import in those hooks/pages; `useMail.ts`/`AgentCenterPage.tsx` paths in ticket no longer exist).
- [~] After restart, last surface paints from persisted cache before server ready — only for Notes list / agents catalog (`persist.ts:16`).
- [x] No duplicate in-flight requests per key (test) — `query-cache.test.tsx:73`.
- [x] Persisted store holds no message bodies/secrets (test) — `:161` + `persist.ts:6-16`.

Merged PRs: #1618 (body: "Refs #1576"). Verdict: **PARTIAL (≈60 %)**.

## #1577 — [Perf P2] Keep-alive SurfaceHost + idle warm-up + hover/focus prefetch

Evidence
- `lib/surface-keepalive.tsx` (232 lines): capacity 5 / low-memory 3 (:20-22, `deviceMemory` :67-71), `hidden` + `content-visibility: hidden` (:141-157), `useSurfaceActive`/`useEffectiveVisible` (:110-130); wired in `MainContentPanel.tsx:66, 261, 277-279`.
- `lib/route-preload.ts`, `components/app-shell/route-pages.ts`, `lib/shell-warmup.ts`.
- `lib/warmup.ts` (311 lines): 4 ms slices (:16), steps incl. transcript tails, notes-tasks, skills-sources, inbox-feed, calendar (:28-33), input cancels on pointerdown/keydown/wheel (:76), battery/low-memory top 3 (:17).
- Intent prefetch: `ActivityRail.tsx`, `ModesRailGroup.tsx`, `LeftSidebar.tsx`, `SessionItem.tsx`; note-row prefetch dropped (`docs/perf/PERF-10-keepalive-surfaces.md:45`).
- Self-assessment: `docs/perf/PERF-10-keepalive-surfaces.md:36-57`.

Criteria
- [~] 5-surface switch p95 ≤ 100 ms (CI gate on) — gate `surface_revisit` `ciGate: true` (`perf/budgets.ts:62-68`), but samples come from a simulator (`docs/perf/PERF-10…md:41`); real app unverifiable.
- [~] First visit after warm-up ≤ 200/250 ms — `surface_first_warm` (`budgets.ts:69-75`), simulator only, no Windows figure.
- [~] Warm-up ≤ 1.5 s CPU, ≤ 25 MB, no long task > 50 ms, input preempts — CPU/slice/input unit-tested (`lib/__tests__/warmup.test.ts`); 25 MB only report-only (`perf-budgets.yml:123-130`).
- [~] Hidden surfaces 0 timer-driven RPCs — met for Inbox/Feed/Home/Cloud-run/Decisions/Radar/Dossier/Agent-center (doc :45); Focus/Meetings/Mail explicitly out of scope; 9 files use the visibility hooks.

Merged PRs: #1696 (2026-10-09, refresh of closed #1620), #1710. Verdict: **PARTIAL (≈85 %)** — real-app gates, remaining pollers, note-row prefetch.

## #1578 — [Perf P2] Virtualize every list

Evidence
- `EntityList` has opt-in custom windowing (`components/ui/entity-list.tsx:10, 51` threshold 40, `:667`); sticky headers in windowed mode (#1671). Not `@tanstack/react-virtual` (not a dependency).
- Only consumer passing `virtualize`: `SessionList.tsx:1491` (1 of 14 `EntityList` consumer files). Notes sidebar windowed separately (`pages/notes/NotesNavigationSidebar.tsx`, test `notes-tree-windowing.test.ts`; #1642).
- No exported `VirtualList`; Inbox (`pages/inbox/*`), `FeedPage.tsx`, calendar: no windowing.
- DOM budgets job (2,000 sessions / 5,000 notes): `perf-budgets.yml:146-160`.

Criteria
- [ ] 10k-row scroll ≤ 1 %/3 % dropped frames, CI gate — unmet (2k/5k DOM budgets only, mac only).
- [~] DOM nodes ≤ 2× visible rows — plausible for SessionList/notes only; unverifiable elsewhere.
- [~] Keyboard/roving focus/DnD/a11y tests — windowed EntityList tests exist (`entity-list-virtualization.test.ts`, `entity-list-windowed-headers.test.tsx` per #1671); not for other lists.

Merged PRs: #1636 (`d97972484`), #1642, #1671 (advisor-plans numbering). Verdict: **PARTIAL (≈25 %)**.

## #1579 — [Perf P2] Replace polling with events; one visibility-paused refresh scheduler

Evidence
- Pollers still present but visibility-gated: inbox 60 s (`hooks/useInboxItems.ts:208-217`, guarded by `visible`), clock 60 s (:141), feed 60 s (`FeedPage.tsx:345-354`, deps include `surfaceVisible`).
- `feed.CHANGED` exists server-side (`rpc/feed.ts:92`, `channels.ts:1208-1210`); **no inbox `CHANGED` channel** in `channels.ts`.
- No central slow-refresh scheduler (no match for scheduler names).
- 68 `setInterval(` call sites in non-test renderer code; 26 files with `setInterval` that never reference `useEffectiveVisible`/`useSurfaceActive`/`visibilityState`/`document.hidden`.

Criteria
- [ ] Hidden window: 0 RPCs/min besides heartbeat — unverifiable; unlikely given 26 ungated files.
- [ ] Visible idle ≤ 2 RPCs/min — unverifiable; inbox + feed alone poll 2/min while visible.
- [ ] Changes appear within 1 s via events (tests) — unmet for inbox (no emitter).

Merged PRs: #1696 (poller gating part). Verdict: **PARTIAL (≈20 %)**.

## #1586 — [Perf P3] Run server-core in an Electron utilityProcess

Evidence: `apps/electron/src/main/server-host.ts` absent; `utilityProcess` used only by the extension host (`main/extension-host/protocol.ts:3, 84`, `worker.ts:4`). server-core still in-process (`index.ts:1512` `serverReady` mark after in-process bootstrap).
Criteria: all unmet. Verdict: **NOT STARTED**.

## #1587 — [Perf P3] Append-only session journal and narrowed config watcher

Evidence: persistence still rewrites the whole transcript via tmp + rename (`sessions/persistence-queue.ts:188-197`; `jsonl.ts:162-180`); watcher still `watch(workspaceDir, { recursive: true })` (`config/watcher.ts:421`).
Criteria: all unmet. Verdict: **NOT STARTED**.

## #1588 — [Perf P3] Transport fast path

Evidence: `serializeEnvelope` = `JSON.stringify(encodeWireValue(...))`, `deserializeEnvelope` = `decodeWireValue(JSON.parse(raw))` — unconditional deep walks (`transport/codec.ts:141-151`, recursive `Object.fromEntries` :104). No MessagePort transport.
Criteria: all unmet. Verdict: **NOT STARTED**.

## #1589 — [Perf P3] Chat: tail windows, virtualized timeline, rAF-coalesced streaming

Evidence: no `getMessagesWindow`/`tailTurns`; full `sessions:getMessages` (`channels.ts:60`); `ChatDisplay` renders a growing turn slice (`TURNS_PER_PAGE = 20`, `visibleTurnCount` :740-741, grows at :1381), no virtualization; no delta buffer (rAF in `ChatDisplay.tsx` is scroll-only, e.g. :1073, :1513). PR #1707 matched the search only by text.
Criteria: all unmet. Verdict: **NOT STARTED**.

## #1590 — [Perf P3] Worker-based code highlighting and large-markdown parsing

Evidence: `apps/electron/src/renderer/workers/` absent; no `new Worker(`/`comlink` in `packages/ui/src` or renderer. #1603 made Shiki lazy (PERF-04 scope), still main-thread.
Criteria: all unmet. Verdict: **NOT STARTED**.

## #1591 — [Perf P3] Memory LRUs and a memory watchdog

Evidence: no `app.getAppMetrics` use in `apps/electron/src/main`; no transcript LRU in `atoms/sessions.ts` (only metadata-only unload bookkeeping :398-447) or `SessionManager.ts` (only `evictStaleBackgroundTasks` :9247). Only unrelated LRU: thumbnails (`thumbnail-protocol.ts:29-52`).
Criteria: all unmet. Verdict: **NOT STARTED**.
