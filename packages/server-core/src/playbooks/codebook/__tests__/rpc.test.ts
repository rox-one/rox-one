import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type { ProjectConfig } from '@rox/shared/projects'
import type { CodebookJob, CodebookRun } from '@rox/shared/playbooks'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../../handlers/handler-deps'
import type { CodebookProcessInput, CodebookProcessResult } from '../engine.ts'
import { DEFAULT_ENVIRONMENT, HANDLED_CHANNELS, registerCodebookHandlers, type HandlerEnvironment } from '../index.ts'
import { codebookRunsDirectory } from '../runs.ts'

const SLUG = 'demo-project'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-codebook-'))
  // The handler canonicalises the workspace root (`realpath`), so the fixture
  // must hand out the same canonical path or journal reads diverge (/var vs /private/var).
  const canonical = realpathSync(dir)
  roots.push(canonical)
  mkdirSync(join(canonical, 'projects', SLUG), { recursive: true })
  return canonical
}

interface HarnessOptions {
  project?: ProjectConfig
  runner?: (input: CodebookProcessInput) => Promise<CodebookProcessResult>
}

function harness(options: HarnessOptions = {}) {
  const dir = root()
  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string; args: unknown[] }> = []
  const listeners = new Set<() => void>()
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push(channel: string, _target: unknown, ...args: unknown[]) {
      pushes.push({ channel, args })
      for (const listener of [...listeners]) listener()
    },
    onShutdown() { return () => {} },
  } as unknown as RpcServer
  const config: ProjectConfig = options.project ?? { id: 'proj_1', slug: SLUG, name: 'Demo', workingDirectory: dir, createdAt: 1, updatedAt: 1 }
  const saved = new Map<string, ProjectConfig>([[config.slug, config]])
  const ran: string[] = []
  const environment: HandlerEnvironment = {
    ...DEFAULT_ENVIRONMENT,
    getWorkspace: id => (id === 'ws' ? { id, rootPath: dir } : null),
    loadProjectConfig: (_root, slug) => saved.get(slug) ?? null,
    saveProject: (_root, project) => { saved.set(project.slug, project) },
    run: async input => {
      ran.push(input.command)
      return options.runner ? options.runner(input) : { code: 0, stdout: `out-${input.command}`, stderr: '' }
    },
  }
  const deps = {
    // No session mechanism composed: an agent cell must answer agent-unavailable.
    sessionManager: {},
    windowManager: {
      getWindowByWebContentsId: (id: number) => (id === 1 ? {} : null),
      getWorkspaceForWindow: (id: number) => (id === 1 ? 'ws' : null),
    },
  } as unknown as HandlerDeps
  registerCodebookHandlers(server, deps, environment)
  const context: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: 1 }
  const call = (channel: string) => (input: unknown, ctx: RequestContext = context) =>
    Promise.resolve().then(() => handlers.get(channel)!(ctx, input))
  /** Await the real push event, not a guessed duration. */
  const waitForJobState = (state: CodebookJob['state']): Promise<CodebookJob> => {
    const { promise, resolve } = Promise.withResolvers<CodebookJob>()
    const check = () => {
      const last = jobsFrom(pushes).at(-1)
      if (last?.state === state) { listeners.delete(check); resolve(last) }
    }
    listeners.add(check)
    check()
    return promise
  }
  return { dir, saved, ran, pushes, handlers, call, waitForJobState }
}

function jobsFrom(pushes: Array<{ channel: string; args: unknown[] }>): CodebookJob[] {
  return pushes.filter(push => push.channel === RPC_CHANNELS.playbooks.CODEBOOK_JOB).map(push => push.args[0] as CodebookJob)
}

function journalOf(dir: string, runId: string): CodebookRun {
  return JSON.parse(readFileSync(join(codebookRunsDirectory(dir, SLUG), `${runId}.json`), 'utf8')) as CodebookRun
}

const SCRIPT_CELL = { id: 'c1', kind: 'script' as const, command: 'echo', args: ['hi'] }

describe('playbooks codebook RPC', () => {
  it('registers the frozen codebook channels', () => {
    const fixture = harness()
    expect([...fixture.handlers.keys()].sort()).toEqual([...HANDLED_CHANNELS].sort())
  })

  it('returns ids immediately, pushes a queued job and journals a successful run', async () => {
    const fixture = harness()
    const started = await fixture.call(RPC_CHANNELS.playbooks.RUN_CODEBOOK)({
      workspaceId: 'ws', notebookId: 'nb1', projectSlug: SLUG, title: 'Demo notebook', cells: [SCRIPT_CELL],
    })
    expect(started.jobId).toMatch(/^codebookjob_[a-f0-9]{16}$/)
    expect(started.runId).toMatch(/^codebookrun_[a-f0-9]{16}$/)
    expect(started.notebookId).toBe('nb1')
    expect(jobsFrom(fixture.pushes)[0]).toMatchObject({ state: 'queued', seq: 1, totalCells: 1 })

    const settled = await fixture.waitForJobState('done')
    expect(settled).toMatchObject({ state: 'done', doneSteps: 1, cellIndex: 0 })
    const seqs = jobsFrom(fixture.pushes).map(job => job.seq)
    // Monotonic seq is the ONLY ordering authority.
    expect(seqs.every((seq, index) => index === 0 || seq > (seqs[index - 1] as number))).toBe(true)

    const run = journalOf(fixture.dir, started.runId)
    expect(run).toMatchObject({ status: 'succeeded', notebookId: 'nb1', title: 'Demo notebook' })
    expect(run.steps[0]!.output).toMatchObject({ text: 'out-echo', exitCode: 0 })
  })

  it('selects a cell subset while preserving notebook indexes', async () => {
    const fixture = harness()
    await fixture.call(RPC_CHANNELS.playbooks.RUN_CODEBOOK)({
      workspaceId: 'ws', notebookId: 'nb1', projectSlug: SLUG,
      cells: [SCRIPT_CELL, { id: 'c2', kind: 'script', command: 'second' }, { id: 'c3', kind: 'script', command: 'third' }],
      cellIds: ['c3'],
    })
    const settled = await fixture.waitForJobState('done')
    expect(fixture.ran).toEqual(['third'])
    expect(settled.totalCells).toBe(1)
    expect(settled.steps[0]).toMatchObject({ cellId: 'c3', index: 2 })
  })

  it('fails with the failing cell index and reports it on the push', async () => {
    const fixture = harness({ runner: async input => ({ code: input.command === 'boom' ? 3 : 0, stdout: '', stderr: 'nope' }) })
    const started = await fixture.call(RPC_CHANNELS.playbooks.RUN_CODEBOOK)({
      workspaceId: 'ws', notebookId: 'nb1', projectSlug: SLUG,
      cells: [SCRIPT_CELL, { id: 'c2', kind: 'script', command: 'boom' }],
    })
    const settled = await fixture.waitForJobState('failed')
    expect(settled).toMatchObject({ state: 'failed', error: { code: 'step-failed', cellIndex: 1 } })
    const run = journalOf(fixture.dir, started.runId)
    expect(run.status).toBe('failed')
    expect(run.error?.cellIndex).toBe(1)
  })

  it('lists the durable run journal', async () => {
    const fixture = harness()
    await fixture.call(RPC_CHANNELS.playbooks.RUN_CODEBOOK)({ workspaceId: 'ws', notebookId: 'nb1', projectSlug: SLUG, cells: [SCRIPT_CELL] })
    await fixture.waitForJobState('done')
    const listing = await fixture.call(RPC_CHANNELS.playbooks.CODEBOOK_RUNS)({ workspaceId: 'ws', projectSlug: SLUG })
    expect(listing.runs).toHaveLength(1)
    expect(listing.runs[0]).toMatchObject({ status: 'succeeded', notebookId: 'nb1' })
  })

  it('cancels the active job by notebook and reports it cancelled', async () => {
    // The runner honours the abort signal, so cancellation needs no wall-clock timer.
    const fixture = harness({ runner: input => {
      const { promise, resolve } = Promise.withResolvers<CodebookProcessResult>()
      input.signal.addEventListener('abort', () => resolve({ code: null, stdout: '', stderr: '' }), { once: true })
      return promise
    } })
    await fixture.call(RPC_CHANNELS.playbooks.RUN_CODEBOOK)({ workspaceId: 'ws', notebookId: 'nb1', projectSlug: SLUG, cells: [SCRIPT_CELL] })
    expect(await fixture.call(RPC_CHANNELS.playbooks.CANCEL_CODEBOOK)({ workspaceId: 'ws', notebookId: 'nb1' })).toEqual({ cancelled: true })
    const settled = await fixture.waitForJobState('cancelled')
    expect(settled).toMatchObject({ state: 'cancelled', error: { code: 'cancelled' } })
  })

  it('answers cancelled:false for an unknown job', async () => {
    const fixture = harness()
    expect(await fixture.call(RPC_CHANNELS.playbooks.CANCEL_CODEBOOK)({ workspaceId: 'ws' })).toEqual({ cancelled: false })
  })

  it('rejects a notebook with no cells and never pushes a job', async () => {
    const fixture = harness()
    const error = await fixture.call(RPC_CHANNELS.playbooks.RUN_CODEBOOK)({ workspaceId: 'ws', notebookId: 'nb1', projectSlug: SLUG, cells: [] }).catch(caught => caught)
    expect(error).toBeInstanceOf(CodedError)
    expect((error as CodedError).code).toBe('INVALID_PAYLOAD')
    expect(fixture.pushes).toEqual([])
  })

  it('answers agent-unavailable when no session mechanism is composed', async () => {
    const fixture = harness()
    await fixture.call(RPC_CHANNELS.playbooks.RUN_CODEBOOK)({
      workspaceId: 'ws', notebookId: 'nb1', projectSlug: SLUG, cells: [{ id: 'a', kind: 'agent', prompt: 'explain' }],
    })
    const settled = await fixture.waitForJobState('failed')
    expect(settled).toMatchObject({ state: 'failed', error: { code: 'agent-unavailable', cellIndex: 0 } })
  })

  it('resolves an artifact cell against the dev-space manifest without copying content', async () => {
    const fixture = harness()
    const devSpace = join(fixture.dir, 'projects', SLUG, 'dev-space')
    mkdirSync(devSpace, { recursive: true })
    writeFileSync(join(devSpace, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, repositoryId: 'repo_x', snapshotId: 'snap_x', runId: 'run_x',
      entries: [{ id: 'artifact_x', kind: 'wiki', path: 'wiki/index.md', format: 'md', producedBy: { providerId: 'p', version: '1' }, createdAt: 1 }],
    }))
    const started = await fixture.call(RPC_CHANNELS.playbooks.RUN_CODEBOOK)({
      workspaceId: 'ws', notebookId: 'nb1', projectSlug: SLUG, cells: [{ id: 'a', kind: 'artifact', artifactId: 'artifact_x' }],
    })
    const settled = await fixture.waitForJobState('done')
    expect(settled).toMatchObject({ state: 'done' })
    const run = journalOf(fixture.dir, started.runId)
    expect(run.steps[0]!.output).toEqual({ artifactId: 'artifact_x', artifactPath: 'wiki/index.md', artifactFormat: 'md' })
    expect(run.steps[0]!.output).not.toHaveProperty('text')
  })

  it('answers artifact-unavailable for an unknown artifact id', async () => {
    const fixture = harness()
    await fixture.call(RPC_CHANNELS.playbooks.RUN_CODEBOOK)({
      workspaceId: 'ws', notebookId: 'nb1', projectSlug: SLUG, cells: [{ id: 'a', kind: 'artifact', artifactId: 'artifact_missing' }],
    })
    const settled = await fixture.waitForJobState('failed')
    expect(settled).toMatchObject({ state: 'failed', error: { code: 'artifact-unavailable', cellIndex: 0 } })
  })

  it('creates and uses the default playbooks container when no project slug is given', async () => {
    const fixture = harness()
    await fixture.call(RPC_CHANNELS.playbooks.RUN_CODEBOOK)({ workspaceId: 'ws', notebookId: 'nb1', cells: [SCRIPT_CELL] })
    await fixture.waitForJobState('done')
    expect(fixture.saved.get('playbooks')).toMatchObject({ slug: 'playbooks', name: 'Playbooks' })
    expect(existsSync(join(fixture.dir, 'projects', 'playbooks'))).toBe(true)
    // The run is journaled under the default container, so a no-slug read lists it.
    const listing = await fixture.call(RPC_CHANNELS.playbooks.CODEBOOK_RUNS)({ workspaceId: 'ws' })
    expect(listing.runs).toHaveLength(1)
    expect(listing.runs[0]).toMatchObject({ status: 'succeeded', notebookId: 'nb1', projectSlug: 'playbooks' })
  })

  it('a read path never creates the default playbooks container', async () => {
    const fixture = harness()
    // A bare read of a workspace that never wrote a codebook lists nothing…
    expect(await fixture.call(RPC_CHANNELS.playbooks.CODEBOOK_RUNS)({ workspaceId: 'ws' })).toEqual({ runs: [] })
    // …and never creates the container on disk.
    expect(existsSync(join(fixture.dir, 'projects', 'playbooks'))).toBe(false)
  })
})

// A run journal with corrupt content must never be surfaced as a valid record.
describe('codebook run journal guards', () => {
  it('skips a corrupt journal entry', async () => {
    const fixture = harness()
    const directory = codebookRunsDirectory(fixture.dir, SLUG)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'codebookrun_00000000000000ff.json'), '{not json')
    const listing = await fixture.call(RPC_CHANNELS.playbooks.CODEBOOK_RUNS)({ workspaceId: 'ws', projectSlug: SLUG })
    expect(listing.runs).toEqual([])
  })
})