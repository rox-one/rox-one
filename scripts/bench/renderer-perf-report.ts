#!/usr/bin/env bun
/**
 * Human-readable renderer performance report + optional CI fail-on-regression.
 *
 *   bun run scripts/bench/renderer-perf-report.ts
 *   bun run scripts/bench/renderer-perf-report.ts --ci --out docs/perf/latest-renderer-report.md
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gatedFailures } from '../../apps/electron/src/renderer/perf/evaluate.ts'
import { formatPerfReport } from '../../apps/electron/src/renderer/perf/report.ts'
import { runPerfHarness } from '../../apps/electron/src/renderer/perf/runner.ts'

const args = process.argv.slice(2)
const ci = args.includes('--ci')
const outFlag = args.indexOf('--out')
const outPath = outFlag >= 0 ? args[outFlag + 1] : undefined
const includeBundle = args.includes('--bundle')
const sessionCountFlag = args.indexOf('--session-count')
const sessionCountRaw = sessionCountFlag >= 0 ? Number(args[sessionCountFlag + 1]) : 2000
const sessionCount: 500 | 2000 = sessionCountRaw === 500 ? 500 : 2000

const report = runPerfHarness({
  sessionCount,
  switchIterations: sessionCount === 500 ? 24 : 60,
  includeBundleProfile: includeBundle,
})
const text = formatPerfReport(report)

if (outPath) {
  const absolute = resolve(outPath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, text)
}

process.stdout.write(text)

if (ci) {
  const failures = gatedFailures(report.verdicts)
  if (failures.length > 0) {
    process.stderr.write(
      `\nCI budgets failed:\n${failures.map((f) => `- ${f.name}: ${f.reasons.join('; ')}`).join('\n')}\n`,
    )
    process.exit(1)
  }
}
