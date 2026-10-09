import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import { devSpaceArtifactDirectory, readDevSpaceManifest } from '../artifacts.ts'
import {
  ToolExecError, createToolAdapter, parseToolVersion, toolProcessEnv,
  type StructuralAdapter, type StructuralAdapterContext, type ToolExec, type ToolExecInput,
} from '../adapters/contract.ts'
import { codegraphAdapterSpec } from '../adapters/codegraph.ts'
import { gromaAdapterSpec } from '../adapters/groma.ts'
import { graphifyAdapterSpec } from '../adapters/graphify.ts'
import { archifyAdapterSpec } from '../adapters/archify.ts'
import type { DevSpaceStageContext } from '../runner.ts'
import { clearDevSpaceStages, hasDevSpaceStage } from '../runner.ts'
import { defaultStructuralAdapters, registerDevSpaceStructuralStage, runStructuralStage } from '../stages/structural.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
beforeEach(() => { clearDevSpaceStages() })
afterEach(() => { clearDevSpaceStages() })

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-devspace-structural-'))
  roots.push(root)
  return root
}

const repositoryId = `repo_${'b'.repeat(64)}`
const snapshotId = `snapshot_${'c'.repeat(64)}`
const runId = `devrun_${'a'.repeat(64)}`

function record(overrides: Partial<DevSpaceRepositoryRecord> = {}): DevSpaceRepositoryRecord {
  return {
    schemaVersion: 1,
    id: `devrepo_${'e'.repeat(64)}`,
    repositoryId,
    workspaceId: 'ws',
    projectId: 'proj',
    projectSlug: 'demo',
    origin: { kind: 'local-folder', path: '/tmp/demo' },
    displayName: 'demo',
    status: 'bound',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function adapterContext(root: string, cwd: string): StructuralAdapterContext {
  return {
    root, cwd, projectSlug: 'demo', repositoryId, snapshotId, runId,
    signal: new AbortController().signal, report: () => undefined,
  }
}

/** Stub exec seam that records every invocation and can create the tool's output files. */
function stubExec(options: {
  probe?: ((input: ToolExecInput) => { stdout: string }) | 'unavailable'
  onRun?: (input: ToolExecInput) => void
} = {}): { exec: ToolExec; calls: ToolExecInput[] } {
  const calls: ToolExecInput[] = []
  const exec: ToolExec = async input => {
    calls.push(input)
    if (input.args.includes('--version')) {
      if (options.probe === 'unavailable') throw new ToolExecError('unavailable', null, `spawn ${input.command} ENOENT`)
      return { code: 0, stdout: options.probe ? options.probe(input).stdout : `${input.command} 1.2.3`, stderr: '' }
    }
    if (options.probe === 'unavailable') throw new ToolExecError('unavailable', null, `spawn ${input.command} ENOENT`)
    options.onRun?.(input)
    return { code: 0, stdout: '', stderr: '' }
  }
  return { exec, calls }
}

/** Create a declared output file under the recorded cwd, as a real tool would. */
function writeOutput(source: string, content: string): (input: ToolExecInput) => void {
  return input => {
    const target = join(input.cwd, source)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
}

describe('devSpace structural adapter contract', () => {
  it('reports unavailable (never throwing) when the tool is not on PATH', async () => {
    const adapter = createToolAdapter(gromaAdapterSpec, { exec: stubExec({ probe: 'unavailable' }).exec })
    expect(await adapter.detect()).toMatchObject({ available: false })
    const result = await adapter.run(adapterContext(freshRoot(), freshRoot()))
    expect(result.status).toBe('unavailable')
    expect(result.artifactIds).toEqual([])
  })

  it('detects a tool and parses its pinned version from the probe output', async () => {
    const adapter = createToolAdapter(graphifyAdapterSpec, { exec: stubExec().exec })
    expect(await adapter.detect()).toEqual({ available: true, version: '1.2.3' })
    expect(parseToolVersion('graphify version v0.9.82\nextra')).toBe('0.9.82')
  })

  it('publishes each tool output into its canonical kind directory with provenance', async () => {
    const cases = [
      { spec: codegraphAdapterSpec, dir: 'code-graph', name: 'graph.json', source: '.codegraph/graph.json' },
      { spec: gromaAdapterSpec, dir: 'c4', name: 'architecture.md', source: 'groma/architecture.md' },
      { spec: graphifyAdapterSpec, dir: 'knowledge-graph', name: 'graph.json', source: 'graphify-out/graph.json' },
      { spec: archifyAdapterSpec, dir: 'diagrams', name: 'diagram.svg', source: 'archify-out/diagram.svg' },
    ] as const
    for (const testCase of cases) {
      const root = freshRoot()
      const cwd = freshRoot()
      const { exec } = stubExec({ onRun: writeOutput(testCase.source, 'payload') })
      const adapter = createToolAdapter(testCase.spec, { exec })
      const result = await adapter.run(adapterContext(root, cwd))
      expect(result.status).toBe('ok')
      expect(result.artifactIds).toHaveLength(1)
      const manifest = await readDevSpaceManifest(root, 'demo')
      expect(manifest?.entries).toHaveLength(1)
      const entry = manifest!.entries[0]!
      expect(entry).toMatchObject({
        kind: testCase.spec.kind, format: testCase.spec.outputs[0]!.format,
        producedBy: { providerId: testCase.spec.providerId, version: testCase.spec.version },
      })
      expect(devSpaceArtifactDirectory(root, 'demo', entry.kind)).toBe(join(root, 'projects', 'demo', 'dev-space', testCase.dir))
      expect(readFileSync(join(root, 'projects', 'demo', 'dev-space', testCase.dir, testCase.name), 'utf8')).toBe('payload')
    }
  })

  it('reports an error outcome and writes no manifest row when the tool produces nothing', async () => {
    const root = freshRoot()
    const { exec } = stubExec()
    const adapter = createToolAdapter(archifyAdapterSpec, { exec })
    const result = await adapter.run(adapterContext(root, freshRoot()))
    expect(result.status).toBe('error')
    expect(await readDevSpaceManifest(root, 'demo')).toBeNull()
  })

  it('runs the tool with a git-hardened env and no package-manager or install argv', async () => {
    const root = freshRoot()
    const cwd = freshRoot()
    const { exec, calls } = stubExec({ onRun: writeOutput('.codegraph/graph.json', '{}') })
    const adapter = createToolAdapter(codegraphAdapterSpec, { exec })
    await adapter.detect()
    await adapter.run(adapterContext(root, cwd))
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.command).toBe('codegraphcontext')
      expect(call.args.join(' ')).not.toMatch(/\b(install|update|add|remove|upgrade)\b/)
      expect(call.env.GIT_TERMINAL_PROMPT).toBe('0')
      expect(call.env.GIT_OPTIONAL_LOCKS).toBe('0')
    }
    const runCall = calls.find(call => !call.args.includes('--version'))!
    expect(runCall.env.CGC_RUNTIME_DB_PATH).toContain(join('projects', 'demo', 'dev-space', 'code-graph'))
    expect(runCall.cwd).toBe(cwd)
  })

  it('hardens only git env vars and leaves the base environment intact', () => {
    const env = toolProcessEnv({ PATH: '/usr/bin' }, { CUSTOM: '1' })
    expect(env).toMatchObject({ PATH: '/usr/bin', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', CUSTOM: '1' })
  })
})

describe('devSpace structural stage', () => {
  function stageContext(root: string, signal: AbortSignal, progress: Array<[number, number]>, repo = record()): DevSpaceStageContext {
    return {
      runId, repositoryId, snapshotId, workspaceId: 'ws', projectSlug: repo.projectSlug, root, record: repo, signal,
      report: (done, total) => { progress.push([done, total]) },
    }
  }

  it('runs available adapters in sequence, skips the missing one and settles partial', async () => {
    const root = freshRoot()
    const { exec, calls } = stubExec({ onRun: writeOutput('graphify-out/graph.json', '{"nodes":[]}') })
    const graphify = createToolAdapter(graphifyAdapterSpec, { exec })
    const groma = createToolAdapter(gromaAdapterSpec, { exec: stubExec({ probe: 'unavailable', onRun: () => undefined }).exec })
    const progress: Array<[number, number]> = []
    const recordValue = record({ origin: { kind: 'git-url', url: 'https://github.com/acme/demo.git', provider: 'github' } })

    const outcome = await runStructuralStage([graphify, groma], stageContext(root, new AbortController().signal, progress, recordValue))

    expect(outcome.partial).toBe(true)
    expect(outcome.artifacts).toHaveLength(1)
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]])
    // git-url origin resolves cwd under projects/<slug>/<repo-dir> (ADR-0022).
    const runCall = calls.find(call => !call.args.includes('--version'))!
    expect(runCall.cwd).toBe(join(root, 'projects', 'demo', 'demo'))

    const manifest = await readDevSpaceManifest(root, 'demo')
    expect(manifest?.entries.map(entry => entry.kind)).toEqual(['knowledge-graph'])

    const audit = readFileSync(join(root, 'projects', 'demo', 'dev-space', 'audit.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(audit.map(entry => [entry.tool, entry.status])).toEqual([['graphify', 'run'], ['groma', 'skip']])
  })

  it('marks the outcome partial when an adapter that is installed fails', async () => {
    const root = freshRoot()
    const failing: StructuralAdapter = {
      id: 'broken', kind: 'c4', version: '0.0.1',
      detect: async () => ({ available: true }),
      run: async () => ({ status: 'error', artifactIds: [], detail: 'boom' }),
    }
    const outcome = await runStructuralStage([failing], stageContext(root, new AbortController().signal, []))
    expect(outcome).toEqual({ artifacts: [], partial: true })
  })

  it('stops before touching any tool once the signal is aborted', async () => {
    const root = freshRoot()
    const { exec, calls } = stubExec()
    const adapter = createToolAdapter(graphifyAdapterSpec, { exec })
    const controller = new AbortController()
    controller.abort()
    const outcome = await runStructuralStage([adapter], stageContext(root, controller.signal, []))
    expect(outcome).toEqual({ artifacts: [], partial: true })
    expect(calls).toHaveLength(0)
  })

  it('registers the structural stage (default and explicit adapter sets)', () => {
    expect(hasDevSpaceStage('structural')).toBe(false)
    registerDevSpaceStructuralStage()
    expect(hasDevSpaceStage('structural')).toBe(true)
    clearDevSpaceStages()
    expect(defaultStructuralAdapters().map(adapter => adapter.id)).toEqual(['codegraph', 'groma', 'graphify', 'archify'])
    registerDevSpaceStructuralStage([])
    expect(hasDevSpaceStage('structural')).toBe(true)
  })
})