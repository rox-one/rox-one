#!/usr/bin/env bun
/**
 * Baseline: kill -9 of a local runner → getStatus reconcile latency.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalSubprocessProvider } from '../../packages/cloud-runner/src/local-provider.ts'

const baseDir = await mkdtemp(join(tmpdir(), 'craft-runner-recovery-'))
const provider = new LocalSubprocessProvider({
  baseDir,
  // Provider always appends `--dir <runDir>`. `exec` so runner.pid is sleep itself.
  runnerCommand: ['bash', '-c', 'exec sleep 120'],
})
const spec = {
  id: `recovery-${Date.now().toString(36)}`,
  name: 'recovery',
  subtasks: [{ id: 't1', prompt: 'p' }],
}

try {
  await provider.createRun(spec)
  const pidRaw = await readFile(join(baseDir, spec.id, 'runner.pid'), 'utf8')
  const pid = Number.parseInt(pidRaw.trim(), 10)
  process.kill(pid, 'SIGKILL')
  const t0 = Number(process.hrtime.bigint()) / 1e6
  const status = await provider.getStatus(spec.id)
  const reconcileMs = Number(process.hrtime.bigint()) / 1e6 - t0
  console.log(JSON.stringify({
    state: status.state,
    failureReason: status.failureReason ?? null,
    reconcileMs,
  }))
} finally {
  await rm(baseDir, { recursive: true, force: true })
}
