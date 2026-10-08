/**
 * Shared-project, event replay and identity routes, plus the domain request
 * pipeline the license routes reuse.
 * W1-03 (#1500): moved out of `http.ts`; check order and responses unchanged.
 */

import { IdentityDomainError } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { requireActor, requireUuid } from './commands.ts'
import { HttpFailure, bearer, defineRoute, jsonBody, query, readBody, send, type WorkspaceRouteContext } from '../../routing.ts'

/** Captures of the original domain regex, by meaning. */
export interface DomainRouteMatch {
  workspaceSegment: string | undefined
  /** `commands/project.createShared`, `projects…`, `events`, `identity`, `commands/audit.releaseLicense`, `licenses…` */
  routeSegment: string | undefined
  projectSegment: string | undefined
  licenseSegment: string | undefined
  licenseEventSegment: string | undefined
}

/**
 * GET /projects/{id} accepts canonical project:UUID or its raw UUID alias, returning the same ref.
 * POST command returns 200 for both original application and idempotent receipt replay.
 */
export async function handleDomainRoute(ctx: WorkspaceRouteContext, matched: DomainRouteMatch): Promise<void> {
  const { req, res, params, options, maxBytes, timeoutMs } = ctx
  const { authority, actorResolver } = options
  const { workspaceSegment, routeSegment, projectSegment, licenseSegment, licenseEventSegment } = matched
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
  const identity = routeSegment === 'identity'
  const licenseCommand = routeSegment === 'commands/audit.releaseLicense'
  const licenseRoute = licenseCommand || routeSegment.startsWith('licenses')
  if (licenseRoute && !options.licenseAuthority) throw new HttpFailure('NOT_FOUND', 404)
  let licenseId: string | undefined
  try { licenseId = licenseSegment === undefined ? undefined : requireUuid(decodeURIComponent(licenseSegment).replace(/^license-component:/, '')) }
  catch { throw new IdentityDomainError('INVALID_PAYLOAD') }
  const command = routeSegment.startsWith('commands/')
  const method = command ? 'POST' : 'GET'
  if (req.method !== method) throw new HttpFailure('METHOD_NOT_ALLOWED', 405, method)
  const input = query(params, !command && !projectId && !identity && (!licenseId || Boolean(licenseEventSegment)))
  let bound = await actorResolver.authenticate(bearer(req))
  const bytes = await readBody(req, maxBytes, timeoutMs)
  if (!command && bytes.length) throw new IdentityDomainError('INVALID_PAYLOAD')
  const body = command ? jsonBody(bytes, req) : licenseId ? { ...input, entityId: 'license-component:' + licenseId } : projectId ? { entityId: 'project:' + projectId } : input
  bound = await actorResolver.revalidate(bound)
  requireActor(bound.actor, workspaceId)
  const result = identity ? null : licenseRoute && options.licenseAuthority
    ? licenseCommand ? await options.licenseAuthority.auditReleaseLicense(bound.actor, workspaceId, body)
      : licenseEventSegment ? await options.licenseAuthority.licenseEvents(bound.actor, workspaceId, body)
      : licenseId ? await options.licenseAuthority.getLicenseComponent(bound.actor, workspaceId, body)
      : await options.licenseAuthority.listLicenseComponents(bound.actor, workspaceId, body)
    : command ? await authority.createSharedProject(bound.actor, workspaceId, body)
    : projectId ? await authority.getProject(bound.actor, workspaceId, body)
    : routeSegment === 'events' ? await authority.replayEvents(bound.actor, workspaceId, body)
    : await authority.listProjects(bound.actor, workspaceId, body)
  // Suppress private results if session or membership was revoked while the query/command awaited I/O.
  bound = await actorResolver.revalidate(bound)
  requireActor(bound.actor, workspaceId)
  if (licenseRoute && options.licenseResponseGuard) await options.licenseResponseGuard(bound.actor,workspaceId,licenseCommand?'audit':licenseEventSegment?'events':licenseId?'get':'list',body,result)
  send(res, 200, identity ? { issuer: bound.identity.issuer, principalId: bound.identity.principalId,
    sessionId: bound.identity.sessionId, deviceId: bound.identity.deviceId, workspaceId, expiresAt: bound.identity.expiresAt } : result)
}

export const identityRoute = defineRoute<DomainRouteMatch>({
  name: 'identity.domain',
  match(path) {
    const matched = /^\/v1\/workspaces\/([^/]+)\/(commands\/project\.createShared|projects(?:\/([^/]+))?|events|identity)$/.exec(path)
    return matched ? { workspaceSegment: matched[1], routeSegment: matched[2], projectSegment: matched[3], licenseSegment: undefined, licenseEventSegment: undefined } : null
  },
  handle: handleDomainRoute,
})

export const IDENTITY_ROUTES = [identityRoute] as const
