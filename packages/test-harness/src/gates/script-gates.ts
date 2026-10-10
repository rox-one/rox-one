/**
 * W3 (#1507) — checked-in script gates (provenance, version parity, ipc sends,
 * task-tool names).
 *
 * Wraps four scripts that already live in `scripts/` and are enforced by CI
 * directly today. They are checked into the repo, so unlike the sibling-input
 * gates there is NO `pending` state: a missing script is a failure (fail
 * closed, see types.ts), and the exit code decides pass/fail. Each run is
 * capped at its own timeout (#1507 review 4): a script that hangs or overruns
 * is killed and the gate FAILS with a timeout message instead of holding the
 * CI job until its 30-minute limit.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GateResult } from './types.ts'

export const PROVENANCE_SCRIPT = join('scripts', 'check-provenance.ts')
export const VERSION_PARITY_SCRIPT = join('scripts', 'check-version.ts')
export const IPC_SENDS_SCRIPT = join('scripts', 'check-raw-sends.sh')
export const TOOL_NAME_CHECKS_SCRIPT = join('scripts', 'check-task-tool-checks.sh')

/** The provenance diff walks git history against a base; generous cap. */
export const PROVENANCE_TIMEOUT_MS = 120_000
/** The version-parity check reads 15 manifests; sub-second in practice. */
export const VERSION_PARITY_TIMEOUT_MS = 30_000
/** The raw-send and task-tool greps walk the tracked tree. */
export const IPC_SENDS_TIMEOUT_MS = 60_000
export const TOOL_NAME_CHECKS_TIMEOUT_MS = 60_000

/** Default repo root: this file is `packages/test-harness/src/gates/`. */
const DEFAULT_REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..')

interface CheckedScriptOptions {
  gate: string
  script: string
  runtime: 'bun' | 'bash'
  timeoutMs: number
  root: string
}

/** Run a checked-in script and map its outcome onto the fail-closed contract. */
async function runCheckedScript(o: CheckedScriptOptions): Promise<GateResult> {
  const { gate, script, runtime, timeoutMs, root } = o
  if (!existsSync(join(root, script))) {
    return { gate, status: 'fail', summary: `${script} is missing from the repo`, violations: [] }
  }
  const proc = Bun.spawnSync([runtime, join(root, script)], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs,
  })
  const output = `${proc.stdout?.toString() ?? ''}${proc.stderr?.toString() ?? ''}`.trim()
  if (proc.exitedDueToTimeout) {
    return {
      gate,
      status: 'fail',
      summary: `${gate} gate timed out: ${script} did not finish within ${Math.round(timeoutMs / 1000)} s and was killed`,
      violations: [`${script} timed out after ${timeoutMs} ms (killed with ${proc.signalCode ?? 'SIGTERM'})`],
    }
  }
  if (proc.exitCode === 0) {
    return { gate, status: 'pass', summary: output.slice(0, 300) || `${gate} gate green` }
  }
  return {
    gate,
    status: 'fail',
    summary: `${gate} gate failed`,
    violations: output.split('\n').filter(Boolean).slice(0, 20),
  }
}

export async function runProvenanceGate(opts: { repoRoot?: string; timeoutMs?: number } = {}): Promise<GateResult> {
  return runCheckedScript({
    gate: 'provenance',
    script: PROVENANCE_SCRIPT,
    runtime: 'bun',
    timeoutMs: opts.timeoutMs ?? PROVENANCE_TIMEOUT_MS,
    root: opts.repoRoot ?? DEFAULT_REPO_ROOT,
  })
}

export async function runVersionParityGate(opts: { repoRoot?: string; timeoutMs?: number } = {}): Promise<GateResult> {
  return runCheckedScript({
    gate: 'version-parity',
    script: VERSION_PARITY_SCRIPT,
    runtime: 'bun',
    timeoutMs: opts.timeoutMs ?? VERSION_PARITY_TIMEOUT_MS,
    root: opts.repoRoot ?? DEFAULT_REPO_ROOT,
  })
}

export async function runIpcSendsGate(opts: { repoRoot?: string; timeoutMs?: number } = {}): Promise<GateResult> {
  return runCheckedScript({
    gate: 'ipc-sends',
    script: IPC_SENDS_SCRIPT,
    runtime: 'bash',
    timeoutMs: opts.timeoutMs ?? IPC_SENDS_TIMEOUT_MS,
    root: opts.repoRoot ?? DEFAULT_REPO_ROOT,
  })
}

export async function runToolNameChecksGate(opts: { repoRoot?: string; timeoutMs?: number } = {}): Promise<GateResult> {
  return runCheckedScript({
    gate: 'tool-name-checks',
    script: TOOL_NAME_CHECKS_SCRIPT,
    runtime: 'bash',
    timeoutMs: opts.timeoutMs ?? TOOL_NAME_CHECKS_TIMEOUT_MS,
    root: opts.repoRoot ?? DEFAULT_REPO_ROOT,
  })
}