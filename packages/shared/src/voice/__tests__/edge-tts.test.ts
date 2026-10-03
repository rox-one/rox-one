import { describe, expect, it } from 'bun:test'
import { access, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createEdgeSpeakAdapter, edgeTtsVoice } from '../adapters/edge-tts.ts'
import { getDefaultVoicePrefs } from '../types.ts'
import { speakWithPolicy } from '../transcribe.ts'

const command = async () => ({ executable: 'fixture-edge-tts', args: ['prefix'] })

describe('edge-tts synthesis', () => {
  it('selects Russian and English voices using the configured language or text', () => {
    expect(edgeTtsVoice({ text: 'Привет' })).toBe('ru-RU-SvetlanaNeural')
    expect(edgeTtsVoice({ text: 'Hello', language: 'ru' })).toBe('ru-RU-SvetlanaNeural')
    expect(edgeTtsVoice({ text: 'Привет', language: 'en' })).toBe('en-US-AriaNeural')
    expect(edgeTtsVoice({ text: 'Hello', language: 'auto' })).toBe('en-US-AriaNeural')
  })

  it('passes text through stdin, preserves audio through policy and removes temporary files', async () => {
    let directory = ''
    const text = 'Привет $(touch /tmp/should-not-exist); `echo secret`'
    const edge = createEdgeSpeakAdapter({
      resolveCommand: command,
      async run(cmd, stdin) {
        expect(stdin).toBe(text)
        expect(cmd.args).not.toContain(text)
        expect(cmd.args.slice(0, 5)).toEqual(['prefix', '--file', '-', '--voice', 'ru-RU-SvetlanaNeural'])
        const output = cmd.args.at(-1)!
        directory = dirname(output)
        await writeFile(output, Buffer.from('fixture-mp3'))
      },
    })
    const result = await speakWithPolicy({ ...getDefaultVoicePrefs(), ttsEngine: 'edge' }, { text }, { edge })
    expect(result).toEqual({ engine: 'edge', uploaded: false, textSent: true, textTransmission: 'sent', audioBase64: Buffer.from('fixture-mp3').toString('base64'), mimeType: 'audio/mpeg' })
    await expect(access(directory)).rejects.toThrow()
  })

  it('cleans up when synthesis fails and rejects empty output', async () => {
    for (const fail of [true, false]) {
      let directory = ''
      const adapter = createEdgeSpeakAdapter({
        resolveCommand: command,
        async run(cmd) {
          directory = dirname(cmd.args.at(-1)!)
          if (fail) throw new Error('provider unavailable')
          await writeFile(cmd.args.at(-1)!, '')
        },
      })
      await expect(adapter.speak({ text: 'hello' })).rejects.toThrow(fail ? 'synthesis failed' : 'invalid audio size')
      await expect(access(directory)).rejects.toThrow()
    }
  })

  it('rejects invalid text or an already cancelled request before launching a command', async () => {
    let resolved = 0
    const adapter = createEdgeSpeakAdapter({ resolveCommand: async () => { resolved++; return command() } })
    await expect(adapter.speak({ text: ' ' })).rejects.toThrow('empty')
    await expect(adapter.speak({ text: 'x'.repeat(20_001) })).rejects.toThrow('too long')
    await expect(adapter.speak({ text: 'hello', signal: AbortSignal.abort() })).rejects.toThrow()
    expect(resolved).toBe(0)
  })

  it('kills a stalled real subprocess on timeout', async () => {
    const started = Date.now()
    const adapter = createEdgeSpeakAdapter({
      resolveCommand: async () => ({ executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }),
      timeoutMs: 100,
    })
    await expect(adapter.speak({ text: 'hello' })).rejects.toThrow()
    expect(Date.now() - started).toBeGreaterThanOrEqual(80)
  })

  it('terminates a real subprocess that ignores SIGTERM before completing cleanup', async () => {
    const proof = await mkdtemp(join(tmpdir(), 'rox-edge-signal-proof-'))
    const receipt = join(proof, 'signal.txt')
    try {
      const script = `require('node:fs').writeFileSync(${JSON.stringify(receipt)}, 'ready'); process.on('SIGTERM', () => require('node:fs').writeFileSync(${JSON.stringify(receipt)}, 'ignored')); setInterval(() => {}, 1000)`
      const adapter = createEdgeSpeakAdapter({ resolveCommand: async () => ({ executable: process.execPath, args: ['-e', script] }), timeoutMs: 1500 })
      await expect(adapter.speak({ text: 'fixture' })).rejects.toMatchObject({ textTransmission: 'possible' })
      expect(await readFile(receipt, 'utf8')).toBe('ignored')
    } finally { await rm(proof, { recursive: true, force: true }) }
  })

  it('rejects oversized output after invocation and removes its temporary directory', async () => {
    let directory = ''
    const adapter = createEdgeSpeakAdapter({ resolveCommand: command, async run(cmd) {
      directory = dirname(cmd.args.at(-1)!)
      const file = await open(cmd.args.at(-1)!, 'w')
      try { await file.truncate(16 * 1024 * 1024 + 1) } finally { await file.close() }
    } })
    await expect(adapter.speak({ text: 'hello' })).rejects.toMatchObject({ textTransmission: 'possible' })
    await expect(access(directory)).rejects.toThrow()
  })

  it('cancellation while resolving does not invoke the CLI or claim transmission', async () => {
    let resolved!: (value: Awaited<ReturnType<typeof command>>) => void
    let calls = 0
    const controller = new AbortController()
    const adapter = createEdgeSpeakAdapter({ resolveCommand: () => new Promise(resolve => { resolved = resolve }),
      async run() { calls++ } })
    const pending = adapter.speak({ text: 'private', signal: controller.signal })
    controller.abort()
    resolved(await command())
    await expect(pending).rejects.toMatchObject({ textTransmission: 'not-sent' })
    expect(calls).toBe(0)
  })

  it('cancels a resolver that never completes without waiting for it or invoking the CLI', async () => {
    const controller = new AbortController()
    let calls = 0
    const adapter = createEdgeSpeakAdapter({ resolveCommand: () => new Promise(() => {}), async run() { calls++ } })
    const pending = adapter.speak({ text: 'private', signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ textTransmission: 'not-sent' })
    expect(calls).toBe(0)
  })

  it('cancellation after invocation retains possible transmission and waits for cleanup', async () => {
    let started!: () => void
    const running = new Promise<void>(resolve => { started = resolve })
    let directory = ''
    const controller = new AbortController()
    const adapter = createEdgeSpeakAdapter({ resolveCommand: command, run(cmd, _text, signal) {
      directory = dirname(cmd.args.at(-1)!)
      started()
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('private text')), { once: true }))
    } })
    const pending = adapter.speak({ text: 'private text', signal: controller.signal })
    await running
    controller.abort()
    await expect(pending).rejects.toMatchObject({ message: 'Edge TTS synthesis cancelled', textTransmission: 'possible' })
    await expect(access(directory)).rejects.toThrow()
  })

  it('enforces the 20,000-character boundary before resolving a command', async () => {
    let calls = 0
    const adapter = createEdgeSpeakAdapter({ resolveCommand: command, async run(cmd, text) {
      calls++
      expect(text.length).toBe(20_000)
      await writeFile(cmd.args.at(-1)!, 'fixture')
    } })
    await adapter.speak({ text: 'x'.repeat(20_000) })
    await expect(adapter.speak({ text: 'x'.repeat(20_001) })).rejects.toMatchObject({ textTransmission: 'not-sent' })
    expect(calls).toBe(1)
  })

  it('does not dispatch defaults or legacy Edge settings to a remote adapter', async () => {
    let calls = 0
    const edge = { engine: 'edge' as const, async speak() { calls++; return { engine: 'edge' as const, uploaded: false as const } } }
    for (const prefs of [getDefaultVoicePrefs(), { ...getDefaultVoicePrefs(), version: 2 as never, ttsEngine: 'edge' as const }]) {
      await expect(speakWithPolicy(prefs, { text: 'private' }, { edge })).rejects.toMatchObject({ code: 'consent-required' })
    }
    expect(calls).toBe(0)
  })
})
