/**
 * Shared HTTP plumbing for the workspace service route table.
 *
 * W1-03 (#1500): moved verbatim out of `http.ts` when the regex router became
 * a per-module route table (`modules/<m>/routes.ts`). Behaviour, check order
 * and error codes are unchanged.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import type { JSONWebKeySet } from 'jose'
import {
  IdentityDomainError,
  type AuthenticatedActor,
  type SharedProjectAuthority,
} from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { requireUuid } from './modules/identity/commands.ts'
import { AuthenticationError, type createVerifiedActorResolver } from './auth/verified-actor.ts'
import type { createLocalIssuer } from './auth/local-issuer.ts'
import type { LicenseAuthority } from '../../../packages/shared/src/workspace-domain/licenses/contracts.ts'
import type { WorkspaceBroInvitationAuthority } from './modules/collaboration/invitations.ts'
import type { WorkspaceCommandHttpAuthority } from './modules/commands/routes.ts'

export type WorkspaceActorResolver = ReturnType<typeof createVerifiedActorResolver<AuthenticatedActor>>
export type WorkspaceLocalIssuer = Awaited<ReturnType<typeof createLocalIssuer>>

export interface WorkspaceHttpOptions {
  authority: SharedProjectAuthority
  licenseAuthority?: LicenseAuthority
  collaborationAuthority?: WorkspaceBroInvitationAuthority
  licenseResponseGuard?: (actor: AuthenticatedActor, workspaceId: string, operation: string, body: unknown, result: unknown) => Promise<void>
  actorResolver: WorkspaceActorResolver
  /** Explicit trusted public key set; no token header or local-mode fallback selects keys. */
  publicJwks?: JSONWebKeySet
  /** Only the composition root can opt into the loopback credential endpoint. */
  localIssuer?: WorkspaceLocalIssuer
  maxBodyBytes?: number
  bodyTimeoutMs?: number
  // W1-03 (#1500)
  /** Generic command bus (`POST /v1/workspaces/{ws}/commands`); absent → the route answers 404. */
  commandBus?: WorkspaceCommandHttpAuthority
}

export class HttpFailure extends Error {
  constructor(readonly code: string, readonly status: number, readonly allow?: string) { super(code) }
}

export function publicKeys(jwks: JSONWebKeySet | undefined): JSONWebKeySet | undefined {
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

export function loopback(address: string | undefined): boolean {
  if (!address) return false
  if (address === '::1') return true
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address
  return isIP(ipv4) === 4 && ipv4.startsWith('127.')
}

export function bearer(req: IncomingMessage): string {
  const count = req.rawHeaders.filter((_, index) => index % 2 === 0)
    .filter(name => name.toLowerCase() === 'authorization').length
  const header = req.headers.authorization
  if (count !== 1 || typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) {
    throw new AuthenticationError()
  }
  return header.slice(7)
}

export function readBody(req: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<Buffer> {
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

export function jsonBody(bytes: Buffer, req: IncomingMessage): unknown {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpFailure('UNSUPPORTED_MEDIA_TYPE', 415)
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new HttpFailure('INVALID_PAYLOAD', 400) }
}

export function query(params: URLSearchParams, paged: boolean): { limit?: number; cursor?: string } {
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

export function send(res: ServerResponse, status: number, value: unknown, allow?: string): void {
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

/** Everything a route needs; built once per request by `createWorkspaceHttpHandler`. */
export interface WorkspaceRouteContext {
  readonly req: IncomingMessage
  readonly res: ServerResponse
  /** Original (non-normalised) path. */
  readonly path: string
  readonly params: URLSearchParams
  readonly options: WorkspaceHttpOptions
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly jwks: JSONWebKeySet | undefined
}

/**
 * One entry of the route table. `match` must be pure (no I/O, no throws);
 * the first matching route handles the request. Routes keep their own check
 * order (path decode → availability → method → query → auth → body → …).
 */
export interface WorkspaceRoute<M = unknown> {
  readonly name: string
  match(path: string): M | null
  handle(ctx: WorkspaceRouteContext, match: M): Promise<void>
}

export function defineRoute<M>(route: WorkspaceRoute<M>): WorkspaceRoute<unknown> {
  return route as unknown as WorkspaceRoute<unknown>
}
