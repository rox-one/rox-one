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
