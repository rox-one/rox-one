/**
 * Podcast TTS stage (03-SPEC-features §8.3–§8.4, D13).
 *
 * Only the existing engines are used — `edge` (`shared/src/voice/adapters/edge-tts.ts`),
 * `system` (the macOS `say` engine behind `server-core/src/handlers/rpc/system-tts.ts`)
 * and, since O5 closed for podcasts, the offline `kokoro` CLI (`kokoro-tts`, MIT,
 * PyPI `kokoro-tts`; the user installs the model, we never do) on macOS/Linux —
 * so this module adds no dictation engine: it adds the three
 * things the podcast needs on top of them —
 *
 * 1. a **fixed voice registry** (§8.4) so each of the 2–6 roles gets a distinct
 *    registry voice per engine instead of the language-based defaults,
 * 2. **segment synthesis to files** with an `AbortSignal`, because a long render
 *    is cancelled per segment and mixed down later, and
 * 3. an **honest availability probe** (`podcast:engines`) so the studio offers
 *    `kokoro` only when `kokoro-tts` is really present.
 *
 * A missing binary is a typed `tts-unavailable`; it is never installed. The
 * `system` engine also writes its speech to a file (`say -o`) rather than playing
 * it, mirroring the spawn/stdin/SIGTERM discipline of `system-tts.ts`.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfigDir } from '@rox/shared/config'
import { createResolver, toolchainPaths } from '@rox/shared/toolchain'
import { createEdgeSpeakAdapter } from '@rox/shared/voice/adapters/edge-tts'
import { PodcastPipelineError } from '@rox/shared/voice'
import type { PodcastEngine, PodcastEngineAvailability, PodcastEnginesResult, PodcastRoleId, PodcastRoleTemplate, SpeakAdapter } from '@rox/shared/voice'

export interface PodcastVoice {
  readonly engine: PodcastEngine
  readonly id: string
  readonly label: string
  readonly language: 'ru' | 'en'
  readonly gender: 'female' | 'male'
}

/**
 * Fixed registry (§8.4): the only voices a role may be assigned. `edge` ids are
 * Microsoft neural voices of the pinned CLI, `system` ids are macOS `say` voices.
 */
export const PODCAST_VOICE_REGISTRY: readonly PodcastVoice[] = [
  { engine: 'edge', id: 'ru-RU-SvetlanaNeural', label: 'Светлана (edge, RU)', language: 'ru', gender: 'female' },
  { engine: 'edge', id: 'ru-RU-DmitryNeural', label: 'Дмитрий (edge, RU)', language: 'ru', gender: 'male' },
  { engine: 'edge', id: 'en-US-AriaNeural', label: 'Aria (edge, EN)', language: 'en', gender: 'female' },
  { engine: 'edge', id: 'en-US-GuyNeural', label: 'Guy (edge, EN)', language: 'en', gender: 'male' },
  { engine: 'system', id: 'Milena', label: 'Milena (system, RU)', language: 'ru', gender: 'female' },
  { engine: 'system', id: 'Yuri', label: 'Yuri (system, RU)', language: 'ru', gender: 'male' },
  // Kokoro v1.0 ships no Russian voices; the Russian pair stays on edge/system above.
  { engine: 'kokoro', id: 'af_heart', label: 'Heart (kokoro, EN)', language: 'en', gender: 'female' },
  { engine: 'kokoro', id: 'am_adam', label: 'Adam (kokoro, EN)', language: 'en', gender: 'male' },
]

/**
 * The scenario prompt is Russian, so the N-role planner prefers registry voices in
 * this language. Engines without one (kokoro v1.0 is EN-only) fall back to their
 * own voices instead of failing.
 */
const PODCAST_VOICE_LANGUAGE: PodcastVoice['language'] = 'ru'

/** host→female, expert→male keeps the two voices distinct within every engine. */
export function defaultVoiceForRole(engine: PodcastEngine, role: PodcastRoleId): PodcastVoice {
  const gender = role === 'host' ? 'female' : 'male'
  const voice = PODCAST_VOICE_REGISTRY.find(candidate => candidate.engine === engine && candidate.gender === gender)
  if (!voice) throw new PodcastPipelineError('tts-unavailable', `podcast.voice-${engine}`)
  return voice
}

/**
 * Assign every role a registry voice for the chosen engine. Gender comes from the
 * role (default by position: first female, second male, then alternation), and
 * voices of that gender are handed out round-robin, so more roles than voices
 * reuse voices cyclically instead of failing (the v1.x N-agent boundary). An
 * engine with no voice of a requested gender is a typed `tts-unavailable`.
 */
export function planPodcastVoices(
  engine: PodcastEngine,
  roles: readonly PodcastRoleTemplate[],
): (role: PodcastRoleId) => string {
  const pool = (gender: PodcastVoice['gender']) => {
    const forEngine = PODCAST_VOICE_REGISTRY.filter(candidate => candidate.engine === engine && candidate.gender === gender)
    // Prefer the RU registry language (the scenario prompt is Russian), but fall
    // back to the engine's own voices when it has none — kokoro v1.0 is EN-only.
    const preferred = forEngine.filter(candidate => candidate.language === PODCAST_VOICE_LANGUAGE)
    return preferred.length ? preferred : forEngine
  }
  const voices = { female: pool('female'), male: pool('male') }
  if (!voices.female.length && !voices.male.length) throw new PodcastPipelineError('tts-unavailable', `podcast.voice-${engine}`)
  const cursor = { female: 0, male: 0 }
  const assigned = new Map<PodcastRoleId, string>()
  roles.forEach((role, index) => {
    const gender = role.gender ?? (index % 2 === 0 ? 'female' : 'male')
    const available = voices[gender].length ? voices[gender] : voices[gender === 'female' ? 'male' : 'female']
    if (!available.length) throw new PodcastPipelineError('tts-unavailable', `podcast.voice-${engine}`)
    const voice = available[cursor[gender]++ % available.length]!
    assigned.set(role.id, voice.id)
  })
  return role => assigned.get(role) ?? defaultVoiceForRole(engine, role).id
}

export interface SegmentAudio {
  readonly bytes: Uint8Array
  /** Container on disk; ffmpeg re-encodes all of them to mp3 at mixdown. */
  readonly extension: 'mp3' | 'aiff' | 'wav'
  readonly mimeType: string
}

export interface SegmentSynthesisRequest {
  readonly role: PodcastRoleId
  readonly text: string
  readonly signal: AbortSignal
}

export interface SegmentSynthesizer {
  readonly engine: PodcastEngine
  synthesize(request: SegmentSynthesisRequest): Promise<SegmentAudio>
}

/** Bounds mirror the edge adapter: an oversized segment is split before synthesis. */
const MAX_SEGMENT_TEXT = 20_000
const EDGE_SEGMENT_TIMEOUT_MS = 60_000
/** A local kokoro render is slower than edge, but the same per-segment budget applies. */
const KOKORO_SEGMENT_TIMEOUT_MS = 60_000
/** kokoro v1.0 voices are English-only (`af_*`/`am_*`); the CLI still needs the flag. */
const KOKORO_LANGUAGE = 'en'

export interface KokoroCommand { readonly executable: string; readonly args: readonly string[] }

/**
 * Locate the offline `kokoro-tts` CLI (nazdridoy/kokoro-tts, MIT; PyPI `kokoro-tts`).
 * There is NO uv/`--from` fallback: unlike edge-tts, kokoro needs a model the user
 * installs, so an absent binary is honestly `unavailable`, never auto-provisioned.
 */
export async function resolveKokoroCommand(): Promise<KokoroCommand> {
  const override = process.env.CRAFT_KOKORO?.trim()
  if (override) return { executable: override, args: [] }
  const resolver = createResolver(toolchainPaths(resolveConfigDir()))
  const installed = await resolver.findExecutable('kokoro-tts')
  if (!installed) throw new PodcastPipelineError('tts-unavailable', 'podcast.kokoro')
  return { executable: installed, args: [] }
}

/**
 * Honest availability of every podcast engine (never installs anything). `system`
 * gated on `say`'s host platform, `edge` on its CLI or the bundled uv, `kokoro`
 * on its CLI plus a hard macOS/Linux gate (v1.0 has no Windows build, O5).
 */
export async function probePodcastEngines(options: {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  findExecutable?: (name: string) => Promise<string | null>
} = {}): Promise<PodcastEnginesResult> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const find = options.findExecutable ?? (async (name: string) => {
    const resolver = createResolver(toolchainPaths(resolveConfigDir()))
    return resolver.findExecutable(name)
  })
  const system: PodcastEngineAvailability = platform === 'darwin' ? { available: true } : { available: false, reason: 'platform' }
  const edgePresent = Boolean(env.CRAFT_EDGE_TTS?.trim()) || Boolean(await find('edge-tts'))
    || Boolean(env.CRAFT_UV?.trim()) || Boolean(await find('uv'))
  const kokoroPresent = Boolean(env.CRAFT_KOKORO?.trim()) || Boolean(await find('kokoro-tts'))
  const kokoro: PodcastEngineAvailability = platform === 'win32'
    ? { available: false, reason: 'platform' }
    : kokoroPresent ? { available: true } : { available: false, reason: 'missing' }
  return {
    system,
    edge: edgePresent ? { available: true } : { available: false, reason: 'missing' },
    kokoro,
  }
}

function assertText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new PodcastPipelineError('invalid-input', 'podcast-empty-segment')
  if (trimmed.length > MAX_SEGMENT_TEXT) throw new PodcastPipelineError('limit-exceeded', 'podcast-segment-too-long')
  return trimmed
}

/** Edge engine: one buffered adapter per role so each role keeps its registry voice. */
export function createEdgeSegmentSynthesizer(options: {
  /** Override the voice per role (the renderer may re-assign one from the registry). */
  voiceForRole?: (role: PodcastRoleId) => string
  timeoutMs?: number
} = {}): SegmentSynthesizer {
  const adapters: Partial<Record<PodcastRoleId, SpeakAdapter>> = {}
  const adapterFor = (role: PodcastRoleId) => {
    const existing = adapters[role]
    if (existing) return existing
    const voice = options.voiceForRole?.(role) ?? defaultVoiceForRole('edge', role).id
    const adapter = createEdgeSpeakAdapter({ voice, timeoutMs: options.timeoutMs ?? EDGE_SEGMENT_TIMEOUT_MS })
    adapters[role] = adapter
    return adapter
  }
  return {
    engine: 'edge',
    async synthesize({ role, text, signal }) {
      const body = assertText(text)
      let result
      try {
        result = await adapterFor(role).speak({ text: body, signal })
      } catch (error) {
        if (signal.aborted) throw new PodcastPipelineError('cancelled', 'podcast.tts')
        if (error instanceof PodcastPipelineError) throw error
        // A missing CLI and a rejected synthesis are different user actions.
        throw new PodcastPipelineError(/requires edge-tts|ENOENT/.test(error instanceof Error ? error.message : '')
          ? 'tts-unavailable' : 'tts-failed', 'podcast.edge-tts')
      }
      if (!result.audioBase64) throw new PodcastPipelineError('tts-failed', 'podcast.edge-tts-empty')
      const bytes = new Uint8Array(Buffer.from(result.audioBase64, 'base64'))
      if (bytes.byteLength === 0) throw new PodcastPipelineError('tts-failed', 'podcast.edge-tts-empty')
      return { bytes, extension: 'mp3', mimeType: 'audio/mpeg' }
    },
  }
}

/** Injection seam for the `say` process; mirrors `system-tts.ts`'s spawn shape. */
export type SaySpawn = (command: string, args: readonly string[], options: { stdio: ['pipe', 'ignore', 'ignore'] }) => SayChild
export interface SayChild {
  stdin: { end(chunk: string): void } | null
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'error' | 'close', listener: (arg: unknown) => void): unknown
}

/**
 * System engine: `say` writes the utterance to a file (`-o`) with text piped
 * through stdin, so no text ever becomes an argv entry. Voice availability is
 * the caller's honest capability question — an unknown voice is `tts-unavailable`.
 */
export function createSystemSegmentSynthesizer(options: {
  platform?: NodeJS.Platform
  spawn?: SaySpawn
  voiceForRole?: (role: PodcastRoleId) => string
} = {}): SegmentSynthesizer {
  const platform = options.platform ?? process.platform
  const saySpawn = options.spawn ?? (spawn as unknown as SaySpawn)
  return {
    engine: 'system',
    async synthesize({ role, text, signal }) {
      if (platform !== 'darwin') throw new PodcastPipelineError('tts-unavailable', 'podcast.say-platform')
      const body = assertText(text)
      const voice = options.voiceForRole?.(role) ?? defaultVoiceForRole('system', role).id
      const dir = await mkdtemp(join(tmpdir(), 'rox-podcast-say-'))
      const output = join(dir, 'segment.aiff')
      try {
        await sayToFile(saySpawn, voice, output, body, signal)
        const bytes = await readFile(output)
        if (bytes.byteLength === 0) throw new PodcastPipelineError('tts-failed', 'podcast.say-empty')
        return { bytes: new Uint8Array(bytes), extension: 'aiff', mimeType: 'audio/aiff' }
      } catch (error) {
        if (signal.aborted) throw new PodcastPipelineError('cancelled', 'podcast.tts')
        if (error instanceof PodcastPipelineError) throw error
        // `say` exited zero without leaving a file, or the file is unreadable.
        throw new PodcastPipelineError('tts-failed', 'podcast.say')
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}

function sayToFile(saySpawn: SaySpawn, voice: string, output: string, text: string, signal: AbortSignal): Promise<void> {
  let child: SayChild
  try {
    child = saySpawn('say', ['-v', voice, '-o', output, '--data-format=LEI16@22050'], { stdio: ['pipe', 'ignore', 'ignore'] })
  } catch {
    // A `say` that cannot even be spawned is unavailable, not a failed synthesis.
    return Promise.reject(new PodcastPipelineError('tts-unavailable', 'podcast.say'))
  }
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  let settled = false
  let exitCode: number | null = 0
  const finish = (error?: Error) => {
    if (settled) return
    settled = true
    signal.removeEventListener('abort', onAbort)
    if (error) reject(error)
    else if (exitCode === 0) resolve()
    else reject(new PodcastPipelineError('tts-failed', 'podcast.say-exit'))
  }
  const onAbort = () => child.kill('SIGTERM')
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  child.once('error', error => finish(error instanceof Error ? error : new PodcastPipelineError('tts-unavailable', 'podcast.say')))
  child.once('close', code => { exitCode = typeof code === 'number' ? code : null; finish() })
  child.stdin?.end(text)
  return promise
}

/**
 * Injection seam for the `kokoro-tts` process; the same spawn/stdin/SIGTERM shape
 * as the `say` seam, so a fake child drives the tests without a real CLI.
 */
export type KokoroSpawn = SaySpawn

/**
 * Kokoro engine: `kokoro-tts /dev/stdin out.wav --voice <id> --lang en --format wav`
 * with the utterance piped through stdin, so no text ever becomes an argv entry.
 * A missing CLI is honestly `tts-unavailable`; a timeout or non-zero exit is
 * `tts-failed`. The temporary `.wav` directory is removed on every exit path.
 */
export function createKokoroSegmentSynthesizer(options: {
  platform?: NodeJS.Platform
  spawn?: KokoroSpawn
  voiceForRole?: (role: PodcastRoleId) => string
  resolveCommand?: () => Promise<KokoroCommand>
  timeoutMs?: number
} = {}): SegmentSynthesizer {
  const platform = options.platform ?? process.platform
  const kokoroSpawn = options.spawn ?? (spawn as unknown as KokoroSpawn)
  const resolveCommand = options.resolveCommand ?? resolveKokoroCommand
  const timeoutMs = options.timeoutMs ?? KOKORO_SEGMENT_TIMEOUT_MS
  return {
    engine: 'kokoro',
    async synthesize({ role, text, signal }) {
      // v1.0 ships no Windows build (O5); the probe gates the UI the same way.
      if (platform === 'win32') throw new PodcastPipelineError('tts-unavailable', 'podcast.kokoro-platform')
      const body = assertText(text)
      const voice = options.voiceForRole?.(role) ?? defaultVoiceForRole('kokoro', role).id
      let command: KokoroCommand
      try {
        command = await resolveCommand()
      } catch (error) {
        if (signal.aborted) throw new PodcastPipelineError('cancelled', 'podcast.tts')
        if (error instanceof PodcastPipelineError) throw error
        throw new PodcastPipelineError('tts-unavailable', 'podcast.kokoro')
      }
      const dir = await mkdtemp(join(tmpdir(), 'rox-podcast-kokoro-'))
      const output = join(dir, 'segment.wav')
      try {
        await kokoroToFile(kokoroSpawn, command, voice, output, body, signal, timeoutMs)
        const bytes = await readFile(output)
        if (bytes.byteLength === 0) throw new PodcastPipelineError('tts-failed', 'podcast.kokoro-empty')
        return { bytes: new Uint8Array(bytes), extension: 'wav', mimeType: 'audio/wav' }
      } catch (error) {
        if (signal.aborted) throw new PodcastPipelineError('cancelled', 'podcast.tts')
        if (error instanceof PodcastPipelineError) throw error
        throw new PodcastPipelineError('tts-failed', 'podcast.kokoro')
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}

/** A spawn ENOENT is `tts-unavailable`; anything else about the CLI is `tts-failed`. */
function kokoroSpawnError(error: unknown): PodcastPipelineError {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
  return new PodcastPipelineError(code === 'ENOENT' ? 'tts-unavailable' : 'tts-failed', 'podcast.kokoro')
}

function kokoroToFile(
  kokoroSpawn: KokoroSpawn,
  command: KokoroCommand,
  voice: string,
  output: string,
  text: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  const args = [...command.args, '/dev/stdin', output, '--voice', voice, '--lang', KOKORO_LANGUAGE, '--format', 'wav']
  let child: SayChild
  try {
    child = kokoroSpawn(command.executable, args, { stdio: ['pipe', 'ignore', 'ignore'] })
  } catch (error) {
    return Promise.reject(kokoroSpawnError(error))
  }
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  let settled = false
  let exitCode: number | null = null
  let timedOut = false
  let killTimer: NodeJS.Timeout | undefined
  const onAbort = () => child.kill('SIGTERM')
  const finish = (error?: Error) => {
    if (settled) return
    settled = true
    clearTimeout(killTimer)
    signal.removeEventListener('abort', onAbort)
    if (error) reject(error)
    else if (exitCode === 0) resolve()
    else reject(new PodcastPipelineError('tts-failed', 'podcast.kokoro-exit'))
  }
  child.once('error', error => finish(error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
    ? new PodcastPipelineError('tts-unavailable', 'podcast.kokoro')
    : error instanceof Error ? error : kokoroSpawnError(error)))
  child.once('close', code => {
    exitCode = typeof code === 'number' ? code : null
    finish(timedOut ? new PodcastPipelineError('tts-failed', 'podcast.kokoro-timeout') : undefined)
  })
  // A stalled render is bounded like a segment budget; the CLI gets SIGTERM first.
  killTimer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
  killTimer.unref()
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  child.stdin?.end(text)
  return promise
}
