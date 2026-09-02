#!/usr/bin/env bun
/**
 * Headless Issue 03 performance gate.
 * No display. Deterministic fixtures. Exits 1 on declared budget regressions.
 *
 *   bun run scripts/perf-benchmark.ts
 *   bun run scripts/perf-benchmark.ts --report /tmp/rox-perf-report.md
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { runBenchmarkAndFormat } from '../apps/electron/src/renderer/perf/harness.ts'

const reportFlag = process.argv.indexOf('--report')
const reportPath = reportFlag >= 0 ? process.argv[reportFlag + 1] : undefined

const { report, text } = await runBenchmarkAndFormat({ iterations: 40, includeBundle: true })

process.stdout.write(text)
if (!text.endsWith('\n')) process.stdout.write('\n')

if (reportPath) {
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, text, 'utf8')
  process.stdout.write(`Wrote ${reportPath}\n`)
}

if (!report.passed) {
  process.stderr.write(`perf-benchmark: FAIL (${report.violations.length} violation(s))\n`)
  process.exit(1)
}

process.stdout.write('perf-benchmark: PASS\n')
