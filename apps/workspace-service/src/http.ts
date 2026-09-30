import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import type { JSONWebKeySet } from 'jose'
import {
  IdentityDomainError,
  type AuthenticatedActor,
  type SharedProjectAuthority,
} from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { requireActor, requireUuid } from './modules/identity/commands.ts'
import { AuthenticationError, type createVerifiedActorResolver } from './auth/verified-actor.ts'
import type { createLocalIssuer } from './auth/local-issuer.ts'

export type WorkspaceActorResolver = ReturnType<typeof createVerifiedActorResolver<AuthenticatedActor>>
export type WorkspaceLocalIssuer = Awaited<ReturnType<typeof createLocalIssuer>>

export interface WorkspaceHttpOptions {
  authority: SharedProjectAuthority
  actorResolver: WorkspaceActorResolver
  /** Explicit trusted public key set; no token header or local-mode fallback selects keys. */
  publicJwks?: JSONWebKeySet
  /** Only the composition root can opt into the loopback credential endpoint. */
  localIssuer?: WorkspaceLocalIssuer
  maxBodyBytes?: number
  bodyTimeoutMs?: number
}

class HttpFailure extends Error {
  constructor(readonly code: string, readonly status: number, readonly allow?: string) { super(code) }
}

function publicKeys(jwks: JSONWebKeySet | undefined): JSONWebKeySet | undefined {
  if (!jwks) return undefined
  const publicFields = new Set(['kty', 'kid', 'use', 'alg', 'key_ops', 'crv', 'x', 'y', 'n', 'e', 'x5c', 'x5t', 'x5t#S256'])
  const privateFields = ['d', 'k', 'p', 'q', 'dp', 'dq', 'qi', 'oth']
  if (!Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.some(key =>
    !['OKP', 'EC', 'RSA'].includes(key.kty ?? '') || privateFields.some(field => Object.hasOwn(key, field)))) {
    throw new Error('Only configured public asymmetric JWKS may be served')
  }
  return JSON.parse(JSON.stringify({ keys: jwks.keys.map(key =>
    Object.fromEntries(Object.entries(key).filter(([field]) => publicFields.has(field)))) }))
}

function loopback(address: string | undefined): boolean {
  if (!address) return false
  if (address === '::1') return true
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address
  return isIP(ipv4) === 4 && ipv4.startsWith('127.')
}

function bearer(req: IncomingMessage): string {
  const count = req.rawHeaders.filter((_, index) => index % 2 === 0)
    .filter(name => name.toLowerCase() === 'authorization').length
  const header = req.headers.authorization
  if (count !== 1 || typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) {
    throw new AuthenticationError()
  }
  return header.slice(7)
}

function readBody(req: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  const length = req.headers['content-length']
  if (length !== undefined && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > maxBytes)) {
    req.resume()
    return Promise.reject(new HttpFailure(Number(length) > maxBytes ? 'BODY_TOO_LARGE' : 'INVALID_PAYLOAD', Number(length) > maxBytes ? 413 : 400))
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const timer = setTimeout(() => finish(new HttpFailure('REQUEST_TIMEOUT', 408)), timeoutMs)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      req.off('data', data)
      req.off('end', end)
      req.off('aborted', aborted)
      req.off('error', failed)
      if (error) { req.resume(); reject(error) }
      else resolve(Buffer.concat(chunks, bytes))
    }
    const data = (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      bytes += buffer.length
      if (bytes > maxBytes) finish(new HttpFailure('BODY_TOO_LARGE', 413))
      else chunks.push(buffer)
    }
    const end = () => finish()
    const aborted = () => finish(new HttpFailure('INVALID_PAYLOAD', 400))
    const failed = () => finish(new HttpFailure('INVALID_PAYLOAD', 400))
    req.on('data', data)
    req.once('end', end)
    req.once('aborted', aborted)
    req.once('error', failed)
  })
}

function jsonBody(bytes: Buffer, req: IncomingMessage): unknown {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpFailure('UNSUPPORTED_MEDIA_TYPE', 415)
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new HttpFailure('INVALID_PAYLOAD', 400) }
}

function query(params: URLSearchParams, paged: boolean): { limit?: number; cursor?: string } {
  const result: { limit?: number; cursor?: string } = {}
  const seen = new Set<string>()
  for (const [key, value] of params) {
    if (!paged || !['limit', 'cursor'].includes(key) || seen.has(key)) throw new IdentityDomainError('INVALID_PAYLOAD')
    seen.add(key)
    if (key === 'limit') {
      if (!/^(?:[1-9][0-9]?|100)$/.test(value)) throw new IdentityDomainError('INVALID_PAYLOAD')
      result.limit = Number(value)
    } else result.cursor = requireUuid(value)
  }
  return result
}

function send(res: ServerResponse, status: number, value: unknown, allow?: string): void {
  if (res.writableEnded || res.destroyed) return
  // Serialize before headers: cyclic/unserializable internal values fail with a redacted 500.
  const body = JSON.stringify(value)
  if (typeof body !== 'string') throw new Error('Unserializable HTTP output')
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer')
  if (allow) res.setHeader('Allow', allow)
  res.end(body)
}

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
  const jwks = publicKeys(options.publicJwks)
  const { authority, actorResolver, localIssuer } = options

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = req.url ?? ''
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('#') || raw.includes('\\')) throw new HttpFailure('INVALID_PAYLOAD', 400)
    // Match the original path, before URL normalization could erase dot segments.
    const queryStart = raw.indexOf('?')
    const path = queryStart === -1 ? raw : raw.slice(0, queryStart)
    const params = new URL(raw, 'http://workspace.invalid').searchParams
    if (path === '/.well-known/jwks.json') {
      if (!jwks) throw new HttpFailure('NOT_FOUND', 404)
      if (req.method !== 'GET') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'GET')
      query(params, false)
      if ((await readBody(req, maxBytes, timeoutMs)).length) throw new HttpFailure('INVALID_PAYLOAD', 400)
      send(res, 200, jwks)
      return
    }
    if (path === '/v1/auth/local/token') {
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
      return
    }
    const matched = /^\/v1\/workspaces\/([^/]+)\/(commands\/project\.createShared|projects(?:\/([^/]+))?|events)$/.exec(path)
    if (!matched) throw new HttpFailure('NOT_FOUND', 404)
    const workspaceSegment = matched[1]
    const routeSegment = matched[2]
    const projectSegment = matched[3]
    if (workspaceSegment === undefined || routeSegment === undefined) throw new HttpFailure('NOT_FOUND', 404)
    let workspaceId: string
    let projectId: string | undefined
    try {
      workspaceId = requireUuid(decodeURIComponent(workspaceSegment))
      if (projectSegment !== undefined) {
        const id = decodeURIComponent(projectSegment)
        projectId = requireUuid(id.startsWith('project:') ? id.slice(8) : id)
      }
    } catch { throw new IdentityDomainError('INVALID_PAYLOAD') }
    const command = routeSegment === 'commands/project.createShared'
    const method = command ? 'POST' : 'GET'
    if (req.method !== method) throw new HttpFailure('METHOD_NOT_ALLOWED', 405, method)
    const input = query(params, !command && !projectId)
    let bound = await actorResolver.authenticate(bearer(req))
    const bytes = await readBody(req, maxBytes, timeoutMs)
    if (!command && bytes.length) throw new IdentityDomainError('INVALID_PAYLOAD')
    const body = command ? jsonBody(bytes, req) : projectId ? { entityId: 'project:' + projectId } : input
    bound = await actorResolver.revalidate(bound)
    requireActor(bound.actor, workspaceId)
    const result = command ? await authority.createSharedProject(bound.actor, workspaceId, body)
      : projectId ? await authority.getProject(bound.actor, workspaceId, body)
      : routeSegment === 'events' ? await authority.replayEvents(bound.actor, workspaceId, body)
      : await authority.listProjects(bound.actor, workspaceId, body)
    // Suppress private results if session or membership was revoked while the query/command awaited I/O.
    bound = await actorResolver.revalidate(bound)
    requireActor(bound.actor, workspaceId)
    send(res, 200, result)
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
