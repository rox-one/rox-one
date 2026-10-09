/**
 * Podcast studio bridge (С-14, D13). Consumes the В4 podcast RPC surface
 * (`podcast:start` / `podcast:cancel` / `podcast:episodes` / `podcast:audio` /
 * `podcast:audio-url`) through the preload bridge; progress arrives on the
 * `podcast:job` push stream (monotonic `seq`, see `@rox/shared/voice/podcast-job`).
 *
 * The player uses the host's playable data URL. Export is renderer-side: srt via
 * the dev-space artifact read + the shared text-save dialog, mp3 by concatenating
 * the frame reader into a Blob download (the existing renderer export pattern).
 */
import type {
  PodcastCancelInput,
  PodcastCancelResult,
  PodcastEpisode,
  PodcastEpisodeAudioChunk,
  PodcastEpisodeAudioInput,
  PodcastEngine,
  PodcastEpisodesInput,
  PodcastEpisodesResult,
  PodcastJob,
  PodcastRoleTemplate,
  PodcastSourceInput,
  PodcastStartInput,
  PodcastStartResult,
} from '@rox/shared/voice'

export type {
  PodcastCancelInput,
  PodcastCancelResult,
  PodcastEpisode,
  PodcastEngine,
  PodcastEpisodesInput,
  PodcastEpisodesResult,
  PodcastJob,
  PodcastRoleTemplate,
  PodcastSourceInput,
  PodcastStartInput,
  PodcastStartResult,
} from '@rox/shared/voice'

export type PodcastExportFormat = 'mp3' | 'srt'

/** Frame-aligned chunk size of `podcast:audio` (192 KiB). */
const AUDIO_FRAME_BYTES = 192 * 1024

/**
 * Podcast inputs default the container to `projects/playbooks`; `projectSlug` is
 * sent only when the notebook is really bound to a project (omitted = server
 * default). Built here so the renderer never invents a slug.
 */
export interface PodcastStartParams {
  readonly workspaceId: string
  readonly projectSlug?: string
  readonly source: PodcastSourceInput
  readonly title?: string
  readonly engine?: PodcastEngine
  readonly roles?: readonly PodcastRoleTemplate[]
  readonly maxSegments?: number
}

export interface PodcastEpisodesParams {
  readonly workspaceId: string
  readonly projectSlug?: string
}

export interface PodcastAudioParams {
  readonly workspaceId: string
  readonly projectSlug?: string
  readonly episodeId: string
  readonly offset?: number
}

/** Optional channel the srt export depends on; absent until dev-space artifacts land. */
interface DevSpaceArtifactReader {
  readDevSpaceArtifact?(input: { workspaceId: string; projectSlug?: string; artifactId: string }): Promise<string>
}

export function startPodcast(params: PodcastStartParams): Promise<PodcastStartResult> {
  return window.electronAPI.startPodcast(params as PodcastStartInput)
}

export function cancelPodcast(input: PodcastCancelInput): Promise<PodcastCancelResult> {
  return window.electronAPI.cancelPodcast(input)
}

export function onPodcastJob(callback: (job: PodcastJob) => void): () => void {
  return window.electronAPI.onPodcastJob(callback)
}

export function listPodcastEpisodes(params: PodcastEpisodesParams): Promise<PodcastEpisodesResult> {
  return window.electronAPI.podcastEpisodes(params as PodcastEpisodesInput)
}

export function readPodcastEpisodeAudio(params: PodcastAudioParams): Promise<PodcastEpisodeAudioChunk> {
  return window.electronAPI.readPodcastEpisodeAudio(params as PodcastEpisodeAudioInput)
}

export function podcastAudioUrl(workspaceId: string, episode: PodcastEpisode): Promise<string | null> {
  return window.electronAPI.podcastEpisodeAudioUrl({ workspaceId, episode })
}

export async function exportPodcastEpisode(input: {
  workspaceId: string
  projectSlug?: string
  episode: PodcastEpisode
  format: PodcastExportFormat
  defaultPath: string
  /** Player data URL; preferred for mp3 so export needs no project binding. */
  audioUrl?: string | null
}): Promise<{ canceled: boolean; filePath?: string }> {
  const { workspaceId, projectSlug, episode, format, defaultPath, audioUrl } = input
  if (format === 'srt') {
    const reader = window.electronAPI as unknown as DevSpaceArtifactReader
    if (typeof reader.readDevSpaceArtifact !== 'function') throw new Error('podcast srt export unavailable')
    const content = await reader.readDevSpaceArtifact({ workspaceId, projectSlug, artifactId: episode.artifacts.srt })
    return window.electronAPI.saveTextFile({
      content,
      defaultPath,
      filters: [{ name: 'SRT', extensions: ['srt'] }],
    })
  }
  const parts: Uint8Array<ArrayBuffer>[] = []
  const dataUrlPayload = audioUrl?.startsWith('data:') ? audioUrl.slice(audioUrl.indexOf(',') + 1) : null
  if (dataUrlPayload) {
    parts.push(decodeBase64(dataUrlPayload))
  } else {
    let offset = 0
    let totalBytes = 0
    do {
      const chunk = await readPodcastEpisodeAudio({ workspaceId, projectSlug, episodeId: episode.id, offset })
      totalBytes = chunk.totalBytes
      if (chunk.contentBase64) parts.push(decodeBase64(chunk.contentBase64))
      offset += AUDIO_FRAME_BYTES
    } while (offset < totalBytes)
  }
  const url = URL.createObjectURL(new Blob(parts, { type: 'audio/mpeg' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = defaultPath
  anchor.click()
  URL.revokeObjectURL(url)
  return { canceled: false }
}

/** base64 → bytes for the mp3 export (data URL or frame chunk). */
function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}