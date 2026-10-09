# V8 — app smoke: does the product boot with all eight slices merged?

- Repo: `/Users/t/Projects/rox-one-port` (worktree, branch `port/openclaw-features`)
- HEAD: `cdcd4c50f` (contains merged main @ merge `9927e86eb`)
- Platform: darwin 27.0.0 arm64 · bun 1.4.2 · electron 39.2.7 · @playwright/test 1.49.1
- Date: 2026-10-09
- Verdict: **PASS (boots, no wave-1 runtime throw) — with one caveat on the reported budget numbers** (see (a)).

## Method

Method (1) from the ticket — the repo's own startup bench — was usable, so (2)/(3)
were not needed.

```sh
bun run electron:build          # ~103 s, exit 0 (subprocess+main+preload+renderer+resources+assets)
bun run perf:startup -- --runs 3 --timeout 60000 --md /tmp/v8-startup.md --out /tmp/v8-startup.json
timeout 120 /tmp/v8-launch.sh   # direct launch of dist/main.cjs, stdout/stderr captured
```

Environment note (not a source change): `node_modules/electron/dist` was missing
`Electron.app` (the postinstall had not extracted the binary; `require('electron')`
threw "Electron failed to install correctly"). I restored it by extracting the
cached `~/Library/Caches/electron/electron-v39.2.7-darwin-arm64.zip` into
`node_modules/electron/dist` and writing `path.txt`. No repo source/test/config
was modified.

## (a) Reaches a stable surface + budget

Bench (`bun run perf:startup`, CI budgets ×4 because `CI=true` in this shell —
same relaxation the CI job uses). `--runs 3` → 1 cold + 3 warm; all 4 runs ok:

```
[startup-bench] run 0 (cold): window=2832ms fmp=3952ms
[startup-bench] run 1 (warm): window=2991ms fmp=3892ms
[startup-bench] run 2 (warm): window=3388ms fmp=4306ms
[startup-bench] run 3 (warm): window=2662ms fmp=3493ms

| metric                        | warm median (ms) | budget (ms) | status |
| window-created                | 2991             | 1200        | OVER   |
| first-meaningful-paint        | 3892             | 3200        | OVER   |
| first-meaningful-paint (cold) | 3952             | 120000      | PASS   |
```

CAVEAT: on every run the FMP source is `renderer:interactive:onboarding`, not
`renderer:fmp` — the app settles on the onboarding surface (fresh isolated
profile, so the session list/'splash gate' is never reached; this is the bench's
documented fallback, README §Cold vs warm). So the "FMP" figure is the
onboarding interactive paint, and the app did reach a first stable surface in
all runs. The bench itself is **report-only / non-blocking** in CI
(`.github/workflows/perf-budgets.yml`, job `electron-startup`,
`continue-on-error: true`), and the budgets in `apps/electron/src/shared/startup-perf.ts`
(darwin window ≤300 ms / FMP ≤0.8 s, ×4 in CI) are the audit reference, not a
gating contract. Verdict: app booted to a stable surface (PASS); warm medians are
over the ×4 reference budget (reported, not a regression claim — no baseline exists, see (c)).

Direct launch (`timeout 120 /tmp/v8-launch.sh`, isolated profile, ROX_PERF=1),
`perf.json` marks (ms since main start):

```
main:entry=1666  main:shell-env=2284  main:app-ready=2424  main:server-ready=2704
main:window-created=2901  main:ws-port-handed=3299  renderer:script-start=3450
renderer:first-paint=3532  main:skills-sync:start=3533  renderer:interactive:onboarding=3676
eventLoopDelay { p50: 11.5, p99: 40.5, max: 984.1 }
```

`main:skills-sync:inline` is absent → the bundled-skills merge ran in the worker
(healthy path per README; no main-thread fallback).

## (b) No unhandled exception / rejection referencing wave-1 modules

Direct-launch logs: `/tmp/v8-app-stdout.log` (759 lines), `/tmp/v8-app-stderr.log` (976 lines).

```sh
grep -cE "\bERROR\b|\bFATAL\b" /tmp/v8-app-stderr.log      # -> 0
grep -iE "UnhandledPromiseRejection|uncaughtException|throw new|AssertionError|Segmentation|crash" ... # -> no matches
grep -iE "no handler|unknown channel|not registered|handler not found" ...   # -> no matches (clean WS/RPC boot)
```

The only WARN/ERROR-tagged lines are:

```
WARN  [main] Bundled uv binary missing, CLI document tools may fail unless uv is available on PATH.
17× WARN [session] memory: MemoryService: distiller failed for <session>: runMiniCompletion returned null
```

- The `distiller failed` WARN path is **pre-existing**: identical string on
  `origin/main:packages/server-core/src/memory/MemoryService.ts:704` (`git show
  origin/main:... | grep`), and it fires because no model host was configured in
  this isolated profile (`runMiniCompletion` → null). It is a caught+logged warn,
  not an unhandled throw.
- The `uv` warning and the `maturin`/`pydantic-core` build failures in stderr
  (lines ~80–200) are MCP source provisioning for the `qdrant` server (uv tried
  to build pydantic-core under CPython 3.14), unrelated to any wave-1 slice.
- Shutdown was graceful: `[EventBus] Disposing…` / `[AutomationSystem] Disposed`
  at the tail; process ended on my SIGTERM/SIGKILL, no crash.

Verdict: no wave-1 module threw at runtime. PASS.

## (c) Measured startup vs recorded baseline

No committed startup baseline exists in the repo:
`find` for `*electron-startup*` → none; `perf-baselines/` contains only
`bundle-size.json` (that is what commit `5a4f2236d` re-recorded — renderer bundle
size, not startup). The only startup reference is the budget table in
`apps/electron/src/shared/startup-perf.ts` and the report-only CI job.

Measured (this machine, this HEAD): warm window-created **2991 ms**,
warm FMP **3892 ms**, cold FMP **3952 ms**. vs CI ×4 budgets: window OVER
(+1791 ms), FMP OVER (+692 ms), cold PASS. No historical number to compare a
delta against.

## (d) New IPC channels present

From the built bundle (the ticket's fallback: "else from the built bundle"),
each literal present in BOTH `apps/electron/dist/main.cjs` (handler side) and
`apps/electron/dist/bootstrap-preload.cjs` (client side):

```
sessions:assignOwner            main=1 preload=1   (S1)
meetings-local:observe-start    main=1 preload=1   (S6)
meetings-local:observe-stop     main=1 preload=1   (S6)
meetings-local:observe-ingest   main=1 preload=1   (S6)
serviceLifecycle:getStatus      main=1 preload=1   (S7)
serviceLifecycle:install        main=1 preload=1   (S7)
serviceLifecycle:statusChanged  main=1 preload=1   (S7)
voice:talkStart                 main=1 preload=1   (S8)
voice:ttsStreamChunk            main=1 preload=1   (S8)
voice:trigger                   main=1 preload=1   (S8)
voice:wakeGet / voice:wakeSet   main=1 preload=1   (S8)
```

The running app logged no missing/unknown-handler error, and the renderer
completed its boot handshake (`main:ws-port-handed` → `renderer:first-paint`).
S3's handoff mint (`POST /handoff/mint`) is an HTTP route in the embedded server,
not an Electron IPC channel, so it does not appear in this channel set.
Verdict: PASS (channels bundled on both sides; no handler-resolution errors at runtime).

## Cleanup

```sh
pgrep -fl "rox-one-port|startup-bench|dist/main.cjs"   # -> none
pgrep -fl "Electron.app/Contents/MacOS"                # -> none
lsof -nP -iTCP -sTCP:LISTEN | grep 19xxx               # -> none of mine
```

The bench removed its own temp profile; the direct-launch profile
(`/tmp/v8-profile-r6vUb4`) was deleted. No electron/bench process or port survived.

## Unproven / not tested

- True `renderer:fmp` (session-list paint) on a populated profile was not
  exercised — the isolated profile always settles on onboarding, so the
  "reaches the session list" surface is unproven (only "reaches onboarding").
- No startup baseline exists to attribute the over-budget warm medians to the
  port vs this machine vs the fresh-profile onboarding path.