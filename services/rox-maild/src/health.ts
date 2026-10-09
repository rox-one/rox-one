/**
 * `GET /api/health` — liveness for the service itself and reachability of the
 * local Stalwart management endpoint. Always 200 while the process is up.
 */
import type { Config } from './config.ts'

export interface HealthResult {
  status: 200
  body: { ok: true; stalwart: boolean }
}

export function healthProbeUrl(config: Config): string {
  return `${config.stalwartAdminUrl}/healthz/live`
}

export async function handleHealth(config: Config, fetchImpl: (input: string, init?: RequestInit) => Promise<Response>): Promise<HealthResult> {
  let stalwart = false
  try {
    const response = await fetchImpl(healthProbeUrl(config), { signal: AbortSignal.timeout(config.healthTimeoutMs) })
    stalwart = response.ok
  } catch {
    stalwart = false
  }
  return { status: 200, body: { ok: true, stalwart } }
}