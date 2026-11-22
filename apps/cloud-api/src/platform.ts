/**
 * Rox's own provider credentials, for the machines Rox pays for itself.
 *
 * A customer with a key of their own (byok) never comes here. A guest or a
 * new customer without one (managed) gets a machine on Rox's platform key, and
 * that key must not exist anywhere outside this module: it is read from the
 * environment once per provider, handed straight to the adapter, and the only
 * thing the rest of the process may see is the last four characters.
 *
 * The fallback name `DAYTONA_API_KEY` exists because the pilot machine already
 * carries it; the platform name wins when both are set, so pointing Rox at a
 * dedicated account is one variable, not a hunt through the config.
 */

import type { SandboxProvider } from '../../../packages/cloud-runner/src/sandbox.ts'
import { createDaytonaProvider, DAYTONA_DEFAULT_API_URL } from '../../../packages/providers/src/daytona.ts'

export const PLATFORM_DAYTONA_KEY_ENV = 'ROX_PLATFORM_DAYTONA_KEY'
export const PLATFORM_DAYTONA_URL_ENV = 'ROX_PLATFORM_DAYTONA_URL'
/** Existing pilot variable, read only when the platform name is absent. */
export const LEGACY_DAYTONA_KEY_ENV = 'DAYTONA_API_KEY'

/** Providers this build can drive on a platform key. */
const PLATFORM_PROVIDERS: readonly string[] = ['daytona']

/** Injected transport and clock, so a test never reaches the vendor. */
export interface PlatformDeps {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly fetch?: typeof fetch
  readonly now?: () => number
  readonly toolboxUrl?: string
}

/** The key is private to this module; nothing else exports it. */
function platformKey(deps: PlatformDeps): string | undefined {
  const env = deps.env ?? process.env
  const dedicated = (env[PLATFORM_DAYTONA_KEY_ENV] ?? '').trim()
  if (dedicated.length > 0) return dedicated
  const legacy = (env[LEGACY_DAYTONA_KEY_ENV] ?? '').trim()
  return legacy.length > 0 ? legacy : undefined
}

/** The API URL override, or `undefined` for the adapter's own default. */
function platformApiUrl(deps: PlatformDeps): string | undefined {
  const env = deps.env ?? process.env
  const raw = (env[PLATFORM_DAYTONA_URL_ENV] ?? '').trim()
  return raw.length > 0 ? raw : undefined
}

/**
 * Built adapters, so the Daytona sandbox map survives between requests exactly
 * like a tenant's cached adapter does. Only used without injected transport:
 * a test that passes its own `fetch` gets a fresh instance every time.
 */
interface CachedProvider {
  readonly key: string
  readonly apiUrl: string | undefined
  readonly provider: SandboxProvider
}

const cache = new Map<string, CachedProvider>()

/**
 * The platform adapter for one provider, or `null` when Rox has no key for it
 * (or this build has no adapter). The key goes into the adapter and nowhere
 * else — no log, no return value, no error message.
 */
export function createPlatformProvider(
  id: string | null,
  deps: PlatformDeps = {},
): SandboxProvider | null {
  if (id === null || !PLATFORM_PROVIDERS.includes(id)) return null
  const key = platformKey(deps)
  if (key === undefined) return null

  const apiUrl = platformApiUrl(deps)
  const cacheable = deps.fetch === undefined && deps.now === undefined
  const cached = cache.get(id)
  if (cacheable && cached !== undefined && cached.key === key && cached.apiUrl === apiUrl) {
    return cached.provider
  }

  const provider = createDaytonaProvider({
    id: 'daytona',
    apiUrl: apiUrl ?? DAYTONA_DEFAULT_API_URL,
    ...(deps.toolboxUrl === undefined ? {} : { toolboxUrl: deps.toolboxUrl }),
    apiKey: key,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  })
  if (cacheable) cache.set(id, { key, apiUrl, provider })
  return provider
}

/** Provider ids that have a platform credential configured in this process. */
export function platformProviders(deps: PlatformDeps = {}): readonly string[] {
  const key = platformKey(deps)
  return key === undefined ? [] : [...PLATFORM_PROVIDERS]
}

/**
 * Providers Rox can actually sell as managed right now: a platform key exists
 * and this build has an adapter to spend it on. The catalog reports these, so
 * the site never offers a mode that would answer `capability_unavailable`.
 */
export function managedProviders(deps: PlatformDeps = {}): readonly string[] {
  const key = platformKey(deps)
  if (key === undefined) return []
  return PLATFORM_PROVIDERS.filter((id) => createPlatformProvider(id, deps) !== null)
}

/**
 * Last four characters of the platform key, for the staff panel only. `null`
 * means no such provider or no key; the rest of the secret never leaves here.
 */
export function platformKeyLast4(id: string | null, deps: PlatformDeps = {}): string | null {
  if (id === null || !PLATFORM_PROVIDERS.includes(id)) return null
  const key = platformKey(deps)
  if (key === undefined) return null
  return key.slice(-4)
}
