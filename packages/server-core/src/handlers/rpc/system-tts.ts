/**
 * System text-to-speech fallback for the message «Слушать» action.
 *
 * Used when online synthesis is unavailable. On macOS we speak
 * through the built-in `say` binary (text is piped via stdin, never passed as
 * argv). Elsewhere the caller reports `playback: 'renderer'` and the renderer
 * falls back to the Web Speech API.
 */
import { spawn as nodeSpawn } from 'node:child_process'

type SpawnLike = (command: string, args: string[], options: { stdio: ['pipe', 'ignore', 'ignore'] }) => {
  stdin: { end(chunk: string): void } | null
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'spawn' | 'exit' | 'error', listener: (arg: unknown) => void): unknown
}

export type SystemSpeakResult = { played: boolean }

export type SystemSpeaker = {
  /**
   * Starts speaking and resolves as soon as playback has started (so the RPC
   * call never outlives the request timeout). `played` is false when no system
   * engine is available.
   */
  speak(text: string): Promise<SystemSpeakResult>
  /** True while the last started utterance is still playing. */
  isSpeaking(): boolean
  stop(): boolean
}

export function createSystemSpeaker(options: {
  platform?: NodeJS.Platform
  spawn?: SpawnLike
} = {}): SystemSpeaker {
  const platform = options.platform ?? process.platform
  const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnLike)
  let current: ReturnType<SpawnLike> | null = null

  const stop = () => {
    if (!current) return false
    const proc = current
    current = null
    proc.kill('SIGTERM')
    return true
  }

  return {
    stop,
    isSpeaking: () => current !== null,
    speak(text) {
      if (platform !== 'darwin' || !text.trim()) return Promise.resolve({ played: false })
      stop()
      return new Promise<SystemSpeakResult>((resolve) => {
        let settled = false
        const settle = (played: boolean) => {
          if (settled) return
          settled = true
          resolve({ played })
        }
        let proc: ReturnType<SpawnLike>
        try {
          proc = spawn('say', [], { stdio: ['pipe', 'ignore', 'ignore'] })
        } catch {
          settle(false)
          return
        }
        current = proc
        proc.once('spawn', () => settle(true))
        proc.once('error', () => {
          if (current === proc) current = null
          settle(false)
        })
        proc.once('exit', () => {
          if (current === proc) current = null
          settle(true)
        })
        proc.stdin?.end(text)
      })
    },
  }
}
