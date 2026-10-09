/**
 * Dev Space repository ingest RPC: workspace catalog, git clone and freshness.
 *
 * Long operations (clone/pull) run the git binary directly with progress and
 * cancellation — never through `shell:exec` (spec §6.3). The catalog is a
 * server-owned `dev-space-repositories.json` under the workspace root; the
 * renderer only ever sees the secret-free projection. Private-repository tokens
 * are resolved server-side and handed to git through a temporary `GIT_ASKPASS`
 * helper (see `devspace/clone.ts`), never through argv, logs or pushed events.
 */
import { execFile } from 'node:child_process'
import { appendFile, lstat, mkdir, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { loadProjectById, loadProjectConfig, saveProjectConfig } from '@rox/shared/projects'
import type { ProjectConfig } from '@rox/shared/projects'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type { ErrorCode } from '@rox/shared/protocol'
import {
  bindRepository, captureRepositorySnapshot, defaultRepositoryConfiguration,
  repositoryCurrentBranch, repositoryPolicyFingerprint, saveRepositoryBinding, saveRepositorySnapshot,
} from '@rox/shared/code-intelligence'
import type { RepositoryBinding, RepositoryScope } from '@rox/shared/code-intelligence'
import { devSpaceRepositoryId } from '@rox/shared/dev-space'
import type {
  DevSpaceRepositoryCatalog, DevSpaceRepositoryRecord, DevSpaceRepositoryStatus,
} from '@rox/shared/dev-space'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import { pushTyped } from '@rox/server-core/transport'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { RequestContext } from '../../transport/types'
import { CloneError, runGitClone, runGitPull, type CloneErrorCode } from '../../devspace/clone.ts'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.devSpace.LIST_REPOSITORIES, RPC_CHANNELS.devSpace.ADD_REPOSITORY, RPC_CHANNELS.devSpace.START_CLONE,
  RPC_CHANNELS.devSpace.REMOVE_REPOSITORY, RPC_CHANNELS.devSpace.REFRESH_REPOSITORY, RPC_CHANNELS.devSpace.CANCEL,
  RPC_CHANNELS.devSpace.CAPABILITIES, RPC_CHANNELS.devSpace.LIST_RUNS,
] as const

export interface HandlerEnvironment {
  getWorkspace(id: string): { id: string; rootPath: string } | null
  loadProject(root: string, id: string): { config: ProjectConfig } | null
  saveProject(root: string, config: ProjectConfig): void
  loadProjectConfig(root: string, slug: string): ProjectConfig | null
  /** Server-only GitHub credential delivery; absent means a public-only host. */
  resolveGithubToken?(workspaceId: string, repositoryId: string): Promise<string | null>
}
export const DEFAULT_ENVIRONMENT: HandlerEnvironment = {
  getWorkspace: getWorkspaceByNameOrId,
  loadProject: loadProjectById,
  saveProject: saveProjectConfig,
  loadProjectConfig,
}

interface DevSpaceCatalogFile { schemaVersion: 1; repositories: DevSpaceRepositoryRecord[] }

const MAX_REQUESTS_PER_CLIENT = 8
const MAX_RECORDS = 64
const CATALOG_FILENAME = 'dev-space-repositories.json'
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DEV_REPO_ID = /^devrepo_[a-f0-9]{64}$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const PROVIDER = 'github' as const

function invalid(reason: string): never { throw new CodedError('INVALID_PAYLOAD', `devSpace.${reason}`) }
function missing(reason: string): never { throw new CodedError('NOT_FOUND', `devSpace.${reason}`) }
function unavailable(reason: string): never { throw new CodedError('PROVIDER_UNAVAILABLE', `devSpace.${reason}`) }
function denied(reason: string): never { throw new CodedError('AUTH_FAILED', `devSpace.${reason}`) }
function cancelled(): never { throw new CodedError('CLIENT_DISCONNECTED', 'devSpace.request-cancelled') }

const CLONE_ERROR_CODE: Readonly<Record<CloneErrorCode, ErrorCode>> = {
  'request-cancelled': 'CLIENT_DISCONNECTED',
  'git-unavailable': 'UNSUPPORTED_OPERATION',
  'authentication-required': 'AUTH_FAILED',
  'network-unavailable': 'PROVIDER_UNAVAILABLE',
  'repository-not-found': 'NOT_FOUND',
  'clone-failed': 'PROVIDER_UNAVAILABLE',
}
function asCoded(error: unknown): never {
  if (error instanceof CloneError) throw new CodedError(CLONE_ERROR_CODE[error.code], `devSpace.clone-${error.code}`)
  throw error
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
async function noSymlinks(root: string, target: string): Promise<void> {
  if (!inside(root, target)) invalid('path-denied')
  const parts = relative(root, target).split(sep).filter(Boolean)
  let path = root
  for (const part of parts) {
    path = join(path, part)
    try { if ((await lstat(path)).isSymbolicLink()) invalid('path-denied') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}
function checkCancellation(signal: AbortSignal): void { if (signal.aborted) cancelled() }

function envelope(raw: unknown, extra: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('invalid-input')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['workspaceId', 'requestId', ...extra].includes(key))
    || typeof value.workspaceId !== 'string' || !ID.test(value.workspaceId)
    || (value.requestId !== undefined && (typeof value.requestId !== 'string' || !ID.test(value.requestId)))) invalid('invalid-input')
  return value
}

/** Code-intelligence repository id for a canonical root (mirrors `refs.ts` digest). */
function canonicalRepositoryId(path: string): string {
  return `repo_${createHash('sha256').update(JSON.stringify(path)).digest('hex')}`
}
function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'repo'
}
function derivedSlug(seed: string, name: string): string {
  return `${sanitizeName(name)}-${createHash('sha256').update(seed).digest('hex').slice(0, 8)}`
}
function repositoryDirectoryName(url: string): string {
  const name = url.replace(/\.git$/i, '').split('/').filter(Boolean).pop() ?? 'repository'
  return sanitizeName(name)
}
function projectFolderPath(root: string, slug: string): string { return join(root, 'projects', slug) }
function gitUrlDestination(root: string, slug: string, url: string): string {
  return join(projectFolderPath(root, slug), repositoryDirectoryName(url))
}

function githubUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) invalid('invalid-git-url')
  let parsed: URL
  try { parsed = new URL(raw) } catch { return invalid('invalid-git-url') }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password
    || parsed.search || parsed.hash || segments.length !== 2
    || !/^[A-Za-z0-9_.-]+$/.test(segments[0]!) || !/^[A-Za-z0-9_.-]+$/.test(segments[1]!)) invalid('invalid-git-url')
  const repo = segments[1]!.replace(/\.git$/i, '')
  if (!repo || repo === '.' || repo === '..') invalid('invalid-git-url')
  return `https://github.com/${segments[0]}/${repo}.git`
}
function localFolderPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096 || /[\x00-\x1f]/.test(raw) || !isAbsolute(raw)) invalid('invalid-local-path')
  return resolve(raw)
}
function parseSource(raw: unknown): { kind: 'git-url'; url: string } | { kind: 'local-folder'; path: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('invalid-source')
  const value = raw as Record<string, unknown>
  if (value.kind === 'git-url') return { kind: 'git-url', url: githubUrl(value.url) }
  if (value.kind === 'local-folder') return { kind: 'local-folder', path: localFolderPath(value.path) }
  return invalid('invalid-source')
}

function findRecord(catalog: DevSpaceCatalogFile, id: unknown): DevSpaceRepositoryRecord {
  if (typeof id !== 'string' || !DEV_REPO_ID.test(id)) invalid('invalid-repository-id')
  const record = catalog.repositories.find(entry => entry.id === id)
  if (!record) missing('repository-not-found')
  return record
}

async function readCatalog(root: string): Promise<DevSpaceCatalogFile> {
  const path = join(root, CATALOG_FILENAME)
  await noSymlinks(root, path)
  let raw: string
  try { raw = await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, repositories: [] }
    throw error
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return unavailable('catalog-corrupt') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || (parsed as DevSpaceCatalogFile).schemaVersion !== 1 || !Array.isArray((parsed as DevSpaceCatalogFile).repositories)) return unavailable('catalog-corrupt')
  const repositories = (parsed as DevSpaceCatalogFile).repositories
  if (repositories.length > MAX_RECORDS) return unavailable('catalog-limit')
  return { schemaVersion: 1, repositories }
}
async function writeCatalog(root: string, catalog: DevSpaceCatalogFile): Promise<void> {
  await mkdir(root, { recursive: true })
  atomicWriteFileSync(join(root, CATALOG_FILENAME), JSON.stringify(catalog, null, 2))
}

async function appendAudit(root: string, slug: string, event: Record<string, unknown>): Promise<void> {
  if (!SLUG.test(slug)) return
  const directory = join(projectFolderPath(root, slug), 'dev-space')
  if (!inside(root, directory)) return
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await appendFile(join(directory, 'audit.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, 'utf8')
  } catch { /* audit is best-effort and must never fail an operation */ }
}

function createRecord(input: {
  readonly workspaceId: string; readonly projectId: string; readonly projectSlug: string; readonly repositoryId: string
  readonly origin: DevSpaceRepositoryRecord['origin']; readonly displayName: string
  readonly status: DevSpaceRepositoryStatus; readonly bindingId?: string
}): DevSpaceRepositoryRecord {
  const now = Date.now()
  return {
    schemaVersion: 1,
    id: devSpaceRepositoryId(input.workspaceId, input.projectId, input.repositoryId),
    repositoryId: input.repositoryId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    projectSlug: input.projectSlug,
    ...(input.bindingId ? { bindingId: input.bindingId } : {}),
    origin: input.origin,
    displayName: input.displayName,
    status: input.status,
    createdAt: now,
    updatedAt: now,
  }
}

/** Catalog records are frozen contracts; updates always produce a new record. */
function withoutError(record: DevSpaceRepositoryRecord): DevSpaceRepositoryRecord {
  const { lastError: _lastError, ...rest } = record
  return rest
}
function replaceRecord(catalog: DevSpaceCatalogFile, record: DevSpaceRepositoryRecord): void {
  catalog.repositories = catalog.repositories.map(entry => (entry.id === record.id ? record : entry))
}

export function registerDevSpaceHandlers(server: RpcServer, deps: HandlerDeps,
  environment: HandlerEnvironment = DEFAULT_ENVIRONMENT): void {
  // Cancellation belongs to this client and workspace; supplied actor fields never establish authority.
  const requests = new Map<string, { clientId: string; workspaceId: string; controller: AbortController }>()
  function assertWindow(context: RequestContext, workspaceId?: string): void {
    if (!Number.isSafeInteger(context.webContentsId) || context.webContentsId === null || context.webContentsId <= 0
      || !deps.windowManager || !deps.windowManager.getWindowByWebContentsId(context.webContentsId)
      || (workspaceId !== undefined && (context.workspaceId !== workspaceId
        || deps.windowManager.getWorkspaceForWindow(context.webContentsId) !== workspaceId))) {
      denied('repository-accessDenied')
    }
  }
  async function workspaceRoot(context: RequestContext, workspaceId: string, signal: AbortSignal): Promise<string> {
    checkCancellation(signal)
    assertWindow(context, workspaceId)
    const workspace = environment.getWorkspace(workspaceId)
    if (!workspace || workspace.id !== workspaceId) missing('workspace-missing')
    return realpath(workspace.rootPath)
  }
  async function loadProjectConfigFor(root: string, record: DevSpaceRepositoryRecord): Promise<ProjectConfig> {
    const loaded = environment.loadProject(root, record.projectId)
    if (loaded && loaded.config.id === record.projectId) return loaded.config
    const config = environment.loadProjectConfig(root, record.projectSlug)
    if (!config) missing('project-missing')
    return config
  }
  async function ensureContainerProject(root: string, slug: string, name: string, workingDirectory?: string): Promise<ProjectConfig> {
    const existing = environment.loadProjectConfig(root, slug)
    if (existing) {
      if (workingDirectory && existing.workingDirectory !== workingDirectory) {
        const updated: ProjectConfig = { ...existing, workingDirectory }
        environment.saveProject(root, updated)
        return updated
      }
      return existing
    }
    await mkdir(projectFolderPath(root, slug), { recursive: true, mode: 0o700 })
    const now = Date.now()
    const config: ProjectConfig = {
      id: `proj_${randomUUID().slice(0, 8)}`, slug, name,
      ...(workingDirectory ? { workingDirectory } : {}), createdAt: now, updatedAt: now,
    }
    environment.saveProject(root, config)
    return config
  }
  async function bindWorkingCopy(scope: RepositoryScope, workingDirectory: string, signal: AbortSignal): Promise<RepositoryBinding> {
    const branch = await repositoryCurrentBranch(workingDirectory, signal).catch(() => invalid('repository-branch-unavailable'))
    const configuration = defaultRepositoryConfiguration(branch)
    return bindRepository({ ...scope, workingDirectory, signal,
      policy: { ...configuration, workspaceId: scope.workspaceId, allowedRoots: [workingDirectory], excludes: [...configuration.excludes], dataEgress: 'deny' } })
  }
  async function persistBinding(root: string, project: ProjectConfig, workingDirectory: string, binding: RepositoryBinding): Promise<void> {
    const config: ProjectConfig = { ...project, workingDirectory,
      repositoryBindings: [...(project.repositoryBindings ?? []).filter(entry => entry.id !== binding.id), binding] }
    environment.saveProject(root, config)
  }
  function operation(channel: string, extra: readonly string[], run: (context: RequestContext,
    input: Record<string, unknown>, signal: AbortSignal, root: string) => Promise<unknown>): void {
    server.handle(channel, async (context, raw: unknown) => {
      const input = envelope(raw, extra)
      assertWindow(context, input.workspaceId as string)
      const key = JSON.stringify([context.clientId, input.requestId ?? randomUUID()])
      if (requests.has(key)) invalid('duplicate-request-id')
      if ([...requests.values()].filter(request => request.clientId === context.clientId).length >= MAX_REQUESTS_PER_CLIENT) invalid('request-limit')
      const controller = new AbortController()
      requests.set(key, { clientId: context.clientId, workspaceId: input.workspaceId as string, controller })
      try {
        const root = await workspaceRoot(context, input.workspaceId as string, controller.signal)
        return await run(context, input, controller.signal, root)
      } finally { requests.delete(key) }
    }, { access: 'localElectron' })
  }
  function pushChanged(clientId: string, repositoryId: string, status: DevSpaceRepositoryStatus): void {
    pushTyped(server, RPC_CHANNELS.devSpace.CHANGED, { to: 'client', clientId }, { repositoryId, status })
  }

  operation(RPC_CHANNELS.devSpace.LIST_REPOSITORIES, [], async (_context, _input, _signal, root): Promise<DevSpaceRepositoryCatalog> => {
    const catalog = await readCatalog(root)
    return { schemaVersion: 1, repositories: catalog.repositories }
  })

  operation(RPC_CHANNELS.devSpace.ADD_REPOSITORY, ['source', 'projectSlug'], async (context, input, signal, root) => {
    checkCancellation(signal)
    const source = parseSource(input.source)
    const requestedSlug = input.projectSlug
    if (requestedSlug !== undefined && (typeof requestedSlug !== 'string' || !SLUG.test(requestedSlug))) invalid('invalid-project-slug')
    const workspaceId = input.workspaceId as string
    const catalog = await readCatalog(root)
    const slug = typeof requestedSlug === 'string' ? requestedSlug : (source.kind === 'git-url'
      ? derivedSlug(source.url, repositoryDirectoryName(source.url))
      : derivedSlug(source.path, basename(source.path)))

    if (source.kind === 'git-url') {
      const destination = gitUrlDestination(root, slug, source.url)
      if (!inside(join(root, 'projects'), destination)) invalid('path-denied')
      const repositoryId = canonicalRepositoryId(destination)
      const existing = catalog.repositories.find(entry => entry.repositoryId === repositoryId)
      if (existing) return existing
      if (catalog.repositories.length >= MAX_RECORDS) invalid('catalog-limit')
      const project = await ensureContainerProject(root, slug, repositoryDirectoryName(source.url))
      const record = createRecord({ workspaceId, projectId: project.id, projectSlug: project.slug, repositoryId,
        origin: { kind: 'git-url', url: source.url, provider: PROVIDER },
        displayName: source.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, ''), status: 'unbound' })
      catalog.repositories.push(record)
      await writeCatalog(root, catalog)
      await appendAudit(root, slug, { event: 'repository-added', sourceKind: 'git-url', repositoryId })
      return record
    }

    const workingDirectory = await realpath(source.path).catch(() => invalid('local-path-missing'))
    const project = await ensureContainerProject(root, slug, basename(workingDirectory), workingDirectory)
    const scope: RepositoryScope = { workspaceId, projectId: project.id }
    const binding = await bindWorkingCopy(scope, workingDirectory, signal)
    const existing = catalog.repositories.find(entry => entry.repositoryId === binding.repositoryId)
    if (existing) return existing
    if (catalog.repositories.length >= MAX_RECORDS) invalid('catalog-limit')
    checkCancellation(signal)
    await persistBinding(root, project, workingDirectory, binding)
    const record = createRecord({ workspaceId, projectId: project.id, projectSlug: project.slug, repositoryId: binding.repositoryId,
      origin: { kind: 'local-folder', path: workingDirectory }, displayName: basename(workingDirectory),
      status: 'bound', bindingId: binding.id })
    catalog.repositories.push(record)
    await writeCatalog(root, catalog)
    await appendAudit(root, slug, { event: 'repository-added', sourceKind: 'local-folder', repositoryId: binding.repositoryId })
    return record
  })

  operation(RPC_CHANNELS.devSpace.START_CLONE, ['repositoryId'], async (context, input, signal, root) => {
    const catalog = await readCatalog(root)
    const found = findRecord(catalog, input.repositoryId)
    if (found.origin.kind !== 'git-url') invalid('not-a-git-url')
    const source = found.origin
    const destination = gitUrlDestination(root, found.projectSlug, source.url)
    if (!inside(join(root, 'projects'), destination)) invalid('path-denied')
    const projectFolder = projectFolderPath(root, found.projectSlug)
    await mkdir(projectFolder, { recursive: true, mode: 0o700 })
    const workspaceId = input.workspaceId as string
    const token = environment.resolveGithubToken ? await environment.resolveGithubToken(workspaceId, found.repositoryId) : null

    let record: DevSpaceRepositoryRecord = { ...withoutError(found), status: 'cloning', updatedAt: Date.now() }
    replaceRecord(catalog, record)
    await writeCatalog(root, catalog)
    pushChanged(context.clientId, record.repositoryId, 'cloning')
    try {
      await runGitClone({ url: source.url, destination, repositoryId: record.repositoryId, token, signal,
        onProgress: progress => pushTyped(server, RPC_CHANNELS.devSpace.CLONE_PROGRESS, { to: 'client', clientId: context.clientId }, progress) })
    } catch (error) {
      record = { ...record, status: 'error', updatedAt: Date.now(),
        lastError: { code: error instanceof CloneError ? error.code : 'clone-failed', at: Date.now() } }
      replaceRecord(catalog, record)
      await writeCatalog(root, catalog)
      pushChanged(context.clientId, record.repositoryId, 'error')
      await appendAudit(root, record.projectSlug, { event: 'clone', repositoryId: record.repositoryId, ok: false })
      asCoded(error)
    }
    checkCancellation(signal)
    const project = await loadProjectConfigFor(root, record)
    const binding = await bindWorkingCopy({ workspaceId, projectId: project.id }, destination, signal)
    if (binding.repositoryId !== record.repositoryId) unavailable('repository-identity-changed')
    await persistBinding(root, project, destination, binding)
    record = { ...record, status: 'cloned', bindingId: binding.id, updatedAt: Date.now() }
    replaceRecord(catalog, record)
    await writeCatalog(root, catalog)
    await appendAudit(root, record.projectSlug, { event: 'clone', repositoryId: record.repositoryId, ok: true })
    pushChanged(context.clientId, record.repositoryId, 'cloned')
    return record
  })

  operation(RPC_CHANNELS.devSpace.REFRESH_REPOSITORY, ['repositoryId'], async (context, input, signal, root) => {
    const catalog = await readCatalog(root)
    const found = findRecord(catalog, input.repositoryId)
    const workspaceId = input.workspaceId as string
    const project = await loadProjectConfigFor(root, found)
    const projectFolder = projectFolderPath(root, found.projectSlug)
    await noSymlinks(root, projectFolder)
    if (found.origin.kind === 'git-url') {
      const destination = gitUrlDestination(root, found.projectSlug, found.origin.url)
      if (!inside(join(root, 'projects'), destination)) invalid('path-denied')
      const token = environment.resolveGithubToken ? await environment.resolveGithubToken(workspaceId, found.repositoryId) : null
      try {
        await runGitPull({ workingDirectory: destination, repositoryId: found.repositoryId, token, signal })
      } catch (error) { asCoded(error) }
    }
    const workingDirectory = found.origin.kind === 'git-url'
      ? gitUrlDestination(root, found.projectSlug, found.origin.url) : found.origin.path
    const scope: RepositoryScope = { workspaceId, projectId: project.id }
    const binding = await bindWorkingCopy(scope, workingDirectory, signal)
    const store = join(projectFolder, 'code-intelligence', binding.id, repositoryPolicyFingerprint(binding.policy))
    await noSymlinks(root, store)
    const snapshot = await captureRepositorySnapshot(binding, { scope, signal })
    await saveRepositoryBinding(binding, store, scope)
    await saveRepositorySnapshot(snapshot, binding, store, scope)
    await persistBinding(root, project, workingDirectory, binding)
    // The freshly captured snapshot id is the freshness identity assessSnapshotFreshness compares against;
    // comparing it to the last analyzed id avoids a redundant second full capture.
    const stale = found.lastAnalyzedSnapshotId !== undefined && found.lastAnalyzedSnapshotId !== snapshot.id
    const record: DevSpaceRepositoryRecord = {
      ...withoutError(found),
      lastSnapshotId: snapshot.id,
      bindingId: binding.id,
      status: stale ? 'stale' : found.lastAnalyzedSnapshotId === undefined ? 'bound' : 'ready',
      updatedAt: Date.now(),
    }
    replaceRecord(catalog, record)
    await writeCatalog(root, catalog)
    await appendAudit(root, record.projectSlug, { event: 'refresh', repositoryId: record.repositoryId, stale })
    pushChanged(context.clientId, record.repositoryId, record.status)
    return record
  })

  operation(RPC_CHANNELS.devSpace.REMOVE_REPOSITORY, ['repositoryId', 'confirm'], async (context, input, _signal, root) => {
    if (input.confirm !== true) invalid('confirmation-required')
    const catalog = await readCatalog(root)
    const record = findRecord(catalog, input.repositoryId)
    const projectFolder = projectFolderPath(root, record.projectSlug)
    await noSymlinks(root, projectFolder)
    if (record.origin.kind === 'git-url') {
      const destination = gitUrlDestination(root, record.projectSlug, record.origin.url)
      if (inside(projectFolder, destination) && destination !== projectFolder) await rm(destination, { recursive: true, force: true })
    }
    await rm(join(projectFolder, 'code-intelligence'), { recursive: true, force: true })
    catalog.repositories = catalog.repositories.filter(entry => entry.id !== record.id)
    await writeCatalog(root, catalog)
    await appendAudit(root, record.projectSlug, { event: 'repository-removed', repositoryId: record.repositoryId })
    pushChanged(context.clientId, record.repositoryId, 'unbound')
    return { removed: record.id }
  })

  operation(RPC_CHANNELS.devSpace.LIST_RUNS, ['projectSlug'], async (_context, input, _signal, root) => {
    const catalog = await readCatalog(root)
    const slugs = input.projectSlug !== undefined
      ? (typeof input.projectSlug === 'string' && SLUG.test(input.projectSlug) ? [input.projectSlug] : invalid('invalid-project-slug'))
      : [...new Set(catalog.repositories.map(record => record.projectSlug))]
    const runs: unknown[] = []
    for (const slug of slugs.slice(0, MAX_RECORDS)) {
      const directory = join(projectFolderPath(root, slug), 'dev-space', 'runs')
      let names: string[]
      try { names = await readdir(directory) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      for (const name of names.filter(entry => entry.endsWith('.json')).slice(0, MAX_RECORDS)) {
        try { runs.push(JSON.parse(await readFile(join(directory, name), 'utf8'))) } catch { /* skip corrupt run journal */ }
      }
    }
    return { runs }
  })

  operation(RPC_CHANNELS.devSpace.CAPABILITIES, [], async () => {
    const git = await new Promise<boolean>(resolve => {
      execFile('git', ['--version'], { timeout: 5000, windowsHide: true }, error => resolve(!error))
    })
    return { git, githubDeviceLogin: typeof environment.resolveGithubToken === 'function', engines: [] as string[] }
  })

  server.handle(RPC_CHANNELS.devSpace.CANCEL, (context, raw: unknown) => {
    const input = envelope(raw)
    assertWindow(context)
    if (!input.requestId) invalid('invalid-input')
    const active = requests.get(JSON.stringify([context.clientId, input.requestId]))
    if (!active || active.workspaceId !== input.workspaceId) return false
    active.controller.abort()
    return true
  }, { access: 'localElectron' })
}