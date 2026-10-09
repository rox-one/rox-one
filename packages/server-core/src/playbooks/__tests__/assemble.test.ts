import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PodcastPipelineError } from '@rox/shared/voice'
import type { PodcastSegment } from '../script.ts'
import {
  ESTIMATED_CHARS_PER_SECOND, buildMixdownArgs, buildSrt, cuesFromDurations, estimateDurations, mixdownSegments,
  probeDurations, resolveFfmpegCommand, type ProcessRunner,
} from '../assemble.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-podcast-assemble-'))
  roots.push(root)
  return root
}

const SEGMENTS: readonly PodcastSegment[] = [
  { speaker: 'host', text: 'Почему это важно?' },
  { speaker: 'expert', text: 'Потому что индекс ускоряет поиск.' },
]

const LABELS: Record<PodcastSegment['speaker'], string> = { host: 'Ведущий', expert: 'Эксперт' }

function codeOf(error: unknown): string | undefined {
  return error instanceof PodcastPipelineError ? error.code : undefined
}

describe('podcast timings → srt', () => {
  it('sequences cues cumulatively and renders a valid srt', () => {
    const timings = cuesFromDurations(SEGMENTS, LABELS, [1500, 2500], 'probed')
    expect(timings.durationMs).toBe(4000)
    expect(timings.source).toBe('probed')
    expect(buildSrt(timings.cues)).toBe([
      '1',
      '00:00:00,000 --> 00:00:01,500',
      'Ведущий: Почему это важно?',
      '',
      '2',
      '00:00:01,500 --> 00:00:04,000',
      'Эксперт: Потому что индекс ускоряет поиск.',
      '',
    ].join('\n'))
  })

  it('clamps a too-short cue instead of emitting an unplayable zero-length block', () => {
    const timings = cuesFromDurations(SEGMENTS, LABELS, [10, 10], 'estimated')
    expect(timings.cues[0]!.endMs - timings.cues[0]!.startMs).toBe(300)
    expect(timings.durationMs).toBe(600)
  })

  it('rejects a duration list that does not match the segments', () => {
    expect(() => cuesFromDurations(SEGMENTS, LABELS, [1000], 'probed')).toThrow(PodcastPipelineError)
  })

  it('estimates from text length only as the documented fallback', () => {
    const estimates = estimateDurations([{ speaker: 'host', text: 'x'.repeat(ESTIMATED_CHARS_PER_SECOND * 2) }])
    expect(estimates).toEqual([2000])
  })
})

describe('podcast mixdown argv', () => {
  it('resamples every input and concatenates them into one mono mp3', () => {
    const args = buildMixdownArgs(['/tmp/a.aiff', '/tmp/b.mp3'], '/tmp/out.mp3')
    expect(args).toEqual([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', '/tmp/a.aiff', '-i', '/tmp/b.mp3',
      '-filter_complex', '[0:a]aresample=44100[a0];[1:a]aresample=44100[a1];[a0][a1]concat=n=2:v=0:a=1[out]',
      '-map', '[out]', '-c:a', 'libmp3lame', '-ar', '44100', '-ac', '1', '-b:a', '128k',
      '/tmp/out.mp3',
    ])
    expect(args.join(' ')).not.toContain('shell')
  })

  it('refuses to build a graph without segments', () => {
    expect(() => buildMixdownArgs([], '/tmp/out.mp3')).toThrow(PodcastPipelineError)
  })
})

describe('podcast mixdown execution', () => {
  it('reports a typed ffmpeg-unavailable when the binary cannot be spawned', async () => {
    const root = tempRoot()
    const input = join(root, 'segment.aiff')
    writeFileSync(input, 'audio')
    const error = await mixdownSegments({
      ffmpeg: join(root, 'missing-ffmpeg-binary'), inputs: [input], output: join(root, 'out.mp3'), signal: new AbortController().signal,
    }).catch(caught => caught)
    expect(codeOf(error)).toBe('ffmpeg-unavailable')
  })

  it('fails when ffmpeg exits non-zero and never claims a successful mixdown', async () => {
    const run: ProcessRunner = async () => ({ code: 1, stdout: '', stderr: 'boom' })
    const error = await mixdownSegments({
      ffmpeg: 'ffmpeg', inputs: ['/tmp/a.aiff'], output: '/tmp/out.mp3', signal: new AbortController().signal, run,
    }).catch(caught => caught)
    expect(codeOf(error)).toBe('assembly-failed')
  })

  it('fails when ffmpeg exits zero without producing the output file', async () => {
    const run: ProcessRunner = async () => ({ code: 0, stdout: '', stderr: '' })
    const error = await mixdownSegments({
      ffmpeg: 'ffmpeg', inputs: ['/tmp/a.aiff'], output: '/tmp/never-written.mp3', signal: new AbortController().signal, run,
    }).catch(caught => caught)
    expect(codeOf(error)).toBe('assembly-failed')
  })

  it('reports cancellation and reads a completed mixdown', async () => {
    const root = tempRoot()
    const output = join(root, 'out.mp3')
    const run: ProcessRunner = async (_command, _args, signal) => {
      if (signal.aborted) return { code: null, stdout: '', stderr: '' }
      writeFileSync(output, 'mp3')
      return { code: 0, stdout: '', stderr: '' }
    }
    await mixdownSegments({ ffmpeg: 'ffmpeg', inputs: [join(root, 'a.aiff')], output, signal: new AbortController().signal, run })
    expect(codeOf(await mixdownSegments({
      ffmpeg: 'ffmpeg', inputs: [join(root, 'a.aiff')], output, signal: AbortSignal.abort(), run,
    }).catch(caught => caught))).toBe('cancelled')
  })
})

describe('podcast ffmpeg resolution', () => {
  it('honours an explicit CRAFT_FFMPEG override without probing the toolchain', async () => {
    const previous = process.env.CRAFT_FFMPEG
    process.env.CRAFT_FFMPEG = '/opt/custom/ffmpeg'
    try { expect(await resolveFfmpegCommand()).toBe('/opt/custom/ffmpeg') } finally {
      if (previous === undefined) delete process.env.CRAFT_FFMPEG
      else process.env.CRAFT_FFMPEG = previous
    }
  })
})

describe('podcast duration probing', () => {
  it('reads ffprobe stdout and degrades to null when any segment fails', async () => {
    const run: ProcessRunner = async (_command, args) => ({ code: 0, stdout: args.at(-1) === 'b' ? 'not-a-number\n' : '2.5\n', stderr: '' })
    expect(await probeDurations('ffprobe', ['a'], new AbortController().signal, run)).toEqual([2500])
    expect(await probeDurations('ffprobe', ['a', 'b'], new AbortController().signal, run)).toBeNull()
  })

  it('never claims a probed timing when ffprobe is absent', async () => {
    expect(await probeDurations('ffprobe', ['/nonexistent-audio-file'], new AbortController().signal)).toBeNull()
  })
})

