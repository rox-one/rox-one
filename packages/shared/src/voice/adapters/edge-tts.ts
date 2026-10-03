/** Microsoft Edge online TTS through the edge-tts CLI. No shell or text argv. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfigDir } from '../../config/paths.ts'
import { createResolver, toolchainPaths } from '../../toolchain/index.ts'
import type { SpeakAdapter, SpeakInput } from '../types.ts'

export const EDGE_TTS_VERSION = '7.2.8'
const MAX_TEXT_LENGTH = 20_000
const MAX_AUDIO_BYTES = 16 * 1024 * 1024

export type EdgeTtsCommand = { executable: string; args: string[] }
export type EdgeTtsRunner = (command: EdgeTtsCommand, text: string, signal: AbortSignal) => Promise<void>

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

const runEdgeTts: EdgeTtsRunner = (command, text, signal) => new Promise((resolve, reject) => {
  const child = spawn(command.executable, command.args, {
    shell: false,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    signal,
  })
  // Do not include stderr in errors: providers may echo submitted text.
  let processError: Error | null = null
  child.once('error', (error) => { processError = error })
  // Wait for close even on abort so the writer exits before removing its directory.
  child.once('close', (code) => {
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
      if (!text) throw new Error('Edge TTS text is empty')
      if (text.length > MAX_TEXT_LENGTH) throw new Error('Edge TTS text is too long')
      const signal = input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(options.timeoutMs ?? 20_000)])
        : AbortSignal.timeout(options.timeoutMs ?? 20_000)
      signal.throwIfAborted()
      const command = await (options.resolveCommand ?? resolveEdgeTtsCommand)()
      signal.throwIfAborted()
      const dir = await mkdtemp(join(tmpdir(), 'rox-edge-tts-'))
      try {
        const output = join(dir, 'speech.mp3')
        await (options.run ?? runEdgeTts)({
          executable: command.executable,
          args: [...command.args, '--file', '-', '--voice', edgeTtsVoice(input), '--write-media', output],
        }, text, signal)
        signal.throwIfAborted()
        const info = await stat(output)
        if (!info.size || info.size > MAX_AUDIO_BYTES) throw new Error('Edge TTS returned invalid audio size')
        const audio = await readFile(output)
        signal.throwIfAborted()
        return { engine: 'edge', uploaded: false, textSent: true, audioBase64: audio.toString('base64'), mimeType: 'audio/mpeg' }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}
