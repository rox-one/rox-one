import { describe, expect, it } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { PodcastPipelineError } from '@rox/shared/voice'
import {
  createKokoroSegmentSynthesizer,
  defaultVoiceForRole,
  probePodcastEngines,
  type KokoroCommand,
  type KokoroSpawn,
} from '../tts.ts'

interface FakeCall {
  command: string
  args: string[]
  stdin: string[]
  killed: boolean
  listeners: Record<string, (arg: unknown) => void>
}

/** Fake `kokoro-tts` seam: writes the output file (unless suppressed) and closes on demand. */
function fakeSpawn(behavior: { write?: string | false; exit?: number; manual?: boolean } = {}) {
  const calls: FakeCall[] = []
  const spawn: KokoroSpawn = (command, args) => {
    const call: FakeCall = { command, args: [...args], stdin: [], killed: false, listeners: {} }
    calls.push(call)
    const close = (code: number | null) => call.listeners.close?.(code)
    return {
      stdin: {
        end: (chunk: string) => {
          call.stdin.push(chunk)
          const output = call.args[1]!
          if (behavior.write !== false) writeFileSync(output, Buffer.from(behavior.write ?? 'wav-bytes'))
          if (call.killed) return
          if (!behavior.manual) close(behavior.exit ?? 0)
        },
      },
      // Killing a manual child settles it so cleanup can proceed, mirroring a real SIGTERM.
      kill: () => { call.killed = true; close(null); return true },
      once: (event, listener) => { call.listeners[event] = listener },
    }
  }
  return { calls, spawn }
}

const command = async (): Promise<KokoroCommand> => ({ executable: 'kokoro-tts-fixture', args: [] })
const codeOf = (error: unknown) => (error instanceof PodcastPipelineError ? error.code : undefined)

describe('podcast kokoro synthesis', () => {
  it('pipes the text through stdin and passes --voice/--lang/--format in argv', async () => {
    const { calls, spawn } = fakeSpawn()
    const synthesizer = createKokoroSegmentSynthesizer({ platform: 'darwin', spawn, resolveCommand: command })
    const signal = new AbortController().signal
    const audio = await synthesizer.synthesize({ role: 'host', text: 'Hello $(touch /tmp/nope)', signal })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.command).toBe('kokoro-tts-fixture')
    expect(calls[0]!.args).toEqual(['/dev/stdin', calls[0]!.args[1], '--voice', 'af_heart', '--lang', 'en', '--format', 'wav'])
    expect(calls[0]!.args).not.toContain('Hello $(touch /tmp/nope)')
    expect(calls[0]!.stdin).toEqual(['Hello $(touch /tmp/nope)'])
    expect(audio).toEqual({ bytes: new Uint8Array(Buffer.from('wav-bytes')), extension: 'wav', mimeType: 'audio/wav' })
    // The temporary directory is removed on every exit path.
    expect(existsSync(dirname(calls[0]!.args[1]!))).toBe(false)
  })

  it('picks the fixed registry voice per role', () => {
    expect(defaultVoiceForRole('kokoro', 'host').id).toBe('af_heart')
    expect(defaultVoiceForRole('kokoro', 'expert').id).toBe('am_adam')
  })

  it('maps a missing binary (spawn ENOENT) to tts-unavailable', async () => {
    const spawn: KokoroSpawn = () => { throw Object.assign(new Error('spawn kokoro-tts ENOENT'), { code: 'ENOENT' }) }
    const synthesizer = createKokoroSegmentSynthesizer({ platform: 'darwin', spawn, resolveCommand: command })
    const error = await synthesizer.synthesize({ role: 'host', text: 'hello', signal: new AbortController().signal }).catch(caught => caught)
    expect(codeOf(error)).toBe('tts-unavailable')
  })

  it('maps a non-zero exit to tts-failed and removes the temp directory', async () => {
    const { calls, spawn } = fakeSpawn({ exit: 3 })
    const synthesizer = createKokoroSegmentSynthesizer({ platform: 'linux', spawn, resolveCommand: command })
    const error = await synthesizer.synthesize({ role: 'expert', text: 'hello', signal: new AbortController().signal }).catch(caught => caught)
    expect(codeOf(error)).toBe('tts-failed')
    expect(existsSync(dirname(calls[0]!.args[1]!))).toBe(false)
  })

  it('rejects an empty output file as tts-failed', async () => {
    const { spawn } = fakeSpawn({ write: '' })
    const synthesizer = createKokoroSegmentSynthesizer({ platform: 'darwin', spawn, resolveCommand: command })
    const error = await synthesizer.synthesize({ role: 'host', text: 'hello', signal: new AbortController().signal }).catch(caught => caught)
    expect(codeOf(error)).toBe('tts-failed')
  })

  it('sends SIGTERM and reports cancelled when the signal aborts', async () => {
    const controller = new AbortController()
    const { calls, spawn } = fakeSpawn({ manual: true })
    const synthesizer = createKokoroSegmentSynthesizer({
      platform: 'darwin', spawn,
      // Abort during resolution so the kill happens on the very first child.
      resolveCommand: async () => { controller.abort(); return { executable: 'kokoro-tts-fixture', args: [] } },
    })
    const error = await synthesizer.synthesize({ role: 'host', text: 'hello', signal: controller.signal }).catch(caught => caught)
    expect(calls[0]!.killed).toBe(true)
    expect(codeOf(error)).toBe('cancelled')
  })

  it('is unavailable on Windows regardless of the CLI (O5 gate)', async () => {
    const { calls, spawn } = fakeSpawn()
    const synthesizer = createKokoroSegmentSynthesizer({ platform: 'win32', spawn, resolveCommand: command })
    const error = await synthesizer.synthesize({ role: 'host', text: 'hello', signal: new AbortController().signal }).catch(caught => caught)
    expect(codeOf(error)).toBe('tts-unavailable')
    expect(calls).toHaveLength(0)
  })
})

describe('podcast engine availability probe', () => {
  it('reports system/edge availability and a missing kokoro CLI', async () => {
    const result = await probePodcastEngines({
      platform: 'darwin', env: {},
      findExecutable: async name => (name === 'edge-tts' ? '/usr/local/bin/edge-tts' : null),
    })
    expect(result.system).toEqual({ available: true })
    expect(result.edge).toEqual({ available: true })
    expect(result.kokoro).toEqual({ available: false, reason: 'missing' })
  })

  it('hard-gates kokoro off Windows and off macOS for the system engine', async () => {
    const result = await probePodcastEngines({ platform: 'win32', env: {}, findExecutable: async () => '/usr/bin/kokoro-tts' })
    expect(result.system).toEqual({ available: false, reason: 'platform' })
    expect(result.kokoro).toEqual({ available: false, reason: 'platform' })
  })

  it('detects kokoro on macOS/Linux through env override or the resolver', async () => {
    const viaEnv = await probePodcastEngines({ platform: 'linux', env: { CRAFT_KOKORO: '/opt/kokoro-tts' }, findExecutable: async () => null })
    expect(viaEnv.kokoro).toEqual({ available: true })
    expect(viaEnv.edge).toEqual({ available: false, reason: 'missing' })
    const viaPath = await probePodcastEngines({ platform: 'darwin', env: {}, findExecutable: async name => (name === 'kokoro-tts' ? '/usr/local/bin/kokoro-tts' : null) })
    expect(viaPath.kokoro).toEqual({ available: true })
  })
})