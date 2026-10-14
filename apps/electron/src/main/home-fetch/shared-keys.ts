/**
 * Shared API keys embedded at build time.
 *
 * `scripts/gen-shared-keys.ts` writes the gitignored `shared-keys.local.ts`
 * next to this file from the build machine's environment before `build:main`.
 * When it is absent (fresh clone, CI) every key is simply unavailable. A
 * runtime env var of the same name overrides the embedded value for local
 * development. Keys live only in the main process.
 */
export interface SharedKeys {
  exa?: string
}

let cached: SharedKeys | null = null

function loadEmbedded(): SharedKeys {
  try {
    // Optional gitignored module: esbuild leaves an unresolved require inside try/catch as a runtime miss.
    const mod = require('./shared-keys.local') as { SHARED_KEYS?: SharedKeys }
    return mod?.SHARED_KEYS && typeof mod.SHARED_KEYS === 'object' ? mod.SHARED_KEYS : {}
  } catch {
    return {}
  }
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_\-.]{8,200}$/.test(value.trim()) ? value.trim() : undefined
}

export function getSharedKeys(env: Record<string, string | undefined> = process.env): SharedKeys {
  if (!cached) cached = loadEmbedded()
  return { exa: clean(env.ROX_EXA_API_KEY) ?? clean(cached.exa) }
}

/** Test hook. */
export function resetSharedKeysForTest(keys: SharedKeys | null): void {
  cached = keys
}
