# Plan 003: Make the startup bench use the real HOME (keychain) and gate the cold run

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4418fca40..HEAD -- apps/electron/scripts/perf/startup-bench.ts apps/electron/scripts/perf/__tests__/startup-bench.test.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `4418fca40`, 2026-10-09

## Why this matters

The Electron startup bench (`apps/electron/scripts/perf/startup-bench.ts`) is
the *only* automated metric that could catch a regression in fresh-profile
("cold") startup — the case that was observed to take ~75 s. Today it cannot:
(1) it launches the app with `HOME`/`USERPROFILE` pointed at an empty temp
directory, which makes Chromium `safeStorage` unavailable on macOS, so the app
fails closed before rendering and the cold run never produces a meaningful
paint mark; and (2) even if it did, run 0 is explicitly excluded from the
budget check ("run 0 ... reported separately; runs 1..N ... are the ones
checked"). Net effect: the one metric that matters is both mismeasured and
ungated.

A sibling harness fixed the HOME problem already
(`tests/e2e/product-tour/native-harness.ts:50-53`), and the CSP/app code reads
the app's own isolation env vars (`ROX_CONFIG_DIR`, `ROX_USER_DATA_DIR`), so
the bench can keep real profile isolation *and* keep the login keychain
reachable. This plan makes the bench mirror that harness, keeps the cold run
measured and reported, adds a generous explicit cold budget line, and makes a
missing FMP a loud failure instead of a silent "NO DATA" table cell.

## Current state

All paths are relative to the repo root (`/Users/t/Projects/archive/rox-one-e01-wt`).

- `apps/electron/scripts/perf/startup-bench.ts` — the bench. Launches the
  built app (`apps/electron/dist/main.cjs`) via Playwright's Electron driver,
  reads `globalThis.__roxStartupPerf`, and compares medians against the shared
  budgets. Contains the two bugs.
- `apps/electron/scripts/perf/__tests__/startup-bench.test.ts` — the existing
  unit test for the bench (imports `median`, `metricsFromTimeline`). This is
  the structural pattern for the new tests.
- `tests/e2e/product-tour/native-harness.ts` — the *fixed* sibling; the source
  of the exact env shape to copy.
- `apps/electron/src/shared/startup-perf.ts` — the shared budgets + mark names.
  **Frozen by this plan** (do not edit).
- `.github/workflows/perf-budgets.yml` — the CI consumer. **Frozen by this
  plan** (do not edit).
- `apps/electron/src/main/index.ts:322-330` — where main reads
  `ROX_USER_DATA_DIR` / `CRAFT_USER_DATA_DIR`.
- `packages/shared/src/config/env.ts:204-217` — `resolveConfigDir()`, which
  reads the config-dir override via `getEnv('CONFIG_DIR', env)`
  (`packages/shared/src/config/env.ts:71-81`), i.e. `ROX_CONFIG_DIR` then
  `CRAFT_CONFIG_DIR`.
- `apps/electron/src/main/pocket-account-store.ts:57-64` — the fail-closed path
  that throws `ROX_OS_SECURE_STORAGE_UNAVAILABLE` when `safeStorage` is
  unavailable.
- `package.json:56` — the `perf:startup` script; `package.json:92` —
  `electron:build` (the prerequisite for running the bench).

### Excerpt A — the two bugs in the bench

`apps/electron/scripts/perf/startup-bench.ts:11-14` (cold run excluded from the
checked set):

```ts
 * Run 0 uses a fresh profile (first install: skills sync, caches cold) and is
 * reported separately; runs 1..N reuse that profile (warm launch) and are the
 * ones checked against budgets. Report-only by default; `--strict` exits 1 on
 * an exceeded budget. `--ci` multiplies budgets (shared runners / xvfb).
```

`apps/electron/scripts/perf/startup-bench.ts:84-103` (`HOME`/`USERPROFILE`
substituted with an empty dir — the keychain bug):

```ts
function isolatedEnv(profile: string, outFile: string): Record<string, string> {
  for (const child of ['home', 'config', 'userData', 'tmp', 'appData', 'localAppData']) mkdirSync(join(profile, child), { recursive: true })
  const env: Record<string, string> = {}
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'SHELL']) {
    if (process.env[name]) env[name] = process.env[name]!
  }
  return Object.assign(env, {
    HOME: join(profile, 'home'), USERPROFILE: join(profile, 'home'),
    ROX_CONFIG_DIR: join(profile, 'config'), CRAFT_CONFIG_DIR: join(profile, 'config'),
    ROX_USER_DATA_DIR: join(profile, 'userData'), CRAFT_USER_DATA_DIR: join(profile, 'userData'),
    TMPDIR: join(profile, 'tmp'), TMP: join(profile, 'tmp'), TEMP: join(profile, 'tmp'),
    APPDATA: join(profile, 'appData'), LOCALAPPDATA: join(profile, 'localAppData'),
    CRAFT_INSTANCE_NUMBER: `startup-bench-${process.pid}`,
    ROX_DEV_DISABLE_PROTOCOL_REGISTRATION: '1',
    ROX_SKIP_PROTOCOL_REGISTRATION: '1',
    ROX_PERF: '1',
    ROX_PERF_OUT: outFile,
    NODE_ENV: 'production',
  })
}
```

`apps/electron/scripts/perf/startup-bench.ts:151-176` (`report` — only warm runs
are checked; a NO DATA median renders as a table cell and nothing more):

```ts
function report(args: Args, runs: RunMetrics[]) {
  const warm = runs.filter(r => r.kind === 'warm' && r.ok)
  const platform = process.platform
  const windowBudget = startupBudgetFor('windowCreatedMs', platform, args.ci)
  const fmpBudget = startupBudgetFor('firstMeaningfulPaintMs', platform, args.ci)
  const windowMedian = median(warm.flatMap(r => r.windowCreatedMs ?? []))
  const fmpMedian = median(warm.flatMap(r => r.fmpMs ?? []))
  const checks = [
    { metric: 'window-created', median: windowMedian, budget: windowBudget },
    { metric: 'first-meaningful-paint', median: fmpMedian, budget: fmpBudget },
  ].map(c => ({ ...c, pass: c.median !== undefined && c.median <= c.budget }))
  const lines = [
    `# Electron startup bench (${platform}${args.ci ? ', CI budgets ×4' : ''})`,
    '',
    `Runs: ${runs.length} (cold: ${runs.filter(r => r.kind === 'cold').length}, warm ok: ${warm.length})`,
    '',
    '| metric | warm median (ms) | budget (ms) | status |',
    '|---|---:|---:|---|',
    ...checks.map(c => `| ${c.metric} | ${c.median ?? 'n/a'} | ${c.budget} | ${c.pass ? 'PASS' : c.median === undefined ? 'NO DATA' : 'OVER'} |`),
```

`apps/electron/scripts/perf/startup-bench.ts:186-201` (`main` — exit code is
tied only to `--strict` and to `checks.some(c => !c.pass)`):

```ts
    // Cold run first (fresh profile) + N warm runs on the same profile.
    const total = args.profile ? args.runs : args.runs + 1
    for (let run = 0; run < total; run++) {
      const result = await runOnce(args, profile, run)
      runs.push(result)
      console.log(`[startup-bench] run ${run} (${result.kind}): window=${result.windowCreatedMs ?? '-'}ms fmp=${result.fmpMs ?? '-'}ms${result.error ? ` error=${result.error}` : ''}`)
    }
  } finally {
    if (!args.profile) rmSync(profile, { recursive: true, force: true })
  }
  const { checks, markdown } = report(args, runs)
  console.log(`\n${markdown}`)
  if (args.md) writeFileSync(args.md, `${markdown}\n`)
  if (args.out) writeFileSync(args.out, `${JSON.stringify({ platform: process.platform, ci: args.ci, checks, runs }, null, 2)}\n`)
  if (args.strict && checks.some(c => !c.pass)) process.exit(1)
}
```

### Excerpt B — the fixed sibling env (copy this shape)

`tests/e2e/product-tour/native-harness.ts:45-62`:

```ts
  const env: Record<string, string> = {}
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    if (process.env[name]) env[name] = process.env[name]!
  }
  Object.assign(env, {
    // The login keychain must stay reachable: Chromium safeStorage answers
    // isEncryptionAvailable() from the real HOME, and the app fails closed with
    // ROX_OS_SECURE_STORAGE_UNAVAILABLE when it is not (which masks the onboarding).
    HOME: process.env.HOME ?? join(profile, 'home'), USERPROFILE: process.env.USERPROFILE ?? process.env.HOME ?? join(profile, 'home'),
    ROX_CONFIG_DIR: join(profile, 'config'), CRAFT_CONFIG_DIR: join(profile, 'config'),
    ROX_USER_DATA_DIR: join(profile, 'userData'), CRAFT_USER_DATA_DIR: join(profile, 'userData'),
    TMPDIR: join(profile, 'tmp'), TMP: join(profile, 'tmp'), TEMP: join(profile, 'tmp'),
    APPDATA: join(profile, 'appData'), LOCALAPPDATA: join(profile, 'localAppData'),
    CRAFT_INSTANCE_NUMBER: `product-tour-native-${process.pid}`,
    ROX_DEV_DISABLE_PROTOCOL_REGISTRATION: '1',
    ROX_SKIP_PROTOCOL_REGISTRATION: '1',
    NODE_ENV: 'test',
  })
```

### Excerpt C — the app honors (and the contracts behind) the isolation env

`apps/electron/src/main/index.ts:322-330` (`ROX_USER_DATA_DIR`):

```ts
// Isolate Chromium profile so a second dev instance does not share cookies/locks.
const numberedInstance = (process.env.ROX_INSTANCE_NUMBER || process.env.CRAFT_INSTANCE_NUMBER)?.trim()
const userDataOverride = (process.env.ROX_USER_DATA_DIR || process.env.CRAFT_USER_DATA_DIR)?.trim()
if (userDataOverride) {
  mkdirSync(userDataOverride, { recursive: true })
  app.setPath('userData', userDataOverride)
} else if (numberedInstance) {
  app.setPath('userData', resolveNumberedUserDataDir(app.getPath('appData'), numberedInstance))
}
```

`packages/shared/src/config/env.ts:204-217` (`resolveConfigDir`; `ROX_CONFIG_DIR`
via `getEnv('CONFIG_DIR', ...)`, defined at `packages/shared/src/config/env.ts:71-81`):

```ts
export function resolveConfigDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  homeDir: string = homedir(),
  options?: { enabledWorkbenchFlags?: ReadonlySet<string> },
): string {
  const override = getEnv('CONFIG_DIR', env);
  if (override) return override;
  const visibleDir = join(homeDir, ROX_VISIBLE_CONFIG_DIR_NAME);
  const hiddenDir = join(homeDir, ROX_CONFIG_DIR_NAME);
```

`getEnv` reads `ROX_<suffix>` first, then `CRAFT_<suffix>`
(`packages/shared/src/config/env.ts:71-81`) — so `ROX_CONFIG_DIR` /
`CRAFT_CONFIG_DIR` from the bench env are honored without touching boot.

`apps/electron/src/main/pocket-account-store.ts:57-64` (why a fake HOME breaks
cold start):

```ts
  const ready = () => {
    if (!['darwin', 'win32'].includes(platform)) throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
    // win32 without safeStorage falls back to DPAPI over PowerShell; other
    // platforms have no fallback and must fail closed.
    if (!storage.isEncryptionAvailable() && platform !== 'win32') throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
    mkdirSync(options.directory, { recursive: true, mode: 0o700 })
    if (lstatSync(options.directory).isSymbolicLink()) throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
  }
```

### Excerpt D — the budgets (frozen) and the CI consumer

`apps/electron/src/shared/startup-perf.ts:74-78`:

```ts
export const STARTUP_BUDGETS = {
  windowCreatedMs: { darwin: 300, win32: 500, linux: 500 },
  firstMeaningfulPaintMs: { darwin: 800, win32: 1500, linux: 1500 },
  ciMultiplier: 4,
} as const
```

`.github/workflows/perf-budgets.yml:57-62` and `:71-72`:

```yaml
  # PERF-01: launch the built app and compare startup marks with the audit
  # budgets (CI ×4). Report-only and non-blocking until shell-first boot lands.
  electron-startup:
    runs-on: [self-hosted, macos-toolchain]
    timeout-minutes: 30
    continue-on-error: true
```
```yaml
      - name: Startup bench (report-only)
        run: bun run perf:startup -- --runs 3 --ci --md electron-startup.md --out electron-startup.json
```

The CI job is `continue-on-error: true`, so it never blocks merges today. The
only other consumer is `package.json:56` (`perf:startup`), used by CI and
locally. Nothing parses the bench's stdout as an API — the shape is human- and
artifact-facing.

## Commands you will need

Run from the repo root.

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests (fast, no build) | `bun test apps/electron/scripts/perf/__tests__/startup-bench.test.ts` | all pass |
| Typecheck (shared) | `bun run typecheck:shared` | exit 0 |
| Typecheck (electron) | `bun run typecheck:electron` | exit 0 |
| Build the app (prerequisite for the bench) | `bun run electron:build` | exit 0; `apps/electron/dist/main.cjs` exists |
| Run the bench | `bun run perf:startup -- --runs 3` | cold + 3 warm runs, summary table (see Step 4) |
| i18n parity (repo gate) | `bun scripts/check-i18n-parity.ts` | exit 0 |
| Locale sort check (repo gate) | `bun scripts/sort-locales.ts --check` | exit 0 |

Note: the bench launches the **built** app; `bun run electron:build` is a hard
prerequisite (the bench itself errors with "Built entry not found" otherwise,
`apps/electron/scripts/perf/startup-bench.ts:180-183`). On Linux, wrap the
bench in `xvfb-run -a` (per the file header, line 20).

## Scope

**In scope** (the only files you should modify):
- `apps/electron/scripts/perf/startup-bench.ts`
- `apps/electron/scripts/perf/__tests__/startup-bench.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `apps/electron/src/shared/startup-perf.ts` — the shared budgets and mark
  names are frozen; this plan must not change any budget value or the
  `ciMultiplier`.
- `.github/workflows/perf-budgets.yml` — do not modify, do not enable
  `--strict`, do not remove `continue-on-error`.
- `apps/electron/src/main/index.ts` and any app boot code — do not alter the
  boot sequence; the isolation env vars are read there already.
- `tests/e2e/product-tour/native-harness.ts` — already correct; copy its shape,
  don't edit it.
- `package.json` — the `perf:startup` script already exists and is correct.

## Git workflow

- Branch: `advisor/003-startup-bench-keychain-and-cold-budget`
- Commit style is conventional commits in English (see `git log --oneline`
  examples such as `test(shell): re-anchor the sash geometry pin to the
  shipped tokens`). Suggested messages:
  - `perf(bench): keep the real HOME so safeStorage/keychain stays reachable`
  - `perf(bench): check the cold run against an explicit cold budget`
  - `perf(bench): fail loudly when FMP is NO DATA`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Use the real HOME in the bench env (mirror the native harness)

In `apps/electron/scripts/perf/startup-bench.ts`, change `isolatedEnv` so that
`HOME`/`USERPROFILE` are the real ones, while the app's own isolation vars keep
pointing into the temp profile. This is a two-line change plus a comment, and
an `export` so it can be unit-tested.

Replace (lines 84–103):

```ts
    HOME: join(profile, 'home'), USERPROFILE: join(profile, 'home'),
```

with:

```ts
    // The login keychain must stay reachable: Chromium safeStorage answers
    // isEncryptionAvailable() from the real HOME, and the app fails closed with
    // ROX_OS_SECURE_STORAGE_UNAVAILABLE when it is not (see
    // tests/e2e/product-tour/native-harness.ts:50-53). Profile isolation stays
    // via the app's own ROX_*/CRAFT_* dirs below.
    HOME: process.env.HOME ?? join(profile, 'home'),
    USERPROFILE: process.env.USERPROFILE ?? process.env.HOME ?? join(profile, 'home'),
```

Also change `function isolatedEnv(...)` to `export function isolatedEnv(...)`.
Do NOT change the `mkdirSync` loop (keep creating `join(profile, 'home')` for
parity/log fallback), and do NOT change the `ROX_CONFIG_DIR` / `CRAFT_CONFIG_DIR`
/ `ROX_USER_DATA_DIR` / `CRAFT_USER_DATA_DIR` / `TMPDIR` / `APPDATA` lines.

**Verify**: `bun test apps/electron/scripts/perf/__tests__/startup-bench.test.ts`
→ existing tests still pass (module import unaffected). The new behavior is
asserted in the Test plan (Step 4's full run also exercises it).

### Step 2: Keep the cold run measured and give it an explicit (generous) budget line

Two edits in the same file:

(a) Add a cold budget constant near the top of the module (after the imports,
before `interface Args`):

```ts
/**
 * Report-only cold (first-install: skills sync, caches cold) FMP ceiling.
 * Deliberately generous — the warm contract is 800 ms macOS / 1500 ms Windows
 * (×4 in CI), while cold pays one-time setup. `bun run perf:startup` prints the
 * observed cold FMP; tighten this constant once a healthy cold number is known.
 */
export const COLD_FMP_BUDGET_MS = 120_000
```

(b) In `report()` (`apps/electron/scripts/perf/startup-bench.ts:151-176`), add
the cold run to the checked set. After the existing `warm`/median lines:

```ts
  const cold = runs.filter(r => r.kind === 'cold' && r.ok)
  const coldFmpMedian = median(cold.flatMap(r => r.fmpMs ?? []))
```

and add a third entry to the `checks` array:

```ts
    { metric: 'first-meaningful-paint (cold)', median: coldFmpMedian, budget: COLD_FMP_BUDGET_MS },
```

Why 120 000 ms: the bench's own report format shows a single `budget (ms)`
column per metric, and the warm FMP contract tops out at `1500 × 4 = 6000` ms.
The observed pathological fresh-profile startup was ~75 s, so 120 s is generous
enough to absorb shared-runner noise on a cold install while still flagging a
runaway (multi-minute) regression. It is a **report-only** line: the CI job
runs without `--strict` and stays `continue-on-error: true`, so no existing gate
tightens. The value is a module constant precisely so it can be lowered once a
healthy cold number is recorded.

**Verify**: `bun run typecheck:electron` → exit 0 (the new export and check
entry compile). `bun test apps/electron/scripts/perf/__tests__/startup-bench.test.ts`
→ all pass (see Test plan for the new assertion on `COLD_FMP_BUDGET_MS`).

### Step 3: Fail loudly when a required metric is NO DATA

Add a small pure helper (exported, so it is unit-testable) and use it in
`main()`. Place the helper next to `median`:

```ts
/** Metrics whose median is undefined — the app never emitted the mark. */
export function missingMetrics(checks: Array<{ metric: string; median?: number }>): string[] {
  return checks.filter(c => c.median === undefined).map(c => c.metric)
}
```

Then in `main()` replace the final exit block
(`apps/electron/scripts/perf/startup-bench.ts:201`):

```ts
  if (args.strict && checks.some(c => !c.pass)) process.exit(1)
```

with:

```ts
  const missing = missingMetrics(checks)
  if (missing.length) {
    console.error(
      `[startup-bench] NO DATA for: ${missing.join(', ')}. The app did not emit the required startup mark(s) (see the per-run 'error' column). Failing.`,
    )
    process.exitCode = 1
  }
  if (args.strict && checks.some(c => !c.pass)) process.exitCode = 1
```

Use `process.exitCode` (not `process.exit`) so the `finally` cleanup and the
`--md`/`--out` writers still run. This cannot tighten the CI gate: the workflow
invokes the bench without `--strict` and the job is `continue-on-error: true`
(`.github/workflows/perf-budgets.yml:62`) — we are not editing the workflow.

**Verify**: `bun test apps/electron/scripts/perf/__tests__/startup-bench.test.ts`
→ all pass, including the new `missingMetrics` cases.

### Step 4: Full local run of the bench (integration)

Run the bench against a freshly built app:

```bash
bun run electron:build
bun run perf:startup -- --runs 3
```

(Linux: `xvfb-run -a bun run perf:startup -- --runs 3`.)

**Expected observable output** — per-run lines include a real cold FMP, with no
error and no missing-mark failure:

```
[startup-bench] run 0 (cold): window=<N>ms fmp=<N>ms
[startup-bench] run 1 (warm): window=<N>ms fmp=<N>ms
[startup-bench] run 2 (warm): window=<N>ms fmp=<N>ms
[startup-bench] run 3 (warm): window=<N>ms fmp=<N>ms
```

where `<N>` is a **positive integer** (never `-`), and no line contains
`error=`. The summary table must contain three metric rows — `window-created`,
`first-meaningful-paint`, and `first-meaningful-paint (cold)` — each with a
numeric median and status `PASS`/`OVER` (not `NO DATA`). Exit status 0 (no
`NO DATA` and no over-budget with `--strict` off).

If `run 0 (cold)` shows `fmp=-` or an `error=`, that is a STOP condition (the
env fix did not restore the keychain path — do not paper over it).

**Keychain check** (macOS): confirm the app log gained no
`ROX_OS_SECURE_STORAGE_UNAVAILABLE` entry. Because the bench now keeps the real
HOME, the log lives at the real path; record the baseline count first, then
compare:

```bash
LOG="$HOME/Library/Logs/Rox/main.log"
before=$(grep -c ROX_OS_SECURE_STORAGE_UNAVAILABLE "$LOG" 2>/dev/null || echo 0)
# ... run the bench (above) ...
after=$(grep -c ROX_OS_SECURE_STORAGE_UNAVAILABLE "$LOG" 2>/dev/null || echo 0)
echo "before=$before after=$after"
```

Expected: `after == before` (the cold run added no new fail-closed entries). If
the log file does not exist at that path, check
`$HOME/Library/Logs/Electron/main.log` instead; if neither exists, report that
the log check was not observable (do not treat absence of a log as success).

## Test plan

- File: `apps/electron/scripts/perf/__tests__/startup-bench.test.ts` — extend the
  existing `describe` blocks (structural pattern: the current
  `describe('startup bench metrics', ...)` in that file, which imports from
  `'../startup-bench'` and asserts on pure functions).
- Add a `describe('startup bench isolation env', ...)` covering:
  - `isolatedEnv(profile, outFile)` returns `HOME === process.env.HOME` and
    `USERPROFILE === (process.env.USERPROFILE ?? process.env.HOME)` (the fix);
  - it still points `ROX_CONFIG_DIR` / `CRAFT_CONFIG_DIR` at
    `<profile>/config` and `ROX_USER_DATA_DIR` / `CRAFT_USER_DATA_DIR` at
    `<profile>/userData` (isolation preserved).
- Add a `describe('startup bench cold budget', ...)` covering:
  - `COLD_FMP_BUDGET_MS` is a number and is **strictly greater** than the CI
    warm FMP budget, `startupBudgetFor('firstMeaningfulPaintMs', 'darwin', true)`
    (i.e. `800 * 4 = 3200`), so the cold line is genuinely generous.
- Add a `describe('startup bench NO DATA detection', ...)` covering:
  - `missingMetrics([{ metric: 'a', median: 1 }, { metric: 'b', median: undefined }])`
    returns `['b']`;
  - `missingMetrics([{ metric: 'a', median: 0 }])` returns `[]` (a real `0` is
    not "missing").
- Use `mkdtempSync(join(tmpdir(), 'bench-test-'))` for the `profile` argument in
  the isolation-env test and clean up in a `finally`, matching the bench's own
  temp-dir style (`apps/electron/scripts/perf/startup-bench.ts:184`).
- Verification: `bun test apps/electron/scripts/perf/__tests__/startup-bench.test.ts`
  → all pass, including the new assertions.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun test apps/electron/scripts/perf/__tests__/startup-bench.test.ts` exits 0; the new `isolatedEnv`, cold-budget, and `missingMetrics` tests exist and pass
- [ ] `bun run typecheck:electron` exits 0
- [ ] `bun run typecheck:shared` exits 0
- [ ] `grep -n "HOME: join(profile, 'home')" apps/electron/scripts/perf/startup-bench.ts` returns **no** match (only the `?? join(profile, 'home')` fallback remains)
- [ ] `grep -n "COLD_FMP_BUDGET_MS" apps/electron/scripts/perf/startup-bench.ts` shows the constant, its cold `checks` entry, and (indirectly) the report row
- [ ] `grep -n "missingMetrics" apps/electron/scripts/perf/startup-bench.ts` shows the export and its use in `main()`
- [ ] With a built app, `bun run perf:startup -- --runs 3` prints `run 0 (cold): ... fmp=<N>ms` with a positive integer and no `error=`, and no `[startup-bench] NO DATA` line
- [ ] `apps/electron/src/shared/startup-perf.ts` is unchanged (`git diff --name-only` does not list it)
- [ ] No files outside the in-scope list are modified (`git status --short`)
- [ ] `bun scripts/check-i18n-parity.ts` and `bun scripts/sort-locales.ts --check` exit 0 (repo gates; unchanged behavior)
- [ ] `advisor-plans/README.md` status row updated (if that index exists)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts above
  (the codebase has drifted since this plan was written).
- Step 4's cold run still shows `fmp=-` or an `error=`, or the bench prints
  `[startup-bench] NO DATA` — the HOME fix did not restore the keychain path.
- Making the cold run measurable requires changing `apps/electron/src/shared/startup-perf.ts`,
  `.github/workflows/perf-budgets.yml`, or any app boot code (all out of scope).
- The `perf:startup` script or `electron:build` script is missing/renamed from
  what `package.json` shows here.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The cold FMP budget (`COLD_FMP_BUDGET_MS = 120_000`) is an initial generous
  ceiling, not a target. Once a healthy cold number is recorded on the runner,
  lower it in a dedicated change and note the observed value in the constant's
  doc comment — that is the whole point of the line.
- If shell-first boot lands (the condition named in
  `.github/workflows/perf-budgets.yml:58` for making the gate blocking), the
  cold budget may need revisiting alongside it; do that in the workflow's own
  change, not here.
- The bench now shares the real HOME with any concurrent Rox instance for
  keychain access and `~/Library/Logs/Rox/main.log`; Chromium profile, config,
  and temp dirs remain isolated under the temp profile. If a future change adds
  another shared-HOME dependency, keep the isolation in the `ROX_*/CRAFT_*` env
  vars rather than reintroducing a fake HOME.
- What a reviewer should scrutinize: that no budget value in
  `startup-perf.ts` changed; that the CI workflow and its
  `continue-on-error: true` are untouched; that the new non-`--strict` NO DATA
  failure cannot block merges (it can only fail the report-only step, which CI
  tolerates).
- Deferred out of this plan: actually repairing the underlying ~75 s
  fresh-profile startup cost (likely the skills-sync / first-install path). This
  plan only makes that cost *visible and gated*; the perf fix is a separate
  change.