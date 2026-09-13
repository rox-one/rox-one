import { fixtureTranscript, LocalModelError, type LocalAsrAdapter, type LocalAsrInput } from './adapter.ts'
import { variantMatches } from '../models/manifest-schema.ts'
import type { ModelManifest } from '../models/manifest-schema.ts'

export class WhisperLargeV3TurboAdapter implements LocalAsrAdapter {
  readonly family = 'whisper-large-v3-turbo'
  private loaded: ModelManifest | null = null

  constructor(private readonly options: { fixtures?: boolean } = {}) {}

  async load(manifest: ModelManifest): Promise<void> {
    if (manifest.family !== this.family) throw new LocalModelError('unsupported', 'Wrong family')
    if (!variantMatches(manifest)) throw new LocalModelError('wrong-variant', 'Whisper variant mismatch')
    if (!this.options.fixtures) throw new LocalModelError('not-ready', 'Whisper weights are not installed')
    this.loaded = manifest
  }

  async transcribe(input: LocalAsrInput): Promise<ReturnType<typeof fixtureTranscript>> {
    if (input.signal?.aborted) throw new LocalModelError('cancelled', 'Cancelled')
    if (!this.loaded) throw new LocalModelError('not-ready', 'Whisper adapter is not loaded')
    if (!this.options.fixtures) throw new LocalModelError('not-ready', 'Whisper inference requires installed weights')
    return fixtureTranscript(this.loaded.modelId, input.language, 'fixture-whisper')
  }

  async unload(): Promise<void> {
    this.loaded = null
  }
}
