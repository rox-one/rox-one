/**
 * Fetch-backed Infisical HTTP transport for the account-import RPC.
 * The shared InfisicalProvider owns auth/tenant/secret semantics; this module
 * only performs the request and returns the raw status/body it expects.
 */
import type { InfisicalHttpClient } from '@rox/shared/credentials'

export function createInfisicalHttpClient(fetchImpl: typeof fetch = globalThis.fetch): InfisicalHttpClient {
  return async (request) => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      ...(request.headers ? { headers: { ...request.headers } } : {}),
      ...(request.body !== undefined ? { body: request.body } : {}),
    })
    return { status: response.status, body: await response.text() }
  }
}