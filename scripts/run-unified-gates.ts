#!/usr/bin/env bun
/**
 * W1-10 (#1507) — CI entry point: run every unified gate on the current tree.
 *
 * Exit 0 when every gate passes, warns (report-only perf benches unless
 * ROX_BENCH_STRICT=1) or is pending (sibling input absent; visual / axe /
 * one-rail until the wave-2 browser driver exists). Exit 1 when any gate
 * fails, including an input that exists but cannot be evaluated.
 *
 * It does not run the harness self-tests; CI runs `bun test
 * packages/test-harness` as a separate step before this script.
 */
import { runAllGates, gatesExitCode, formatGateResults } from '../packages/test-harness/src/gates/run-all.ts'

const results = await runAllGates()
console.log(formatGateResults(results))
const count = (status: string) => results.filter((r) => r.status === status).length
for (const r of results) for (const v of r.violations ?? []) console.log(`  - ${r.gate}: ${v}`)
console.log(`\n${count('pass')} pass / ${count('fail')} fail / ${count('warn')} warn / ${count('pending')} pending`)
process.exit(gatesExitCode(results))
