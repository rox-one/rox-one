/**
 * Local Russian text-to-speech fallback for the message «Слушать» action.
 * Text is piped through stdin and never passed as a process argument. The
 * requested voice is explicit: if it is not installed, startup fails and the
 * caller can report that local fallback is unavailable rather than claiming
 * that speech was played.
 */
import { execFileSync, spawn as nodeSpawn } from 'node:child_process'

type SpawnLike = (command: string, args: string[], options: { stdio: ['pipe', 'ignore', 'ignore'] }) => {
  stdin: { end(chunk: string): void } | null
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'spawn' | 'exit' | 'error', listener: (arg: unknown) => void): unknown
}

export type SystemSpeakResult = { played: boolean; voice?: string }


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
  findRussianVoice?: () => string | null
} = {}): SystemSpeaker {
  const platform = options.platform ?? process.platform
  const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnLike)
  const findRussianVoice = options.findRussianVoice ?? (() => {
    try {
      const output = execFileSync('say', ['-v', '?'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      const voices = output.split('\n').flatMap((line) => {
        const match = line.match(/^(.+?)\s+ru_RU(?:\s|$)/)
        return match?.[1] ? [match[1].trim()] : []
      })
      return voices.find((voice) => voice.toLowerCase() === 'yuri') ?? voices[0] ?? null
    } catch {
      return null
    }
  })
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
      const voice = findRussianVoice()
      if (!voice) return Promise.resolve({ played: false })
      stop()
      return new Promise<SystemSpeakResult>((resolve) => {
        let settled = false
        const settle = (played: boolean) => {
          if (settled) return
          settled = true
          resolve(played ? { played: true, voice } : { played: false })
        }
        let proc: ReturnType<SpawnLike>
        try {
          proc = spawn('say', ['-v', voice], { stdio: ['pipe', 'ignore', 'ignore'] })
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
