import { describe, expect, it } from 'bun:test'
import { access, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
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
    const result = await speakWithPolicy(getDefaultVoicePrefs(), { text }, { edge, fish: edge })
    expect(result).toEqual({ engine: 'edge', uploaded: false, textSent: true, audioBase64: Buffer.from('fixture-mp3').toString('base64'), mimeType: 'audio/mpeg' })
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
      await expect(adapter.speak({ text: 'hello' })).rejects.toThrow(fail ? 'provider unavailable' : 'invalid audio size')
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
})
