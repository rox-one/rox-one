# Electron startup bench (PERF-01)

`startup-bench.ts` launches the **built** app (`apps/electron/dist/main.cjs`)
through Playwright's Electron driver with an isolated profile and `ROX_PERF=1`,
reads the startup timeline (`globalThis.__roxStartupPerf` in main; renderer
marks are forwarded over IPC) and compares warm medians to the PERF-AUDIT
budgets (window ≤ 300 ms macOS / ≤ 500 ms Windows; FMP ≤ 0.8 s / ≤ 1.5 s).

```sh
bun run electron:build
bun run perf:startup -- --runs 5            # report only
bun run perf:startup -- --runs 3 --ci --md electron-startup.md --out electron-startup.json
# Linux: wrap in `xvfb-run -a` (DISPLAY and XAUTHORITY must reach the child).
```

Flags: `--runs N` (default 5), `--ci` (budgets ×4 for shared runners/xvfb;
implied by `CI=true`), `--strict` (exit 1 when a budget is exceeded), `--out`
(JSON), `--md` (Markdown table), `--main <path>`, `--timeout <ms>`,
`--profile <dir>` (reuse a profile instead of a fresh temp dir).

## Cold vs warm runs

- **Run 0 is cold**: fresh profile — first install, so the bundled-skills stamp
  misses and the full hash-merge runs (in a worker after first paint), caches
  are empty. Reported separately, never checked against budgets.
- **Runs 1..N are warm**: same profile; these medians are what the budgets and
  the CI job (`.github/workflows/perf-budgets.yml`, `electron-startup`) check.

The run table has a `skills inline` column: it shows the time of the
`main:skills-sync:inline` mark when the merge fell back to the main thread
(worker script missing or crashed). On a healthy build it is empty.

## Warm-up probe (PERF-10, `perf:warmup-probe`)

`warmup-heap-probe.ts` launches the built app like the startup bench, waits for
`window.__roxWarmup()` (the `shell-warmup.ts` diagnostics hook) to report a
terminal queue state, and prints **one** JSON document:

| field | meaning |
|---|---|
| `cpuMs` | idle CPU the queue spent (`≤ 1.5 s`) |
| `longestSliceMs` | longest idle slice (`≤ 50 ms`) |
| `heapDeltaMb` | renderer V8 heap growth — `Runtime.getHeapUsage` after `HeapProfiler.collectGarbage` over the CDP session, else `performance.memory` (`≤ 25 MB`) |
| `longTasks` | `longtask` PerformanceObserver summary; `over50Ms` is the criterion |
| `retainedSurfaces` | mounted keep-alive panes when the queue settled |
| `probeOk`, `note` | whether the measurement completed, with every boundary spelled out |

```sh
bun run electron:build
bun run perf:warmup-probe -- --out warmup-probe.json       # report only
bun run perf:warmup-probe -- --profile /tmp/rox-profile    # reused (warm) profile
# Linux: wrap in `xvfb-run -a`.
```

Flags: `--out <path>`, `--main <path>`, `--timeout <ms>`, `--profile <dir>`,
`--attempts N` (default 2 — a first-run profile has no workspace to warm, so the
second launch on the same profile is the one measured). The probe exits 1
whenever it could not measure: a missing `dist/main.cjs`, a renderer without the
hook (stale build), or a queue that never settles. It prints the JSON and the
reason on stderr either way. The CI job (`warmup-probe`) is report-only
(`continue-on-error: true`) and archives `warmup-probe.json`.

Boundaries: the heap is the renderer's JS heap only (DOM/C++ and the main
process are not counted) and `longTasks` covers the measured window's renderer
from the observer install onwards.

## Dev / unstamped bundles: fingerprint walk

`bun run electron:build` (via `electron:build:resources`) writes
`dist/resources/skills/bundle-fingerprint.json`, so the startup stamp check
is O(1): read that file and stat the state files.

Bundles **without** that file — running from source/dev
(`apps/electron` `bun run build` / `bun run start`, which copy resources via `build:copy`, or `vite dev`), or any
build that skipped `electron:build:resources` — fall back to computing the
fingerprint by walking the bundle: an `lstat` of every bundled file (~5.7k
files) on the **main thread** after first paint, and, on a stamp miss, again
inside the worker before merging. This is expected and costs tens to a few
hundred milliseconds depending on disk cache; it does not affect packaged
builds. Bench numbers from such builds are therefore not comparable to CI —
always bench `electron:build` output.
