import { validateAudioLimits, secondsToMs, AudioValidationError, type NormalizedTranscript, type TranscriptSegment, type TranscriptWord } from './audio-result.ts'
import { RoxTranscriptionError, type TranscriptionRequest, type TranscriptionHttp } from './rox-transcription.ts'
import { DEEPGRAM_TRANSCRIPTION_MODEL, DEEPGRAM_TRANSCRIPTION_NAME } from '../contracts.ts'

export { DEEPGRAM_TRANSCRIPTION_MODEL, DEEPGRAM_TRANSCRIPTION_NAME }

/** Only released general batch models qualify, never Flux/medical/streaming-only models. */
export function latestNovaModel(raw: unknown): string {
  const models = asObject(raw).stt
  if (!Array.isArray(models)) return DEEPGRAM_TRANSCRIPTION_MODEL
  const families = models.flatMap((rawModel) => {
    const model = asObject(rawModel)
    if (model.retired === true || model.batch !== true) return []
    const name = typeof model.canonical_name === 'string' ? model.canonical_name : model.name
    const match = typeof name === 'string' ? /^nova-(\d+)(?:-general)?$/.exec(name) : null
    return match && Number(match[1]) >= 3 ? [Number(match[1])] : []
  })
  return families.length ? `nova-${families.reduce((latest, family) => Math.max(latest, family), 3)}` : DEEPGRAM_TRANSCRIPTION_MODEL
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function speakerLabel(speaker: unknown): string | undefined {
  return typeof speaker === 'number' && Number.isSafeInteger(speaker) && speaker >= 0 ? `speaker-${speaker + 1}` : undefined
}

function timedText(raw: unknown, textKey: string): TranscriptSegment | undefined {
  const item = asObject(raw)
  const text = typeof item[textKey] === 'string' ? item[textKey].trim() : ''
  if (!text) return undefined
  if (typeof item.start !== 'number' || typeof item.end !== 'number' || !Number.isFinite(item.start) || !Number.isFinite(item.end)
    || item.start < 0 || item.end < item.start) throw new AudioValidationError('damaged', 'Invalid Deepgram timestamps')
  const startMs = secondsToMs(item.start)
  const endMs = secondsToMs(item.end)
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) throw new AudioValidationError('damaged', 'Invalid Deepgram timestamps')
  return { startMs, endMs, text, speakerId: speakerLabel(item.speaker) }
}

function validateTimeline(items: Array<TranscriptSegment | TranscriptWord>, durationMs: number): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if ((i > 0 && item.startMs < items[i - 1]!.startMs) || (durationMs > 0 && item.endMs > durationMs + 50)) {
      throw new AudioValidationError('damaged', 'Invalid Deepgram timeline')
    }
  }
}

export function normalizeDeepgramTranscript(raw: unknown, requestedModelId = DEEPGRAM_TRANSCRIPTION_MODEL): NormalizedTranscript {
  const payload = asObject(raw)
  const metadata = asObject(payload.metadata)
  const results = asObject(payload.results)
  const channel = asObject(Array.isArray(results.channels) ? results.channels[0] : undefined)
  const alternative = asObject(Array.isArray(channel.alternatives) ? channel.alternatives[0] : undefined)
  if (typeof alternative.transcript !== 'string') throw new AudioValidationError('damaged', 'Missing Deepgram transcript')
  const duration = metadata.duration
  if (duration !== undefined && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)) {
    throw new AudioValidationError('damaged', 'Invalid Deepgram duration')
  }
  const durationMs = secondsToMs(typeof duration === 'number' ? duration : 0)
  if (!Number.isSafeInteger(durationMs)) throw new AudioValidationError('damaged', 'Invalid Deepgram duration')
  const rawParagraphs = asObject(alternative.paragraphs).paragraphs
  let segments: TranscriptSegment[] = Array.isArray(rawParagraphs) ? rawParagraphs.flatMap((rawParagraph) => {
    const paragraph = asObject(rawParagraph)
    const sentences = Array.isArray(paragraph.sentences) ? paragraph.sentences.flatMap((sentence) => {
      const normalized = timedText(sentence, 'text')
      return normalized ? [normalized] : []
    }) : []
    if (!sentences.length) return []
    validateTimeline(sentences, durationMs)
    return [{ startMs: sentences[0]!.startMs, endMs: sentences.at(-1)!.endMs,
      text: sentences.map((sentence) => sentence.text).join(' '), speakerId: speakerLabel(paragraph.speaker) }]
  }) : []
  if (!segments.length && Array.isArray(results.utterances)) {
    segments = results.utterances.flatMap((utterance) => {
      const normalized = timedText(utterance, 'transcript')
      return normalized ? [normalized] : []
    })
  }
  const words: TranscriptWord[] | undefined = Array.isArray(alternative.words) ? alternative.words.flatMap((rawWord) => {
    const word = asObject(rawWord)
    const normalized = timedText({ ...word, text: word.punctuated_word ?? word.word }, 'text')
    return normalized ? [normalized] : []
  }) : undefined
  // Some provider responses have no paragraph speaker field; infer it from timed words.
  for (const segment of segments) {
    segment.speakerId ??= words?.find((word) => word.startMs >= segment.startMs && word.startMs < segment.endMs)?.speakerId
  }
  if (!segments.length && alternative.transcript.trim()) segments = [{ startMs: 0, endMs: durationMs, text: alternative.transcript.trim() }]
  validateTimeline(segments, durationMs)
  if (words) validateTimeline(words, durationMs)
  const modelInfo = asObject(Object.values(asObject(metadata.model_info))[0])
  const diarization = asObject(metadata.diarize_info)
  return {
    text: segments.map((segment) => segment.text).join('\n\n'), segments, words: words?.length ? words : undefined,
    detectedLanguage: typeof channel.detected_language === 'string' ? channel.detected_language : undefined,
    durationMs, requestedModelId,
    resolvedModelId: typeof modelInfo.arch === 'string' ? modelInfo.arch : typeof modelInfo.name === 'string' ? modelInfo.name : requestedModelId,
    modelRevision: typeof modelInfo.version === 'string' ? modelInfo.version : undefined,
    diarizationModel: typeof diarization.arch === 'string' ? diarization.arch : undefined,
    requestId: typeof metadata.request_id === 'string' ? metadata.request_id : 'deepgram',
    noSpeech: !alternative.transcript.trim(),
  }
}

/** Backend/main process only: the shared key never enters a renderer or source configuration. */
export class DeepgramTranscriptionAdapter {
  constructor(private readonly options: { apiKey: string; model?: string; http?: TranscriptionHttp; timeoutMs?: number }) {}

  async transcribe(input: TranscriptionRequest): Promise<NormalizedTranscript> {
    if (!this.options.apiKey.trim()) throw new RoxTranscriptionError('unauthorized', 'Deepgram is not configured')
    if (input.signal?.aborted) throw new RoxTranscriptionError('cancelled', 'Transcription cancelled')
    const mime = validateAudioLimits(input.audio, { maxBytes: 200 * 1024 * 1024, allowedMime: ['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/flac', 'audio/x-m4a', 'audio/aac'] }, input.mimeType?.split(';')[0])
    const request = this.options.http?.fetch ?? fetch
    let model = this.options.model?.trim()
    if (!model) {
      try {
        const catalog = await request('https://api.deepgram.com/v1/models', {
          headers: { Authorization: `Token ${this.options.apiKey}` },
          signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
        })
        model = catalog.ok ? latestNovaModel(await catalog.json()) : DEEPGRAM_TRANSCRIPTION_MODEL
      } catch { model = DEEPGRAM_TRANSCRIPTION_MODEL }
    }
    if (input.signal?.aborted) throw new RoxTranscriptionError('cancelled', 'Transcription cancelled')
    const url = new URL('https://api.deepgram.com/v1/listen')
    for (const [key, value] of Object.entries({ model, version: 'latest', smart_format: 'true', punctuate: 'true',
      diarize_model: 'latest', paragraphs: 'true', utterances: 'true' })) url.searchParams.set(key, value)
    if (input.language && input.language !== 'auto') url.searchParams.set('language', input.language)
    else url.searchParams.set('detect_language', 'true')
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 180_000)
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
    let response: Response
    try {
      response = await request(url.toString(), {
        method: 'POST', headers: { Authorization: `Token ${this.options.apiKey}`, 'Content-Type': mime },
        body: new Blob([new Uint8Array(input.audio)], { type: mime }), signal,
      })
    } catch {
      if (input.signal?.aborted) throw new RoxTranscriptionError('cancelled', 'Transcription cancelled')
      if (timeout.aborted) throw new RoxTranscriptionError('timeout', 'Deepgram request timed out')
      throw new RoxTranscriptionError('upstream', 'Deepgram could not be reached')
    }
    if (!response.ok) {
      const code = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 413 ? 'too-large' : response.status === 429 ? 'rate-limited' : 'upstream'
      // Provider errors can contain credentials or audio details; expose only the status.
      throw new RoxTranscriptionError(code, `Deepgram transcription failed (${response.status})`, { status: response.status })
    }
    if (input.signal?.aborted) throw new RoxTranscriptionError('cancelled', 'Transcription cancelled')
    let payload: unknown
    try { payload = await response.json() } catch {
      if (input.signal?.aborted) throw new RoxTranscriptionError('cancelled', 'Transcription cancelled')
      if (timeout.aborted) throw new RoxTranscriptionError('timeout', 'Deepgram request timed out')
      throw new AudioValidationError('damaged', 'Invalid Deepgram response')
    }
    if (input.signal?.aborted) throw new RoxTranscriptionError('cancelled', 'Transcription cancelled')
    return normalizeDeepgramTranscript(payload, model)
  }
}
