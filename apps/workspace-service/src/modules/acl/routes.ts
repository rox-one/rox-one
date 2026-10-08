/**
 * W1-04 (#1501) — ACL HTTP routes as a module route table.
 *
 * `apps/workspace-service/src/http.ts` is being refactored into a route table
 * by W1-03 (#1500), so this module only *exposes* routes; it does not edit
 * http.ts. STUB(#1500): the composition root mounts `createAclRoutes()` (and
 * `createDirectoryRoutes()`) once the table lands — listed under UNDONE.
 *
 * The http layer is expected to do what it does for every `/v1/workspaces/*`
 * route today: bounded body, bearer → `actorResolver.authenticate` →
 * `revalidate`, `requireActor(actor, workspaceId)`, and map
 * `IdentityDomainError` to its status. Handlers re-check the actor anyway.
 */

import { ACL_ACTIONS, isAclAction, listingVisibility, type AclAction, type ListingVisibility } from '../../../../../packages/core/src/acl/index.ts'
import { formatEntityRef, parseEntityRef } from '../../../../../packages/core/src/entities/refs.ts'
import type { EntityRef } from '../../../../../packages/core/src/entities/refs.ts'
import {
  IdentityDomainError,
  type AuthenticatedActor,
} from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import type { WorkspaceAcl } from './service.ts'

export interface WorkspaceRouteContext {
  /** Verified, revalidated actor. */
  readonly actor: AuthenticatedActor
  /** Raw `:workspaceId` path segment (handlers validate it). */
  readonly workspaceId: string
  readonly params: Readonly<Record<string, string>>
  readonly query: URLSearchParams
  /** Parsed JSON body for POST, `undefined` for GET. */
  readonly body: unknown
}

/** Framework-neutral route record for the W1-03 (#1500) route table. */
export interface WorkspaceModuleRoute {
  readonly method: 'GET' | 'POST'
  /** Template, e.g. `/v1/workspaces/:workspaceId/acl/check`. */
  readonly path: string
  handle(context: WorkspaceRouteContext): Promise<unknown>
}

export interface WorkspaceRouteMatch {
  route: WorkspaceModuleRoute
  params: Record<string, string>
}

/**
 * Match `method path` against a route table. Path params are single
 * URI-decoded segments; a malformed escape is `INVALID_PAYLOAD`. Returns
 * `null` when nothing matches (the caller answers 404, or 405 with
 * `allowedMethods(routes, path)` as the `Allow` header).
 */
export function matchWorkspaceModuleRoute(routes: readonly WorkspaceModuleRoute[], method: string, path: string): WorkspaceRouteMatch | null {
  const segments = path.split('/')
  for (const route of routes) {
    if (route.method !== method) continue
    const template = route.path.split('/')
    if (template.length !== segments.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < template.length && ok; i++) {
      const part = template[i]!
      const actual = segments[i]!
      if (part.startsWith(':')) {
        if (!actual) { ok = false; break }
        try { params[part.slice(1)] = decodeURIComponent(actual) } catch { throw new IdentityDomainError('INVALID_PAYLOAD') }
      } else if (part !== actual) ok = false
    }
    if (ok) return { route, params }
  }
  return null
}

/** Methods any route accepts for `path` (for a 405 `Allow` header). */
export function allowedMethods(routes: readonly WorkspaceModuleRoute[], path: string): string[] {
  const methods = new Set<string>()
  for (const route of routes) {
    if (matchWorkspaceModuleRoute([route], route.method, path)) methods.add(route.method)
  }
  return [...methods].sort()
}

export const MAX_ACL_CHECK_REFS = 100

export interface AclCheckResult {
  ref: string
  allowed: boolean
  /** Effective role, or `null` when denied without a viewable role. */
  role: string | null
  /** How a listing must render the ref (`hide` for unviewable secret / missing refs). */
  visibility: ListingVisibility
}

function parseCheckBody(body: unknown): { action: AclAction; refs: EntityRef[] } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new IdentityDomainError('INVALID_PAYLOAD')
  const input = body as Record<string, unknown>
  if (Object.keys(input).sort().join(',') !== 'action,refs') throw new IdentityDomainError('INVALID_PAYLOAD')
  if (typeof input.action !== 'string' || !isAclAction(input.action)) throw new IdentityDomainError('INVALID_PAYLOAD')
  if (!Array.isArray(input.refs) || input.refs.length === 0 || input.refs.length > MAX_ACL_CHECK_REFS) throw new IdentityDomainError('INVALID_PAYLOAD')
  const refs = input.refs.map(raw => {
    if (typeof raw !== 'string' || raw.length > 512) throw new IdentityDomainError('INVALID_PAYLOAD')
    const parsed = parseEntityRef(raw)
    if (!parsed.ok) throw new IdentityDomainError('INVALID_PAYLOAD')
    // ACL is per entity; fragments (blocks, timestamps) are ignored.
    return { kind: parsed.value.kind, id: parsed.value.id }
  })
  return { action: input.action, refs }
}

/**
 * `POST /v1/workspaces/:workspaceId/acl/check` — `{ action, refs[] }` →
 * `{ action, results[] }` for the calling principal only (no probing other
 * principals). A missing ref and an unviewable secret ref are reported
 * identically (`allowed:false, role:null, visibility:'hide'`), so the
 * endpoint is not an existence oracle.
 */
export function createAclRoutes(acl: WorkspaceAcl): WorkspaceModuleRoute[] {
  return [{
    method: 'POST',
    path: '/v1/workspaces/:workspaceId/acl/check',
    async handle({ actor, workspaceId: rawWorkspaceId, body }) {
      const workspaceId = requireUuid(rawWorkspaceId)
      requireActor(actor, workspaceId)
      const { action, refs } = parseCheckBody(body)
      const principal = await acl.principalFor(actor, workspaceId)
      const decisions = await acl.engine.evaluateMany(principal, action, refs)
      // A hard denial of the principal itself (revoked, placeholder, …) is a 403, not per-ref noise.
      const hard = decisions.find(d => d.reason === 'not_member' || d.reason === 'placeholder' || d.reason === 'inactive' || d.reason === 'cross_workspace')
      if (hard) throw new IdentityDomainError('FORBIDDEN')
      const view = action === 'view' ? decisions : await acl.engine.evaluateMany(principal, 'view', refs)
      const results: AclCheckResult[] = refs.map((ref, index) => {
        const decision = decisions[index]!
        const viewDecision = view[index]!
        const hidden = viewDecision.reason === 'not_found' || (viewDecision.secret && viewDecision.preview === 'none')
        return {
          ref: formatEntityRef(ref),
          allowed: decision.allowed,
          role: hidden ? null : decision.role,
          visibility: hidden ? 'hide' : listingVisibility(viewDecision),
        }
      })
      return { action, results }
    },
  }]
}

/** Exposed for tests / docs: the action vocabulary accepted by `acl/check`. */
export const ACL_CHECK_ACTIONS: readonly AclAction[] = ACL_ACTIONS
