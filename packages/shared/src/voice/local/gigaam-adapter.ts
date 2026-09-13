import { fixtureTranscript, LocalModelError, type LocalAsrAdapter, type LocalAsrInput } from './adapter.ts'
import { variantMatches } from '../models/manifest-schema.ts'
import type { ModelManifest } from '../models/manifest-schema.ts'

export class GigaamE2eRnntAdapter implements LocalAsrAdapter {
  readonly family = 'gigaam-v3-e2e-rnnt'
  private loaded: ModelManifest | null = null

  constructor(private readonly options: { fixtures?: boolean } = {}) {}

  async load(manifest: ModelManifest): Promise<void> {
    if (manifest.family !== this.family) throw new LocalModelError('unsupported', 'Wrong family')
    if (!variantMatches(manifest) || manifest.variant !== 'e2e_rnnt') {
      throw new LocalModelError('wrong-variant', 'GigaAM must be e2e_rnnt')
    }
    if (manifest.streamingCapabilities.streaming) {
      throw new LocalModelError('unsupported', 'GigaAM streaming is not certified')
    }
    if (!this.options.fixtures) throw new LocalModelError('not-ready', 'GigaAM weights are not installed')
    this.loaded = manifest
  }

  async transcribe(input: LocalAsrInput): Promise<ReturnType<typeof fixtureTranscript>> {
    if (!this.loaded) throw new LocalModelError('not-ready', 'GigaAM adapter is not loaded')
    if (input.language && input.language !== 'ru' && input.language !== 'auto') {
      throw new LocalModelError('language', 'GigaAM e2e_rnnt is Russian-only')
    }
    if (!this.options.fixtures) throw new LocalModelError('not-ready', 'GigaAM inference requires installed weights')
    return fixtureTranscript(this.loaded.modelId, 'ru', 'fixture-gigaam')
  }

  async unload(): Promise<void> {
    this.loaded = null
  }
}
