/**
 * Bundle / minification hang isolation.
 * Kept off the interaction p95 track on purpose (Issue 03 / 27).
 */

export interface BundleProfileResult {
  durationMs: number
  hung: boolean
  steps: Array<{ name: string; durationMs: number }>
}

export const BUNDLE_HANG_MS = 30_000

export async function profileBundleSteps(
  steps: Array<{ name: string; run: () => Promise<void> | void }>,
  opts: { hangMs?: number; now?: () => number } = {},
): Promise<BundleProfileResult> {
  const hangMs = opts.hangMs ?? BUNDLE_HANG_MS
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const started = now()
  const recorded: Array<{ name: string; durationMs: number }> = []
  let hung = false

  for (const step of steps) {
    const stepStart = now()
    await step.run()
    const durationMs = now() - stepStart
    recorded.push({ name: step.name, durationMs })
    if (durationMs >= hangMs) {
      hung = true
      break
    }
  }

  return {
    durationMs: now() - started,
    hung,
    steps: recorded,
  }
}

/** Cheap deterministic stand-in so CI never launches a real minify. */
export function createSyntheticBundleSteps(): Array<{ name: string; run: () => void }> {
  return [
    { name: 'parse-graph', run: () => { let n = 0; for (let i = 0; i < 200; i += 1) n += i; void n } },
    { name: 'minify-js', run: () => { let n = 0; for (let i = 0; i < 400; i += 1) n += i; void n } },
    { name: 'write-assets', run: () => { let n = 0; for (let i = 0; i < 100; i += 1) n += i; void n } },
  ]
}
