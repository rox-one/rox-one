import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type { ProjectConfig } from '@rox/shared/projects'
import { PodcastPipelineError } from '@rox/shared/voice'
import type { DevSpaceConsent } from '@rox/shared/dev-space'
import type { PodcastJob, PodcastRoleTemplate } from '@rox/shared/voice'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handlers/handler-deps'
import { DEFAULT_PODCAST_ROLES } from '../script.ts'
import { writePodcastEpisode } from '../episodes.ts'
import type { SegmentAudio, SegmentSynthesizer } from '../tts.ts'
import type { ProcessRunner } from '../assemble.ts'
import { HANDLED_CHANNELS, registerPodcastHandlers, runPodcastPipeline, type HandlerEnvironment } from '../jobs.ts'
import { devSpaceDirectory } from '../episodes.ts'

const SLUG = 'demo-project'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-podcast-jobs-'))
  roots.push(dir)
  mkdirSync(join(dir, 'projects', SLUG), { recursive: true })
  return dir
}

function codeOf(error: unknown): string | undefined {
  return error instanceof PodcastPipelineError ? error.code : undefined
}

function consent(modelConnectors: boolean): DevSpaceConsent {
  return { schemaVersion: 1, repositoryId: 'repo_x', items: { modelConnectors, cveNetwork: false, toolUpdates: false }, grantedAt: 1, updatedAt: 1 }
}

/** Writes the file the mixdown is expected to produce; never runs a real binary. */
function ffmpegWritingRun(marker = 'mp3-bytes'): ProcessRunner {
  return async (_command, args) => {
    const output = args.at(-1)!
    writeFileSync(output, marker)
    return { code: 0, stdout: '', stderr: '' }
  }
}

function countingSynthesizer(onSegment?: (index: number) => void): { synthesizer: SegmentSynthesizer; calls: number[] } {
  const calls: number[] = []
  const synthesizer: SegmentSynthesizer = {
    engine: 'edge',
    async synthesize({ role, text }): Promise<SegmentAudio> {
      calls.push(calls.length)
      onSegment?.(calls.length - 1)
      void role
      void text
      return { bytes: new Uint8Array([1, 2, 3]), extension: 'mp3', mimeType: 'audio/mpeg' }
    },
  }
  return { synthesizer, calls }
}

const ROLES: readonly PodcastRoleTemplate[] = DEFAULT_PODCAST_ROLES

function pipelineFixture(overrides: {
  consent?: DevSpaceConsent | null
  connectorText?: string
  synthesizer?: SegmentSynthesizer
  run?: ProcessRunner
  onProgress?: (patch: { state: string; doneSegments: number; totalSegments: number }) => void
} = {}) {
  const dir = root()
  const { synthesizer, calls } = countingSynthesizer()
  return {
    root: dir,
    calls,
    run: () => runPodcastPipeline({
      root: dir, projectSlug: SLUG, episodeId: 'podcast_0123456789abcdef', sourceText: 'Индексация репозитория важна.',
      title: 'Индексация', engine: 'edge', roles: ROLES, maxSegments: 12,
      consent: overrides.consent === undefined ? consent(true) : overrides.consent,
      signal: new AbortController().signal,
      onProgress: overrides.onProgress ?? (() => {}),
    }, {
      connector: {
        providerId: 'test-connector', version: '1',
        async complete() { return overrides.connectorText ?? 'ВЕДУЩИЙ: Почему это важно?\nЭКСПЕРТ: Потому что индекс ускоряет поиск.' },
      },
      synthesizer: () => overrides.synthesizer ?? synthesizer,
      resolveFfmpeg: async () => 'ffmpeg',
      resolveFfprobe: () => null,
      run: overrides.run ?? ffmpegWritingRun(),
    }),
  }
}

describe('podcast pipeline gates', () => {
  it('refuses to run the scenario without modelConnectors consent', async () => {
    const fixture = pipelineFixture({ consent: consent(false) })
    const error = await fixture.run().catch(caught => caught)
    expect(codeOf(error)).toBe('consent-required')
    expect(fixture.calls).toEqual([])
  })

  it('reports connector-unavailable instead of inventing a script', async () => {
    const dir = root()
    const error = await runPodcastPipeline({
      root: dir, projectSlug: SLUG, episodeId: 'podcast_0123456789abcdef', sourceText: 'x', title: 't', engine: 'edge',
      roles: ROLES, maxSegments: 8, consent: consent(true), signal: new AbortController().signal, onProgress: () => {},
    }, { synthesizer: () => countingSynthesizer().synthesizer, resolveFfmpeg: async () => 'ffmpeg' }).catch(caught => caught)
    expect(codeOf(error)).toBe('connector-unavailable')
  })

  it('surfaces a typed ffmpeg-unavailable and publishes nothing', async () => {
    const fixture = pipelineFixture({ run: async () => { throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }) } })
    const error = await fixture.run().catch(caught => caught)
    expect(codeOf(error)).toBe('ffmpeg-unavailable')
    expect(existsSync(join(devSpaceDirectory(fixture.root, SLUG), 'audio'))).toBe(false)
  })

  it('cancels mid-synthesis without publishing a partial episode', async () => {
    const dir = root()
    const controller = new AbortController()
    const { synthesizer } = countingSynthesizer(index => { if (index === 0) controller.abort() })
    const states: string[] = []
    const error = await runPodcastPipeline({
      root: dir, projectSlug: SLUG, episodeId: 'podcast_0123456789abcdef', sourceText: 'x', title: 't', engine: 'edge',
      roles: ROLES, maxSegments: 12, consent: consent(true), signal: controller.signal,
      onProgress: patch => states.push(patch.state),
    }, {
      connector: { providerId: 'c', version: '1', async complete() { return 'ВЕДУЩИЙ: a\nЭКСПЕРТ: b\nВЕДУЩИЙ: c' } },
      synthesizer: () => synthesizer,
      resolveFfmpeg: async () => 'ffmpeg',
      run: ffmpegWritingRun(),
    }).catch(caught => caught)
    expect(codeOf(error)).toBe('cancelled')
    expect(states).toEqual(['scripting', 'synthesizing', 'synthesizing'])
    expect(existsSync(join(devSpaceDirectory(dir, SLUG), 'audio'))).toBe(false)
  })
})

describe('podcast pipeline output', () => {
  it('turns the scenario into segments, an srt and a published episode with monotonic progress', async () => {
    const progress: Array<{ state: string; doneSegments: number; totalSegments: number }> = []
    const fixture = pipelineFixture({ onProgress: patch => progress.push(patch) })
    const episode = await fixture.run()

    expect(fixture.calls).toEqual([0, 1])
    expect(episode.segments).toBe(2)
    expect(episode.timings).toBe('estimated')
    expect(episode.srt!.bytes).toBeGreaterThan(0)
    const audio = readdirSync(join(devSpaceDirectory(fixture.root, SLUG), 'audio')).sort()
    expect(audio).toEqual(['index.json', 'podcast_0123456789abcdef.mp3', 'podcast_0123456789abcdef.srt'])
    const srt = readAudioFile(fixture.root, 'podcast_0123456789abcdef.srt')
    expect(srt).toContain('Ведущий: Почему это важно?')
    expect(srt).toContain('-->')

    expect(progress.map(entry => entry.state)).toEqual(['scripting', 'synthesizing', 'synthesizing', 'synthesizing', 'assembling'])
    expect(progress.at(-1)!.doneSegments).toBe(2)
  })

  it('publishes an episode through the kokoro engine when it is selected', async () => {
    const dir = root()
    const episode = await runPodcastPipeline({
      root: dir, projectSlug: SLUG, episodeId: 'podcast_0123456789abcdef', sourceText: 'x', title: 't', engine: 'kokoro',
      roles: ROLES, maxSegments: 8, consent: consent(true), signal: new AbortController().signal, onProgress: () => {},
    }, {
      connector: { providerId: 'c', version: '1', async complete() { return 'ВЕДУЩИЙ: a\nЭКСПЕРТ: b' } },
      synthesizer: () => ({
        engine: 'kokoro',
        async synthesize() { return { bytes: new Uint8Array([1, 2, 3]), extension: 'wav', mimeType: 'audio/wav' } },
      }),
      resolveFfmpeg: async () => 'ffmpeg',
      resolveFfprobe: () => null,
      run: ffmpegWritingRun(),
    })
    expect(episode.engine).toBe('kokoro')
    expect(episode.segments).toBe(2)
    const audio = readdirSync(join(devSpaceDirectory(dir, SLUG), 'audio')).sort()
    expect(audio).toContain('podcast_0123456789abcdef.mp3')
  })
})

function readAudioFile(dir: string, name: string): string {
  return readFileSync(join(devSpaceDirectory(dir, SLUG), 'audio', name), 'utf8')
}

// ---------------------------------------------------------------------------
// RPC surface
// ---------------------------------------------------------------------------

function rpcFixture(options: { connector?: boolean; consent?: boolean } = {}) {
  const dir = root()
  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string; target: unknown; args: unknown[] }> = []
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
  const config: ProjectConfig = { id: 'proj_1', slug: SLUG, name: 'Demo', createdAt: 1, updatedAt: 1 }
  const saved = new Map<string, ProjectConfig>([[SLUG, config]])
  const environment: HandlerEnvironment = {
    getWorkspace: id => (id === 'ws' ? { id, rootPath: dir } : null),
    loadProjectConfig: (_root, slug) => saved.get(slug) ?? null,
    saveProject: (_root, project) => { saved.set(project.slug, project) },
    ...(options.connector === false ? {} : {
      connector: { providerId: 'c', version: '1', async complete() { return 'ВЕДУЩИЙ: q\nЭКСПЕРТ: a' } },
    }),
    synthesizer: () => countingSynthesizer().synthesizer,
    resolveFfmpeg: async () => 'ffmpeg',
    resolveFfprobe: () => null,
    run: ffmpegWritingRun(),
  }
  if (options.consent !== false) {
    mkdirSync(devSpaceDirectory(dir, SLUG), { recursive: true })
    writeFileSync(join(devSpaceDirectory(dir, SLUG), 'consent.json'), JSON.stringify(consent(true)))
  }
  registerPodcastHandlers(server, deps, environment)
  const context: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: 1 }
  const call = (channel: string) => (input: unknown, ctx: RequestContext = context) =>
    Promise.resolve().then(() => handlers.get(channel)!(ctx, input))
  return { dir, handlers, pushes, saved, call }
}

function jobsFrom(pushes: Array<{ channel: string; args: unknown[] }>): PodcastJob[] {
  return pushes.filter(push => push.channel === RPC_CHANNELS.podcast.JOB).map(push => push.args[0] as PodcastJob)
}

describe('podcast:* RPC surface', () => {
  it('registers the frozen podcast channels', () => {
    const fixture = rpcFixture()
    expect([...fixture.handlers.keys()].sort()).toEqual([...HANDLED_CHANNELS].sort())
  })

  it('refuses to start without consent and never pushes a job', async () => {
    const fixture = rpcFixture({ consent: false })
    const error = await fixture.call(RPC_CHANNELS.podcast.START)({
      workspaceId: 'ws', projectSlug: SLUG, source: { kind: 'topic', topic: 'Индексация' },
    }).catch(caught => caught)
    expect(error).toBeInstanceOf(CodedError)
    expect((error as CodedError).code).toBe('FORBIDDEN')
    expect(fixture.pushes).toEqual([])
  })

  it('returns ids immediately and pushes the queued job', async () => {
    const fixture = rpcFixture()
    const started = await fixture.call(RPC_CHANNELS.podcast.START)({
      workspaceId: 'ws', projectSlug: SLUG, source: { kind: 'topic', topic: 'Индексация' }, title: 'Тема', engine: 'edge',
    })
    expect(started.jobId).toMatch(/^podcastjob_[a-f0-9]{16}$/)
    expect(started.episodeId).toMatch(/^podcast_[a-f0-9]{16}$/)
    expect(jobsFrom(fixture.pushes)[0]).toMatchObject({ state: 'queued', seq: 1, engine: 'edge', title: 'Тема' })
    // Stop the background render so it cannot outlive the assertion.
    await fixture.call(RPC_CHANNELS.podcast.CANCEL)({ workspaceId: 'ws' })
  })

  it('lists published episodes from the audio index', async () => {
    const fixture = rpcFixture()
    await writePodcastEpisode({
      root: fixture.dir, projectSlug: SLUG, episodeId: 'podcast_0123456789abcdef', title: 'Эпизод', engine: 'edge',
      cues: [{ speaker: 'host', label: 'Ведущий', text: 'q', startMs: 0, endMs: 500 }], durationMs: 500, timings: 'probed',
      mp3: new Uint8Array([1, 2, 3]), srt: '1\n00:00:00,000 --> 00:00:00,500\nВедущий: q\n',
    })
    const listing = await fixture.call(RPC_CHANNELS.podcast.EPISODES)({ workspaceId: 'ws', projectSlug: SLUG })
    expect(listing.episodes.map((episode: { id: string }) => episode.id)).toEqual(['podcast_0123456789abcdef'])
    expect(listing.episodes[0].artifacts.mp3).toStartWith('artifact_')
  })

  it('cancels the active job and reports it as cancelled', async () => {
    const fixture = rpcFixture()
    await fixture.call(RPC_CHANNELS.podcast.START)({
      workspaceId: 'ws', projectSlug: SLUG, source: { kind: 'topic', topic: 'Индексация' },
    })
    expect(await fixture.call(RPC_CHANNELS.podcast.CANCEL)({ workspaceId: 'ws' })).toEqual({ cancelled: true })
    expect(jobsFrom(fixture.pushes).at(-1)).toMatchObject({ state: 'cancelled', error: { code: 'cancelled' } })
  })

  it('creates and uses the default playbooks container when no project slug is given', async () => {
    const fixture = rpcFixture()
    // Consent is per project slug, so the container needs its own grant.
    mkdirSync(devSpaceDirectory(fixture.dir, 'playbooks'), { recursive: true })
    writeFileSync(join(devSpaceDirectory(fixture.dir, 'playbooks'), 'consent.json'), JSON.stringify(consent(true)))
    const started = await fixture.call(RPC_CHANNELS.podcast.START)({
      workspaceId: 'ws', source: { kind: 'topic', topic: 'Индексация' }, engine: 'edge',
    })
    expect(fixture.saved.get('playbooks')).toMatchObject({ slug: 'playbooks', name: 'Playbooks' })
    expect(existsSync(join(fixture.dir, 'projects', 'playbooks'))).toBe(true)
    // A read path never creates the container, it just lists nothing.
    const listing = await fixture.call(RPC_CHANNELS.podcast.EPISODES)({ workspaceId: 'ws' })
    expect(listing).toEqual({ episodes: [] })
    await fixture.call(RPC_CHANNELS.podcast.CANCEL)({ workspaceId: 'ws' })
    expect(started.jobId).toMatch(/^podcastjob_[a-f0-9]{16}$/)
  })

  it('answers a missing episode with NOT_FOUND for both audio reads', async () => {
    const fixture = rpcFixture()
    const chunk = await fixture.call(RPC_CHANNELS.podcast.AUDIO)({
      workspaceId: 'ws', projectSlug: SLUG, episodeId: 'podcast_0123456789abcdef', offset: 0,
    }).catch(caught => caught)
    expect((chunk as CodedError).code).toBe('NOT_FOUND')
    const url = await fixture.call(RPC_CHANNELS.podcast.AUDIO_URL)({
      workspaceId: 'ws', projectSlug: SLUG, episodeId: 'podcast_0123456789abcdef',
    }).catch(caught => caught)
    expect((url as CodedError).code).toBe('NOT_FOUND')
  })
})