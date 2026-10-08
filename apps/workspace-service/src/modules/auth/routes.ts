/**
 * Public key set and the loopback local-token endpoint.
 * W1-03 (#1500): moved out of `http.ts` unchanged.
 */

import { IdentityDomainError } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { HttpFailure, defineRoute, jsonBody, loopback, query, readBody, send } from '../../routing.ts'

export const jwksRoute = defineRoute<true>({
  name: 'auth.jwks',
  match: path => path === '/.well-known/jwks.json' ? true : null,
  async handle({ req, res, params, jwks, maxBytes, timeoutMs }) {
    if (!jwks) throw new HttpFailure('NOT_FOUND', 404)
    if (req.method !== 'GET') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'GET')
    query(params, false)
    if ((await readBody(req, maxBytes, timeoutMs)).length) throw new HttpFailure('INVALID_PAYLOAD', 400)
    send(res, 200, jwks)
  },
})

export const localTokenRoute = defineRoute<true>({
  name: 'auth.localToken',
  match: path => path === '/v1/auth/local/token' ? true : null,
  async handle({ req, res, params, options, maxBytes, timeoutMs }) {
    const { localIssuer } = options
    if (!localIssuer) throw new HttpFailure('NOT_FOUND', 404)
    if (!loopback(req.socket.remoteAddress)) throw new IdentityDomainError('FORBIDDEN')
    if (req.method !== 'POST') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'POST')
    query(params, false)
    const input = jsonBody(await readBody(req, maxBytes, timeoutMs), req)
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).sort().join(',') !== 'login,password') throw new IdentityDomainError('INVALID_PAYLOAD')
    const { login, password } = input as { login: unknown; password: unknown }
    if (typeof login !== 'string' || typeof password !== 'string') throw new IdentityDomainError('INVALID_PAYLOAD')
    send(res, 200, await localIssuer.authenticate(login, password))
  },
})

export const AUTH_ROUTES = [jwksRoute, localTokenRoute] as const
