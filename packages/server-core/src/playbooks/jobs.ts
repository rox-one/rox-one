/**
 * Podcast job orchestration + RPC (02-SPEC-foundations §5.1, §8; 03-SPEC-features §8; D13).
 *
 * The render is a long background job, so the RPC surface is deliberately thin:
 *
 * - `podcast:start` validates, registers the job and returns `{ jobId, episodeId }`
 *   IMMEDIATELY; the caller follows the run on the `podcast:job` push.
 * - `podcast:cancel` aborts the run's `AbortController`; a cancelled run never
 *   publishes an episode (the mixdown stays in a temp directory).
 * - `podcast:episodes` lists published episodes; `podcast:audio` / `podcast:audioUrl`
 *   hand the player the mp3.
 *
 * Every state change is pushed with a monotonic `seq` (the `voice/job-machine.ts`
 * discipline, `shared/src/voice/podcast-job.ts`) and appended to the dev-space
 * audit journal (§8.4). The pipeline itself is dependency-injected, so the whole
 * flow is testable with a fake connector, synthesizer and ffmpeg.
 */
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { loadProjectConfig, saveProjectConfig } from '@rox/shared/projects'
import type { ProjectConfig } from '@rox/shared/projects'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type { ErrorCode } from '@rox/shared/protocol'
import {
  PodcastPipelineError, advancePodcastJob, createPodcastJob, isPodcastRoleId,
} from '@rox/shared/voice'
import type { DevSpaceConsent } from '@rox/shared/dev-space'
import type {
  PodcastCancelResult, PodcastEngine, PodcastEpisode, PodcastEpisodesResult, PodcastJob, PodcastJobState,
  PodcastRoleGender, PodcastRoleId, PodcastRoleTemplate, PodcastSourceInput, PodcastStartResult,
} from '@rox/shared/voice'
import { pushTyped } from '@rox/server-core/transport'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handlers/handler-deps'
import type { RequestContext } from '../transport/types'
import {
  assertPodcastConsent, buildPodcastPrompt, maskPodcastSource, parsePodcastScript, resolveMaxSegments, resolvePodcastRoles,
} from './script.ts'
import { createEdgeSegmentSynthesizer, createSystemSegmentSynthesizer, planPodcastVoices, type SegmentSynthesizer } from './tts.ts'
import {
  buildSrt, cuesFromDurations, estimateDurations, mixdownSegments, probeDurations, resolveFfmpegCommand,
  resolveFfprobeCommand, runProcess, type ProcessRunner,
} from './assemble.ts'
import {
  devSpaceDirectory, newEpisodeId, readPodcastAudioChunk, readPodcastAudioUrl, readPodcastConsent,
  readPodcastEpisodes, writePodcastEpisode,
} from './episodes.ts'

/** The scenario is the podcast's only model-connector egress (D6); the host composes it. */
export interface PodcastScenarioConnector {
  readonly providerId: string
  readonly version: string
  complete(input: { readonly prompt: string; readonly signal: AbortSignal }): Promise<string>
}

export interface HandlerEnvironment {
  getWorkspace(id: string): { id: string; rootPath: string } | null
  loadProjectConfig(root: string, slug: string): ProjectConfig | null
  /** Used to create the default `playbooks` container when no project slug is given. */
  saveProject?(root: string, config: ProjectConfig): void
  /** Absent means the host has no model connector composed: start fails `connector-unavailable`. */
  connector?: PodcastScenarioConnector
  synthesizer?: (engine: PodcastEngine, voiceForRole: (role: PodcastRoleId) => string) => SegmentSynthesizer
  resolveFfmpeg?: () => Promise<string>
  resolveFfprobe?: (ffmpeg: string) => string | null
  run?: ProcessRunner
}

export const DEFAULT_ENVIRONMENT: HandlerEnvironment = {
  getWorkspace: getWorkspaceByNameOrId,
  loadProjectConfig,
  saveProject: saveProjectConfig,
  resolveFfmpeg: resolveFfmpegCommand,
  resolveFfprobe: resolveFfprobeCommand,
  run: runProcess,
}

/** Container project for podcast renders that have no repository project (D13). */
export const DEFAULT_PODCAST_PROJECT_SLUG = 'playbooks'
export const DEFAULT_PODCAST_PROJECT_NAME = 'Playbooks'

const MAX_ACTIVE_JOBS_PER_CLIENT = 2
/** Bounds the source material that may become a scenario prompt. */
const MAX_SOURCE_CHARS = 100_000
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const JOB_ID = /^podcastjob_[a-f0-9]{16}$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Protocol codes a renderer branches on; never the message. */
const ERROR_CODES: Readonly<Record<string, ErrorCode>> = {
  'invalid-input': 'INVALID_PAYLOAD',
  'not-found': 'NOT_FOUND',
  'consent-required': 'FORBIDDEN',
  'connector-unavailable': 'UNSUPPORTED_OPERATION',
  'tts-unavailable': 'UNSUPPORTED_OPERATION',
  'ffmpeg-unavailable': 'UNSUPPORTED_OPERATION',
  'scenario-failed': 'PROVIDER_UNAVAILABLE',
  'tts-failed': 'PROVIDER_UNAVAILABLE',
  'assembly-failed': 'HANDLER_ERROR',
  'storage-failed': 'HANDLER_ERROR',
  'limit-exceeded': 'INVALID_PAYLOAD',
  'cancelled': 'CLIENT_DISCONNECTED',
}

function invalid(reason: string): never { throw new CodedError('INVALID_PAYLOAD', `podcast.${reason}`) }
function denied(reason: string): never { throw new CodedError('AUTH_FAILED', `podcast.${reason}`) }
function asCoded(error: unknown): never {
  if (error instanceof PodcastPipelineError) throw new CodedError(ERROR_CODES[error.code] ?? 'HANDLER_ERROR', `podcast.${error.code}`)
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

function parseSource(raw: unknown): PodcastSourceInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('source')
  const value = raw as Record<string, unknown>
  if (value.kind === 'topic') {
    if (typeof value.topic !== 'string' || !value.topic.trim() || value.topic.length > 20_000) invalid('source')
    return { kind: 'topic', topic: value.topic }
  }
  if (value.kind === 'artifact') {
    if (typeof value.path !== 'string' || !value.path || value.path.length > 512 || value.path.includes('\0')) invalid('source')
    return { kind: 'artifact', path: value.path }
  }
  return invalid('source')
}

function parseRoles(raw: unknown): readonly PodcastRoleTemplate[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) invalid('roles')
  const roles: PodcastRoleTemplate[] = raw.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return invalid('roles')
    const value = entry as Record<string, unknown>
    if (Object.keys(value).some(key => !['id', 'label', 'prompt', 'gender'].includes(key))
      || !isPodcastRoleId(value.id)
      || typeof value.label !== 'string' || typeof value.prompt !== 'string'
      || (value.gender !== undefined && value.gender !== 'female' && value.gender !== 'male')) return invalid('roles')
    return {
      id: value.id, label: value.label, prompt: value.prompt,
      ...(value.gender ? { gender: value.gender as PodcastRoleGender } : {}),
    }
  })
  return roles
}

function episodeCoordinates(raw: unknown): { projectSlug: string; episodeId: string } | null {
  if (!raw || typeof raw !== 'object' || !('id' in raw) || !('projectSlug' in raw)) return null
  const id = raw.id
  const slug = raw.projectSlug
  return typeof id === 'string' && typeof slug === 'string' ? { projectSlug: slug, episodeId: id } : null
}

async function artifactSourceText(root: string, projectSlug: string, path: string): Promise<string> {
  const devSpace = devSpaceDirectory(root, projectSlug)
  const target = join(devSpace, path)
  const rel = relative(devSpace, target)
  if (rel.startsWith('..') || rel === '' || rel.includes('\0')) throw new PodcastPipelineError('invalid-input', 'podcast-source-path')
  try {
    const text = await readFile(target, 'utf8')
    // Source material becomes a prompt: bound it and refuse binary artifacts
    // (the audio container lives in the same tree).
    if (text.includes('\0')) throw new PodcastPipelineError('invalid-input', 'podcast-source-binary')
    if (!text.trim()) throw new PodcastPipelineError('invalid-input', 'podcast-source-empty')
    if (text.length > MAX_SOURCE_CHARS) throw new PodcastPipelineError('limit-exceeded', 'podcast-source-too-large')
    return text
  } catch (error) {
    if (error instanceof PodcastPipelineError) throw error
    throw new PodcastPipelineError('not-found', 'podcast-source-artifact')
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface PodcastPipelineDeps {
  readonly connector?: PodcastScenarioConnector
  readonly synthesizer: (engine: PodcastEngine, voiceForRole: (role: PodcastRoleId) => string) => SegmentSynthesizer
  readonly resolveFfmpeg: () => Promise<string>
  readonly resolveFfprobe?: (ffmpeg: string) => string | null
  readonly run?: ProcessRunner
}

export interface PodcastPipelineInput {
  readonly root: string
  readonly projectSlug: string
  readonly episodeId: string
  readonly sourceText: string
  readonly title: string
  readonly engine: PodcastEngine
  readonly roles: readonly PodcastRoleTemplate[]
  readonly maxSegments: number
  readonly consent: DevSpaceConsent | null
  readonly signal: AbortSignal
  /** Called on every phase change and after every synthesized segment. */
  readonly onProgress: (patch: { readonly state: 'scripting' | 'synthesizing' | 'assembling'; readonly doneSegments: number; readonly totalSegments: number }) => void
}

/** Raised on abort so `finally` cleanup and the caller's cancelled state agree. */
function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new PodcastPipelineError('cancelled', 'podcast.cancelled')
}

/**
 * Scenario → per-segment TTS → ffmpeg mixdown → published episode. Temp segment
 * files live in a private directory that is removed on every exit path, so a
 * cancellation never leaves a publishable partial mixdown (POD-004).
 */
export async function runPodcastPipeline(input: PodcastPipelineInput, deps: PodcastPipelineDeps): Promise<PodcastEpisode> {
  assertPodcastConsent(input.consent)
  if (!deps.connector) throw new PodcastPipelineError('connector-unavailable', 'podcast.connector')
  const connector = deps.connector
  const workDir = await mkdtemp(join(tmpdir(), 'rox-podcast-'))
  try {
    assertNotAborted(input.signal)
    input.onProgress({ state: 'scripting', doneSegments: 0, totalSegments: 0 })
    const prompt = buildPodcastPrompt({ sourceText: maskPodcastSource(input.sourceText), roles: input.roles, maxSegments: input.maxSegments })
    const raw = await connector.complete({ prompt, signal: input.signal }).catch(error => {
      if (input.signal.aborted) throw new PodcastPipelineError('cancelled', 'podcast.cancelled')
      throw new PodcastPipelineError('scenario-failed', error instanceof Error ? error.message : 'podcast.connector')
    })
    assertNotAborted(input.signal)
    const segments = parsePodcastScript(raw, input.roles, input.maxSegments)

    const synthesizer = deps.synthesizer(input.engine, planPodcastVoices(input.engine, input.roles))
    const files: string[] = []
    input.onProgress({ state: 'synthesizing', doneSegments: 0, totalSegments: segments.length })
    for (const [index, segment] of segments.entries()) {
      assertNotAborted(input.signal)
      const audio = await synthesizer.synthesize({ role: segment.speaker, text: segment.text, signal: input.signal })
      const file = join(workDir, `segment_${String(index).padStart(3, '0')}.${audio.extension}`)
      await writeFile(file, audio.bytes)
      files.push(file)
      input.onProgress({ state: 'synthesizing', doneSegments: index + 1, totalSegments: segments.length })
    }
    assertNotAborted(input.signal)

    input.onProgress({ state: 'assembling', doneSegments: segments.length, totalSegments: segments.length })
    const ffmpeg = await deps.resolveFfmpeg()
    const ffprobe = deps.resolveFfprobe?.(ffmpeg) ?? null
    const probed = ffprobe ? await probeDurations(ffprobe, files, input.signal, deps.run).catch(() => null) : null
    const timings = cuesFromDurations(
      segments,
      Object.fromEntries(input.roles.map(role => [role.id, role.label])),
      probed ?? estimateDurations(segments),
      probed ? 'probed' : 'estimated',
    )
    const output = join(workDir, `${input.episodeId}.mp3`)
    await mixdownSegments({ ffmpeg, inputs: files, output, signal: input.signal, ...(deps.run ? { run: deps.run } : {}) })
    assertNotAborted(input.signal)
    const mp3 = await readFile(output)
    return await writePodcastEpisode({
      root: input.root, projectSlug: input.projectSlug, episodeId: input.episodeId, title: input.title,
      engine: input.engine, cues: timings.cues, durationMs: timings.durationMs, timings: timings.source,
      mp3: new Uint8Array(mp3), srt: buildSrt(timings.cues),
    })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort temp cleanup */ })
  }
}

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.podcast.START, RPC_CHANNELS.podcast.CANCEL, RPC_CHANNELS.podcast.EPISODES,
  RPC_CHANNELS.podcast.AUDIO, RPC_CHANNELS.podcast.AUDIO_URL,
] as const

interface ActiveJob {
  readonly id: string
  readonly episodeId: string
  readonly clientId: string
  readonly workspaceId: string
  readonly projectSlug: string
  readonly engine: PodcastEngine
  readonly controller: AbortController
  job: PodcastJob
}

export function registerPodcastHandlers(server: RpcServer, deps: HandlerDeps,
  environment: HandlerEnvironment = DEFAULT_ENVIRONMENT): void {
  const jobs = new Map<string, ActiveJob>()
  const pushJob = (job: ActiveJob): void => {
    pushTyped(server, RPC_CHANNELS.podcast.JOB, { to: 'client', clientId: job.clientId }, job.job)
  }
  const transition = (job: ActiveJob, state: PodcastJobState, patch: Partial<PodcastJob>): void => {
    const next = advancePodcastJob(job.job, state, job.job.seq + 1, patch)
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
    if (!workspace || workspace.id !== workspaceId) throw new CodedError('NOT_FOUND', 'podcast.workspace-missing')
    return realpath(workspace.rootPath)
  }
  async function audit(root: string, projectSlug: string, event: Record<string, unknown>): Promise<void> {
    if (!SLUG.test(projectSlug)) return
    try {
      const directory = devSpaceDirectory(root, projectSlug)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await appendFile(join(directory, 'audit.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, 'utf8')
    } catch { /* the audit journal never fails a render */ }
  }
  /**
   * Resolve the target project. Without a slug the workspace's `playbooks`
   * container is used and created on demand (the `ensureContainerProject`
   * precedent in `dev-space.ts`), so a Playbooks notebook with no repository
   * project can still render; artifacts land in `projects/playbooks/dev-space/`.
   */
  async function resolveProject(root: string, requested: unknown, create: true): Promise<{ slug: string; config: ProjectConfig }>
  async function resolveProject(root: string, requested: unknown, create: boolean): Promise<{ slug: string; config: ProjectConfig | null }>
  async function resolveProject(root: string, requested: unknown, create: boolean): Promise<{ slug: string; config: ProjectConfig | null }> {
    if (requested !== undefined) {
      if (typeof requested !== 'string' || !SLUG.test(requested)) invalid('invalid-project-slug')
      const config = environment.loadProjectConfig(root, requested)
      if (!config) throw new CodedError('NOT_FOUND', 'podcast.project-missing')
      return { slug: requested, config }
    }
    const slug = DEFAULT_PODCAST_PROJECT_SLUG
    const existing = environment.loadProjectConfig(root, slug)
    if (existing || !create) return { slug, config: existing }
    await mkdir(join(root, 'projects', slug), { recursive: true, mode: 0o700 })
    const now = Date.now()
    const config: ProjectConfig = {
      id: `proj_${randomUUID().slice(0, 8)}`, slug, name: DEFAULT_PODCAST_PROJECT_NAME, createdAt: now, updatedAt: now,
    }
    if (!environment.saveProject) throw new CodedError('UNSUPPORTED_OPERATION', 'podcast.project-create-unavailable')
    environment.saveProject(root, config)
    await audit(root, slug, { event: 'podcast-project-created', slug })
    return { slug, config }
  }

  server.handle(RPC_CHANNELS.podcast.START, async (context, raw: unknown): Promise<PodcastStartResult> => {
    try {
      return await startPodcast(context, raw)
    } catch (error) {
      asCoded(error)
    }
  }, { access: 'localElectron' })

  async function startPodcast(context: RequestContext, raw: unknown): Promise<PodcastStartResult> {
    const input = envelope(raw, ['projectSlug', 'source', 'title', 'engine', 'roles', 'maxSegments'])
    const source = parseSource(input.source)
    const engine: PodcastEngine = input.engine === undefined ? 'system' : input.engine === 'edge' || input.engine === 'system' ? input.engine : invalid('invalid-engine')
    const roles = resolvePodcastRoles(parseRoles(input.roles))
    const maxSegments = input.maxSegments === undefined
      ? resolveMaxSegments()
      : resolveMaxSegments(typeof input.maxSegments === 'number' ? input.maxSegments : invalid('max-segments'))
    const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 120) : undefined
    const root = await workspaceRoot(context, input.workspaceId as string)
    const { slug: projectSlug, config: project } = await resolveProject(root, input.projectSlug, true)
    if ([...jobs.values()].some(job => job.clientId === context.clientId && job.projectSlug === projectSlug)) invalid('job-active')
    if ([...jobs.values()].filter(job => job.clientId === context.clientId).length >= MAX_ACTIVE_JOBS_PER_CLIENT) invalid('job-limit')

    const consent = await readPodcastConsent(root, projectSlug)
    // Fail fast with a typed code: the same gate runs again inside the pipeline.
    assertPodcastConsent(consent)
    const sourceText = source.kind === 'topic' ? source.topic : await artifactSourceText(root, projectSlug, source.path)

    const jobId = `podcastjob_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const episodeId = newEpisodeId()
    const job: ActiveJob = {
      id: jobId, episodeId, clientId: context.clientId, workspaceId: input.workspaceId as string, projectSlug,
      engine, controller: new AbortController(), job: createPodcastJob(jobId, engine, title),
    }
    jobs.set(jobId, job)
    transition(job, 'queued', { totalSegments: 0, doneSegments: 0 })
    await audit(root, projectSlug, { event: 'podcast-start', jobId, episodeId, engine })

    void runPodcastPipeline({
      root, projectSlug, episodeId, sourceText, title: title ?? project.name, engine, roles, maxSegments,
      consent, signal: job.controller.signal,
      onProgress: patch => transition(job, patch.state, { totalSegments: patch.totalSegments, doneSegments: patch.doneSegments }),
    }, {
      ...(environment.connector ? { connector: environment.connector } : {}),
      synthesizer: environment.synthesizer ?? ((engine, voiceForRole) => engine === 'system'
        ? createSystemSegmentSynthesizer({ voiceForRole })
        : createEdgeSegmentSynthesizer({ voiceForRole })),
      resolveFfmpeg: environment.resolveFfmpeg ?? DEFAULT_ENVIRONMENT.resolveFfmpeg!,
      resolveFfprobe: environment.resolveFfprobe ?? DEFAULT_ENVIRONMENT.resolveFfprobe!,
      run: environment.run ?? DEFAULT_ENVIRONMENT.run,
    }).then(episode => {
      transition(job, 'done', { episodeId: episode.id, totalSegments: episode.segments, doneSegments: episode.segments })
      void audit(root, projectSlug, { event: 'podcast-done', jobId, episodeId: episode.id, segments: episode.segments })
    }).catch(error => {
      const failure = error instanceof PodcastPipelineError ? error : new PodcastPipelineError('storage-failed', 'podcast-pipeline')
      if (job.controller.signal.aborted || failure.code === 'cancelled') {
        transition(job, 'cancelled', { error: { code: 'cancelled' } })
        void audit(root, projectSlug, { event: 'podcast-cancelled', jobId, episodeId })
      } else {
        transition(job, 'failed', { error: { code: failure.code, detail: failure.message.slice(0, 200) } })
        void audit(root, projectSlug, { event: 'podcast-failed', jobId, episodeId, code: failure.code })
      }
    }).finally(() => { jobs.delete(jobId) })
    return { jobId, episodeId }
  }

  server.handle(RPC_CHANNELS.podcast.CANCEL, (context, raw: unknown): PodcastCancelResult => {
    const input = envelope(raw, ['jobId'])
    assertWindow(context)
    if (input.jobId !== undefined && (typeof input.jobId !== 'string' || !JOB_ID.test(input.jobId))) invalid('invalid-job-id')
    const active = input.jobId !== undefined
      ? jobs.get(input.jobId as string)
      : [...jobs.values()].find(job => job.clientId === context.clientId)
    if (!active || active.clientId !== context.clientId) return { cancelled: false }
    active.controller.abort()
    transition(active, 'cancelled', { error: { code: 'cancelled' } })
    return { cancelled: true }
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.podcast.EPISODES, async (context, raw: unknown): Promise<PodcastEpisodesResult> => {
    const input = envelope(raw, ['projectSlug'])
    const root = await workspaceRoot(context, input.workspaceId as string)
    const { slug } = await resolveProject(root, input.projectSlug, false)
    return { episodes: await readPodcastEpisodes(root, slug).catch(asCoded) }
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.podcast.AUDIO, async (context, raw: unknown) => {
    const input = envelope(raw, ['projectSlug', 'episodeId', 'offset'])
    if (typeof input.projectSlug !== 'string' || !SLUG.test(input.projectSlug)) invalid('invalid-project-slug')
    if (typeof input.episodeId !== 'string') invalid('invalid-episode-id')
    const offset = input.offset === undefined ? 0 : input.offset
    if (typeof offset !== 'number') invalid('invalid-offset')
    const root = await workspaceRoot(context, input.workspaceId as string)
    return readPodcastAudioChunk({ root, projectSlug: input.projectSlug, episodeId: input.episodeId, offset }).catch(asCoded)
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.podcast.AUDIO_URL, async (context, raw: unknown): Promise<string | null> => {
    const input = envelope(raw, ['projectSlug', 'episodeId', 'episode'])
    const fromRecord = episodeCoordinates(input.episode)
    const projectSlug = typeof input.projectSlug === 'string' ? input.projectSlug : fromRecord?.projectSlug
    const episodeId = typeof input.episodeId === 'string' ? input.episodeId : fromRecord?.episodeId
    if (typeof projectSlug !== 'string' || !SLUG.test(projectSlug)) invalid('invalid-project-slug')
    if (typeof episodeId !== 'string') invalid('invalid-episode-id')
    const root = await workspaceRoot(context, input.workspaceId as string)
    return readPodcastAudioUrl(root, projectSlug, episodeId).catch(asCoded)
  }, { access: 'localElectron' })
}