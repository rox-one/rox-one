export const LOCAL_MODEL_FAMILIES = ['whisper-large-v3-turbo', 'nemotron-3.5-asr-streaming-0.6b', 'gigaam-v3-e2e-rnnt'] as const
export type LocalModelFamily = (typeof LOCAL_MODEL_FAMILIES)[number]
export type ModelFileRole = 'weights' | 'tokenizer' | 'config' | 'notice' | 'runtime'
export interface ModelFile { path: string; url: string; bytes: number; sha256: string; role: ModelFileRole }
export interface ModelManifest {
  modelId: string; displayName: string; family: LocalModelFamily; sourceRepo: string; sourceRevision: string
  variant: string; license: string; notice: string; runtimeId: string; runtimeVersion: string
  platform: 'darwin' | 'win32' | 'linux'; arch: 'arm64' | 'x64'; accelerator: 'cpu' | 'metal' | 'cuda' | 'auto'
  quantization?: string; files: ModelFile[]; preprocessing: { sampleRate: number; channels: number; featureConfig: string }
  tokenizer: { format: string; blankId?: number }; streamingCapabilities: { streaming: boolean; partials: boolean }
  languages: string[]; timestamps: 'none' | 'segment' | 'word'; minAppVersion: string; compatibilityTests: string[]
  signingKeyId: string; signature: string
}
export type ModelLifecycle = 'not-installed' | 'downloading' | 'verifying' | 'installed' | 'loading' | 'smoke-testing' | 'ready' | 'failed' | 'unsupported'
export function isLocalModelFamily(value: unknown): value is LocalModelFamily {
  return typeof value === 'string' && (LOCAL_MODEL_FAMILIES as readonly string[]).includes(value)
}
export function validateManifestShape(raw: unknown): { ok: true; manifest: ModelManifest } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-object' }
  const obj = raw as Partial<ModelManifest>
  if (!isLocalModelFamily(obj.family)) return { ok: false, reason: 'unknown-family' }
  if (!obj.modelId || !obj.sourceRepo || !obj.sourceRevision) return { ok: false, reason: 'missing-source' }
  if (!Array.isArray(obj.files) || obj.files.length === 0) return { ok: false, reason: 'missing-files' }
  for (const file of obj.files) {
    if (!file.sha256 || file.sha256.length < 32) return { ok: false, reason: 'missing-hash' }
    if (file.path.includes('..') || file.path.startsWith('/')) return { ok: false, reason: 'path-traversal' }
  }
  if (!obj.signature || obj.signature === 'unsigned') return { ok: false, reason: 'unsigned' }
  if (!obj.signingKeyId) return { ok: false, reason: 'missing-signing-key' }
  return { ok: true, manifest: obj as ModelManifest }
}
export function expectedVariant(family: LocalModelFamily): string {
  if (family === 'whisper-large-v3-turbo') return 'turbo-v3'
  if (family === 'nemotron-3.5-asr-streaming-0.6b') return 'streaming-0.6b'
  return 'e2e_rnnt'
}
export function variantMatches(manifest: ModelManifest): boolean {
  if (manifest.family === 'gigaam-v3-e2e-rnnt') return manifest.variant === 'e2e_rnnt'
  return manifest.variant === expectedVariant(manifest.family)
}
