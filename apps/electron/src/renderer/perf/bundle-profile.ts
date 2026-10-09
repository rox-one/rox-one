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

/** The payload the synthetic minify-hang profile hashes; all-ASCII (one code unit per character). */
const MINIFY_SAMPLE = 'function x(){return 1}'
const MINIFY_SAMPLE_CODES = Array.from(MINIFY_SAMPLE, (char) => char.codePointAt(0) ?? 0)
const MINIFY_SAMPLE_SUM = MINIFY_SAMPLE_CODES.reduce((sum, code) => sum + code, 0)

/**
 * Synthetic minify-hang stand-in — NOT a real minifier measurement. It models per-character work
 * over at most 50k characters per iteration with a closed form (hoisted sample codes/sum) instead
 * of a per-character inner loop; the `| 0` keeps the old loop's mod-2^32 reduction, so the checksum
 * is bit-identical to the pre-change per-character implementation.
 */
export function minifyHangChecksum(sourceChars: number, iterations = 8): number {
  const count = Math.min(sourceChars, 50_000)
  const fullPasses = Math.floor(count / MINIFY_SAMPLE_CODES.length)
  const remainder = count % MINIFY_SAMPLE_CODES.length
  let perIteration = MINIFY_SAMPLE_SUM * fullPasses
  for (let k = 0; k < remainder; k++) perIteration += MINIFY_SAMPLE_CODES[k] ?? 0
  let checksum = 0
  for (let i = 0; i < iterations; i++) checksum = (checksum + perIteration + i * count) | 0
  return checksum
}

export function profileMinifyHang(sourceChars: number, iterations = 8): BundleProfileResult {
  const t0 = nowMs()
  void minifyHangChecksum(sourceChars, iterations)
  return { phase: 'minify', durationMs: nowMs() - t0, fileCount: 0 }
}
