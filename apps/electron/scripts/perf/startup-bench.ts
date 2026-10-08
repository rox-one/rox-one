#!/usr/bin/env bun
/**
 * Electron startup bench (PERF-01).
 *
 * Launches the *built* app (`apps/electron/dist/main.cjs`) through Playwright's
 * Electron driver with an isolated profile and ROX_PERF=1, reads the startup
 * timeline the app records (`globalThis.__roxStartupPerf` in main; renderer
 * marks are forwarded over IPC), and compares medians to the PERF-AUDIT
 * budgets (window ≤300 ms macOS / ≤500 ms Windows, FMP ≤0.8 s / ≤1.5 s).
 *
 * Run 0 uses a fresh profile (first install: skills sync, caches cold) and is
 * reported separately; runs 1..N reuse that profile (warm launch) and are the
 * ones checked against budgets. Report-only by default; `--strict` exits 1 on
 * an exceeded budget. `--ci` multiplies budgets (shared runners / xvfb).
 *
 * Self-contained in apps/electron on purpose; PR #1557 (#1507 harness) may add
 * shared bench infra later — fold this into it then.
 *
 *   bun run electron:build && bun apps/electron/scripts/perf/startup-bench.ts --runs 5 --ci
 *   (Linux: wrap in `xvfb-run -a`.)
 */
import { _electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { STARTUP_MARKS, startupBudgetFor, type StartupTimeline } from '../../src/shared/startup-perf'

interface Args { runs: number; ci: boolean; strict: boolean; out: string | null; md: string | null; main: string; timeoutMs: number; profile: string | null }

function parseArgs(argv: string[]): Args {
  const value = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] ?? null : null }
  const repo = resolve(import.meta.dir, '../../../..')
  return {
    runs: Math.max(1, Number(value('--runs') ?? 5)),
    ci: argv.includes('--ci') || process.env.CI === 'true',
    strict: argv.includes('--strict'),
    out: value('--out'),
    md: value('--md'),
    main: resolve(value('--main') ?? join(repo, 'apps/electron/dist/main.cjs')),
    timeoutMs: Number(value('--timeout') ?? 60_000),
    profile: value('--profile'),
  }
}

export interface RunMetrics {
  run: number
  kind: 'cold' | 'warm'
  ok: boolean
  error?: string
  launchWallMs?: number
  marks: Record<string, number>
  windowCreatedMs?: number
  firstPaintMs?: number
  /** FMP (`renderer:fmp`), or the first settled screen on profiles that never reach the session list. */
  fmpMs?: number
  fmpSource?: string
}

export function metricsFromTimeline(timeline: StartupTimeline): Omit<RunMetrics, 'run' | 'kind' | 'ok'> {
  const marks: Record<string, number> = {}
  for (const mark of timeline.marks) if (!(mark.name in marks) && !mark.name.startsWith('nav:')) marks[mark.name] = Math.round(mark.atMs)
  const interactive = Object.keys(marks).find(name => name.startsWith('renderer:interactive:'))
  const fmpSource = marks[STARTUP_MARKS.rendererFirstMeaningfulPaint] !== undefined ? STARTUP_MARKS.rendererFirstMeaningfulPaint : interactive
  return {
    marks,
    windowCreatedMs: marks[STARTUP_MARKS.windowCreated],
    firstPaintMs: marks[STARTUP_MARKS.rendererFirstPaint],
    fmpMs: fmpSource ? marks[fmpSource] : undefined,
    fmpSource,
  }
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2
}

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

async function runOnce(args: Args, profile: string, run: number): Promise<RunMetrics> {
  const kind = run === 0 && !args.profile ? 'cold' : 'warm'
  const require = createRequire(import.meta.url)
  const executablePath: string = require('electron')
  const outFile = join(profile, `perf-run-${run}.json`)
  const launchArgs = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', args.main] : [args.main]
  const started = performance.now()
  let app: Awaited<ReturnType<typeof _electron.launch>> | null = null
  try {
    app = await _electron.launch({ executablePath, args: launchArgs, cwd: dirname(dirname(args.main)), env: isolatedEnv(profile, outFile), timeout: args.timeoutMs })
    const launchWallMs = Math.round(performance.now() - started)
    const deadline = Date.now() + args.timeoutMs
    let timeline: StartupTimeline | null = null
    let detached = false
    while (Date.now() < deadline) {
      if (!detached) {
        try {
          timeline = await app.evaluate(() => (globalThis as { __roxStartupPerf?: { timeline: () => unknown } }).__roxStartupPerf?.timeline() ?? null) as StartupTimeline | null
        } catch {
          // First-run relaunch / context swap: fall back to the ROX_PERF_OUT file
          // the app writes after FMP (or its 30 s timeout).
          detached = true
        }
      }
      if (detached) {
        if (existsSync(outFile)) { timeline = JSON.parse(readFileSync(outFile, 'utf8')) as StartupTimeline; break }
        await new Promise(r => setTimeout(r, 250))
        continue
      }
      const names = new Set(timeline?.marks.map(mark => mark.name) ?? [])
      if (names.has(STARTUP_MARKS.rendererFirstMeaningfulPaint)) break
      // Fresh profiles settle on onboarding/picker: give FMP a short grace period, then accept that.
      const interactive = timeline?.marks.find(mark => mark.name.startsWith('renderer:interactive:'))
      if (interactive && interactive.name !== 'renderer:interactive:ready' && (performance.now() - started) > interactive.atMs + 2_000) break
      await new Promise(r => setTimeout(r, 100))
    }
    if (!timeline) throw new Error('app exposed no startup timeline (is dist/main.cjs from this branch?)')
    const metrics = metricsFromTimeline(timeline)
    return { run, kind, ok: metrics.fmpMs !== undefined, launchWallMs, ...metrics, ...(metrics.fmpMs === undefined ? { error: 'no FMP/interactive mark before timeout' } : {}) }
  } catch (error) {
    return { run, kind, ok: false, error: error instanceof Error ? error.message : String(error), marks: {} }
  } finally {
    await app?.close().catch(() => undefined)
  }
}

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
    '',
    '| run | kind | launch wall | window-created | first-paint | fmp | fmp source | error |',
    '|---:|---|---:|---:|---:|---:|---|---|',
    ...runs.map(r => `| ${r.run} | ${r.kind} | ${r.launchWallMs ?? ''} | ${r.windowCreatedMs ?? ''} | ${r.firstPaintMs ?? ''} | ${r.fmpMs ?? ''} | ${r.fmpSource ?? ''} | ${r.error ?? ''} |`),
  ]
  return { checks, markdown: lines.join('\n') }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.main)) {
    console.error(`Built entry not found: ${args.main}\nRun \`bun run electron:build\` first.`)
    process.exit(args.strict ? 1 : 0)
  }
  const profile = args.profile ?? mkdtempSync(join(tmpdir(), 'rox-startup-bench-'))
  const runs: RunMetrics[] = []
  try {
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

if (import.meta.main) await main()
