/**
 * Podcast generation job contract (docs/specs/2026-10-09-dev-space-and-playbooks/02-SPEC-foundations.md §5.1, D13;
 * 03-SPEC-features §8).
 *
 * The push channel `podcast:job` replaces `voice:job` for the podcast flow while
 * `voice:job` stays for dictation/ASR. Podcasts are long background renders with
 * their own lifecycle (scenario → per-segment TTS → ffmpeg mixdown), so the
 * record carries segment progress and never mixes with `VoiceHostEvent`.
 *
 * `seq` is monotonic per job and is the ONLY ordering authority: a late event is
 * dropped rather than allowed to rewind the state (same discipline as
 * `voice/job-machine.ts`).
 */

/** Pipeline phase; every state is terminal-exclusive or advances strictly forward. */
export type PodcastJobState =
  | 'queued'
  | 'scripting'
  | 'synthesizing'
  | 'assembling'
  | 'done'
  | 'failed'
  | 'cancelled'

/**
 * TTS engines reused from `types.ts` for the podcast. `system`/`edge` are the
 * v1 pair; `kokoro` is the optional third engine (O5): the offline `kokoro-tts`
 * CLI, macOS/Linux only, English-only voices in v1.0 — never installed by us.
 */
export type PodcastEngine = 'system' | 'edge' | 'kokoro'

/**
 * Honest per-engine availability probed on the host (`podcast:engines`). A
 * missing binary is reported, never installed; the renderer maps `reason` to a
 * locale hint instead of guessing from a failed render.
 */
export interface PodcastEngineAvailability {
  readonly available: boolean
  /** Machine code, absent when `available`. */
  readonly reason?: 'platform' | 'missing'
}

/** `podcast:engines` result: one honest probe per engine (O5 closes for podcasts). */
export interface PodcastEnginesResult {
  readonly system: PodcastEngineAvailability
  readonly edge: PodcastEngineAvailability
  readonly kokoro: PodcastEngineAvailability
}

export type PodcastRoleId = 'host' | 'expert'

/** Editable role template (03-SPEC-features §8.2): label + prompt, both user-editable. */
export interface PodcastRoleTemplate {
  readonly id: PodcastRoleId
  readonly label: string
  readonly prompt: string
}

/** Typed pipeline failure; the renderer branches on `code`, never on a message. */
export type PodcastErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'consent-required'
  | 'connector-unavailable'
  | 'scenario-failed'
  | 'tts-unavailable'
  | 'tts-failed'
  | 'ffmpeg-unavailable'
  | 'assembly-failed'
  | 'cancelled'
  | 'limit-exceeded'
  | 'storage-failed'

export interface PodcastJobError {
  readonly code: PodcastErrorCode
  /** Sanitised detail (no source text, no secrets). */
  readonly detail?: string
}

/**
 * Typed pipeline failure. Stages throw it with a `PodcastErrorCode`; the RPC
 * layer maps the code onto a protocol `ErrorCode` and the job record carries the
 * same code, so a client branches on the code rather than on a message.
 */
export class PodcastPipelineError extends Error {
  constructor(readonly code: PodcastErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'PodcastPipelineError'
  }
}

export interface PodcastJob {
  readonly schemaVersion: 1
  readonly id: string
  readonly state: PodcastJobState
  /** Monotonic per job, mirroring `voice/job-machine.ts` seq semantics. */
  readonly seq: number
  /** 0 until the scenario produced its segments. */
  readonly totalSegments: number
  readonly doneSegments: number
  readonly engine?: PodcastEngine
  readonly title?: string
  /** Set only when `state === 'done'`. */
  readonly episodeId?: string
  readonly error?: PodcastJobError
}

export const PODCAST_JOB_TRANSITIONS: Readonly<Record<PodcastJobState, readonly PodcastJobState[]>> = {
  queued: ['scripting', 'failed', 'cancelled'],
  scripting: ['synthesizing', 'failed', 'cancelled'],
  synthesizing: ['assembling', 'failed', 'cancelled'],
  assembling: ['done', 'failed', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
}

export function createPodcastJob(id: string, engine?: PodcastEngine, title?: string): PodcastJob {
  return {
    schemaVersion: 1,
    id,
    state: 'queued',
    seq: 0,
    totalSegments: 0,
    doneSegments: 0,
    ...(engine ? { engine } : {}),
    ...(title ? { title } : {}),
  }
}

/**
 * Apply an event to a job. Identity and monotonic-seq guards mirror
 * `voice/job-machine.ts`: a foreign job id or a non-advancing `seq` is ignored,
 * so a late push can never rewind a finished render.
 */
export function applyPodcastJobEvent(current: PodcastJob, next: Partial<PodcastJob> & { seq: number; id: string }): PodcastJob {
  if (next.id !== current.id) return current
  if (next.seq <= current.seq) return current
  return { ...current, ...next, seq: next.seq }
}

/** Advance to `next` only along `PODCAST_JOB_TRANSITIONS`; illegal moves are ignored. */
export function advancePodcastJob(
  current: PodcastJob,
  next: PodcastJobState,
  seq: number,
  patch: Partial<PodcastJob> = {},
): PodcastJob {
  if (next === current.state) return applyPodcastJobEvent(current, { ...patch, id: current.id, seq })
  if (!PODCAST_JOB_TRANSITIONS[current.state].includes(next)) return current
  return applyPodcastJobEvent(current, { ...patch, id: current.id, seq, state: next })
}

// ---------------------------------------------------------------------------
// RPC payload contract (`podcast:start` / `podcast:cancel` / `podcast:episodes`)
// ---------------------------------------------------------------------------

export interface PodcastEnvelope {
  readonly workspaceId: string
  readonly requestId?: string
}

/** Scenario input: either a free-form topic or an existing dev-space artifact. */
export type PodcastSourceInput =
  | { readonly kind: 'topic'; readonly topic: string }
  | { readonly kind: 'artifact'; readonly path: string }

export interface PodcastStartInput extends PodcastEnvelope {
  /** Target project; omitted uses the workspace's `playbooks` container (created on demand). */
  readonly projectSlug?: string
  readonly source: PodcastSourceInput
  readonly title?: string
  readonly engine?: PodcastEngine
  readonly roles?: readonly PodcastRoleTemplate[]
  /** Hard budget for a single episode (segments); exceeding it fails `limit-exceeded`. */
  readonly maxSegments?: number
}

export interface PodcastStartResult {
  readonly jobId: string
  readonly episodeId: string
}

export interface PodcastCancelInput extends PodcastEnvelope {
  /** Defaults to the caller's active job. */
  readonly jobId?: string
}

export interface PodcastCancelResult {
  readonly cancelled: boolean
}

export interface PodcastEpisodesInput extends PodcastEnvelope {
  /** Omitted lists the workspace's default `playbooks` container. */
  readonly projectSlug?: string
}

export interface PodcastEpisode {
  readonly id: string
  readonly title: string
  readonly projectSlug: string
  readonly engine: PodcastEngine
  readonly createdAt: number
  readonly segments: number
  readonly durationMs: number
  /** `probed` when ffprobe measured the mixdown, `estimated` from segment text otherwise. */
  readonly timings: 'probed' | 'estimated'
  readonly mp3: { readonly path: string; readonly bytes: number }
  readonly srt: { readonly path: string; readonly bytes: number } | null
  /** dev-space manifest entry ids, readable through `devSpace:readArtifact` (srt export). */
  readonly artifacts: { readonly mp3: string; readonly srt: string }
  readonly provenance: { readonly providerId: string; readonly version: string }
}

export interface PodcastEpisodesResult {
  readonly episodes: readonly PodcastEpisode[]
}

/** One frame-aligned chunk of an episode's mp3 (`podcast:audio`). */
export interface PodcastEpisodeAudioInput extends PodcastEnvelope {
  readonly projectSlug: string
  readonly episodeId: string
  /** Defaults to 0; must be a multiple of the reader frame size. */
  readonly offset?: number
}

export interface PodcastEpisodeAudioChunk {
  readonly episodeId: string
  readonly offset: number
  readonly totalBytes: number
  readonly contentBase64: string
  readonly mimeType: 'audio/mpeg'
  readonly contentHash: string
}

export interface PodcastEpisodeAudioUrlInput extends PodcastEnvelope {
  /** Either the episode coordinates or the listing record the renderer already has. */
  readonly projectSlug?: string
  readonly episodeId?: string
  readonly episode?: PodcastEpisode
}

/**
 * A playable `data:` URL for the player, or `null` when the host has no audio to
 * serve. Episodes above the transport-friendly cap must use `podcast:audio` frames.
 */
export type PodcastEpisodeAudioUrlResult = string | null