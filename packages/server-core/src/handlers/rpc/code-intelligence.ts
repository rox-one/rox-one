/** Project-scoped local repository receipts. No provider or network operation is performed. */
import { lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { loadProjectById, saveProjectConfig } from '@rox/shared/projects'
import type { LoadedProject, ProjectConfig } from '@rox/shared/projects/types'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import {
  RepositoryContractError, assessSnapshotFreshness, bindRepository, captureRepositorySnapshot,
  loadRepositoryBinding, loadRepositorySnapshot, readFileSpan, repositoryPolicyFingerprint,
  resolveRepositoryGitRoot, saveRepositoryBinding, saveRepositorySnapshot, summarizeRepositorySnapshot, assertRepositoryCurrentReadPolicy,
  defaultRepositoryConfiguration, parseRepositoryConfiguration, repositoryConnectionFingerprint, repositoryCurrentBranch, repositoryPreviewFingerprint,
} from '@rox/shared/code-intelligence'
import type {
  RepositoryBinding, RepositoryConnection, RepositoryConnectionInspection, RepositoryConnectionConfiguration, RepositoryPreview, RepositoryProjectInput, RepositoryScope, RepositorySnapshotSummary,
} from '@rox/shared/code-intelligence'
import type { HandlerDeps } from '../handler-deps'
import type { RequestContext, RpcServer } from '../../transport/types'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.codeIntelligence.PREVIEW, RPC_CHANNELS.codeIntelligence.BIND, RPC_CHANNELS.codeIntelligence.CAPTURE, RPC_CHANNELS.codeIntelligence.LIST,
  RPC_CHANNELS.codeIntelligence.READ_SPAN, RPC_CHANNELS.codeIntelligence.FRESHNESS, RPC_CHANNELS.codeIntelligence.CANCEL,
] as const

interface HandlerEnvironment {
  getWorkspace(id: string): { id: string; rootPath: string } | null
  loadProject(root: string, id: string): LoadedProject | null
  saveProject?(root: string, config: ProjectConfig): void
}
interface ProjectContext { configuration: RepositoryConnectionConfiguration; connection: RepositoryConnection | null; policyState: string; project: LoadedProject; scope: RepositoryScope; store: string; binding: RepositoryBinding; workingDirectory: string; workspaceRoot: string; folder: string }
const DEFAULT_ENVIRONMENT: HandlerEnvironment = { getWorkspace: getWorkspaceByNameOrId, loadProject: loadProjectById }
const MAX_HISTORY = 100
const MAX_REQUESTS_PER_CLIENT = 8
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SNAPSHOT = /^snapshot_[a-f0-9]{64}$/

function reject(code: string): never { throw new RepositoryContractError(code) }
function inputObject(raw: unknown, extra: readonly string[] = []): Record<string, unknown> & RepositoryProjectInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject('invalid-input')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['workspaceId', 'projectId', 'requestId', ...extra].includes(key))
    || typeof value.workspaceId !== 'string' || !ID.test(value.workspaceId)
    || typeof value.projectId !== 'string' || !ID.test(value.projectId)
    || (value.requestId !== undefined && (typeof value.requestId !== 'string' || !ID.test(value.requestId)))) reject('invalid-input')
  return value as Record<string, unknown> & RepositoryProjectInput
}
function snapshotId(raw: unknown): string {
  if (typeof raw !== 'string' || !SNAPSHOT.test(raw)) reject('invalid-snapshot-id')
  return raw
}
function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
async function noSymlinks(root: string, target: string): Promise<void> {
  if (!inside(root, target)) reject('metadata-path-denied')
  const parts = relative(root, target).split(sep).filter(Boolean)
  let path = root
  for (const part of parts) {
    path = join(path, part)
    try { if ((await lstat(path)).isSymbolicLink()) reject('metadata-path-denied') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}
function checkCancellation(signal: AbortSignal): void { if (signal.aborted) reject('request-cancelled') }

export function registerCodeIntelligenceHandlers(server: RpcServer, deps: HandlerDeps,
  environment: HandlerEnvironment = DEFAULT_ENVIRONMENT): void {
  // Cancellation belongs to this client and project; supplied actor/window fields never establish authority.
  const requests = new Map<string, { clientId: string; input: RepositoryProjectInput; controller: AbortController }>()
  function assertWindow(context: RequestContext, workspaceId?: string): void {
    if (!Number.isSafeInteger(context.webContentsId) || context.webContentsId === null || context.webContentsId <= 0
      || !deps.windowManager || !deps.windowManager.getWindowByWebContentsId(context.webContentsId)
      || (workspaceId !== undefined && (context.workspaceId !== workspaceId
        || deps.windowManager.getWorkspaceForWindow(context.webContentsId) !== workspaceId))) {
      throw new CodedError('AUTH_FAILED', 'codeIntelligence.repository.accessDenied')
    }
  }
  async function projectContext(context: RequestContext, input: RepositoryProjectInput & { configuration?: unknown }, signal: AbortSignal): Promise<ProjectContext> {
    checkCancellation(signal); assertWindow(context, input.workspaceId)
    const workspace = environment.getWorkspace(input.workspaceId)
    if (!workspace || workspace.id !== input.workspaceId) reject('workspace-missing')
    const project = environment.loadProject(workspace.rootPath, input.projectId)
    if (!project || project.config.id !== input.projectId) reject('project-missing')
    const workingDirectory = project.config.workingDirectory
    if (!workingDirectory) reject('project-directory-missing')
    const workspaceRoot = await realpath(workspace.rootPath)
    const expectedFolder = resolve(workspaceRoot, 'projects', project.config.slug)
    if (!inside(resolve(workspaceRoot, 'projects'), expectedFolder)) reject('metadata-path-denied')
    await noSymlinks(workspaceRoot, expectedFolder)
    const folder = await realpath(project.folderPath)
    if (folder !== expectedFolder) reject('metadata-path-denied')
    const container = join(folder, 'code-intelligence')
    await noSymlinks(workspaceRoot, container)
    const gitRoot = await resolveRepositoryGitRoot(workingDirectory, { signal })
    const policyState = JSON.stringify(project.config.repositoryConnection ?? null)
    const connection = project.config.repositoryConnection ?? null
    const branch = await repositoryCurrentBranch(gitRoot, signal)
    const requested = input.configuration && typeof input.configuration === 'object' && !Array.isArray(input.configuration)
      ? { approvedBranch: branch, ...input.configuration } : input.configuration
    const configuration = parseRepositoryConfiguration(requested ?? (connection && { approvedBranch: connection.approvedBranch, includes: connection.includes, excludes: connection.excludes, maxFileBytes: connection.maxFileBytes, maxBytes: connection.maxBytes, maxFiles: connection.maxFiles, readOnly: connection.readOnly, connectionRef: connection.connectionRef }) ?? defaultRepositoryConfiguration(branch))
    if (configuration.approvedBranch !== branch) reject('repository-branch-changed')
    const excludes = [...configuration.excludes]
    if (inside(gitRoot, container)) excludes.push(relative(gitRoot, container).split(sep).join('/'))
    const scope = { workspaceId: input.workspaceId, projectId: project.config.id }
    const binding = await bindRepository({ ...scope, workingDirectory, signal,
      policy: { ...configuration, workspaceId: scope.workspaceId, allowedRoots: [gitRoot], excludes, dataEgress: 'deny' } })
    // A new repository or source policy gets a separate history, retaining older receipts without mixing scopes.
    const store = join(container, binding.id, repositoryPolicyFingerprint(binding.policy))
    await noSymlinks(workspaceRoot, store)
    checkCancellation(signal); assertWindow(context, input.workspaceId)
    const liveProject = environment.loadProject(workspace.rootPath, input.projectId)
    if (!liveProject || liveProject.config.id !== input.projectId || liveProject.config.workingDirectory !== workingDirectory
      || liveProject.folderPath !== project.folderPath) reject('project-directory-changed')
    if (JSON.stringify(liveProject.config.repositoryConnection ?? null) !== policyState) reject('repository-policy-changed')
    return { scope, store, binding, workingDirectory, workspaceRoot, folder, configuration, connection, policyState, project }
  }
  async function assertCurrent(context: RequestContext, input: RepositoryProjectInput, current: ProjectContext,
    signal: AbortSignal): Promise<void> {
    checkCancellation(signal); assertWindow(context, input.workspaceId)
    const workspace = environment.getWorkspace(input.workspaceId)
    const project = workspace && environment.loadProject(workspace.rootPath, input.projectId)
    if (!workspace || workspace.id !== input.workspaceId || !project || project.config.id !== input.projectId
      || project.config.workingDirectory !== current.workingDirectory || await realpath(project.folderPath) !== current.folder
      || await realpath(workspace.rootPath) !== current.workspaceRoot) reject('project-directory-changed')
    if (JSON.stringify(project.config.repositoryConnection ?? null) !== current.policyState) reject('repository-policy-changed')
    await noSymlinks(current.workspaceRoot, current.store)
    if (await resolveRepositoryGitRoot(current.workingDirectory, { signal }) !== current.binding.canonicalRoot) reject('project-directory-changed')
    if (await repositoryCurrentBranch(current.binding.canonicalRoot, signal) !== current.configuration.approvedBranch) reject('repository-branch-changed')
    checkCancellation(signal); assertWindow(context, input.workspaceId)
  }
  async function storedBinding(current: ProjectContext): Promise<RepositoryBinding | null> {
    if (!current.connection || current.connection.approvedRoot !== current.binding.canonicalRoot
      || current.connection.policyFingerprint !== repositoryPolicyFingerprint(current.binding.policy)) return null
    try {
      const stored = await loadRepositoryBinding(current.store, current.binding.id, current.scope)
      if (repositoryPolicyFingerprint(stored.policy) !== repositoryPolicyFingerprint(current.binding.policy)) reject('snapshot-policy-changed')
      return stored
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  async function snapshotNames(store: string): Promise<string[]> {
    let names: string[]
    try { names = await readdir(store) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const snapshots = names.filter(name => /^snapshot_[a-f0-9]{64}\.json$/.test(name)).sort()
    if (snapshots.length > MAX_HISTORY) reject('snapshot-history-limit')
    return snapshots
  }
  function operation(channel: string, extra: readonly string[], run: (context: RequestContext,
    input: Record<string, unknown> & RepositoryProjectInput, current: ProjectContext, signal: AbortSignal) => Promise<unknown>): void {
    server.handle(channel, async (context, raw: unknown) => {
      const input = inputObject(raw, extra)
      assertWindow(context, input.workspaceId)
      const key = JSON.stringify([context.clientId, input.requestId ?? randomUUID()])
      if (requests.has(key)) reject('duplicate-request-id')
      if ([...requests.values()].filter(request => request.clientId === context.clientId).length >= MAX_REQUESTS_PER_CLIENT) reject('request-limit')
      const controller = new AbortController()
      requests.set(key, { clientId: context.clientId, input, controller })
      try {
        const current = await projectContext(context, input, controller.signal)
        const result = await run(context, input, current, controller.signal)
        await assertCurrent(context, input, current, controller.signal)
        return result
      } finally { requests.delete(key) }
    }, { access: 'localElectron' })
  }

  async function preview(current: ProjectContext, signal: AbortSignal): Promise<RepositoryPreview> {
    const inventory = summarizeRepositorySnapshot(await captureRepositorySnapshot(current.binding, { scope: current.scope, signal }))
    const expectedPolicyFingerprint = repositoryConnectionFingerprint(current.project.config.repositoryConnection)
    return { binding: current.binding, configuration: current.configuration, inventory, expectedPolicyFingerprint,
      previewFingerprint: repositoryPreviewFingerprint(current.binding, inventory, expectedPolicyFingerprint),
      sourceProvenance: { kind: 'local-owned', readOnly: true, connectionRef: null } }
  }
  operation(RPC_CHANNELS.codeIntelligence.PREVIEW, ['configuration'], async (_context, _input, current, signal) => preview(current, signal))
  operation(RPC_CHANNELS.codeIntelligence.BIND, ['configuration', 'previewFingerprint', 'expectedPolicyFingerprint'], async (context, input, current, signal) => {
    if (!input.configuration || typeof input.previewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.previewFingerprint)
      || (input.expectedPolicyFingerprint !== null && (typeof input.expectedPolicyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedPolicyFingerprint)))) reject('preview-required')
    parseRepositoryConfiguration(input.configuration)
    const receipt = await preview(current, signal)
    if (input.expectedPolicyFingerprint !== receipt.expectedPolicyFingerprint) reject('repository-policy-changed')
    if (input.previewFingerprint !== receipt.previewFingerprint) reject('repository-preview-stale')
    await assertCurrent(context, input, current, signal)
    await mkdir(current.store, { recursive: true, mode: 0o700 })
    await assertCurrent(context, input, current, signal)
    await saveRepositoryBinding(current.binding, current.store, current.scope)
    await assertCurrent(context, input, current, signal)
    const connection: RepositoryConnection = { ...current.configuration, version: 1, approvedRoot: current.binding.canonicalRoot,
      policyFingerprint: repositoryPolicyFingerprint(current.binding.policy), sourceProvenance: { kind: 'local-owned', bindingId: current.binding.id,
        repositoryId: current.binding.repositoryId, previewFingerprint: receipt.previewFingerprint } }
    const workspace = environment.getWorkspace(input.workspaceId)
    const project = workspace && environment.loadProject(workspace.rootPath, input.projectId)
    if (!workspace || !project || JSON.stringify(project.config.repositoryConnection ?? null) !== current.policyState) reject('repository-policy-changed')
    const config: ProjectConfig = { ...project.config, repositoryConnection: connection,
      repositoryBindings: [...(project.config.repositoryBindings ?? []).filter(binding => binding.id !== current.binding.id), current.binding] }
    ;(environment.saveProject ?? saveProjectConfig)(workspace.rootPath, config)
    current.policyState = JSON.stringify(connection)
    return current.binding
  })
  operation(RPC_CHANNELS.codeIntelligence.CAPTURE, [], async (context, input, current, signal) => {
    if (!await storedBinding(current)) reject('repository-not-bound')
    const snapshot = await captureRepositorySnapshot(current.binding, { scope: current.scope, signal })
    await assertCurrent(context, input, current, signal)
    const names = await snapshotNames(current.store)
    const repositoryStore = join(current.folder, 'code-intelligence', current.binding.id)
    await noSymlinks(current.workspaceRoot, repositoryStore)
    let historyCount = names.length
    for (const policyHash of (await readdir(repositoryStore)).filter(name => /^[a-f0-9]{64}$/.test(name) && name !== repositoryPolicyFingerprint(current.binding.policy))) {
      const directory = join(repositoryStore, policyHash)
      await noSymlinks(current.workspaceRoot, directory)
      historyCount += (await snapshotNames(directory)).length
    }
    if (historyCount >= MAX_HISTORY && !names.includes(`${snapshot.id}.json`)) reject('snapshot-history-limit')
    checkCancellation(signal)
    await saveRepositoryBinding(current.binding, current.store, current.scope)
    await assertCurrent(context, input, current, signal)
    await saveRepositorySnapshot(snapshot, current.binding, current.store, current.scope)
    return summarizeRepositorySnapshot(await loadRepositorySnapshot(current.store, snapshot.id, current.binding, current.scope))
  })
  operation(RPC_CHANNELS.codeIntelligence.LIST, [], async (_context, _input, current, signal): Promise<RepositoryConnectionInspection> => {
    const binding = await storedBinding(current)
    if (!binding) return { binding: null, snapshots: [], connection: current.connection, historicalSnapshots: [] }
    const snapshots: RepositorySnapshotSummary[] = []
    for (const name of await snapshotNames(current.store)) {
      checkCancellation(signal)
      const snapshot = await loadRepositorySnapshot(current.store, name.slice(0, -5), binding, current.scope)
      snapshots.push(summarizeRepositorySnapshot(snapshot))
    }
    snapshots.sort((a, b) => b.capturedAt - a.capturedAt || a.id.localeCompare(b.id))
    const historicalSnapshots: RepositorySnapshotSummary[] = []
    const repositoryStore = join(current.folder, 'code-intelligence', binding.id)
    await noSymlinks(current.workspaceRoot, repositoryStore)
    const policies = (await readdir(repositoryStore)).filter(name => /^[a-f0-9]{64}$/.test(name) && name !== repositoryPolicyFingerprint(binding.policy))
    if (policies.length > MAX_HISTORY) reject('snapshot-history-limit')
    for (const policyHash of policies) {
      checkCancellation(signal)
      const directory = join(repositoryStore, policyHash)
      await noSymlinks(current.workspaceRoot, directory)
      const historical = await loadRepositoryBinding(directory, binding.id, current.scope, { immutableReceipt: true })
      if (historical.canonicalRoot !== binding.canonicalRoot || repositoryPolicyFingerprint(historical.policy) !== policyHash) reject('snapshot-policy-changed')
      for (const name of await snapshotNames(directory)) {
        if (historicalSnapshots.length + snapshots.length >= MAX_HISTORY) reject('snapshot-history-limit')
        historicalSnapshots.push(summarizeRepositorySnapshot(await loadRepositorySnapshot(directory, name.slice(0, -5), historical, current.scope)))
      }
    }
    historicalSnapshots.sort((a, b) => b.capturedAt - a.capturedAt || a.id.localeCompare(b.id))
    return { binding, snapshots, connection: current.connection, historicalSnapshots }
  })
  operation(RPC_CHANNELS.codeIntelligence.READ_SPAN, ['snapshotId', 'policyHash', 'path', 'startLine', 'endLine'], async (_context, input, current, signal) => {
    const activeBinding = await storedBinding(current)
    if (!activeBinding) reject('repository-not-bound')
    if (typeof input.path !== 'string') reject('invalid-path')
    let binding = activeBinding, directory = current.store
    if (input.policyHash !== undefined) {
      if (typeof input.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.policyHash)) reject('invalid-policy-fingerprint')
      directory = join(current.folder, 'code-intelligence', binding.id, input.policyHash)
      await noSymlinks(current.workspaceRoot, directory)
      binding = await loadRepositoryBinding(directory, activeBinding.id, current.scope, { immutableReceipt: true })
      if (binding.canonicalRoot !== activeBinding.canonicalRoot || repositoryPolicyFingerprint(binding.policy) !== input.policyHash) reject('snapshot-policy-changed')
    }
    const snapshot = await loadRepositorySnapshot(directory, snapshotId(input.snapshotId), binding, current.scope)
    assertRepositoryCurrentReadPolicy(snapshot, binding, activeBinding, current.scope, input.path)
    checkCancellation(signal)
    return readFileSpan(snapshot, binding, { path: input.path,
      startLine: input.startLine as number, endLine: input.endLine as number }, current.scope)
  })
  operation(RPC_CHANNELS.codeIntelligence.FRESHNESS, ['snapshotId'], async (_context, input, current, signal) => {
    const binding = await storedBinding(current)
    if (!binding) reject('repository-not-bound')
    const snapshot = await loadRepositorySnapshot(current.store, snapshotId(input.snapshotId), binding, current.scope)
    return assessSnapshotFreshness(snapshot, binding, current.scope, { signal })
  })
  server.handle(RPC_CHANNELS.codeIntelligence.CANCEL, (context, raw: unknown) => {
    const input = inputObject(raw)
    assertWindow(context)
    if (!input.requestId) reject('invalid-input')
    const active = requests.get(JSON.stringify([context.clientId, input.requestId]))
    if (!active || active.input.workspaceId !== input.workspaceId || active.input.projectId !== input.projectId) return false
    active.controller.abort()
    return true
  }, { access: 'localElectron' })
}
