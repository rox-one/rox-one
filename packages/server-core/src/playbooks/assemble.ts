/**
 * Podcast mixdown stage (03-SPEC-features §8.1 steps 5–6, D13).
 *
 * Segment audio is concatenated into ONE `mp3` with `ffmpeg` and the segment
 * timings are turned into an `srt` track. Everything here is deliberately
 * separable from the pipeline so the timing math and the exact `ffmpeg` argv are
 * unit-testable without a binary:
 *
 * - `buildMixdownArgs` produces a heterogeneous-input concat graph (the `system`
 *   engine yields AIFF, `edge` yields MP3, so plain concat-demuxing is not enough).
 * - `buildSrt` / `cuesFromDurations` own the timing contract.
 * - `resolveFfmpegCommand` reuses the toolchain resolver: a missing binary is a
 *   typed `ffmpeg-unavailable` failure and is NEVER installed (§6.4, D4).
 * - The external call is a `spawn` of the binary, never `shell:exec` (§3.8).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveConfigDir } from '@rox/shared/config'
import { createResolver, toolchainPaths } from '@rox/shared/toolchain'
import { PodcastPipelineError } from '@rox/shared/voice'
import type { PodcastSegment } from './script.ts'

/** Output format is fixed: mono 44.1 kHz MP3 at 128 kbps (§8.1). */
export const MIXDOWN_SAMPLE_RATE = 44_100
export const MIXDOWN_BITRATE = '128k'
/** A cue shorter than this would be dropped by most players — clamp instead. */
export const MIN_CUE_MS = 300
/** Rough speaking rate used when `ffprobe` is unavailable (chars per second). */
export const ESTIMATED_CHARS_PER_SECOND = 14

export interface PodcastCue {
  readonly speaker: PodcastSegment['speaker']
  readonly label: string
  readonly text: string
  readonly startMs: number
  readonly endMs: number
}

export interface PodcastTimings {
  readonly cues: readonly PodcastCue[]
  readonly durationMs: number
  /** `probed` when durations came from ffprobe, `estimated` from segment text. */
  readonly source: 'probed' | 'estimated'
}

function srtTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1_000)
  const millis = total % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

/** Sequence cue timings from per-segment durations; the last cue ends the episode. */
export function cuesFromDurations(
  segments: readonly PodcastSegment[],
  labels: Readonly<Record<string, string>>,
  durationsMs: readonly number[],
  source: PodcastTimings['source'],
): PodcastTimings {
  if (durationsMs.length !== segments.length) throw new PodcastPipelineError('assembly-failed', 'podcast-durations-mismatch')
  const cues: PodcastCue[] = []
  let cursor = 0
  segments.forEach((segment, index) => {
    const duration = Math.max(MIN_CUE_MS, Math.round(durationsMs[index] ?? 0))
    cues.push({ speaker: segment.speaker, label: labels[segment.speaker] ?? segment.speaker, text: segment.text, startMs: cursor, endMs: cursor + duration })
    cursor += duration
  })
  return { cues, durationMs: cursor, source }
}

/** Durations from segment text; only a fallback when ffprobe cannot measure (§8.4). */
export function estimateDurations(segments: readonly PodcastSegment[]): number[] {
  return segments.map(segment => Math.max(MIN_CUE_MS, Math.round((segment.text.length / ESTIMATED_CHARS_PER_SECOND) * 1_000)))
}

export function buildSrt(cues: readonly PodcastCue[]): string {
  return cues
    .map((cue, index) => [
      String(index + 1),
      `${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}`,
      `${cue.label}: ${cue.text}`,
      '',
    ].join('\n'))
    .join('\n')
}

/**
 * Heterogeneous-input concat: every input is resampled to the output rate first,
 * so AIFF (`system`) and MP3 (`edge`) segments mix without a demuxer-only concat.
 */
export function buildMixdownArgs(inputs: readonly string[], output: string): string[] {
  if (inputs.length === 0) throw new PodcastPipelineError('invalid-input', 'podcast-no-segments')
  const labels = inputs.map((_, index) => `a${index}`)
  const graph = [
    ...inputs.map((_, index) => `[${index}:a]aresample=${MIXDOWN_SAMPLE_RATE}[${labels[index]}]`),
    `${labels.map(label => `[${label}]`).join('')}concat=n=${inputs.length}:v=0:a=1[out]`,
  ].join(';')
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputs.flatMap(input => ['-i', input]),
    '-filter_complex', graph,
    '-map', '[out]',
    '-c:a', 'libmp3lame', '-ar', String(MIXDOWN_SAMPLE_RATE), '-ac', '1', '-b:a', MIXDOWN_BITRATE,
    output,
  ]
}

export interface ProcessResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

export type ProcessRunner = (command: string, args: readonly string[], signal: AbortSignal) => Promise<ProcessResult>

/** `spawn`-based runner with abort → SIGTERM; stderr is bounded and never carries segment text. */
export const runProcess: ProcessRunner = (command, args, signal) => {
  const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  const { promise, resolve, reject } = Promise.withResolvers<ProcessResult>()
  let stdout = ''
  let stderr = ''
  let settled = false
  const finish = (result: ProcessResult | Error) => {
    if (settled) return
    settled = true
    signal.removeEventListener('abort', onAbort)
    if (result instanceof Error) reject(result)
    else resolve(result)
  }
  const onAbort = () => child.kill('SIGTERM')
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  child.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString('utf8')).slice(-4_000) })
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-4_000) })
  child.once('error', error => finish(error))
  child.once('close', code => finish({ code, stdout, stderr }))
  return promise
}

export async function resolveFfmpegCommand(): Promise<string> {
  const override = process.env.CRAFT_FFMPEG?.trim() || process.env.ROX_FFMPEG?.trim()
  if (override) return override
  const resolver = createResolver(toolchainPaths(resolveConfigDir()))
  const installed = await resolver.findExecutable('ffmpeg')
  if (!installed) throw new PodcastPipelineError('ffmpeg-unavailable', 'podcast.ffmpeg')
  return installed
}

/** `ffprobe` ships with ffmpeg builds but is never guaranteed; absence degrades to estimates. */
export function resolveFfprobeCommand(ffmpeg: string): string | null {
  const override = process.env.CRAFT_FFPROBE?.trim() || process.env.ROX_FFPROBE?.trim()
  if (override) return override
  const sibling = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  return existsSync(sibling) ? sibling : null
}

async function probeOne(ffprobe: string, file: string, signal: AbortSignal, run: ProcessRunner): Promise<number | null> {
  const result = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], signal)
  const seconds = Number.parseFloat(result.stdout.trim())
  return result.code === 0 && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000) : null
}

/** Measure every segment; returns null when ANY segment could not be measured (all-or-nothing). */
export async function probeDurations(
  ffprobe: string,
  files: readonly string[],
  signal: AbortSignal,
  run: ProcessRunner = runProcess,
): Promise<number[] | null> {
  const durations: number[] = []
  for (const file of files) {
    signal.throwIfAborted()
    const duration = await probeOne(ffprobe, file, signal, run)
    if (duration === null) return null
    durations.push(duration)
  }
  return durations
}

/** Concatenate segment files into `output`; a non-zero exit or a missing output is a typed failure. */
export async function mixdownSegments(input: {
  readonly ffmpeg: string
  readonly inputs: readonly string[]
  readonly output: string
  readonly signal: AbortSignal
  readonly run?: ProcessRunner
}): Promise<void> {
  const args = buildMixdownArgs(input.inputs, input.output)
  const result = await (input.run ?? runProcess)(input.ffmpeg, args, input.signal).catch(error => {
    if (input.signal.aborted) throw new PodcastPipelineError('cancelled', 'podcast.mixdown')
    const failure = error instanceof Error ? error : new Error('podcast.mixdown')
    // A binary that cannot be spawned at all is an availability problem, not a render failure.
    if ((failure as NodeJS.ErrnoException).code === 'ENOENT') throw new PodcastPipelineError('ffmpeg-unavailable', 'podcast.ffmpeg')
    throw new PodcastPipelineError('assembly-failed', failure.message)
  })
  if (input.signal.aborted) throw new PodcastPipelineError('cancelled', 'podcast.mixdown')
  if (result.code !== 0) throw new PodcastPipelineError('assembly-failed', `podcast.mixdown-exit-${result.code ?? 'signal'}`)
  if (!existsSync(input.output)) throw new PodcastPipelineError('assembly-failed', 'podcast.mixdown-no-output')
}