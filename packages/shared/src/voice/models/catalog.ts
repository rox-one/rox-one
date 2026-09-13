import { expectedVariant, type LocalModelFamily, type ModelManifest } from './manifest-schema.ts'
export function catalogTemplate(family: LocalModelFamily, platform: ModelManifest['platform'], arch: ModelManifest['arch']): Omit<ModelManifest, 'signature' | 'files'> {
  if (family === 'whisper-large-v3-turbo') {
    return {
      modelId: 'whisper-large-v3-turbo', displayName: 'Whisper Large v3 Turbo', family, sourceRepo: 'openai/whisper-large-v3-turbo',
      sourceRevision: 'pinned-pending-build', variant: expectedVariant(family), license: 'MIT', notice: 'openai/whisper-large-v3-turbo',
      runtimeId: 'whisper.cpp', runtimeVersion: 'unverified', platform, arch,
      accelerator: platform === 'darwin' && arch === 'arm64' ? 'metal' : 'cpu',
      preprocessing: { sampleRate: 16000, channels: 1, featureConfig: 'whisper-mel' }, tokenizer: { format: 'whisper' },
      streamingCapabilities: { streaming: false, partials: false }, languages: [], timestamps: 'segment', minAppVersion: '0.0.0',
      compatibilityTests: ['whisper-smoke'], signingKeyId: 'rox-voice-models',
    }
  }
  if (family === 'nemotron-3.5-asr-streaming-0.6b') {
    return {
      modelId: 'nemotron-3.5-asr-streaming-0.6b', displayName: 'NVIDIA Nemotron 3.5 ASR Streaming 0.6B', family,
      sourceRepo: 'nvidia/nemotron-3.5-asr-streaming-0.6b', sourceRevision: 'pinned-pending-build', variant: expectedVariant(family),
      license: 'NVIDIA', notice: 'nvidia/nemotron-3.5-asr-streaming-0.6b', runtimeId: 'nemotron-worker', runtimeVersion: 'unverified',
      platform, arch, accelerator: 'cpu', preprocessing: { sampleRate: 16000, channels: 1, featureConfig: 'nemotron-fastconformer' },
      tokenizer: { format: 'nemotron', blankId: 0 }, streamingCapabilities: { streaming: true, partials: true }, languages: ['en', 'ru'],
      timestamps: 'segment', minAppVersion: '0.0.0', compatibilityTests: ['nemotron-smoke'], signingKeyId: 'rox-voice-models',
    }
  }
  return {
    modelId: 'gigaam-v3-e2e-rnnt', displayName: 'GigaAM v3 E2E RNN-T', family, sourceRepo: 'ai-sage/GigaAM-v3',
    sourceRevision: 'pinned-pending-build', variant: 'e2e_rnnt', license: 'MIT', notice: 'ai-sage/GigaAM-v3',
    runtimeId: 'gigaam-onnx', runtimeVersion: 'unverified', platform, arch, accelerator: 'cpu',
    preprocessing: { sampleRate: 16000, channels: 1, featureConfig: 'gigaam-mel' }, tokenizer: { format: 'gigaam', blankId: 0 },
    streamingCapabilities: { streaming: false, partials: false }, languages: ['ru'], timestamps: 'none', minAppVersion: '0.0.0',
    compatibilityTests: ['gigaam-smoke'], signingKeyId: 'rox-voice-models',
  }
}
