import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PodcastPipelineError } from '@rox/shared/voice'
import type { DevSpaceManifest } from '@rox/shared/dev-space'
import {
  PODCAST_AUDIO_CHUNK_BYTES, PODCAST_AUDIO_URL_MAX_BYTES, devSpaceDirectory, newEpisodeId, readPodcastAudioChunk,
  readPodcastAudioUrl, readPodcastConsent, readPodcastEpisodes, writePodcastEpisode,
} from '../episodes.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const SLUG = 'demo-project'
const EPISODE_ID = 'podcast_0123456789abcdef'

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-podcast-store-'))
  roots.push(dir)
  mkdirSync(join(dir, 'projects', SLUG), { recursive: true })
  return dir
}

function codeOf(error: unknown): string | undefined {
  return error instanceof PodcastPipelineError ? error.code : undefined
}

function writeEpisode(dir: string, mp3Bytes = 2048, episodeId = EPISODE_ID) {
  return writePodcastEpisode({
    root: dir,
    projectSlug: SLUG,
    episodeId,
    title: 'Индексация репозитория',
    engine: 'edge',
    cues: [
      { speaker: 'host', label: 'Ведущий', text: 'Вопрос?', startMs: 0, endMs: 1000 },
      { speaker: 'expert', label: 'Эксперт', text: 'Ответ.', startMs: 1000, endMs: 3000 },
    ],
    durationMs: 3000,
    timings: 'probed',
    mp3: new Uint8Array(mp3Bytes).fill(7),
    srt: '1\n00:00:00,000 --> 00:00:01,000\nВедущий: Вопрос?\n',
    now: 1_700_000_000_000,
  })
}

describe('podcast episode store', () => {
  it('writes mp3 + srt under dev-space/audio and registers manifest entries with provenance', async () => {
    const dir = root()
    const episode = await writeEpisode(dir)

    expect(existsSync(join(dir, 'projects', SLUG, 'dev-space', 'audio', `${EPISODE_ID}.mp3`))).toBe(true)
    expect(existsSync(join(dir, 'projects', SLUG, 'dev-space', 'audio', `${EPISODE_ID}.srt`))).toBe(true)
    expect(episode).toMatchObject({
      id: EPISODE_ID, title: 'Индексация репозитория', engine: 'edge', segments: 2, durationMs: 3000,
      timings: 'probed', mp3: { path: `audio/${EPISODE_ID}.mp3`, bytes: 2048 },
      provenance: { providerId: 'podcast-pipeline', version: '1' },
    })
    expect(episode.artifacts.mp3).toStartWith('artifact_')

    const manifest = JSON.parse(readFileSync(join(devSpaceDirectory(dir, SLUG), 'manifest.json'), 'utf8')) as DevSpaceManifest
    expect(manifest.entries.map(entry => `${entry.kind}:${entry.format}`).sort()).toEqual(['audio:mp3', 'audio:srt'])
    expect(manifest.entries.every(entry => entry.producedBy.providerId === 'podcast-pipeline')).toBe(true)
    expect(manifest.entries.find(entry => entry.format === 'srt')!.path).toBe(`audio/${EPISODE_ID}.srt`)
  })

  it('persists the mp3 bytes verbatim (binary, not utf8 text)', async () => {
    const dir = root()
    await writeEpisode(dir)
    const bytes = readFileSync(join(devSpaceDirectory(dir, SLUG), 'audio', `${EPISODE_ID}.mp3`))
    expect(bytes.byteLength).toBe(2048)
    expect([...bytes.subarray(0, 4)]).toEqual([7, 7, 7, 7])
  })

  it('lists episodes newest-first and keeps the previous set on a second render', async () => {
    const dir = root()
    const first = await writeEpisode(dir)
    const second = await writeEpisode(dir, 64, 'podcast_fedcba9876543210')
    const episodes = await readPodcastEpisodes(dir, SLUG)
    expect(episodes.map(episode => episode.id)).toEqual([second.id, first.id])
  })

  it('refuses an id that is not an episode id and an unknown episode', async () => {
    const dir = root()
    expect(codeOf(await readPodcastAudioChunk({ root: dir, projectSlug: SLUG, episodeId: '../secret', offset: 0 }).catch(caught => caught)))
      .toBe('invalid-input')
    expect(codeOf(await readPodcastAudioChunk({ root: dir, projectSlug: SLUG, episodeId: EPISODE_ID, offset: 0 }).catch(caught => caught)))
      .toBe('not-found')
    expect(newEpisodeId()).toMatch(/^podcast_[a-f0-9]{16}$/)
  })

  it('serves frame-aligned audio chunks and rejects an unaligned offset', async () => {
    const dir = root()
    await writeEpisode(dir, 1024)
    const chunk = await readPodcastAudioChunk({ root: dir, projectSlug: SLUG, episodeId: EPISODE_ID, offset: 0 })
    expect(chunk).toMatchObject({ offset: 0, totalBytes: 1024, mimeType: 'audio/mpeg' })
    expect(Buffer.from(chunk.contentBase64, 'base64').byteLength).toBe(1024)
    expect(chunk.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(codeOf(await readPodcastAudioChunk({ root: dir, projectSlug: SLUG, episodeId: EPISODE_ID, offset: 1 }).catch(caught => caught)))
      .toBe('invalid-input')
    expect(codeOf(await readPodcastAudioChunk({
      root: dir, projectSlug: SLUG, episodeId: EPISODE_ID, offset: PODCAST_AUDIO_CHUNK_BYTES * 4,
    }).catch(caught => caught))).toBe('invalid-input')
  })

  it('returns a playable data url for an episode and NOT_FOUND for a missing one', async () => {
    const dir = root()
    await writeEpisode(dir, 512)
    const url = await readPodcastAudioUrl(dir, SLUG, EPISODE_ID)
    expect(url.startsWith('data:audio/mpeg;base64,')).toBe(true)
    expect(Buffer.from(url.slice('data:audio/mpeg;base64,'.length), 'base64').byteLength).toBe(512)
    // The player refuses a message-sized payload past this cap and falls back to frames.
    expect(PODCAST_AUDIO_URL_MAX_BYTES).toBe(32 * 1024 * 1024)
    expect(codeOf(await readPodcastAudioUrl(dir, SLUG, 'podcast_fedcba9876543210').catch(caught => caught))).toBe('not-found')
  })
})

describe('podcast consent read', () => {
  it('is null without a consent file and when the file is malformed', async () => {
    const dir = root()
    expect(await readPodcastConsent(dir, SLUG)).toBeNull()
    mkdirSync(devSpaceDirectory(dir, SLUG), { recursive: true })
    writeFileSync(join(devSpaceDirectory(dir, SLUG), 'consent.json'), '{"schemaVersion":1}')
    expect(await readPodcastConsent(dir, SLUG)).toBeNull()
  })

  it('reads the per-project consent item', async () => {
    const dir = root()
    mkdirSync(devSpaceDirectory(dir, SLUG), { recursive: true })
    writeFileSync(join(devSpaceDirectory(dir, SLUG), 'consent.json'), JSON.stringify({
      schemaVersion: 1, repositoryId: 'repo_x',
      items: { modelConnectors: true, cveNetwork: false, toolUpdates: false }, grantedAt: 1, updatedAt: 2,
    }))
    expect((await readPodcastConsent(dir, SLUG))?.items.modelConnectors).toBe(true)
  })
})