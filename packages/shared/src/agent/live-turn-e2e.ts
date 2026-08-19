/**
 * Ticket 13 runner — print the live-turn gate for this process environment.
 *
 * Usage: bun packages/shared/src/agent/live-turn-e2e.ts
 *
 * Exits 0 on BLOCKED (honest skip) and on READY-but-not-run.
 * Never claims VERIFIED. A later human run with ROX_API_KEY must pass
 * a real log + browser trace to claimLiveTurnVerified.
 */
import { inspectThisEnvironment, formatLiveTurnEvidence } from './live-turn-gate.ts';

const gate = inspectThisEnvironment();
const evidence = formatLiveTurnEvidence(gate);
process.stdout.write(`${evidence}\n`);
if (gate.status === 'BLOCKED') {
  process.exitCode = 0;
}
