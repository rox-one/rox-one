import { describe, expect, it } from 'bun:test'
import { createSystemSpeaker } from '../system-tts'

function fakeSpawn() {
  const calls: Array<{ command: string; args: string[]; stdin: string[]; killed: boolean; listeners: Record<string, (arg: unknown) => void> }> = []
  const spawn = (command: string, args: string[]) => {
    const call = { command, args, stdin: [] as string[], killed: false, listeners: {} as Record<string, (arg: unknown) => void> }
    calls.push(call)
    return {
      stdin: { end: (chunk: string) => { call.stdin.push(chunk) } },
      kill: () => { call.killed = true; call.listeners.exit?.(null); return true },
      once: (event: 'spawn' | 'exit' | 'error', listener: (arg: unknown) => void) => { call.listeners[event] = listener },
    }
  }
  return { calls, spawn }
}

describe('system TTS fallback', () => {
  it('speaks through macOS say with text on stdin (not argv)', async () => {
    const { calls, spawn } = fakeSpawn()
    const speaker = createSystemSpeaker({ platform: 'darwin', spawn, findRussianVoice: () => 'Yuri' })
    const pending = speaker.speak('Привет; rm -rf /')
    expect(calls[0]!.args).toEqual(['-v', 'Yuri'])
    expect(calls[0]!.stdin).toEqual(['Привет; rm -rf /'])
    calls[0]!.listeners.spawn?.(undefined)
    expect(await pending).toEqual({ played: true, voice: 'Yuri' })
    expect(speaker.isSpeaking()).toBe(true)
    calls[0]!.listeners.exit?.(0)
    expect(speaker.isSpeaking()).toBe(false)
  })

  it('stop() kills the running say process', async () => {
    const { calls, spawn } = fakeSpawn()
    const speaker = createSystemSpeaker({ platform: 'darwin', spawn, findRussianVoice: () => 'Yuri' })
    const pending = speaker.speak('long text')
    expect(speaker.stop()).toBe(true)
    expect(calls[0]!.killed).toBe(true)
    await pending
    expect(speaker.stop()).toBe(false)
  })

  it('reports played=false off macOS or when say is missing', async () => {
    const { calls, spawn } = fakeSpawn()
    expect(await createSystemSpeaker({ platform: 'linux', spawn }).speak('hi')).toEqual({ played: false })
    expect(calls).toHaveLength(0)
    const speaker = createSystemSpeaker({ platform: 'darwin', spawn, findRussianVoice: () => null })
    expect(await speaker.speak('hi')).toEqual({ played: false })
    expect(calls).toHaveLength(0)
  })
})
