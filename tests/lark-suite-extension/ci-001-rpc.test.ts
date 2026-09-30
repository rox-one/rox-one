import { afterEach, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import WebSocket from 'ws'
import { registerCodeIntelligenceHandlers } from '../../packages/server-core/src/handlers/rpc/code-intelligence.ts'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps.ts'
import { WsRpcServer } from '../../packages/server-core/src/transport/server.ts'
import { RPC_CHANNELS, PROTOCOL_VERSION } from '../../packages/shared/src/protocol/index.ts'
import { repositoryPolicyFingerprint } from '../../packages/shared/src/code-intelligence/refs.ts'
import type { FileSpan, RepositoryBinding, RepositorySnapshotSummary, RepositoryFreshness } from '../../packages/shared/src/code-intelligence/refs.ts'
import { loadProjectById, saveProjectConfig } from '../../packages/shared/src/projects/index.ts'
import type { RepositoryConnectionInspection, RepositoryPreview, RepositoryConnectionConfiguration } from '../../packages/shared/src/code-intelligence/repository-connection.ts'

const C = RPC_CHANNELS.codeIntelligence
interface RepositoryRpcResponses {
  [C.PREVIEW]: RepositoryPreview
  [C.BIND]: RepositoryBinding
  [C.CAPTURE]: RepositorySnapshotSummary
  [C.LIST]: RepositoryConnectionInspection
  [C.READ_SPAN]: FileSpan
  [C.FRESHNESS]: RepositoryFreshness
  [C.CANCEL]: boolean
}
interface RpcResponse<T> { result: T; error: { code: string; message: string } }

const exec = promisify(execFile)
const scope = { workspaceId: 'ci-workspace', projectId: 'project-one' }
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function git(root: string, args: string[]) { return (await exec('git', ['-C', root, ...args], { encoding: 'utf8' })).stdout }
async function makeRepository(root: string, label = 'first') {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src/main.ts'), `export function ${label}() {\n  return "${label}"\n}\n`)
  await writeFile(join(root, 'README.md'), '# Repository\n')
  await writeFile(join(root, '.gitignore'), 'ignored.txt\n')
  await git(root, ['init', '--initial-branch=main'])
  await git(root, ['add', '.'])
  await git(root, ['-c', 'user.name=Repository RPC Test', '-c', 'user.email=rpc@example.invalid', 'commit', '-m', 'fixture'])
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rox-ci-rpc-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const repository = join(root, 'repository'), workspace = join(root, 'workspace')
  const folder = join(workspace, 'projects', 'project-one')
  await mkdir(folder, { recursive: true })
  await makeRepository(repository)
  await writeFile(join(folder, 'config.json'), JSON.stringify({ id: scope.projectId, slug: 'project-one', name: 'Repository Project', workingDirectory: join(repository, 'src'), createdAt: 1, updatedAt: 1 }))
  let windowWorkspace: string | null = scope.workspaceId
  let ownsWindow = true
  let nextProjectRead: (() => void) | null = null
  const getProject = () => { const project = loadProjectById(workspace, scope.projectId); if (!project) throw new Error('fixture project missing'); return project }
  const environment = {
    saveProject: saveProjectConfig,
    getWorkspace: (id: string) => id === scope.workspaceId ? { id, rootPath: workspace } : null,
    loadProject: (path: string, id: string) => {
      if (path !== workspace || id !== scope.projectId) return null
      const project = getProject()
      const callback = nextProjectRead; nextProjectRead = null; callback?.()
      return project
    },
  }
  const deps = { windowManager: {
    getWindowByWebContentsId: (id: number) => ownsWindow && id === 42 ? {} : null,
    getWorkspaceForWindow: (id: number) => id === 42 ? windowWorkspace : null,
  } } as unknown as HandlerDeps
  async function startServer() {
    const server = new WsRpcServer({ host: '127.0.0.1', port: 0, serverId: 'ci-test', requireAuth: true,
      validateToken: async token => token === 'ci-test-token',
      resolveLocalClientBinding: candidate => candidate.localClientProof === 'server-owned-proof'
        ? { workspaceId: scope.workspaceId, webContentsId: 42 } : null,
    })
    registerCodeIntelligenceHandlers(server, deps, environment)
    await server.listen()
    cleanups.push(() => server.close())
    return server
  }
  const server = await startServer()
  async function connect(trusted = true, target = server) {
    const ws = new WebSocket(`ws://127.0.0.1:${target.port}`)
    cleanups.push(() => ws.terminate())
    const ack = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('handshake timed out')), 3000)
      ws.once('error', error => { clearTimeout(timeout); reject(error) })
      const listener = (data: WebSocket.RawData) => {
        const response = JSON.parse(data.toString())
        if (response.type === 'handshake_ack') { clearTimeout(timeout); ws.off('message', listener); resolve() }
      }
      ws.on('message', listener)
    })
    ws.on('open', () => ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'handshake', protocolVersion: PROTOCOL_VERSION,
      token: 'ci-test-token', workspaceId: 'spoofed-workspace', webContentsId: 42,
      ...(trusted ? { localClientProof: 'server-owned-proof' } : {}),
    })))
    await ack
    return ws
  }
  function request<Channel extends keyof RepositoryRpcResponses>(ws: WebSocket, channel: Channel, input: unknown): Promise<RpcResponse<RepositoryRpcResponses[Channel]>> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      const timeout = setTimeout(() => { ws.off('message', listener); reject(new Error(`request timed out: ${channel}`)) }, 30000)
      const listener = (data: WebSocket.RawData) => {
        const response = JSON.parse(data.toString())
        if (response.type === 'response' && response.id === id) {
          clearTimeout(timeout); ws.off('message', listener); resolve(response)
        }
      }
      ws.on('message', listener)
      ws.send(JSON.stringify({ id, type: 'request', channel, args: [input] }))
    })
  }
  return { root, repository, workspace, folder, connect, request, startServer,
    store: (binding: RepositoryBinding | null) => {
      if (!binding) throw new Error('fixture expected a bound repository')
      return join(folder, 'code-intelligence', binding.id, repositoryPolicyFingerprint(binding.policy))
    },
    setDirectory: (path: string) => { saveProjectConfig(workspace, { ...getProject().config, workingDirectory: path }) },
    switchWindow: (id: string | null) => { windowWorkspace = id },
    revokeWindow: () => { ownsWindow = false },
    onNextProjectRead: (callback: () => void) => { nextProjectRead = callback },
    approve: async (ws: WebSocket, configuration?: RepositoryConnectionConfiguration) => {
      const preview = await request(ws, C.PREVIEW, { ...scope, ...(configuration ? { configuration } : {}) })
      if (preview.error) throw new Error(preview.error.message)
      return request(ws, C.BIND, { ...scope, configuration: preview.result.configuration, previewFingerprint: preview.result.previewFingerprint, expectedPolicyFingerprint: preview.result.expectedPolicyFingerprint })
    },
  }
}

test('renders the actual panel with no snapshot and maps host errors to localized messages', async () => {
  const panel = resolve(import.meta.dir, '../../apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx')
  const config = resolve(import.meta.dir, '../../apps/electron/tsconfig.json')
  const english = resolve(import.meta.dir, '../../packages/shared/src/i18n/locales/en.json')
  const script = `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
    import i18next from 'i18next'; import { I18nextProvider, initReactI18next } from 'react-i18next';
    import { RepositorySnapshotPanel, repositoryErrorKey } from ${JSON.stringify(panel)};
    import english from ${JSON.stringify(english)};
    const i18n = i18next.createInstance(); await i18n.use(initReactI18next).init({lng:'en',resources:{en:{translation:english}},initImmediate:false});
    const render = props => renderToStaticMarkup(React.createElement(I18nextProvider,{i18n},React.createElement(RepositorySnapshotPanel,props)));
    console.log(JSON.stringify({missing:render({workspaceId:'ws',projectId:'p'}),empty:render({workspaceId:'ws',projectId:'p',workingDirectory:'/local/project'}),
      denied:repositoryErrorKey(new Error('AUTH_FAILED')),changed:repositoryErrorKey(new Error('project-directory-changed'))}));`
  const result = await exec(process.execPath, ['--tsconfig-override', config, '-e', script], { encoding: 'utf8', cwd: resolve(import.meta.dir, '../..') })
  const rendered = JSON.parse(result.stdout)
  expect(rendered.missing).toContain('repository-snapshot-panel')
  expect(rendered.missing).toContain('working directory')
  expect(rendered.empty).toContain('No snapshots yet')
  expect(rendered.empty).not.toContain('codeIntelligence.repository.')
  expect(rendered.denied).toBe('codeIntelligence.repository.accessDenied')
  expect(rendered.changed).toBe('codeIntelligence.repository.changed')
}, 30000)

describe('CI-001 native repository RPC over a real WebSocket', () => {
  test('requires the server-owned Electron binding and rejects actor, root and foreign-scope input', async () => {
    const f = await fixture()
    const untrusted = await f.connect(false)
    expect((await f.request(untrusted, C.CAPTURE, { ...scope, webContentsId: 42, actorPrincipalId: 'admin' })).error.code).toBe('CHANNEL_NOT_FOUND')
    const trusted = await f.connect()
    for (const override of [{ workingDirectory: f.root }, { allowedRoots: [f.root] }, { actorPrincipalId: 'admin' }, { webContentsId: 42 }]) {
      expect((await f.request(trusted, C.BIND, { ...scope, ...override })).error.message).toContain('invalid-input')
    }
    expect((await f.request(trusted, C.LIST, { ...scope, workspaceId: 'foreign' })).error.code).toBe('AUTH_FAILED')
    expect((await f.request(trusted, C.LIST, { ...scope, projectId: 'foreign' })).error.message).toContain('project-missing')
    f.revokeWindow()
    expect((await f.request(trusted, C.BIND, scope)).error.code).toBe('AUTH_FAILED')
  }, 60000)

  test('binds the saved project Git root, captures summaries and reads exact spans after server restart', async () => {
    const f = await fixture(), ws = await f.connect()
    const empty = await f.request(ws, C.LIST, scope)
    expect(empty.result).toEqual({ binding: null, snapshots: [], connection: null, historicalSnapshots: [] })
    expect(await readdir(f.folder)).not.toContain('code-intelligence')
    const bound = await f.approve(ws)
    expect(bound.error).toBeUndefined()
    const binding = bound.result as RepositoryBinding
    expect(binding.canonicalRoot).toBe(await realpath(f.repository))
    expect(binding.repositoryId).not.toBe(scope.projectId)
    expect(binding.policy.dataEgress).toBe('deny')
    const captured = await f.request(ws, C.CAPTURE, scope)
    expect(captured.error).toBeUndefined()
    const snapshot = captured.result
    expect(snapshot.dirty).toBe(false)
    expect(snapshot.parentCommitSha).toBe((await git(f.repository, ['rev-parse', 'HEAD'])).trim())
    expect(snapshot.treeSha).toBe((await git(f.repository, ['rev-parse', 'HEAD^{tree}'])).trim())
    expect(snapshot.files.every((file) => !('content' in file))).toBe(true)
    expect(snapshot.files.find((file) => file.path === 'src/main.ts')?.sourceVersion.kind).toBe('git-commit')
    const replay = await f.request(ws, C.CAPTURE, scope)
    expect(replay.result.id).toBe(snapshot.id)
    expect(replay.result.capturedAt).toBe(snapshot.capturedAt)
    const restarted = await f.startServer(), reconnected = await f.connect(true, restarted)
    const listed = await f.request(reconnected, C.LIST, scope)
    expect(listed.result.binding?.id).toBe(binding.id)
    expect(listed.result.snapshots).toHaveLength(1)
    expect(listed.result.snapshots[0].id).toBe(snapshot.id)
    const span = await f.request(reconnected, C.READ_SPAN, { ...scope, snapshotId: snapshot.id, path: 'src/main.ts', startLine: 1, endLine: 2 })
    expect(span.result.excerpt).toBe('export function first() {\n  return "first"')
    expect(span.result.sourceVersion).toEqual({ kind: 'git-commit', value: snapshot.parentCommitSha })
    expect((await f.request(reconnected, C.FRESHNESS, { ...scope, snapshotId: snapshot.id })).result.state).toBe('current')
    expect(JSON.parse(await readFile(join(f.store(binding), `${snapshot.id}.json`), 'utf8')).files[0].content).toBeDefined()
  }, 60000)

  test('keeps dirty bytes distinct from commit context, reports stale source and reads the immutable receipt', async () => {
    const f = await fixture(), ws = await f.connect()
    await f.approve(ws)
    const clean = (await f.request(ws, C.CAPTURE, scope)).result
    await writeFile(join(f.repository, 'src/main.ts'), 'export function dirty() { return 2 }\n')
    const dirty = (await f.request(ws, C.CAPTURE, scope)).result
    const file = dirty.files.find((item) => item.path === 'src/main.ts')
    if (!file) throw new Error('captured main source missing')
    expect(dirty.id).not.toBe(clean.id)
    expect(dirty.parentCommitSha).toBe(clean.parentCommitSha)
    expect(dirty.dirtyWorkingCopyDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(file.commitSha).toBeUndefined()
    expect(file.parentBlobSha).toBeDefined()
    expect(file.sourceVersion).toEqual({ kind: 'working-copy', value: file.contentHash })
    await writeFile(join(f.repository, 'src/main.ts'), 'export function newer() { return 3 }\n')
    const stale = await f.request(ws, C.FRESHNESS, { ...scope, snapshotId: dirty.id })
    expect(stale.result.state).toBe('stale')
    expect(stale.result.currentSnapshotId).not.toBe(dirty.id)
    const old = await f.request(ws, C.READ_SPAN, { ...scope, snapshotId: dirty.id, path: 'src/main.ts', startLine: 1, endLine: 1 })
    expect(old.result.excerpt).toContain('return 2')
    expect(old.result.sourceVersion.kind).toBe('working-copy')
    expect((await f.request(ws, C.LIST, scope)).result.snapshots).toHaveLength(2)
  }, 60000)

  test('applies source exclusions, byte bounds and symlink protections and validates span paths/ranges', async () => {
    const f = await fixture(), ws = await f.connect()
    await writeFile(join(f.root, 'outside.ts'), 'OUTSIDE_BYTES_MUST_NEVER_BE_INGESTED\n')
    await symlink(join(f.root, 'outside.ts'), join(f.repository, 'outside-link.ts'))
    await mkdir(join(f.repository, 'private'))
    await writeFile(join(f.repository, '.env'), 'PRIVATE_ENV_BYTES\n')
    await writeFile(join(f.repository, 'private/.env.local'), 'NESTED_ENV_BYTES\n')
    await writeFile(join(f.repository, 'private/key.pem'), 'CERTIFICATE_BYTES\n')
    await writeFile(join(f.repository, 'secret.ts'), 'const secret = "sk-abcdefghijkl"\n')
    await writeFile(join(f.repository, 'large.ts'), 'я'.repeat(140000))
    await writeFile(join(f.repository, 'binary.bin'), Buffer.from([0, 1, 255]))
    await writeFile(join(f.repository, 'ignored.txt'), 'GIT_IGNORED_BYTES\n')
    await rm(join(f.repository, 'README.md'))
    await f.approve(ws)
    const snapshot = (await f.request(ws, C.CAPTURE, scope)).result
    for (const [path, reason] of [['.env', 'excluded'], ['private/.env.local', 'excluded'], ['private/key.pem', 'excluded'],
      ['outside-link.ts', 'symlink'], ['secret.ts', 'secret'], ['large.ts', 'file-byte-limit'], ['binary.bin', 'binary'], ['README.md', 'missing']]) {
      expect(snapshot.skipped).toContainEqual({ path, reason })
    }
    expect(snapshot.coverage.truncated).toBe(true)
    expect([...snapshot.files, ...snapshot.skipped].some((file) => file.path === 'ignored.txt')).toBe(false)
    const binding = (await f.request(ws, C.LIST, scope)).result.binding
    const bytes = await readFile(join(f.store(binding), `${snapshot.id}.json`), 'utf8')
    expect(bytes).not.toContain('OUTSIDE_BYTES_MUST_NEVER_BE_INGESTED')
    expect(bytes).not.toContain('PRIVATE_ENV_BYTES')
    expect(bytes).not.toContain('NESTED_ENV_BYTES')
    expect(bytes).not.toContain('GIT_IGNORED_BYTES')
    const base = { ...scope, snapshotId: snapshot.id, startLine: 1, endLine: 1 }
    expect((await f.request(ws, C.READ_SPAN, { ...base, path: '.env' })).error.message).toContain('path-excluded')
    expect((await f.request(ws, C.READ_SPAN, { ...base, path: '../outside.ts' })).error.message).toContain('invalid-path')
    expect((await f.request(ws, C.READ_SPAN, { ...base, path: '/etc/passwd' })).error.message).toContain('invalid-path')
    expect((await f.request(ws, C.READ_SPAN, { ...base, path: 'outside-link.ts' })).error.message).toContain('snapshot-file-missing')
    expect((await f.request(ws, C.READ_SPAN, { ...base, path: 'src/main.ts', endLine: 501 })).error.message).toContain('invalid-limit')
    expect((await f.request(ws, C.READ_SPAN, { ...base, path: 'src/main.ts', endLine: 4 })).error.message).toContain('line-range-missing')
  }, 60000)

  test('isolates history when the saved project root changes and rejects symlinked metadata storage', async () => {
    const f = await fixture(), ws = await f.connect()
    await f.approve(ws)
    const first = (await f.request(ws, C.CAPTURE, scope)).result
    const other = join(f.root, 'other-repository')
    await makeRepository(other, 'second')
    f.setDirectory(other)
    expect((await f.request(ws, C.LIST, scope)).result.binding).toBeNull()
    expect((await f.request(ws, C.LIST, scope)).result.snapshots).toEqual([])
    await f.approve(ws)
    const second = (await f.request(ws, C.CAPTURE, scope)).result
    expect(second.repositoryId).not.toBe(first.repositoryId)
    const history = (await f.request(ws, C.LIST, scope)).result
    expect(history.snapshots.map((item) => item.id)).toEqual([second.id])
    expect((await f.request(ws, C.READ_SPAN, { ...scope, snapshotId: first.id, path: 'src/main.ts', startLine: 1, endLine: 1 })).error).toBeDefined()
    f.setDirectory(f.repository)
    await f.approve(ws)
    expect((await f.request(ws, C.LIST, scope)).result.snapshots[0].id).toBe(first.id)
    await rm(join(f.folder, 'code-intelligence'), { recursive: true })
    const outside = join(f.root, 'metadata-outside'); await mkdir(outside)
    await symlink(outside, join(f.folder, 'code-intelligence'))
    expect((await f.request(ws, C.CAPTURE, scope)).error.message).toContain('metadata-path-denied')
    expect(await readdir(outside)).toEqual([])
  }, 60000)

  test('cancels an in-flight native request idempotently and refuses cancellation from another client', async () => {
    const f = await fixture(), ws = await f.connect(), other = await f.connect()
    await f.approve(ws)
    const requestId = 'cancel-owned-request'
    const started = new Promise<void>(resolve => f.onNextProjectRead(resolve))
    const capture = f.request(ws, C.CAPTURE, { ...scope, requestId })
    await started
    const foreignCancel = await f.request(other, C.CANCEL, { ...scope, requestId })
    expect(foreignCancel.result).toBe(false)
    const cancelled = await f.request(ws, C.CANCEL, { ...scope, requestId })
    expect(cancelled.result).toBe(true)
    const outcome = await capture
    expect(outcome.error.message).toContain('request-cancelled')
    expect((await f.request(ws, C.CANCEL, { ...scope, requestId })).result).toBe(false)
    expect((await f.request(ws, C.LIST, scope)).result.snapshots).toEqual([])
    expect((await f.request(ws, C.CAPTURE, { ...scope, requestId: 'retry-new-request' })).result.id).toMatch(/^snapshot_/)
  }, 60000)

  test('rechecks managed window workspace and saved directory after async work before persisting', async () => {
    const f = await fixture(), ws = await f.connect()
    await f.approve(ws)
    f.onNextProjectRead(() => f.switchWindow('foreign'))
    const switched = await f.request(ws, C.CAPTURE, scope)
    expect(switched.error.code).toBe('AUTH_FAILED')
    f.switchWindow(scope.workspaceId)
    expect((await f.request(ws, C.LIST, scope)).result.snapshots).toEqual([])
    f.onNextProjectRead(() => f.setDirectory(f.root))
    const moved = await f.request(ws, C.CAPTURE, scope)
    expect(moved.error.message).toContain('project-directory-changed')
    f.setDirectory(join(f.repository, 'src'))
    expect((await f.request(ws, C.LIST, scope)).result.snapshots).toEqual([])
  }, 60000)
})

describe('CI-001 reviewed durable connection policy', () => {
  test('requires a fresh inventory approval, rejects unsupported connections and never accepts a payload root', async () => {
    const f = await fixture(), ws = await f.connect()
    expect((await f.request(ws, C.CAPTURE, scope)).error.message).toContain('repository-not-bound')
    expect((await f.request(ws, C.BIND, scope)).error.message).toContain('preview-required')
    const preview = (await f.request(ws, C.PREVIEW, scope)).result
    expect(preview.configuration.approvedBranch).toBe('main')
    expect(preview.sourceProvenance).toEqual({ kind: 'local-owned', readOnly: true, connectionRef: null })
    expect(preview.inventory.coverage).toEqual({ includedCount: 3, skippedCount: 0, totalPaths: 3, truncated: false })
    expect(preview.binding.canonicalRoot).toBe(await realpath(f.repository))
    expect(preview.previewFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(await readdir(f.folder)).not.toContain('code-intelligence')
    for (const configuration of [{ ...preview.configuration, approvedRoot: f.root }, { ...preview.configuration, readOnly: false },
      { ...preview.configuration, connectionRef: { id: 'remote-credential' } }, { ...preview.configuration, includes: ['../outside'] }]) {
      expect((await f.request(ws, C.PREVIEW, { ...scope, configuration })).error.message).toContain('invalid-connection-configuration')
    }
    await writeFile(join(f.repository, 'src/main.ts'), 'export const changedAfterReview = 42\n')
    const stale = await f.request(ws, C.BIND, { ...scope, configuration: preview.configuration, previewFingerprint: preview.previewFingerprint, expectedPolicyFingerprint: null })
    expect(stale.error.message).toContain('repository-preview-stale')
    expect(await readdir(f.folder)).not.toContain('code-intelligence')
    expect(JSON.parse(await readFile(join(f.folder, 'config.json'), 'utf8')).repositoryConnection).toBeUndefined()
    expect((await f.approve(ws)).error).toBeUndefined()
  }, 60000)

  test('persists configured branch, include/exclude and bounds with immutable policy history across restart', async () => {
    const f = await fixture(), ws = await f.connect()
    await f.approve(ws)
    const original = (await f.request(ws, C.CAPTURE, scope)).result
    const originalBytes = await readFile(join(f.store((await f.request(ws, C.LIST, scope)).result.binding), `${original.id}.json`), 'utf8')
    const preview = (await f.request(ws, C.PREVIEW, scope)).result
    const configuration = { ...preview.configuration, includes: ['src/**'], excludes: ['src/private/**'], maxFileBytes: 128, maxBytes: 256, maxFiles: 10 }
    expect((await f.approve(ws, configuration)).error).toBeUndefined()
    const persisted = JSON.parse(await readFile(join(f.folder, 'config.json'), 'utf8'))
    expect(persisted.repositoryConnection.includes).toEqual(['src/**'])
    expect(persisted.repositoryConnection.approvedRoot).toBe(await realpath(f.repository))
    expect(persisted.repositoryConnection.readOnly).toBe(true)
    expect(persisted.repositoryBindings).toHaveLength(1)
    await writeFile(join(f.repository, 'src/too-large.ts'), 'я'.repeat(100))
    await writeFile(join(f.repository, 'src/key.pem'), 'PRIVATE_KEY_BYTES\n')
    await mkdir(join(f.repository, 'src/private'))
    await writeFile(join(f.repository, 'src/private/no.ts'), 'PRIVATE_PATH_BYTES\n')
    const captured = (await f.request(ws, C.CAPTURE, scope)).result
    expect(captured.files.map(file => file.path)).toEqual(['src/main.ts'])
    expect(captured.skipped).toContainEqual({ path: 'src/too-large.ts', reason: 'file-byte-limit' })
    expect(captured.skipped).toContainEqual({ path: 'src/key.pem', reason: 'excluded' })
    expect(captured.skipped).toContainEqual({ path: 'src/private/no.ts', reason: 'excluded' })
    expect(captured.skipped).toContainEqual({ path: 'README.md', reason: 'excluded' })
    expect(captured.policyHash).not.toBe(original.policyHash)
    const restarted = await f.startServer(), reconnected = await f.connect(true, restarted)
    const listed = (await f.request(reconnected, C.LIST, scope)).result
    expect(listed.connection?.maxFileBytes).toBe(128)
    expect(listed.snapshots.map(snapshot => snapshot.id)).toEqual([captured.id])
    expect(listed.historicalSnapshots.map(snapshot => snapshot.id)).toEqual([original.id])
    expect(listed.snapshots[0].coverage).toEqual(captured.coverage)
    expect(listed.historicalSnapshots[0].coverage).toEqual(original.coverage)
    if (!listed.binding) throw new Error('restarted repository binding missing')
    expect(await readFile(join(f.folder, 'code-intelligence', listed.binding.id, original.policyHash, `${original.id}.json`), 'utf8')).toBe(originalBytes)
    const historical = await f.request(reconnected, C.READ_SPAN, { ...scope, snapshotId: original.id, policyHash: original.policyHash, path: 'src/main.ts', startLine: 1, endLine: 1 })
    expect(historical.result.excerpt).toContain('export function first')
    expect((await f.request(reconnected, C.READ_SPAN, { ...scope, snapshotId: original.id, policyHash: original.policyHash, path: 'README.md', startLine: 1, endLine: 1 })).error.message).toContain('path-excluded')
    expect((await f.request(reconnected, C.READ_SPAN, { ...scope, snapshotId: original.id, policyHash: '../outside', path: 'src/main.ts', startLine: 1, endLine: 1 })).error.message).toContain('invalid-policy-fingerprint')
  }, 60000)

  test('rejects policy CAS races, branch changes and directory changes without retargeting approval', async () => {
    const f = await fixture(), ws = await f.connect()
    const firstPreview = (await f.request(ws, C.PREVIEW, scope)).result
    const otherPreview = (await f.request(ws, C.PREVIEW, { ...scope, configuration: { ...firstPreview.configuration, includes: ['src/**'] } })).result
    expect((await f.request(ws, C.BIND, { ...scope, configuration: otherPreview.configuration, previewFingerprint: otherPreview.previewFingerprint, expectedPolicyFingerprint: otherPreview.expectedPolicyFingerprint })).error).toBeUndefined()
    const raced = await f.request(ws, C.BIND, { ...scope, configuration: firstPreview.configuration, previewFingerprint: firstPreview.previewFingerprint, expectedPolicyFingerprint: firstPreview.expectedPolicyFingerprint })
    expect(raced.error.message).toContain('repository-policy-changed')
    expect((await f.request(ws, C.LIST, scope)).result.connection?.includes).toEqual(['src/**'])
    await git(f.repository, ['checkout', '-b', 'other-branch'])
    expect((await f.request(ws, C.CAPTURE, scope)).error.message).toContain('repository-branch-changed')
    const branchPreview = (await f.request(ws, C.PREVIEW, { ...scope, configuration: { ...otherPreview.configuration, approvedBranch: 'other-branch' } })).result
    await git(f.repository, ['checkout', 'main'])
    expect((await f.request(ws, C.BIND, { ...scope, configuration: branchPreview.configuration, previewFingerprint: branchPreview.previewFingerprint, expectedPolicyFingerprint: branchPreview.expectedPolicyFingerprint })).error.message).toContain('repository-branch-changed')
    const rootPreview = (await f.request(ws, C.PREVIEW, scope)).result
    const other = join(f.root, 'other-reviewed-repository'); await makeRepository(other, 'other')
    f.setDirectory(other)
    expect((await f.request(ws, C.CAPTURE, scope)).error.message).toContain('repository-not-bound')
    expect((await f.request(ws, C.BIND, { ...scope, configuration: rootPreview.configuration, previewFingerprint: rootPreview.previewFingerprint, expectedPolicyFingerprint: rootPreview.expectedPolicyFingerprint })).error.message).toContain('repository-preview-stale')
    expect((await f.request(ws, C.LIST, scope)).result.snapshots).toEqual([])
  }, 60000)

  test('enforces actual inventory count, total bytes and tightened current read limits', async () => {
    const f = await fixture(), ws = await f.connect()
    await f.approve(ws)
    const original = (await f.request(ws, C.CAPTURE, scope)).result
    const preview = (await f.request(ws, C.PREVIEW, scope)).result
    expect((await f.request(ws, C.PREVIEW, { ...scope, configuration: { ...preview.configuration, maxFiles: 2 } })).error.message).toContain('file-count-limit')
    expect((await f.request(ws, C.PREVIEW, { ...scope, configuration: { ...preview.configuration, maxFileBytes: 262145 } })).error.message).toContain('invalid-connection-configuration')
    expect((await f.approve(ws, { ...preview.configuration, includes: ['src/**'], maxBytes: 5 })).error).toBeUndefined()
    const bounded = (await f.request(ws, C.CAPTURE, scope)).result
    expect(bounded.files).toEqual([])
    expect(bounded.skipped).toContainEqual({ path: 'src/main.ts', reason: 'snapshot-byte-limit' })
    expect(bounded.coverage.truncated).toBe(true)
    expect((await f.request(ws, C.READ_SPAN, { ...scope, snapshotId: original.id, policyHash: original.policyHash, path: 'src/main.ts', startLine: 1, endLine: 1 })).error.message).toContain('current-policy-byte-limit')
    const history = (await f.request(ws, C.LIST, scope)).result
    expect(history.historicalSnapshots[0].id).toBe(original.id)
    expect(history.snapshots[0].id).toBe(bounded.id)
  }, 60000)
})
