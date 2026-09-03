import { nowMs } from './stats'

export interface BundleProfileResult {
  phase: 'bundle' | 'minify'
  durationMs: number
  fileCount: number
}

/**
 * Profile bundle/minification separately from runtime marks.
 * Counts source-like paths only — does not invoke the production minifier.
 */
export function profileBundleInventory(paths: string[]): BundleProfileResult {
  const t0 = nowMs()
  let fileCount = 0
  for (const path of paths) {
    if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.css')) {
      fileCount += 1
    }
  }
  return { phase: 'bundle', durationMs: nowMs() - t0, fileCount }
}

export function profileMinifyHang(sourceChars: number, iterations = 8): BundleProfileResult {
  const t0 = nowMs()
  let checksum = 0
  const sample = 'function x(){return 1}'
  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < Math.min(sourceChars, 50_000); j++) {
      checksum = (checksum + sample.charCodeAt(j % sample.length) + i) | 0
    }
  }
  void checksum
  return { phase: 'minify', durationMs: nowMs() - t0, fileCount: 0 }
}
