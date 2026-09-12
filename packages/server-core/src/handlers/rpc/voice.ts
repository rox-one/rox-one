/**
 * Voice RPC — dictation / playback prefs, local-or-cloud STT, TTS playback.
 *
 * Audio stays local unless the user selected a cloud STT engine.
 */

import { arch } from 'node:os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  VoicePrivacyError,
  assertEditableTranscript,
  buildVoiceHealth,
  getDefaultVoicePrefs,
  loadVoicePrefs,
  saveVoicePrefs,
  speakWithPolicy,
  transcribeWithPolicy,
  type SpeakAdapter,
  type TranscribeAdapter,
  type TranscribeInput,
  type VoicePrefs,
} from '@craft-agent/shared/voice'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.voice.GET,
  RPC_CHANNELS.voice.SAVE,
  RPC_CHANNELS.voice.HEALTH,
  RPC_CHANNELS.voice.TRANSCRIBE,
  RPC_CHANNELS.voice.SPEAK,
] as const

function appleSilicon(): boolean {
  return process.platform === 'darwin' && (arch() === 'arm64' || process.arch === 'arm64')
}

function decodeAudio(audioBase64: unknown): Uint8Array {
  if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
    throw new Error('audioBase64 is required')
  }
  return Uint8Array.from(Buffer.from(audioBase64, 'base64'))
}

function localFixtureAdapter(): TranscribeAdapter {
  return {
    engine: 'local-whisper',
    async transcribe() {
      return { text: '', engine: 'local-whisper', uploaded: false }
    },
  }
}

function cloudDeniedAdapter(): TranscribeAdapter {
  return {
    engine: 'cloud-rox',
    async transcribe() {
      throw new VoicePrivacyError('cloud-stt-offline', 'Cloud STT adapter is not configured')
    },
  }
}

function edgeSpeakAdapter(): SpeakAdapter {
  return {
    engine: 'edge',
    async speak() {
      return { engine: 'edge', uploaded: false }
    },
  }
}

function fishSpeakAdapter(): SpeakAdapter {
  return {
    engine: 'fish-speech',
    async speak() {
      return { engine: 'fish-speech', uploaded: false }
    },
  }
}

function broadcast(server: RpcServer, prefs: VoicePrefs): void {
  pushTyped(server, RPC_CHANNELS.voice.CHANGED, { to: 'all' }, prefs)
}

export function registerVoiceHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.voice.GET, async () => loadVoicePrefs())

  server.handle(RPC_CHANNELS.voice.SAVE, async (_ctx, patch: unknown) => {
    const current = loadVoicePrefs()
    const next = saveVoicePrefs({
      ...current,
      ...(patch && typeof patch === 'object' ? patch : {}),
      version: 1,
    } as VoicePrefs)
    broadcast(server, next)
    return next
  })

  server.handle(RPC_CHANNELS.voice.HEALTH, async () => {
    return buildVoiceHealth(loadVoicePrefs(), {
      appleSilicon: appleSilicon(),
      offline: false,
    })
  })

  server.handle(RPC_CHANNELS.voice.TRANSCRIBE, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const prefs = loadVoicePrefs()
    const input: TranscribeInput = {
      audio: decodeAudio(body.audioBase64),
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm',
      language: typeof body.language === 'string' ? body.language : undefined,
    }
    try {
      const result = await transcribeWithPolicy(prefs, input, {
        local: localFixtureAdapter(),
        cloud: cloudDeniedAdapter(),
      })
      if (typeof body.transcript === 'string') {
        return { ...result, text: assertEditableTranscript(body.transcript) }
      }
      return result
    } catch (error) {
      if (error instanceof VoicePrivacyError) {
        throw new Error(error.message)
      }
      throw error
    }
  })

  server.handle(RPC_CHANNELS.voice.SPEAK, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const text = assertEditableTranscript(typeof body.text === 'string' ? body.text : '')
    return speakWithPolicy(loadVoicePrefs(), { text }, {
      edge: edgeSpeakAdapter(),
      fish: fishSpeakAdapter(),
    })
  })
}

export function getDefaultVoiceDto(): VoicePrefs {
  return getDefaultVoicePrefs()
}
