import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { ProjectConfig } from '@rox/shared/projects'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { registerDevSpaceHandlers } from '../dev-space.ts'
import { cloneArgs, gitProcessEnv, parseCloneProgress } from '../../../devspace/clone.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

interface EnvironmentOverrides {
  resolveGithubToken?: (workspaceId: string, repositoryId: string) => Promise<string | null>
}

function fixture(overrides: EnvironmentOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rox-devspace-rpc-'))
  roots.push(root)
  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  const configs = new Map<string, ProjectConfig>()
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push(channel: string, target: unknown, ...args: unknown[]) { pushes.push({ channel, target, args }) },
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
    ...(overrides.resolveGithubToken ? { resolveGithubToken: overrides.resolveGithubToken } : {}),
  })
  const context: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: 1 }
  const call = (channel: string) => (input: unknown, ctx: RequestContext = context) =>
    Promise.resolve().then(() => handlers.get(channel)!(ctx, input))
  return { root, handlers, pushes, configs, call }
}

const DEV_SPACE_CHANNELS = [
  RPC_CHANNELS.devSpace.LIST_REPOSITORIES, RPC_CHANNELS.devSpace.ADD_REPOSITORY, RPC_CHANNELS.devSpace.START_CLONE,
  RPC_CHANNELS.devSpace.REMOVE_REPOSITORY, RPC_CHANNELS.devSpace.REFRESH_REPOSITORY, RPC_CHANNELS.devSpace.CANCEL,
  RPC_CHANNELS.devSpace.CAPABILITIES, RPC_CHANNELS.devSpace.LIST_RUNS,
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