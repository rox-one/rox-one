# PERF-10 (#1577) — keep-alive surfaces, route preloads, idle warm-up

Owner decision D2: *warm everything in the background, keep the last five pages
alive, and prefetch on intent.* This note records the contract, the acceptance
criteria from #1577 and what is (and is not) verified in CI.

## Contract

| Piece | Where | Meaning |
|---|---|---|
| Keep-alive host | `renderer/components/app-shell/MainContentPanel.tsx` | Retains the last visited surfaces; the active pane is `display: contents`, a retired one is `hidden` + `content-visibility: hidden` and inert. |
| Retention policy | `renderer/lib/surface-keepalive.tsx` | `advanceRetention` (pure LRU), `useKeepAliveSurfaces`, capacity 5 / 3 (low memory) / 1 (`rox:surface-keepalive = off`). |
| Activity contract | `renderer/lib/surface-keepalive.tsx` | `useSurfaceActive()` → is this surface visible; `useEffectiveVisible()` → window visible **and** surface active (the one polling code uses). |
| Route registry + preload | `renderer/components/app-shell/route-pages.ts`, `renderer/lib/route-preload.ts` | One loader per lazy page; `preloadRoute(name)` memoizes the chunk import that `React.lazy` will reuse; `RAIL_SURFACE_ROUTES` lists the rail surface chunks. |
| Warm-up queue | `renderer/lib/warmup.ts` | Ordered, idle-sliced, cancellable background read plan (see below). |

Warm-up order (each step reads with the same function its page uses, so the
result lands in the shared query cache):

1. `sessions-meta` — the session map the shell paints from.
2. `transcript-tails` — tails of the three most recently used sessions.
3. `notes-tasks` — the notes listing (PERF-09 task cache derives from it).
4. `skills-sources` — skills and sources catalogs.
5. `agent-profiles` — the agents catalog.
6. `inbox-feed` — the inbox/feed remote sources.
7. `calendar` — the current and the next week.
8. `route-chunks` — every rail surface's chunk via `preloadRoute`.

Slices are bounded at 4 ms and reported as `longestSliceMs`; the queue keeps a
1.5 s synchronous-CPU budget, is cancelled by `pointerdown`/`keydown`/`wheel`,
and keeps only the first three steps on battery (`navigator.getBattery`) or low
memory (`navigator.deviceMemory <= 4`).

Retention is per panel instance: the main content panel and each auxiliary
panel own their LRU (a split view keeps its own five).

## Acceptance from #1577

| Criterion | Status | Evidence |
|---|---|---|
| Switching among any 5 visited surfaces: p95 ≤ 100 ms (CI gate **on**) | gated | `surface_revisit` budget (`perf/budgets.ts`), samples from `simulateSurfaceKeepAlive` driven by the real `advanceRetention`; a capacity < 5 fails the gate (`perf/__tests__/surface-keepalive-sim.test.ts`). |
| First visit to any surface after warm-up ≤ 200 ms (Mac) / 250 ms (Windows) | gated at 200 ms | `surface_first_warm` budget with **zero** `sessions.list`/`sessions.messages` per sample; a skipped warm-up fails the gate. |
| Warm-up ≤ 1.5 s idle CPU, no long task > 50 ms, input preempts | verified | CPU budget and input cancellation in `lib/__tests__/warmup.test.ts`; the model asserts `longestSliceMs ≤ 4 ms` (≤ the 50 ms long-task bound). |
| Warm-up ≤ 25 MB | measured, report-only | Packaged probe `apps/electron/scripts/perf/warmup-heap-probe.ts` (CI job `warmup-probe`, `continue-on-error: true`): renderer JS-heap delta after a forced GC, plus `longtask` entries; the structural bounds stay the retention capacity (≤ 5 surfaces) and the metadata-only persisted cache from #1576. |
| Hidden surfaces make 0 timer-driven RPCs | verified for the surfaces named for #1577 | `useEffectiveVisible()` gates their pollers: the Inbox/Feed pollers, the Home widget clocks, the Cloud-run host, and the Extra-screen pollers (Decisions / Radar / Dossier / Agent-center). A retired surface clears its interval and resumes it when re-activated. The session-row intent prefetch reads through `ensureSessionMessagesLoadedAtom` — the same loader ChatPage dispatches when the session opens, so the read lands in the atom cache; the note-row prefetch was dropped because note documents are not cached and the read was thrown away. Other surfaces (Focus/Meetings/Mail, dialogs, timers that issue no RPC) are out of scope. `surface_revisit`/`surface_first_warm` gate zero `sessions.messages`/`sessions.list`; the pause contract is covered by `renderer/lib/__tests__/surface-keepalive.test.tsx`. |

Run the gate locally:

```bash
cd apps/electron
bun test src/renderer/perf                                  # models + budgets
bun run ../../scripts/bench/renderer-perf-report.ts --ci    # CI gate over the budget table
```

Known gaps (honest list): no Windows machine in this environment, and the
packaged numbers (`warmup-probe`) are report-only, JS-heap-only — they measure
the renderer, not DOM/C++ or main-process memory, and they do not gate a merge.
Everything else is exercised by unit tests plus the CI budget gate.