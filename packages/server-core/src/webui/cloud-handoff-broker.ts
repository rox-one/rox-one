/**
 * Mounts the cloud handoff broker (`/api/cloud-handoff/v1/*`) on a hosted Rox
 * server. Activates only when explicitly enabled, the shared Daytona key is in
 * the server env, and we are NOT running inside Electron — so the shared key
 * can never be used from a desktop install.
 */
import { createHash } from 'node:crypto'
import {
  HANDOFF_DEFAULT_KEY_ENV,
  HttpDaytonaClient,
  createHandoffBrokerHandler,
  fetchRoxIdSubject,
} from '@rox/cloud-runner'

export const HANDOFF_BROKER_ENABLED_ENV = 'ROX_CLOUD_HANDOFF_BROKER_ENABLED'
const TOKEN_CACHE_MS = 60_000
const TOKEN_CACHE_MAX = 1_000

export interface BrokerMountOptions {
  env?: Record<string, string | undefined>
  /** Overridable for tests; defaults to `process.versions.electron`. */
  isElectron?: boolean
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}

export function maybeCreateCloudHandoffBroker(
  options: BrokerMountOptions = {},
): ((req: Request) => Promise<Response | null>) | undefined {
  const env = options.env ?? process.env
  const isElectron = options.isElectron ?? Boolean((process.versions as Record<string, string | undefined>).electron)
  if (isElectron) return undefined
  if (env[HANDOFF_BROKER_ENABLED_ENV] !== '1') return undefined
  const sharedKey = env[HANDOFF_DEFAULT_KEY_ENV]?.trim()
  if (!sharedKey) return undefined
  const issuer = env.ROX_CLOUD_HANDOFF_OIDC_ISSUER?.trim() || 'https://id.rox.one'

  // Short cache so a handoff's many file writes do not hammer id.rox.one.
  const cache = new Map<string, { sub: string; at: number }>()
  const verifyToken = async (token: string): Promise<string | null> => {
    const key = createHash('sha256').update(token).digest('hex')
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < TOKEN_CACHE_MS) return hit.sub
    try {
      const sub = await fetchRoxIdSubject({ issuer, accessToken: token, fetchImpl: options.fetchImpl })
      if (cache.size >= TOKEN_CACHE_MAX) cache.delete(cache.keys().next().value!)
      cache.set(key, { sub, at: Date.now() })
      return sub
    } catch {
      return null
    }
  }

  return createHandoffBrokerHandler({
    client: new HttpDaytonaClient({ apiUrl: env.ROX_CLOUD_HANDOFF_DAYTONA_API_URL?.trim() || undefined, resolveApiKey: async () => sharedKey }),
    verifyToken,
    snapshot: env.ROX_CLOUD_HANDOFF_DAYTONA_SNAPSHOT?.trim() || undefined,
    region: env.ROX_CLOUD_HANDOFF_DAYTONA_REGION?.trim() || undefined,
  })
}
