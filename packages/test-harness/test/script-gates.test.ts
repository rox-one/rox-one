/**
 * W3 (#1507) self-test: the checked-in script gates are fail-closed.
 *
 * These four scripts live in the repo, so unlike the sibling-input gates there
 * is no `pending` state: a missing script FAILS, and the script's exit code
 * decides pass/fail. Each gate also caps its run and fails on an overrun.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  runProvenanceGate,
  runVersionParityGate,
  runIpcSendsGate,
  runToolNameChecksGate,
  PROVENANCE_SCRIPT,
  VERSION_PARITY_SCRIPT,
  IPC_SENDS_SCRIPT,
  TOOL_NAME_CHECKS_SCRIPT,
} from '../src/gates/script-gates.ts'
import type { GateResult } from '../src/gates/types.ts'

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'w3-script-gates-'))
  for (const [path, src] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), src)
  }
  return root
}

interface GateCase {
  name: string
  script: string
  runtime: 'bun' | 'bash'
  run: (opts: { repoRoot?: string; timeoutMs?: number }) => Promise<GateResult>
}

const GATES: GateCase[] = [
  { name: 'provenance', script: PROVENANCE_SCRIPT, runtime: 'bun', run: runProvenanceGate },
  { name: 'version-parity', script: VERSION_PARITY_SCRIPT, runtime: 'bun', run: runVersionParityGate },
  { name: 'ipc-sends', script: IPC_SENDS_SCRIPT, runtime: 'bash', run: runIpcSendsGate },
  { name: 'tool-name-checks', script: TOOL_NAME_CHECKS_SCRIPT, runtime: 'bash', run: runToolNameChecksGate },
]

/** A script that writes nothing and exits 0 — green for either runtime. */
const SILENT = ''

/** A script that prints a diagnostic to stderr and exits 1. */
const diagnostic = (runtime: 'bun' | 'bash', name: string): string =>
  runtime === 'bun' ? `console.error('${name} diagnostic'); process.exit(1)\n` : `echo '${name} diagnostic' >&2\nexit 1\n`

describe('script gates: a missing script fails closed (never pending)', () => {
  for (const gate of GATES) {
    test(`${gate.name}: missing script fails and names the path`, async () => {
      const res = await gate.run({ repoRoot: repo({}) })
      expect(res.status).toBe('fail')
      expect(res.gate).toBe(gate.name)
      expect(res.summary).toContain(gate.script)
    })
  }
})

describe('script gates: the exit code decides', () => {
  for (const gate of GATES) {
    test(`${gate.name}: exit 0 passes`, async () => {
      const res = await gate.run({ repoRoot: repo({ [gate.script]: SILENT }) })
      expect(res.status).toBe('pass')
    })
    test(`${gate.name}: exit 1 fails with the diagnostic in violations`, async () => {
      const res = await gate.run({ repoRoot: repo({ [gate.script]: diagnostic(gate.runtime, gate.name) }) })
      expect(res.status).toBe('fail')
      expect(res.violations?.join(' ')).toContain(`${gate.name} diagnostic`)
    })
  }
})

describe('script gates: an overrun is killed and the gate fails', () => {
  test('provenance: a sleeping script fails with a timeout summary', async () => {
    // The gate's timeout is enforced by Bun.spawnSync on a child process, so the
    // sleep must run in the child against the real platform clock — fake timers in
    // the test process cannot drive another process's time.
    const root = repo({ [PROVENANCE_SCRIPT]: `await Bun.sleep(30_000)\n` })
    const res = await runProvenanceGate({ repoRoot: root, timeoutMs: 1_000 })
    expect(res.status).toBe('fail')
    expect(res.summary).toContain('timed out')
    expect(res.summary).toContain(PROVENANCE_SCRIPT)
    expect(res.violations?.[0]).toContain('timed out after 1000 ms')
  })
})