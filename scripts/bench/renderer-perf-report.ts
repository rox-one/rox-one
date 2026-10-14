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
import {
  evaluateRetainedNodeBudgetGate,
  formatRetainedNodeReport,
} from '../../apps/electron/src/renderer/perf/retained-node-budget.ts'
import { runPerfHarness } from '../../apps/electron/src/renderer/perf/runner.ts'
import { SURFACE_KEEPALIVE_CAPACITY } from '../../apps/electron/src/renderer/lib/surface-keepalive.tsx'

const args = process.argv.slice(2)
const ci = args.includes('--ci')
const outFlag = args.indexOf('--out')
const outPath = outFlag >= 0 ? args[outFlag + 1] : undefined
const includeBundle = args.includes('--bundle')
const sessionCountFlag = args.indexOf('--session-count')
const sessionCountRaw = sessionCountFlag >= 0 ? Number(args[sessionCountFlag + 1]) : 2000
const sessionCount: 500 | 2000 = sessionCountRaw === 500 ? 500 : 2000

const report = await runPerfHarness({
  sessionCount,
  switchIterations: sessionCount === 500 ? 24 : 60,
  includeBundleProfile: includeBundle,
})
const retainedNodes = evaluateRetainedNodeBudgetGate(SURFACE_KEEPALIVE_CAPACITY)

// The harness above is a pure-JS model: it renders nothing, so a green row says
// nothing about DOM size or heap. Real-renderer numbers come from
// `test:perf:dom` (Chromium). The retained-set budget below is the bridge —
// policy replayed against measured node counts — and every run states which
// kind of evidence it is.
const SIMULATED_NOTICE =
  '[simulated] the latency rows above come from a pure-JS model (no React, no DOM).\n' +
  '            Real-renderer budgets: `bun run test:perf:dom` (Chromium).\n'
const nodeSection = `\n## Retained surface set (measured node counts)\n\n${formatRetainedNodeReport(retainedNodes)}\n`

const text = `${SIMULATED_NOTICE}\n${formatPerfReport(report)}${nodeSection}`

if (outPath) {
  const absolute = resolve(outPath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, text)
}

process.stdout.write(text)

if (ci) {
  const failures = gatedFailures(report.verdicts)
  const nodeReasons = retainedNodes.passed ? [] : retainedNodes.reasons
  if (failures.length > 0 || nodeReasons.length > 0) {
    process.stderr.write(
      `\nCI budgets failed:\n${failures.map((f) => `- ${f.name}: ${f.reasons.join('; ')}`).join('\n')}${
        nodeReasons.length > 0 ? `\n- retained_set_nodes: ${nodeReasons.join('; ')}` : ''
      }\n`,
    )
    process.exit(1)
  }
}
