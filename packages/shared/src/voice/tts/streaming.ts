/**
 * Chunked, cancellable TTS streaming.
 *
 * Streaming here means delivering one synthesized buffer as an ordered sequence
 * of bounded chunks (the edge/system adapters synthesize a whole utterance), so
 * the client can start playback early and abort mid-stream. Every chunk carries a
 * monotonic `seq`; the last chunk is marked `final`. A cancelled stream stops
 * iterating and releases the underlying synthesis source.
 *
 * Provenance: OpenClaw `src/tts/tts-streaming.ts` (clean-room re-expression; ledger d1.4).
 */

import type { SpeechSynthesisResult } from '../provider-registry.ts'

export const DEFAULT_TTS_CHUNK_BYTES = 8 * 1024

export interface TtsStreamChunk {
  streamId: string
  seq: number
  audioBase64: string
  mimeType: string
  final: boolean
}

export function sliceAudioChunks(buffer: Uint8Array, chunkSize = DEFAULT_TTS_CHUNK_BYTES): Uint8Array[] {
  if (chunkSize <= 0) throw new Error('TTS chunk size must be positive')
  if (!buffer.byteLength) return []
  const slices: Uint8Array[] = []
  for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
    slices.push(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.byteLength)))
  }
  return slices
}

export async function* iterateTtsChunks(options: {
  streamId: string
  buffer: Uint8Array
  mimeType: string
  chunkSize?: number
  signal?: AbortSignal
}): AsyncGenerator<TtsStreamChunk> {
  const slices = sliceAudioChunks(options.buffer, options.chunkSize ?? DEFAULT_TTS_CHUNK_BYTES)
  for (let index = 0; index < slices.length; index += 1) {
    if (options.signal?.aborted) return
    yield {
      streamId: options.streamId,
      seq: index + 1,
      audioBase64: Buffer.from(slices[index]!).toString('base64'),
      mimeType: options.mimeType,
      final: index === slices.length - 1,
    }
  }
}

export interface TtsStream {
  [Symbol.asyncIterator](): AsyncIterator<TtsStreamChunk>
  cancel(reason?: string): void
  readonly cancelled: boolean
}

/**
 * Lazy orchestration: synthesis starts on the first iteration, chunks stream out,
 * and `cancel` aborts both the synthesis signal and any in-flight delivery.
 */
export function createTtsStream(options: {
  streamId: string
  synthesize: (signal: AbortSignal) => Promise<SpeechSynthesisResult>
  chunkSize?: number
  mimeType?: string
}): TtsStream {
  const controller = new AbortController()
  let pending: Promise<SpeechSynthesisResult> | null = null

  async function* iterate(): AsyncGenerator<TtsStreamChunk> {
    if (controller.signal.aborted) return
    const task = pending ??= options.synthesize(controller.signal)
    const result = await task
    yield* iterateTtsChunks({
      streamId: options.streamId,
      buffer: result.audioBuffer,
      mimeType: options.mimeType ?? `audio/${result.fileExtension}`,
      chunkSize: options.chunkSize,
      signal: controller.signal,
    })
  }

  return {
    [Symbol.asyncIterator]: iterate,
    cancel(reason) {
      if (controller.signal.aborted) return
      controller.abort(reason)
    },
    get cancelled() { return controller.signal.aborted },
  }
}