/** Microsoft Edge online TTS through the edge-tts CLI. No shell or text argv. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfigDir } from '../../config/paths.ts'
import { createResolver, toolchainPaths } from '../../toolchain/index.ts'
import type { SpeakAdapter, SpeakInput, TextTransmission } from '../types.ts'

export const EDGE_TTS_VERSION = '7.2.8'
const MAX_TEXT_LENGTH = 20_000
const MAX_AUDIO_BYTES = 16 * 1024 * 1024

export type EdgeTtsCommand = { executable: string; args: string[] }
export type EdgeTtsRunner = (command: EdgeTtsCommand, text: string, signal: AbortSignal) => Promise<void>

/** Sanitized failure with conservative text-transmission evidence. */
export class EdgeTtsError extends Error {
  constructor(message: string, readonly textTransmission: TextTransmission) {
    super(message)
    this.name = 'EdgeTtsError'
  }
}

export async function resolveEdgeTtsCommand(): Promise<EdgeTtsCommand> {
  const override = process.env.CRAFT_EDGE_TTS?.trim()
  if (override) return { executable: override, args: [] }
  const resolver = createResolver(toolchainPaths(resolveConfigDir()))
  const installed = await resolver.findExecutable('edge-tts')
  if (installed) return { executable: installed, args: [] }
  const uv = process.env.CRAFT_UV?.trim() || await resolver.findExecutable('uv')
  if (!uv) throw new Error('Edge TTS requires edge-tts or uv')
  // uv caches an isolated Python environment; the application bundle already ships uv.
  return { executable: uv, args: ['tool', 'run', '--from', `edge-tts==${EDGE_TTS_VERSION}`, 'edge-tts'] }
}

async function resolveCommandWithAbort(resolveCommand: () => Promise<EdgeTtsCommand>, signal: AbortSignal): Promise<EdgeTtsCommand> {
  let abort!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('cancelled'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([resolveCommand(), cancelled])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

const runEdgeTts: EdgeTtsRunner = (command, text, signal) => new Promise((resolve, reject) => {
  const child = spawn(command.executable, command.args, {
    shell: false,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    signal,
  })
  // Do not include stderr in errors: providers may echo submitted text.
  let processError: Error | null = null
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const forceStop = () => {
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 250)
    killTimer.unref()
  }
  signal.addEventListener('abort', forceStop, { once: true })
  if (signal.aborted) forceStop()
  child.once('error', (error) => { processError = error })
  // Wait for close even on abort so the writer exits before removing its directory.
  child.once('close', (code) => {
    if (killTimer) clearTimeout(killTimer)
    signal.removeEventListener('abort', forceStop)
    if (processError) reject(processError)
    else if (code === 0) resolve()
    else reject(new Error(`Edge TTS exited with code ${code}`))
  })
  child.stdin.on('error', () => { /* Child error/close settles the request (including EPIPE). */ })
  child.stdin.end(text)
})

export function edgeTtsVoice(input: Pick<SpeakInput, 'text' | 'language'>): string {
  const russian = input.language === 'ru' || (input.language !== 'en' && /[А-Яа-яЁё]/.test(input.text))
  return russian ? 'ru-RU-SvetlanaNeural' : 'en-US-AriaNeural'
}

export function createEdgeSpeakAdapter(options: {
  resolveCommand?: () => Promise<EdgeTtsCommand>
  run?: EdgeTtsRunner
  timeoutMs?: number
} = {}): SpeakAdapter {
  return {
    engine: 'edge',
    async speak(input) {
      const text = input.text.trim()
      input.onTextTransmission?.('not-sent')
      if (!text) throw new EdgeTtsError('Edge TTS text is empty', 'not-sent')
      if (text.length > MAX_TEXT_LENGTH) throw new EdgeTtsError('Edge TTS text is too long', 'not-sent')
      const controller = new AbortController()
      const externalAbort = () => controller.abort(input.signal?.reason)
      input.signal?.addEventListener('abort', externalAbort, { once: true })
      if (input.signal?.aborted) externalAbort()
      // A referenced timer remains live while command resolution/subprocess IO
      // is pending, including on the qualified Bun 1.3.14 runtime.
      const deadline = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs ?? 20_000)
      const signal = controller.signal
      let transmission: TextTransmission = 'not-sent'
      let dir: string | undefined
      try {
        signal.throwIfAborted()
        const command = await resolveCommandWithAbort(options.resolveCommand ?? resolveEdgeTtsCommand, signal)
        signal.throwIfAborted()
        dir = await mkdtemp(join(tmpdir(), 'rox-edge-tts-'))
        signal.throwIfAborted()
        const output = join(dir, 'speech.mp3')
        // Invocation may transmit text even if cancellation or failure follows.
        transmission = 'possible'
        input.onTextTransmission?.(transmission)
        await (options.run ?? runEdgeTts)({
          executable: command.executable,
          args: [...command.args, '--file', '-', '--voice', edgeTtsVoice(input), '--write-media', output],
        }, text, signal)
        signal.throwIfAborted()
        const info = await stat(output)
        if (!info.size || info.size > MAX_AUDIO_BYTES) throw new EdgeTtsError('Edge TTS returned invalid audio size', transmission)
        const audio = await readFile(output)
        signal.throwIfAborted()
        transmission = 'sent'
        input.onTextTransmission?.(transmission)
        return { engine: 'edge', uploaded: false, textSent: true, textTransmission: transmission, audioBase64: audio.toString('base64'), mimeType: 'audio/mpeg' }
      } catch (error) {
        if (error instanceof EdgeTtsError) throw error
        // Never expose arbitrary CLI/runner messages which may contain text.
        throw new EdgeTtsError(signal.aborted ? 'Edge TTS synthesis cancelled' : 'Edge TTS synthesis failed', transmission)
      } finally {
        clearTimeout(deadline)
        input.signal?.removeEventListener('abort', externalAbort)
        if (dir) await rm(dir, { recursive: true, force: true })
      }
    },
  }
}
