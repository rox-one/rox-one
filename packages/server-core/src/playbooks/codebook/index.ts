/**
 * Codebook RPC surface (03-SPEC-features §9; 04-UI-SPEC B.15 С-15; 05-PLAN В5).
 *
 * A notebook run is a long background job, so the RPC is deliberately thin:
 *
 * - `playbooks:runCodebook` validates the notebook, registers the job and
 *   returns `{ jobId, runId, notebookId }` IMMEDIATELY; the caller follows the
 *   run on the `playbooks:codebookJob` push.
 * - `playbooks:cancelCodebook` aborts the run's `AbortController`; a cancelled
 *   run is journaled as `cancelled` and never as a success.
 * - `playbooks:codebookRuns` lists the durable journal of a project.
 *
 * Every state change is pushed with a monotonic `seq` (the
 * `voice/job-machine.ts` discipline, `@rox/shared/playbooks`) and appended to
 * the dev-space audit journal (02-SPEC-foundations §8.4). The agent step reuses
 * the server session mechanism through `createSessionAgentRunner`; the artifact
 * step is a reference resolver, so no content is duplicated. The whole flow is
 * dependency-injected and testable with fake runners.
 */
import { appendFile, mkdir, realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { loadProjectConfig, saveProjectConfig } from '@rox/shared/projects'
import type { ProjectConfig } from '@rox/shared/projects'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type { ErrorCode } from '@rox/shared/protocol'
import { advanceCodebookJob, CodebookRunError, createCodebookJob } from '@rox/shared/playbooks'
import type {
  CodebookCell, CodebookCancelResult, CodebookJob, CodebookJobState,
  CodebookRunResult, CodebookRunsResult,
} from '@rox/shared/playbooks'
import { pushTyped } from '@rox/server-core/transport'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handlers/handler-deps'
import type { ISessionManager } from '../../handlers/session-manager-interface'
import type { SessionCompletionEvent } from '../../sessions/SessionManager'
import type { RequestContext } from '../../transport/types'
import { codebookDirectory, newCodebookRunId, readCodebookRuns, readDevSpaceManifestEntry, writeCodebookRun } from './runs.ts'
import { runCodebook, spawnCodebookProcess } from './engine.ts'
import type {
  CodebookAgentRun, CodebookAgentRunner, CodebookAgentStepInput, CodebookArtifactPublisher,
  CodebookArtifactResolver, CodebookProcessRunner,
} from './engine.ts'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.playbooks.RUN_CODEBOOK, RPC_CHANNELS.playbooks.CANCEL_CODEBOOK, RPC_CHANNELS.playbooks.CODEBOOK_RUNS,
] as const

export interface HandlerEnvironment {
  getWorkspace(id: string): { id: string; rootPath: string } | null
  loadProjectConfig(root: string, slug: string): ProjectConfig | null
  /** Used to create the default `playbooks` container when no project slug is given. */
  saveProject?(root: string, config: ProjectConfig): void
  /** Optional agent seam; without one the handler composes `createSessionAgentRunner`. */
  agent?: CodebookAgentRunner
  /** Optional artifact resolver (В2 dev-space artifacts); absent answers `artifact-unavailable`. */
  artifacts?: CodebookArtifactResolver
  /** Optional artifact publisher; absent keeps a bounded inline output record. */
  publishArtifact?: CodebookArtifactPublisher
  run?: CodebookProcessRunner
}

export const DEFAULT_ENVIRONMENT: HandlerEnvironment = {
  getWorkspace: getWorkspaceByNameOrId,
  loadProjectConfig,
  saveProject: saveProjectConfig,
  // Artifact cells resolve against the existing dev-space manifest (В2 format),
  // so a reference works without any host composition.
  artifacts: { resolve: input => readDevSpaceManifestEntry(input.root, input.projectSlug, input.artifactId) },
  run: spawnCodebookProcess,
}

/** Container project for codebooks that have no repository project (mirrors the podcast default). */
export const DEFAULT_CODEBOOK_PROJECT_SLUG = 'playbooks'
export const DEFAULT_CODEBOOK_PROJECT_NAME = 'Playbooks'

const MAX_ACTIVE_JOBS_PER_CLIENT = 2
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const JOB_ID = /^codebookjob_[a-f0-9]{16}$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Protocol codes a renderer branches on; never the message. */
const ERROR_CODES: Readonly<Record<string, ErrorCode>> = {
  'invalid-input': 'INVALID_PAYLOAD',
  'not-found': 'NOT_FOUND',
  'step-failed': 'HANDLER_ERROR',
  'step-timeout': 'HANDLER_ERROR',
  'agent-unavailable': 'UNSUPPORTED_OPERATION',
  'artifact-unavailable': 'UNSUPPORTED_OPERATION',
  'command-unavailable': 'UNSUPPORTED_OPERATION',
  'cancelled': 'CLIENT_DISCONNECTED',
  'limit-exceeded': 'INVALID_PAYLOAD',
  'storage-failed': 'HANDLER_ERROR',
}

function invalid(reason: string): never { throw new CodedError('INVALID_PAYLOAD', `playbooks.codebook-${reason}`) }
function denied(reason: string): never { throw new CodedError('AUTH_FAILED', `playbooks.codebook-${reason}`) }
function asCoded(error: unknown): never {
  if (error instanceof CodebookRunError) {
    throw new CodedError(ERROR_CODES[error.code] ?? 'HANDLER_ERROR', `playbooks.codebook-${error.code}`)
  }
  throw error
}

function envelope(raw: unknown, extra: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('invalid-input')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['workspaceId', 'requestId', ...extra].includes(key))
    || typeof value.workspaceId !== 'string' || !ID.test(value.workspaceId)
    || (value.requestId !== undefined && (typeof value.requestId !== 'string' || !ID.test(value.requestId)))) invalid('invalid-input')
  return value
}

/** Parse one cell over the wire; the engine re-validates the executable shape. */
function parseCell(raw: unknown): CodebookCell {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('cell')
  const value = raw as Record<string, unknown>
  const allowed = ['id', 'kind', 'title', 'command', 'args', 'cwd', 'prompt', 'artifactId']
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid('cell')
  if (typeof value.id !== 'string' || !ID.test(value.id)) invalid('cell-id')
  if (value.kind !== 'script' && value.kind !== 'agent' && value.kind !== 'artifact') invalid('cell-kind')
  if (value.title !== undefined && typeof value.title !== 'string') invalid('cell-title')
  if (value.command !== undefined && typeof value.command !== 'string') invalid('cell-command')
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some(arg => typeof arg !== 'string'))) invalid('cell-args')
  if (value.cwd !== undefined && value.cwd !== 'repository' && value.cwd !== 'workspace') invalid('cell-cwd')
  if (value.prompt !== undefined && typeof value.prompt !== 'string') invalid('cell-prompt')
  if (value.artifactId !== undefined && typeof value.artifactId !== 'string') invalid('cell-artifact')
  return {
    id: value.id,
    kind: value.kind,
    ...(value.title !== undefined ? { title: value.title } : {}),
    ...(value.command !== undefined ? { command: value.command } : {}),
    ...(value.args !== undefined ? { args: value.args as string[] } : {}),
    ...(value.cwd !== undefined ? { cwd: value.cwd } : {}),
    ...(value.prompt !== undefined ? { prompt: value.prompt } : {}),
    ...(value.artifactId !== undefined ? { artifactId: value.artifactId } : {}),
  }
}

/**
 * Default agent runner: reuse the existing server session mechanism — create a
 * session, dispatch the prompt and wait for the in-process completion seam
 * (the `tasks/TaskRunner.ts` precedent). Cancelling the run cancels the session.
 * Absent the mechanism the handler passes no runner, so the engine answers
 * `agent-unavailable` instead of inventing output.
 */
export function createSessionAgentRunner(manager: ISessionManager): CodebookAgentRunner {
  return {
    async run(input: CodebookAgentStepInput): Promise<CodebookAgentRun> {
      const session = await manager.createSession(input.workspaceId, {
        name: `Codebook: ${input.cellId}`.slice(0, 120),
        ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
        labels: ['codebook'],
      })
      const { promise: completion, resolve, reject } = Promise.withResolvers<SessionCompletionEvent>()
      const off = manager.onSessionComplete(event => {
        if (event.sessionId !== session.id) return
        off()
        resolve(event)
      })
      input.signal.addEventListener('abort', () => {
        off()
        void manager.cancelProcessing(session.id, true).catch(() => { /* the rejection surfaces below */ })
        reject(new Error('codebook.cancelled'))
      }, { once: true })
      await manager.sendMessage(session.id, input.prompt, undefined, undefined, undefined, undefined, undefined, undefined, undefined)
      const event = await completion
      if (event.reason === 'error' || event.reason === 'timeout') throw new Error(`codebook.agent-${event.reason}`)
      return { sessionId: session.id, text: event.finalText ?? manager.getSessionFinalText(session.id) ?? '' }
    },
  }
}

interface ActiveJob {
  readonly id: string
  readonly runId: string
  readonly notebookId: string
  readonly clientId: string
  readonly workspaceId: string
  readonly projectSlug: string
  readonly controller: AbortController
  job: CodebookJob
}

export function registerCodebookHandlers(server: RpcServer, deps: HandlerDeps,
  environment: HandlerEnvironment = DEFAULT_ENVIRONMENT): void {
  const jobs = new Map<string, ActiveJob>()
  const agent = environment.agent ?? (deps.sessionManager
    && typeof deps.sessionManager.createSession === 'function'
    && typeof deps.sessionManager.sendMessage === 'function'
    && typeof deps.sessionManager.onSessionComplete === 'function'
    ? createSessionAgentRunner(deps.sessionManager)
    : undefined)
  const pushJob = (job: ActiveJob): void => {
    pushTyped(server, RPC_CHANNELS.playbooks.CODEBOOK_JOB, { to: 'client', clientId: job.clientId }, job.job)
  }
  const transition = (job: ActiveJob, state: CodebookJobState, patch: Partial<CodebookJob>): void => {
    const next = advanceCodebookJob(job.job, state, job.job.seq + 1, patch)
    // An illegal or no-op transition returns the same record: never re-push it.
    if (next.seq === job.job.seq) return
    job.job = next
    pushJob(job)
  }
  function assertWindow(context: RequestContext, workspaceId?: string): void {
    if (!Number.isSafeInteger(context.webContentsId) || context.webContentsId === null || context.webContentsId <= 0
      || !deps.windowManager || !deps.windowManager.getWindowByWebContentsId(context.webContentsId)
      || (workspaceId !== undefined && (context.workspaceId !== workspaceId
        || deps.windowManager.getWorkspaceForWindow(context.webContentsId) !== workspaceId))) {
      denied('accessDenied')
    }
  }
  async function workspaceRoot(context: RequestContext, workspaceId: string): Promise<string> {
    assertWindow(context, workspaceId)
    const workspace = environment.getWorkspace(workspaceId)
    if (!workspace || workspace.id !== workspaceId) throw new CodedError('NOT_FOUND', 'playbooks.codebook-workspace-missing')
    return realpath(workspace.rootPath)
  }
  async function audit(root: string, projectSlug: string, event: Record<string, unknown>): Promise<void> {
    if (!SLUG.test(projectSlug)) return
    try {
      const directory = codebookDirectory(root, projectSlug)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await appendFile(join(directory, 'audit.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, 'utf8')
    } catch { /* the audit journal never fails a run */ }
  }
  /** Resolve the target project; without a slug the workspace's `playbooks` container is used. */
  async function resolveProject(root: string, requested: unknown, create: true): Promise<{ slug: string; config: ProjectConfig }>
  async function resolveProject(root: string, requested: unknown, create: boolean): Promise<{ slug: string; config: ProjectConfig | null }>
  async function resolveProject(root: string, requested: unknown, create: boolean): Promise<{ slug: string; config: ProjectConfig | null }> {
    if (requested !== undefined) {
      if (typeof requested !== 'string' || !SLUG.test(requested)) invalid('invalid-project-slug')
      const config = environment.loadProjectConfig(root, requested)
      if (!config) throw new CodedError('NOT_FOUND', 'playbooks.codebook-project-missing')
      return { slug: requested, config }
    }
    const slug = DEFAULT_CODEBOOK_PROJECT_SLUG
    const existing = environment.loadProjectConfig(root, slug)
    if (existing || !create) return { slug, config: existing }
    await mkdir(join(root, 'projects', slug), { recursive: true, mode: 0o700 })
    const now = Date.now()
    const config: ProjectConfig = {
      id: `proj_${randomUUID().slice(0, 8)}`, slug, name: DEFAULT_CODEBOOK_PROJECT_NAME, createdAt: now, updatedAt: now,
    }
    if (!environment.saveProject) throw new CodedError('UNSUPPORTED_OPERATION', 'playbooks.codebook-project-create-unavailable')
    environment.saveProject(root, config)
    await audit(root, slug, { event: 'codebook-project-created', slug })
    return { slug, config }
  }

  server.handle(RPC_CHANNELS.playbooks.RUN_CODEBOOK, async (context, raw: unknown): Promise<CodebookRunResult> => {
    try {
      return await startCodebook(context, raw)
    } catch (error) {
      asCoded(error)
    }
  }, { access: 'localElectron' })

  async function startCodebook(context: RequestContext, raw: unknown): Promise<CodebookRunResult> {
    const input = envelope(raw, ['notebookId', 'projectSlug', 'title', 'cells', 'cellIds'])
    if (typeof input.notebookId !== 'string' || !ID.test(input.notebookId)) invalid('invalid-notebook-id')
    if (!Array.isArray(input.cells)) invalid('cells')
    const cells = input.cells.map(parseCell)
    const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 120) : undefined

    // `cellIds` selects a subset in notebook order (run-one-cell / run-selection).
    let selected = cells.map((cell, index) => ({ cell, index }))
    if (input.cellIds !== undefined) {
      if (!Array.isArray(input.cellIds) || input.cellIds.some(id => typeof id !== 'string' || !ID.test(id))) invalid('cell-ids')
      const wanted = new Set(input.cellIds as string[])
      selected = selected.filter(entry => wanted.has(entry.cell.id))
      if (selected.length === 0) invalid('cell-selection-empty')
    }
    if (selected.length === 0) invalid('empty-notebook')

    const root = await workspaceRoot(context, input.workspaceId as string)
    const { slug: projectSlug, config: project } = await resolveProject(root, input.projectSlug, true)
    if ([...jobs.values()].some(job => job.clientId === context.clientId && job.notebookId === input.notebookId && job.projectSlug === projectSlug)) invalid('job-active')
    if ([...jobs.values()].filter(job => job.clientId === context.clientId).length >= MAX_ACTIVE_JOBS_PER_CLIENT) invalid('job-limit')

    const jobId = `codebookjob_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const runId = newCodebookRunId()
    const job: ActiveJob = {
      id: jobId, runId, notebookId: input.notebookId, clientId: context.clientId, workspaceId: input.workspaceId as string,
      projectSlug, controller: new AbortController(),
      job: createCodebookJob({ id: jobId, notebookId: input.notebookId, runId, projectSlug,
        cells: selected.map(entry => entry.cell), indexes: selected.map(entry => entry.index) }),
    }
    jobs.set(jobId, job)
    transition(job, 'queued', { cellIndex: -1, doneSteps: 0 })
    await audit(root, projectSlug, { event: 'codebook-start', jobId, runId, notebookId: input.notebookId, cells: selected.length })

    const workingDirectory = project.workingDirectory
    void runCodebook({
      root, workspaceId: job.workspaceId, projectSlug, notebookId: input.notebookId, runId,
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(title ? { title } : {}),
      cells: selected.map(entry => entry.cell), indexes: selected.map(entry => entry.index),
      signal: job.controller.signal,
      // The engine's own terminal emit is not the caller's durability signal: this
      // layer owns the terminal push and only sends it after the run is journaled.
      // Forwarding progress here would race the journal (the caller would see
      // `done`/`failed` before the record on disk existed).
      onProgress: progress => {
        if (progress.state === 'running') transition(job, 'running', { cellIndex: progress.cellIndex, doneSteps: progress.doneSteps, steps: progress.steps })
      },
    }, {
      ...(agent ? { agent } : {}),
      ...(environment.artifacts ? { artifacts: environment.artifacts } : {}),
      ...(environment.publishArtifact ? { publishArtifact: environment.publishArtifact } : {}),
      run: environment.run ?? DEFAULT_ENVIRONMENT.run,
    }).then(async run => {
      // Journal first: the terminal push is the caller's "the run is durable" signal.
      await writeCodebookRun({ root, projectSlug, run })
      transition(job, run.status === 'succeeded' ? 'done' : run.status, {
        cellIndex: run.error?.cellIndex ?? job.job.cellIndex,
        doneSteps: run.status === 'succeeded' ? run.steps.length : job.job.doneSteps,
        steps: run.steps,
        ...(run.error ? { error: run.error } : {}),
      })
      await audit(root, projectSlug, { event: 'codebook-done', jobId, runId, status: run.status })
    }).catch(async error => {
      const detail = error instanceof Error ? error.message.slice(0, 200) : 'codebook-pipeline'
      const code = error instanceof CodebookRunError ? error.code : 'storage-failed'
      if (job.controller.signal.aborted || code === 'cancelled') {
        transition(job, 'cancelled', { error: { code: 'cancelled' } })
        await audit(root, projectSlug, { event: 'codebook-cancelled', jobId, runId })
      } else {
        transition(job, 'failed', { error: { code, detail } })
        await audit(root, projectSlug, { event: 'codebook-failed', jobId, runId, code })
      }
    }).finally(() => { jobs.delete(jobId) })
    return { jobId, runId, notebookId: input.notebookId }
  }

  server.handle(RPC_CHANNELS.playbooks.CANCEL_CODEBOOK, (context, raw: unknown): CodebookCancelResult => {
    const input = envelope(raw, ['jobId', 'notebookId'])
    assertWindow(context)
    if (input.jobId !== undefined && (typeof input.jobId !== 'string' || !JOB_ID.test(input.jobId))) invalid('invalid-job-id')
    if (input.notebookId !== undefined && (typeof input.notebookId !== 'string' || !ID.test(input.notebookId))) invalid('invalid-notebook-id')
    const active = input.jobId !== undefined
      ? jobs.get(input.jobId as string)
      : [...jobs.values()].find(job => job.clientId === context.clientId
        && (input.notebookId === undefined || job.notebookId === input.notebookId))
    if (!active || active.clientId !== context.clientId) return { cancelled: false }
    active.controller.abort()
    transition(active, 'cancelled', { error: { code: 'cancelled' } })
    return { cancelled: true }
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.playbooks.CODEBOOK_RUNS, async (context, raw: unknown): Promise<CodebookRunsResult> => {
    const input = envelope(raw, ['projectSlug'])
    const root = await workspaceRoot(context, input.workspaceId as string)
    const { slug } = await resolveProject(root, input.projectSlug, false)
    return { runs: await readCodebookRuns(root, slug).catch(asCoded) }
  }, { access: 'localElectron' })
}