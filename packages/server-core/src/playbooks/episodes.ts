/**
 * Podcast episode store (02-SPEC-foundations §7, D13).
 *
 * Audio lives under `projects/<slug>/dev-space/audio/` — the container the
 * dev-space layout reserves for the podcast (§7.1–§7.2) — as `<episodeId>.mp3`
 * plus `<episodeId>.srt`, both registered in `dev-space/manifest.json` with
 * provenance (§7.3) so the existing `devSpace:listArtifacts` / `devSpace:readArtifact`
 * surfaces can serve them.
 *
 * Two store properties are podcast-specific:
 *
 * 1. **Binary content.** An mp3 is not a utf8 string, so this module writes the
 *    bytes itself before registering the manifest row (the dev-space stage writer
 *    is text-only). The manifest row, path and entry id follow the same contract.
 * 2. **Durable episode index.** The manifest is bound to one
 *    `(repositoryId, snapshotId, runId)` triple and starts a fresh set when the
 *    triple changes, so episodes are listed from `audio/index.json`, which is the
 *    podcast's own append-only view and survives dev-space re-runs.
 *
 * Reads are contained under `dev-space/audio/` and follow no symlinks. Nothing
 * here touches the network or spawns a process.
 */
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { devSpaceManifestEntryId } from '@rox/shared/dev-space'
import { PodcastPipelineError } from '@rox/shared/voice'
import type { DevSpaceConsent, DevSpaceManifest, DevSpaceManifestEntry } from '@rox/shared/dev-space'
import type { PodcastEngine, PodcastEpisode, PodcastEpisodeAudioChunk } from '@rox/shared/voice'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import type { PodcastCue } from './assemble.ts'

/** Mirrors the RPC envelope's slug guard — the slug selects `projects/<slug>`. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const EPISODE_ID = /^podcast_[a-f0-9]{16}$/
const MAX_MANIFEST_ENTRIES = 4_096
const MAX_EPISODE_BYTES = 64 * 1024 * 1024
const MAX_EPISODES = 200
/** Frame size of one audio read; the renderer concatenates frames into a Blob. */
export const PODCAST_AUDIO_CHUNK_BYTES = 192 * 1024
/** A single `data:` URL must stay a display payload, not a transport dump. */
export const PODCAST_AUDIO_URL_MAX_BYTES = 32 * 1024 * 1024

export const PODCAST_AUDIO_DIRECTORY = 'audio'
export const PODCAST_INDEX_FILENAME = 'index.json'
const MANIFEST_FILENAME = 'manifest.json'
const CONSENT_FILENAME = 'consent.json'
const PROVIDER_ID = 'podcast-pipeline'
const PROVIDER_VERSION = '1'

interface PodcastIndexFile {
  readonly schemaVersion: 1
  readonly episodes: readonly PodcastEpisode[]
}

export function devSpaceDirectory(root: string, projectSlug: string): string {
  return join(root, 'projects', projectSlug, 'dev-space')
}

export function podcastAudioDirectory(root: string, projectSlug: string): string {
  return join(devSpaceDirectory(root, projectSlug), PODCAST_AUDIO_DIRECTORY)
}

/** Episode id doubles as the artifact file stem; the format keeps the path guard tight. */
export function newEpisodeId(): string {
  return `podcast_${createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16)}`
}

function assertSlug(projectSlug: string): void {
  if (!SLUG.test(projectSlug)) throw new PodcastPipelineError('invalid-input', 'podcast-project-slug')
}

function assertEpisodeId(episodeId: string): void {
  if (!EPISODE_ID.test(episodeId)) throw new PodcastPipelineError('invalid-input', 'podcast-episode-id')
}

function within(base: string, target: string): boolean {
  const rel = relative(base, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** Refuse to read or write through a symlinked path component. */
async function assertNoSymlinks(root: string, target: string): Promise<void> {
  const rel = relative(root, target)
  if (!within(root, target)) throw new PodcastPipelineError('invalid-input', 'podcast-path-denied')
  let path = root
  for (const part of rel.split(sep).filter(Boolean)) {
    path = join(path, part)
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new PodcastPipelineError('invalid-input', 'podcast-path-denied')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

/** Same schema and defaults as the dev-space consent item (§8.1); no consent file means no egress. */
export async function readPodcastConsent(root: string, projectSlug: string): Promise<DevSpaceConsent | null> {
  if (!SLUG.test(projectSlug)) return null
  const path = join(devSpaceDirectory(root, projectSlug), CONSENT_FILENAME)
  let raw: string
  try { raw = await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new PodcastPipelineError('storage-failed', 'podcast-consent-read')
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const consent = parsed as Record<string, unknown>
  const items = consent.items as Record<string, unknown> | undefined
  if (consent.schemaVersion !== 1 || typeof consent.repositoryId !== 'string' || !items
    || typeof items.modelConnectors !== 'boolean' || typeof items.cveNetwork !== 'boolean'
    || typeof items.toolUpdates !== 'boolean' || typeof consent.grantedAt !== 'number'
    || typeof consent.updatedAt !== 'number') return null
  return parsed as unknown as DevSpaceConsent
}

async function readManifest(root: string, projectSlug: string): Promise<DevSpaceManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(join(devSpaceDirectory(root, projectSlug), MANIFEST_FILENAME), 'utf8')) as DevSpaceManifest
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) return null
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return null
  }
}

/**
 * Write an audio artifact and register it in the manifest. The manifest keeps its
 * existing identity when one is present (audio is appended to the current set);
 * otherwise the podcast identity is used so a project without an analysis run
 * still gets provenance rows.
 */
async function writeAudioArtifact(input: {
  readonly root: string
  readonly projectSlug: string
  readonly episodeId: string
  readonly name: string
  readonly format: 'mp3' | 'srt'
  readonly content: Uint8Array | string
  readonly now: number
}): Promise<DevSpaceManifestEntry> {
  assertSlug(input.projectSlug)
  const directory = podcastAudioDirectory(input.root, input.projectSlug)
  const target = join(directory, input.name)
  if (!within(directory, target)) throw new PodcastPipelineError('invalid-input', 'podcast-path-denied')
  await assertNoSymlinks(input.root, target)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const bytes = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : Buffer.from(input.content)
  if (bytes.byteLength === 0) throw new PodcastPipelineError('storage-failed', 'podcast-empty-artifact')
  if (bytes.byteLength > MAX_EPISODE_BYTES) throw new PodcastPipelineError('limit-exceeded', 'podcast-artifact-too-large')

  const entry: DevSpaceManifestEntry = {
    id: devSpaceManifestEntryId(`podcast:${input.projectSlug}`, `podcast:${input.episodeId}`, 'audio', `${PODCAST_AUDIO_DIRECTORY}/${input.name}`),
    kind: 'audio',
    path: `${PODCAST_AUDIO_DIRECTORY}/${input.name}`,
    format: input.format,
    producedBy: { providerId: PROVIDER_ID, version: PROVIDER_VERSION },
    createdAt: input.now,
  }
  const existing = await readManifest(input.root, input.projectSlug)
  const identity = existing
    ? { repositoryId: existing.repositoryId, snapshotId: existing.snapshotId, runId: existing.runId }
    : { repositoryId: `podcast:${input.projectSlug}`, snapshotId: `podcast:${input.episodeId}`, runId: `podcast:${input.episodeId}` }
  const entries = [...(existing?.entries ?? []).filter(current => current.id !== entry.id), entry]
  // Budget is checked BEFORE the bytes land so a rejected write leaves no orphan file.
  if (entries.length > MAX_MANIFEST_ENTRIES) throw new PodcastPipelineError('limit-exceeded', 'podcast-manifest-limit')

  await writeFile(target, bytes, { mode: 0o600 })
  const manifest: DevSpaceManifest = { schemaVersion: 1, ...identity, entries }
  atomicWriteFileSync(join(devSpaceDirectory(input.root, input.projectSlug), MANIFEST_FILENAME), JSON.stringify(manifest, null, 2))
  return entry
}

async function readIndex(root: string, projectSlug: string): Promise<PodcastEpisode[]> {
  if (!SLUG.test(projectSlug)) return []
  let raw: string
  try { raw = await readFile(join(podcastAudioDirectory(root, projectSlug), PODCAST_INDEX_FILENAME), 'utf8') } catch { return [] }
  try {
    const parsed = JSON.parse(raw) as PodcastIndexFile
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.episodes)) return []
    return [...parsed.episodes]
  } catch { return [] }
}

async function writeIndex(root: string, projectSlug: string, episodes: readonly PodcastEpisode[]): Promise<void> {
  const directory = podcastAudioDirectory(root, projectSlug)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file: PodcastIndexFile = { schemaVersion: 1, episodes: episodes.slice(0, MAX_EPISODES) }
  atomicWriteFileSync(join(directory, PODCAST_INDEX_FILENAME), JSON.stringify(file, null, 2))
}

export interface PodcastEpisodeWriteInput {
  readonly root: string
  readonly projectSlug: string
  readonly episodeId: string
  readonly title: string
  readonly engine: PodcastEngine
  readonly cues: readonly PodcastCue[]
  readonly durationMs: number
  readonly timings: PodcastEpisode['timings']
  readonly mp3: Uint8Array
  readonly srt: string
  readonly now?: number
}

/**
 * Publish a finished render: mp3 + srt + manifest rows + index row, in that
 * order. Callers only reach this after ffmpeg produced a complete file, so a
 * cancelled render never publishes a partial episode (POD-004).
 */
export async function writePodcastEpisode(input: PodcastEpisodeWriteInput): Promise<PodcastEpisode> {
  assertSlug(input.projectSlug)
  assertEpisodeId(input.episodeId)
  const now = input.now ?? Date.now()
  const artifactBase = { root: input.root, projectSlug: input.projectSlug, episodeId: input.episodeId, now }
  const mp3Entry = await writeAudioArtifact({ ...artifactBase, name: `${input.episodeId}.mp3`, format: 'mp3', content: input.mp3 })
  const srtEntry = await writeAudioArtifact({ ...artifactBase, name: `${input.episodeId}.srt`, format: 'srt', content: input.srt })
  const episode: PodcastEpisode = {
    id: input.episodeId,
    title: input.title,
    projectSlug: input.projectSlug,
    engine: input.engine,
    createdAt: now,
    segments: input.cues.length,
    durationMs: input.durationMs,
    timings: input.timings,
    mp3: { path: mp3Entry.path, bytes: input.mp3.byteLength },
    srt: { path: srtEntry.path, bytes: Buffer.byteLength(input.srt, 'utf8') },
    artifacts: { mp3: mp3Entry.id, srt: srtEntry.id },
    provenance: mp3Entry.producedBy,
  }
  const existing = await readIndex(input.root, input.projectSlug)
  await writeIndex(input.root, input.projectSlug, [episode, ...existing.filter(current => current.id !== episode.id)])
  return episode
}

export async function readPodcastEpisodes(root: string, projectSlug: string): Promise<readonly PodcastEpisode[]> {
  assertSlug(projectSlug)
  return readIndex(root, projectSlug)
}

async function episodeFile(root: string, projectSlug: string, episodeId: string, extension: 'mp3' | 'srt'): Promise<string> {
  assertSlug(projectSlug)
  assertEpisodeId(episodeId)
  const directory = podcastAudioDirectory(root, projectSlug)
  const target = join(directory, `${episodeId}.${extension}`)
  if (!within(directory, target)) throw new PodcastPipelineError('invalid-input', 'podcast-path-denied')
  await assertNoSymlinks(root, target)
  return target
}

async function readEpisodeFile(root: string, projectSlug: string, episodeId: string, extension: 'mp3' | 'srt'): Promise<Buffer> {
  const target = await episodeFile(root, projectSlug, episodeId, extension)
  try { return await readFile(target) } catch { throw new PodcastPipelineError('not-found', 'podcast-episode-audio') }
}

export interface PodcastAudioChunkInput {
  readonly root: string
  readonly projectSlug: string
  readonly episodeId: string
  readonly offset: number
}

/** One frame-aligned chunk of an episode's mp3, mirroring the voice-history reader. */
export async function readPodcastAudioChunk(input: PodcastAudioChunkInput): Promise<PodcastEpisodeAudioChunk> {
  if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset % PODCAST_AUDIO_CHUNK_BYTES !== 0) {
    throw new PodcastPipelineError('invalid-input', 'podcast-audio-offset')
  }
  const bytes = await readEpisodeFile(input.root, input.projectSlug, input.episodeId, 'mp3')
  if (input.offset >= bytes.byteLength) throw new PodcastPipelineError('invalid-input', 'podcast-audio-offset')
  const slice = bytes.subarray(input.offset, Math.min(input.offset + PODCAST_AUDIO_CHUNK_BYTES, bytes.byteLength))
  return {
    episodeId: input.episodeId,
    offset: input.offset,
    totalBytes: bytes.byteLength,
    contentBase64: slice.toString('base64'),
    mimeType: 'audio/mpeg',
    contentHash: createHash('sha256').update(slice).digest('hex'),
  }
}

/**
 * A `data:` URL for the player. Capped so an unrealistic episode is served
 * through `podcast:audio` frames instead of a single oversized message.
 */
export async function readPodcastAudioUrl(root: string, projectSlug: string, episodeId: string): Promise<string> {
  const bytes = await readEpisodeFile(root, projectSlug, episodeId, 'mp3')
  if (bytes.byteLength > PODCAST_AUDIO_URL_MAX_BYTES) throw new PodcastPipelineError('limit-exceeded', 'podcast-audio-url-too-large')
  return `data:audio/mpeg;base64,${bytes.toString('base64')}`
}

