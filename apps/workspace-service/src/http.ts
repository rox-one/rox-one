import type { IncomingMessage, ServerResponse } from 'node:http'
import { IdentityDomainError } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { AuthenticationError } from './auth/verified-actor.ts'
import { HttpFailure, publicKeys, send, type WorkspaceHttpOptions, type WorkspaceRoute } from './routing.ts'
import { AUTH_ROUTES } from './modules/auth/routes.ts'
import { COLLABORATION_ROUTES } from './modules/collaboration/routes.ts'
import { IDENTITY_ROUTES } from './modules/identity/routes.ts'
import { LICENSE_ROUTES } from './modules/licenses/routes.ts'
import { COMMAND_ROUTES } from './modules/commands/routes.ts'

export type { WorkspaceActorResolver, WorkspaceHttpOptions, WorkspaceLocalIssuer } from './routing.ts'

/**
 * Per-module route table, first match wins (W1-03 #1500 refactor of the former
 * regex router; every path, check order and response is unchanged). New
 * modules append their `modules/<m>/routes.ts` export here.
 */
export const WORKSPACE_ROUTES: readonly WorkspaceRoute[] = [
  ...AUTH_ROUTES,
  ...COLLABORATION_ROUTES,
  ...IDENTITY_ROUTES,
  ...LICENSE_ROUTES,
  // W1-03 (#1500)
  ...COMMAND_ROUTES,
]

/**
 * Existing WsRpcServerOptions.httpHandler-compatible facade; no listener or second authority.
 * GET /projects/{id} accepts canonical project:UUID or its raw UUID alias, returning the same ref.
 * POST command returns 200 for both original application and idempotent receipt replay.
 */
export function createWorkspaceHttpHandler(options: WorkspaceHttpOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const maxBytes = options.maxBodyBytes ?? 65536
  const timeoutMs = options.bodyTimeoutMs ?? 10000
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Invalid bounded HTTP body configuration')
  if (options.licenseAuthority && !options.licenseResponseGuard) throw new Error('Configured license authority requires its Resource response guard')
  const jwks = publicKeys(options.publicJwks)

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = req.url ?? ''
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('#') || raw.includes('\\')) throw new HttpFailure('INVALID_PAYLOAD', 400)
    // Match the original path, before URL normalization could erase dot segments.
    const queryStart = raw.indexOf('?')
    const path = queryStart === -1 ? raw : raw.slice(0, queryStart)
    const params = new URL(raw, 'http://workspace.invalid').searchParams
    for (const route of WORKSPACE_ROUTES) {
      const match = route.match(path)
      if (match === null) continue
      await route.handle({ req, res, path, params, options, maxBytes, timeoutMs, jwks }, match)
      return
    }
    throw new HttpFailure('NOT_FOUND', 404)
  }

  return (req, res) => {
    // Node may emit error after aborted; retain a terminal listener after body-reader cleanup.
    req.once('error', () => {})
    return handle(req, res).catch(error => {
      req.resume()
      if (error instanceof AuthenticationError) send(res, 401, { error: { code: 'UNAUTHENTICATED' } })
      else if (error instanceof IdentityDomainError) send(res, error.statusCode, { error: { code: error.code } })
      else if (error instanceof HttpFailure) send(res, error.status, { error: { code: error.code } }, error.allow)
      else send(res, 500, { error: { code: 'INTERNAL_ERROR' } })
    })
  }
}
