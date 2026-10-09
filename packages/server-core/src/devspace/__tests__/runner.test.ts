import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DevSpaceRepositoryRecord, DevSpaceRun, DevSpaceRunProgress } from '@rox/shared/dev-space'
import { readDevSpaceRun } from '../runs.ts'
import {
  clearDevSpaceStages, hasDevSpaceStage, isDevSpaceRunActive, registerDevSpaceActiveRun, registerDevSpaceStage,
  runDevSpacePipeline, unregisterDevSpaceActiveRun,
} from '../runner.ts'

const roots: string[] = []
beforeEach(() => { clearDevSpaceStages() })
afterEach(() => {
  clearDevSpaceStages()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-devspace-runner-'))
  roots.push(root)
  return root
}

function record(): DevSpaceRepositoryRecord {
  return {
    schemaVersion: 1,
    id: `devrepo_${'e'.repeat(64)}`,
    repositoryId: `repo_${'b'.repeat(64)}`,
    workspaceId: 'ws',
    projectId: 'proj',
    projectSlug: 'demo',
    origin: { kind: 'local-folder', path: '/tmp/demo' },
    displayName: 'demo',
    status: 'bound',
    createdAt: 1,
    updatedAt: 2,
  }
}

function run(overrides: Partial<DevSpaceRun> = {}): DevSpaceRun {
  return {
    schemaVersion: 1,
    id: `devrun_${'a'.repeat(64)}`,
    repositoryId: `repo_${'b'.repeat(64)}`,
    snapshotId: `snapshot_${'c'.repeat(64)}`,
    stages: ['reconcile', 'structural', 'llm', 'publish'],
    status: 'queued',
    progress: { stage: 'reconcile', done: 0, total: 1 },
    startedAt: 1,
    completedStages: [],
    artifacts: [],
    ...overrides,
  }
}

interface Harness {
  readonly root: string
  readonly progress: DevSpaceRunProgress[]
  readonly audit: Array<Record<string, unknown>>
  readonly controller: AbortController
}

function harness(): Harness {
  return { root: freshRoot(), progress: [], audit: [], controller: new AbortController() }
}

function execute(h: Harness, journal: DevSpaceRun): Promise<DevSpaceRun> {
  return runDevSpacePipeline({
    run: journal, record: record(), root: h.root, clientId: 'c', signal: h.controller.signal,
    emit: progress => { h.progress.push(progress) },
    audit: event => { h.audit.push(event) },
  })
}

describe('devSpace stage registry', () => {
  it('registers, reports and clears stages', () => {
    expect(hasDevSpaceStage('structural')).toBe(false)
    registerDevSpaceStage('structural', () => undefined)
    expect(hasDevSpaceStage('structural')).toBe(true)
    clearDevSpaceStages()
    expect(hasDevSpaceStage('structural')).toBe(false)
  })
})

describe('devSpace pipeline', () => {
  it('runs every registered stage to succeeded and journals after each boundary', async () => {
    for (const stage of ['reconcile', 'structural', 'llm', 'publish'] as const) {
      registerDevSpaceStage(stage, context => {
        context.report(1, 1)
        return { artifacts: [`artifact_${stage}`] }
      })
    }
    const h = harness()
    const finished = await execute(h, run())
    expect(finished.status).toBe('succeeded')
    expect(finished.completedStages).toEqual(['reconcile', 'structural', 'llm', 'publish'])
    expect(finished.artifacts).toEqual(['artifact_reconcile', 'artifact_structural', 'artifact_llm', 'artifact_publish'])
    expect(await readDevSpaceRun(h.root, 'demo', finished.id)).toEqual(finished)
    // The runner emits an entry when a stage starts, whenever the stage reports,
    // when the stage completes and once more as the run settles; assert the stage
    // order is preserved and every stage reaches a terminal 100% progress.
    expect([...new Set(h.progress.map(entry => entry.stage))]).toEqual(['reconcile', 'structural', 'llm', 'publish'])
    for (const stage of ['reconcile', 'structural', 'llm', 'publish'] as const) {
      expect(h.progress.filter(entry => entry.stage === stage)).toContainEqual(expect.objectContaining({ stage, done: 1, total: 1 }))
    }
  })

  it('settles partial when stages are unregistered, without fabricating artifacts', async () => {
    registerDevSpaceStage('reconcile', () => ({ snapshotId: 'snapshot_keep' }))
    const h = harness()
    const finished = await execute(h, run({ completedStages: ['reconcile'] }))
    expect(finished.status).toBe('partial')
    expect(finished.completedStages).toEqual(['reconcile'])
    expect(finished.artifacts).toEqual([])
  })

  it('marks a stage that reports itself incomplete as partial', async () => {
    registerDevSpaceStage('reconcile', () => ({ partial: true }))
    registerDevSpaceStage('structural', () => undefined)
    registerDevSpaceStage('llm', () => undefined)
    registerDevSpaceStage('publish', () => undefined)
    const finished = await execute(harness(), run())
    expect(finished.status).toBe('partial')
  })

  it('records a failed stage with its code and stage, never the raw message', async () => {
    registerDevSpaceStage('reconcile', () => { throw Object.assign(new Error('boom: secret'), { code: 'snapshot-policy-changed' }) })
    const h = harness()
    const finished = await execute(h, run())
    expect(finished.status).toBe('failed')
    expect(finished.error).toEqual({ code: 'snapshot-policy-changed', stage: 'reconcile' })
    expect(JSON.stringify(finished)).not.toContain('secret')
    expect(h.audit).toContainEqual(expect.objectContaining({ event: 'run-stage-failed', code: 'snapshot-policy-changed' }))
  })

  it('falls back to a generic code when a stage throws without one', async () => {
    registerDevSpaceStage('reconcile', () => { throw new Error('opaque') })
    const finished = await execute(harness(), run())
    expect(finished.error).toEqual({ code: 'stage-failed', stage: 'reconcile' })
  })

  it('skips already-completed stages on resume', async () => {
    let calls = 0
    registerDevSpaceStage('structural', () => { calls += 1 })
    registerDevSpaceStage('llm', () => undefined)
    registerDevSpaceStage('publish', () => undefined)
    const finished = await execute(harness(), run({ completedStages: ['reconcile'] }))
    expect(calls).toBe(1)
    expect(finished.status).toBe('succeeded')
  })

  it('cancels a run when the signal aborts mid-stage', async () => {
    const gate = Promise.withResolvers<void>()
    registerDevSpaceStage('structural', async () => { await gate.promise })
    const h = harness()
    registerDevSpaceActiveRun(run().id, h.controller)
    const pending = execute(h, run())
    expect(isDevSpaceRunActive(run().id)).toBe(true)
    h.controller.abort()
    gate.resolve()
    const finished = await pending
    unregisterDevSpaceActiveRun(run().id)
    expect(finished.status).toBe('cancelled')
    expect(isDevSpaceRunActive(run().id)).toBe(false)
    expect(await readDevSpaceRun(h.root, 'demo', finished.id)).toEqual(finished)
  })
})