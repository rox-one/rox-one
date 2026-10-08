#!/usr/bin/env bun
/**
 * W1-10 (#1507) — CI entry point: run every unified gate on the current tree.
 *
 * Exit 0 when all gates pass or report pending (sibling input not landed);
 * exit 1 on real violations. Also runs the harness self-tests first so a
 * broken gate implementation fails loudly instead of silently pending.
 */
import { runAllGates, gatesExitCode, formatGateResults } from '../packages/test-harness/src/gates/run-all.ts'

const results = await runAllGates()
console.log(formatGateResults(results))
const pending = results.filter((r) => r.status === 'pending').length
const failed = results.filter((r) => r.status === 'fail')
console.log(`\n${results.length - pending - failed.length} pass / ${failed.length} fail / ${pending} pending`)
process.exit(gatesExitCode(results))
