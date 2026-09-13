import type { ModelLifecycle, ModelManifest } from './manifest-schema.ts'
export function platformSupported(manifest: ModelManifest, platform: string, arch: string): boolean {
  return manifest.platform === platform && manifest.arch === arch
}
export function lifecycleAfterSmoke(ok: boolean): ModelLifecycle { return ok ? 'ready' : 'failed' }
export function blockedReason(manifest: ModelManifest, platform: string, arch: string): string | null {
  if (manifest.sourceRevision === 'pinned-pending-build') return 'artifact-not-published'
  if (!platformSupported(manifest, platform, arch)) return 'unsupported-platform'
  return null
}
