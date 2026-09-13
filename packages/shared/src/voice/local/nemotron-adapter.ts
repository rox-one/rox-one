import { fixtureTranscript, LocalModelError, type LocalAsrAdapter, type LocalAsrInput } from './adapter.ts'
import type { ModelManifest } from '../models/manifest-schema.ts'

export interface PartialEvent { text: string; isFinal: boolean }

export class NemotronStreamingAdapter implements LocalAsrAdapter {
  readonly family = 'nemotron-3.5-asr-streaming-0.6b'
  private loaded: ModelManifest | null = null
  readonly partials: PartialEvent[] = []

  constructor(private readonly options: { fixtures?: boolean } = {}) {}

  async load(manifest: ModelManifest): Promise<void> {
    if (manifest.family !== this.family) throw new LocalModelError('unsupported', 'Wrong family')
    if (!manifest.streamingCapabilities.streaming || !manifest.streamingCapabilities.partials) {
      throw new LocalModelError('unsupported', 'Nemotron artifact is not a streaming partials build')
    }
    if (!this.options.fixtures) throw new LocalModelError('not-ready', 'Nemotron weights are not installed')
    this.loaded = manifest
  }

  async transcribe(input: LocalAsrInput): Promise<ReturnType<typeof fixtureTranscript>> {
    if (!this.loaded) throw new LocalModelError('not-ready', 'Nemotron adapter is not loaded')
    if (!this.options.fixtures) throw new LocalModelError('not-ready', 'Nemotron inference requires installed weights')
    this.partials.push({ text: 'dic', isFinal: false }, { text: 'dictation check', isFinal: true })
    return fixtureTranscript(this.loaded.modelId, input.language ?? 'en', 'fixture-nemotron')
  }

  async unload(): Promise<void> {
    this.loaded = null
    this.partials.length = 0
  }
}
