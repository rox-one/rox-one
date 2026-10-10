import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { devSpacePlanHash, devSpaceRunId, DEV_SPACE_RUN_STAGES } from '@rox/shared/dev-space'
import { clearDevSpaceToolRuntime, getDevSpaceToolRuntime } from '@rox/session-tools-core'
import type { ProjectConfig } from '@rox/shared/projects'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { registerDevSpaceHandlers } from '../dev-space.ts'
import type { DevSpaceReconcileInput } from '../dev-space.ts'
import { cloneArgs, gitProcessEnv, parseCloneProgress } from '../../../devspace/clone.ts'
import { readDevSpaceRun, writeDevSpaceRun } from '../../../devspace/runs.ts'
import { writeDevSpaceArtifact } from '../../../devspace/artifacts.ts'
import { createHash } from 'node:crypto'
import { DEV_SPACE_READ_ARTIFACT_MAX_BYTES } from '@rox/shared/dev-space'
import type { DevSpaceRun } from '@rox/shared/dev-space'

const roots: string[] = []
afterEach(() => {
  clearDevSpaceToolRuntime()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface EnvironmentOverrides {
  resolveGithubToken?: (workspaceId: string, repositoryId: string) => Promise<string | null>
  reconcile?: (input: DevSpaceReconcileInput) => Promise<{ snapshotId: string }>
}

interface DevSpaceFixture {
  readonly root: string
  readonly handlers: Map<string, HandlerFn>
  readonly pushes: Array<{ channel: string; target: unknown; args: unknown[] }>
  readonly configs: Map<string, ProjectConfig>
  call(channel: string): (input: unknown, ctx?: RequestContext) => Promise<any>
  /** Resolves the first time a push lands on `channel` (event-driven, no timers). */
  waitForPush(channel: string): Promise<void>
  /** Resolves once the detached run journal reaches a terminal status (event-driven). */
  waitForSettled(projectSlug: string, runId: string): Promise<DevSpaceRun>
}

function fixture(overrides: EnvironmentOverrides = {}): DevSpaceFixture {
  const root = mkdtempSync(join(tmpdir(), 'rox-devspace-rpc-'))
  roots.push(root)
  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  const configs = new Map<string, ProjectConfig>()
  const pushWaiters = new Map<string, () => void>()
  // A detached run settles by rewriting its journal, then emitting a final
  // progress push — so a push arriving after the journal is terminal resolves.
  const terminalStatus: Record<string, true> = { succeeded: true, partial: true, failed: true, cancelled: true }
  const settleWaiters: Array<{ slug: string; runId: string; resolve: (run: DevSpaceRun) => void }> = []
  const checkSettleWaiters = async (): Promise<void> => {
    for (const waiter of [...settleWaiters]) {
      const run = await readDevSpaceRun(root, waiter.slug, waiter.runId)
      if (!run || !terminalStatus[run.status]) continue
      const index = settleWaiters.indexOf(waiter)
      if (index >= 0) settleWaiters.splice(index, 1)
      waiter.resolve(run)
    }
  }
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push(channel: string, target: unknown, ...args: unknown[]) {
      pushes.push({ channel, target, args })
      const waiter = pushWaiters.get(channel)
      if (waiter) { pushWaiters.delete(channel); waiter() }
      if (channel === RPC_CHANNELS.devSpace.RUN_PROGRESS) void checkSettleWaiters()
    },
    onShutdown() { return () => {} },
  } as unknown as RpcServer
  const deps = {
    windowManager: {
      getWindowByWebContentsId: (id: number) => (id === 1 ? {} : null),
      getWorkspaceForWindow: (id: number) => (id === 1 ? 'ws' : null),
    },
  } as unknown as HandlerDeps
  registerDevSpaceHandlers(server, deps, {
    getWorkspace: id => (id === 'ws' ? { id, rootPath: root } : null),
    loadProject: (_root, id) => {
      const config = [...configs.values()].find(entry => entry.id === id)
      return config ? { config } : null
    },
    saveProject: (_root, config) => { configs.set(config.slug, config) },
    loadProjectConfig: (_root, slug) => configs.get(slug) ?? null,
    // The rpc fixture exercises the handler, not the real tool adapters: empty
    // adapter sets keep the registered structural/llm stages hermetic (no probes).
    structuralAdapters: [],
    llmAdapters: [],
    ...(overrides.resolveGithubToken ? { resolveGithubToken: overrides.resolveGithubToken } : {}),
    ...(overrides.reconcile ? { reconcile: overrides.reconcile } : {}),
  })
  const context: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: 1 }
  const call = (channel: string) => (input: unknown, ctx: RequestContext = context) =>
    Promise.resolve().then(() => handlers.get(channel)!(ctx, input))
  const waitForPush = (channel: string): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>()
    pushWaiters.set(channel, resolve)
    return promise
  }
  const waitForSettled = (slug: string, runId: string): Promise<DevSpaceRun> => {
    const { promise, resolve } = Promise.withResolvers<DevSpaceRun>()
    settleWaiters.push({ slug, runId, resolve })
    void checkSettleWaiters()
    return promise
  }
  return { root, handlers, pushes, configs, call, waitForPush, waitForSettled }
}

const DEV_SPACE_CHANNELS = [
  RPC_CHANNELS.devSpace.LIST_REPOSITORIES, RPC_CHANNELS.devSpace.ADD_REPOSITORY, RPC_CHANNELS.devSpace.START_CLONE,
  RPC_CHANNELS.devSpace.REMOVE_REPOSITORY, RPC_CHANNELS.devSpace.REFRESH_REPOSITORY, RPC_CHANNELS.devSpace.CANCEL,
  RPC_CHANNELS.devSpace.CAPABILITIES, RPC_CHANNELS.devSpace.LIST_RUNS, RPC_CHANNELS.devSpace.START_RUN,
  RPC_CHANNELS.devSpace.LIST_ARTIFACTS, RPC_CHANNELS.devSpace.READ_ARTIFACT,
  RPC_CHANNELS.devSpace.GENERATE_QUESTIONS, RPC_CHANNELS.devSpace.SET_WATCH,
]

describe('devSpace:* handlers', () => {
  it('registers exactly the frozen devSpace channels', () => {
    expect([...fixture().handlers.keys()].sort()).toEqual([...DEV_SPACE_CHANNELS].sort())
  })

  it('returns an empty catalog projection without secrets', async () => {
    const f = fixture()
    expect(await f.call(RPC_CHANNELS.devSpace.LIST_REPOSITORIES)({ workspaceId: 'ws' }))
      .toEqual({ schemaVersion: 1, repositories: [] })
  })

  it('adds a git-url repository record without cloning or leaking credentials', async () => {
    const f = fixture()
    const record = await f.call(RPC_CHANNELS.devSpace.ADD_REPOSITORY)({
      workspaceId: 'ws', source: { kind: 'git-url', url: 'https://github.com/rox/one.git' },
    })
    expect(record).toMatchObject({ status: 'unbound', repositoryId: expect.stringMatching(/^repo_[a-f0-9]{64}$/) })
    expect(record.origin).toEqual({ kind: 'git-url', url: 'https://github.com/rox/one.git', provider: 'github' })
    expect(JSON.stringify(record)).not.toMatch(/token|secret|password/i)
    expect(f.pushes).toEqual([])
    const catalog = JSON.parse(readFileSync(join(f.root, 'dev-space-repositories.json'), 'utf8'))
    expect(catalog.schemaVersion).toBe(1)
    expect(catalog.repositories).toHaveLength(1)
    const fromDisk: string = JSON.stringify(catalog)
    expect(fromDisk).not.toMatch(/token|secret|password/i)
  })

  it('rejects a non-GitHub or insecure git-url and a missing project slug pattern', async () => {
    const f = fixture()
    const add = f.call(RPC_CHANNELS.devSpace.ADD_REPOSITORY)
    await expect(add({ workspaceId: 'ws', source: { kind: 'git-url', url: 'http://github.com/a/b' } })).rejects.toThrow()
    await expect(add({ workspaceId: 'ws', source: { kind: 'git-url', url: 'https://gitlab.com/a/b' } })).rejects.toThrow()
    await expect(add({ workspaceId: 'ws', source: { kind: 'git-url', url: 'https://github.com/a/b' }, projectSlug: 'Bad Slug' })).rejects.toThrow()
  })

  it('rejects a local-folder source that is not absolute', async () => {
    const f = fixture()
    await expect(f.call(RPC_CHANNELS.devSpace.ADD_REPOSITORY)({
      workspaceId: 'ws', source: { kind: 'local-folder', path: 'relative/folder' },
    })).rejects.toThrow()
  })

  it('requires confirmation before removing a repository', async () => {
    const f = fixture()
    await expect(f.call(RPC_CHANNELS.devSpace.REMOVE_REPOSITORY)({
      workspaceId: 'ws', repositoryId: `devrepo_${'a'.repeat(64)}`,
    })).rejects.toThrow()
    expect(existsSync(join(f.root, 'dev-space-repositories.json'))).toBe(false)
  })

  it('cancels only a known in-flight request', async () => {
    const f = fixture()
    expect(await f.call(RPC_CHANNELS.devSpace.CANCEL)({ workspaceId: 'ws', requestId: 'r1' })).toBe(false)
    await expect(f.call(RPC_CHANNELS.devSpace.CANCEL)({ workspaceId: 'ws' })).rejects.toThrow()
  })

  it('reports github-device-login availability from the environment', async () => {
    expect((await fixture().call(RPC_CHANNELS.devSpace.CAPABILITIES)({ workspaceId: 'ws' })).githubDeviceLogin).toBe(false)
    const withToken = fixture({ resolveGithubToken: async () => 'ghp_example' })
    expect((await withToken.call(RPC_CHANNELS.devSpace.CAPABILITIES)({ workspaceId: 'ws' })).githubDeviceLogin).toBe(true)
  })

  it('publishes a read/search dev-space tool runtime whose propose path stays disabled', async () => {
    expect(getDevSpaceToolRuntime()).toBeNull()
    fixture()
    const runtime = getDevSpaceToolRuntime()
    expect(runtime).not.toBeNull()
    expect(runtime!.propose).toBeUndefined()
  })

  it('starts a run, journals it, and lists it back through the real reader', async () => {
    const snapshotId = `snapshot_${'a'.repeat(64)}`
    const f = fixture({ reconcile: async () => ({ snapshotId }) })
    const record = await f.call(RPC_CHANNELS.devSpace.ADD_REPOSITORY)({
      workspaceId: 'ws', source: { kind: 'git-url', url: 'https://github.com/rox/one.git' },
    })
    const settlePush = f.waitForPush(RPC_CHANNELS.devSpace.RUN_PROGRESS)
    const run = await f.call(RPC_CHANNELS.devSpace.START_RUN)({ workspaceId: 'ws', requestId: 'r1', repositoryId: record.id })
    const expectedRunId = devSpaceRunId(record.repositoryId, snapshotId, devSpacePlanHash(DEV_SPACE_RUN_STAGES))
    expect(run).toMatchObject({ id: expectedRunId, status: 'queued', snapshotId, stages: DEV_SPACE_RUN_STAGES })
    await settlePush
    // Every stage is registered (empty adapter sets in this fixture), so the run
    // executes the full set and settles `partial` (no tools/port composed here).
    const settled = await f.waitForSettled(record.projectSlug, expectedRunId)
    expect(settled).toMatchObject({ status: 'partial', completedStages: [...DEV_SPACE_RUN_STAGES], artifacts: [] })
    expect(settled.error).toBeUndefined()
    const listed = await f.call(RPC_CHANNELS.devSpace.LIST_RUNS)({ workspaceId: 'ws' })
    expect(listed.runs.map((entry: DevSpaceRun) => entry.id)).toEqual([expectedRunId])
    expect(f.pushes.some(push => push.channel === RPC_CHANNELS.devSpace.RUN_PROGRESS)).toBe(true)
  })

  it('returns a succeeded run from the journal as an idempotent cache hit', async () => {
    const snapshotId = `snapshot_${'b'.repeat(64)}`
    const f = fixture({ reconcile: async () => ({ snapshotId }) })
    const record = await f.call(RPC_CHANNELS.devSpace.ADD_REPOSITORY)({
      workspaceId: 'ws', source: { kind: 'git-url', url: 'https://github.com/rox/one.git' },
    })
    const runId = devSpaceRunId(record.repositoryId, snapshotId, devSpacePlanHash(DEV_SPACE_RUN_STAGES))
    const cached: DevSpaceRun = {
      schemaVersion: 1, id: runId, repositoryId: record.repositoryId, snapshotId, stages: DEV_SPACE_RUN_STAGES,
      status: 'succeeded', progress: { stage: 'publish', done: 1, total: 1 }, startedAt: 1, finishedAt: 2,
      completedStages: [...DEV_SPACE_RUN_STAGES], artifacts: [],
    }
    await writeDevSpaceRun(f.root, record.projectSlug, cached)
    const returned = await f.call(RPC_CHANNELS.devSpace.START_RUN)({ workspaceId: 'ws', requestId: 'r2', repositoryId: record.id })
    expect(returned).toEqual(cached)
    expect(f.pushes).toEqual([])
  })

  it('rejects startRun for an unknown repository id', async () => {
    const f = fixture({ reconcile: async () => ({ snapshotId: 'snapshot_x' }) })
    await expect(f.call(RPC_CHANNELS.devSpace.START_RUN)({
      workspaceId: 'ws', repositoryId: `devrepo_${'c'.repeat(64)}`,
    })).rejects.toThrow()
  })

  it('reads back a half-written run journal without failing the list', async () => {
    const f = fixture()
    const directory = join(f.root, 'projects', 'demo', 'dev-space', 'runs')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, `devrun_${'a'.repeat(64)}.json`), '{ not json')
    expect((await f.call(RPC_CHANNELS.devSpace.LIST_RUNS)({ workspaceId: 'ws', projectSlug: 'demo' })).runs).toEqual([])
  })
})

describe('devSpace artifact read surface', () => {
  const producedBy = { providerId: 'openwiki', version: '1.0.0' }

  it('lists manifest entries with a stale flag and no host paths', async () => {
    const f = fixture()
    const entry = await writeDevSpaceArtifact({
      root: f.root, projectSlug: 'demo', repositoryId: 'repo_x', snapshotId: 'snap_a', runId: 'run_a',
      kind: 'wiki', name: 'index.md', format: 'md', content: '# Hello', producedBy,
    })
    const result = await f.call(RPC_CHANNELS.devSpace.LIST_ARTIFACTS)({ workspaceId: 'ws', projectSlug: 'demo' })
    expect(result.projectSlug).toBe('demo')
    expect(result.stale).toBe(false)
    expect(result.artifacts).toEqual([{ ...entry, stale: false }])
    expect(JSON.stringify(result)).not.toContain(f.root)
  })

  it('flags artifacts stale once the catalog snapshot has moved on', async () => {
    const f = fixture({ reconcile: async () => ({ snapshotId: `snapshot_${'a'.repeat(64)}` }) })
    const record = await f.call(RPC_CHANNELS.devSpace.ADD_REPOSITORY)({
      workspaceId: 'ws', source: { kind: 'git-url', url: 'https://github.com/rox/one.git' },
    })
    await writeDevSpaceArtifact({
      root: f.root, projectSlug: record.projectSlug, repositoryId: record.repositoryId,
      snapshotId: `snapshot_${'b'.repeat(64)}`, runId: 'run_b', kind: 'c4', name: 'context.md', format: 'md',
      content: 'ok', producedBy,
    })
    const result = await f.call(RPC_CHANNELS.devSpace.LIST_ARTIFACTS)({ workspaceId: 'ws', repositoryId: record.id })
    expect(result.stale).toBe(true)
    expect(result.artifacts[0]?.stale).toBe(true)
  })

  it('reads a text artifact as utf8 with a provenance hash', async () => {
    const f = fixture()
    const entry = await writeDevSpaceArtifact({
      root: f.root, projectSlug: 'demo', repositoryId: 'repo_x', snapshotId: 'snap', runId: 'run',
      kind: 'wiki', name: 'index.md', format: 'md', content: '# Hello', producedBy,
    })
    const result = await f.call(RPC_CHANNELS.devSpace.READ_ARTIFACT)({ workspaceId: 'ws', projectSlug: 'demo', artifactId: entry.id })
    expect(result).toMatchObject({ content: '# Hello', encoding: 'utf8', truncated: false, byteLength: 7 })
    expect(result.contentHash).toBe(createHash('sha256').update(Buffer.from('# Hello')).digest('hex'))
    expect(JSON.stringify(result)).not.toContain(f.root)
  })

  it('returns binary artifacts as base64 and truncates past the byte cap', async () => {
    const f = fixture()
    const binary = await writeDevSpaceArtifact({
      root: f.root, projectSlug: 'demo', repositoryId: 'repo_x', snapshotId: 'snap', runId: 'run',
      kind: 'audio', name: 'demo.mp3', format: 'mp3', content: 'ID3-bytes', producedBy,
    })
    const read = await f.call(RPC_CHANNELS.devSpace.READ_ARTIFACT)({ workspaceId: 'ws', projectSlug: 'demo', artifactId: binary.id })
    expect(read).toMatchObject({ encoding: 'base64', truncated: false })
    expect(Buffer.from(read.content, 'base64').toString('utf8')).toBe('ID3-bytes')

    const big = await writeDevSpaceArtifact({
      root: f.root, projectSlug: 'demo', repositoryId: 'repo_x', snapshotId: 'snap', runId: 'run',
      kind: 'sbom-cve', name: 'sbom.json', format: 'json', content: 'x'.repeat(DEV_SPACE_READ_ARTIFACT_MAX_BYTES + 10), producedBy,
    })
    const cut = await f.call(RPC_CHANNELS.devSpace.READ_ARTIFACT)({ workspaceId: 'ws', projectSlug: 'demo', artifactId: big.id })
    expect(cut.truncated).toBe(true)
    expect(cut.byteLength).toBe(DEV_SPACE_READ_ARTIFACT_MAX_BYTES)
  })

  it('rejects unknown artifacts and malformed requests', async () => {
    const f = fixture()
    await expect(f.call(RPC_CHANNELS.devSpace.READ_ARTIFACT)({
      workspaceId: 'ws', projectSlug: 'demo', artifactId: `artifact_${'a'.repeat(64)}`,
    })).rejects.toThrow()
    await expect(f.call(RPC_CHANNELS.devSpace.READ_ARTIFACT)({
      workspaceId: 'ws', projectSlug: 'demo', artifactId: 'nope',
    })).rejects.toThrow()
    await expect(f.call(RPC_CHANNELS.devSpace.LIST_ARTIFACTS)({ workspaceId: 'ws' })).rejects.toThrow()
  })
})

describe('devSpace:setWatch (v1.x O10)', () => {
  const addGitRepo = async (f: DevSpaceFixture) =>
    f.call(RPC_CHANNELS.devSpace.ADD_REPOSITORY)({
      workspaceId: 'ws', source: { kind: 'git-url', url: 'https://github.com/rox/one.git' },
    })

  it('stores consent, auto-pull and interval on the catalog record and on disk', async () => {
    const f = fixture()
    const added = await addGitRepo(f)
    const updated = await f.call(RPC_CHANNELS.devSpace.SET_WATCH)({
      workspaceId: 'ws', repositoryId: added.id, watchEnabled: true, watchAutoPull: true, watchIntervalMs: 3_600_000,
    })
    expect(updated).toMatchObject({ id: added.id, watchEnabled: true, watchAutoPull: true, watchIntervalMs: 3_600_000 })
    const onDisk = JSON.parse(readFileSync(join(f.root, 'dev-space-repositories.json'), 'utf8'))
    expect(onDisk.repositories[0]).toMatchObject({ watchEnabled: true, watchAutoPull: true, watchIntervalMs: 3_600_000 })
    expect(f.pushes.at(-1)).toMatchObject({
      channel: RPC_CHANNELS.devSpace.CHANGED,
      args: [{ repositoryId: added.repositoryId, status: added.status }],
    })
  })

  it('defaults auto-pull off and keeps the chosen interval across a disable', async () => {
    const f = fixture()
    const added = await addGitRepo(f)
    const set = f.call(RPC_CHANNELS.devSpace.SET_WATCH)
    const enabled = await set({ workspaceId: 'ws', repositoryId: added.id, watchEnabled: true, watchIntervalMs: 7_200_000 })
    expect(enabled.watchAutoPull).toBe(false)
    expect(enabled.watchIntervalMs).toBe(7_200_000)
    const disabled = await set({ workspaceId: 'ws', repositoryId: added.id, watchEnabled: false })
    expect(disabled.watchEnabled).toBe(false)
    expect(disabled.watchIntervalMs).toBe(7_200_000)
  })

  it('rejects out-of-range intervals and non-boolean flags', async () => {
    const f = fixture()
    const added = await addGitRepo(f)
    const set = f.call(RPC_CHANNELS.devSpace.SET_WATCH)
    await expect(set({ workspaceId: 'ws', repositoryId: added.id, watchEnabled: true, watchIntervalMs: 60_000 })).rejects.toThrow()
    await expect(set({ workspaceId: 'ws', repositoryId: added.id, watchEnabled: true, watchIntervalMs: 25 * 3_600_000 })).rejects.toThrow()
    await expect(set({ workspaceId: 'ws', repositoryId: added.id, watchEnabled: 'yes' })).rejects.toThrow()
    await expect(set({ workspaceId: 'ws', repositoryId: added.id, watchEnabled: true, watchAutoPull: 1 })).rejects.toThrow()
    await expect(set({ workspaceId: 'ws', repositoryId: `devrepo_${'a'.repeat(64)}`, watchEnabled: true })).rejects.toThrow()
  })
})

describe('git clone transport', () => {
  it('keeps the token out of argv and out of the environment when none is resolved', () => {
    const args = cloneArgs('https://github.com/a/b.git', '/tmp/dest')
    expect(args).not.toContain('ghp_example')
    const env = gitProcessEnv({ PATH: '/usr/bin' }, null)
    expect(env).not.toHaveProperty('GIT_ASKPASS')
    expect(env).not.toHaveProperty('GIT_ASKPASS_TOKEN')
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('delivers a resolved token only through the askpass helper env', () => {
    const env = gitProcessEnv({ PATH: '/usr/bin' }, { path: '/tmp/askpass.sh', token: 'ghp_example' })
    expect(env.GIT_ASKPASS).toBe('/tmp/askpass.sh')
    expect(env.GIT_ASKPASS_TOKEN).toBe('ghp_example')
    expect(cloneArgs('https://github.com/a/b.git', '/tmp/dest')).not.toContain('ghp_example')
  })

  it('parses git progress lines into renderer-safe events', () => {
    expect(parseCloneProgress('repo_x', 'Receiving objects:  62% (620/1000), 1.20 MiB | 500.00 KiB/s'))
      .toEqual({ repositoryId: 'repo_x', phase: 'receiving-objects', receivedBytes: Math.round(1.2 * 1024 * 1024) })
    expect(parseCloneProgress('repo_x', 'remote: Counting objects: 100% (10/10)')).toEqual({ repositoryId: 'repo_x', phase: 'counting-objects' })
    expect(parseCloneProgress('repo_x', 'Cloning into /tmp/dest...')).toBeNull()
  })
})