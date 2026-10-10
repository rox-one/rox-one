/**
 * Visitor tool callbacks (port-matrix row a1.6) — the `ctx.visitors` seam for
 * the `visitor_invite` / `visitor_revoke` / `visitor_list` session tools.
 *
 * Wired by SessionManager to the live {@link VisitorAccessService}. A backend
 * without the service (or a deployment where visitor config is absent) reports
 * a typed `VISITOR_STORE_UNAVAILABLE` instead of pretending to grant anything.
 */
import { errorResponse, successResponse, type VisitorToolCallbacks } from '@rox/session-tools-core'
import type { VisitorAccessService } from './service.ts'
import type { VisitorGrant, VisitorSubject } from './types.ts'
import { visitorSubjectLabel } from './types.ts'

const DAY_MS = 24 * 60 * 60_000

type SubjectParse =
  | { ok: true; subject: VisitorSubject }
  | { ok: false; message: string }

/** Exactly one of `email` / `github` must be supplied. */
function parseSubjectArg(args: { email?: string; github?: string }): SubjectParse {
  const email = typeof args.email === 'string' ? args.email.trim() : ''
  const github = typeof args.github === 'string' ? args.github.trim() : ''
  if (email && github) return { ok: false, message: 'pass exactly one of "email" or "github"' }
  if (email) return { ok: true, subject: { kind: 'email', email } }
  if (github) return { ok: true, subject: { kind: 'github', accountId: github } }
  return { ok: false, message: 'one of "email" or "github" is required' }
}

function formatGrant(grant: VisitorGrant, now: number): string {
  const remainingMs = Math.max(0, grant.expiresAt - now)
  const remainingHours = Math.round((remainingMs / 3_600_000) * 10) / 10
  return `${visitorSubjectLabel(grant.subject)} (expires in ${remainingHours}h; key ${grant.key})`
}

export function buildVisitorToolCallbacks(
  getService: () => VisitorAccessService | null,
  now: () => number = Date.now,
): VisitorToolCallbacks {
  const unavailable = (tool: string) =>
    errorResponse(
      `${tool} is unavailable: visitor access is not configured in this process (VISITOR_STORE_UNAVAILABLE).`,
    )

  return {
    async invite(args) {
      const service = getService()
      if (!service) return unavailable('visitor_invite')
      const parsed = parseSubjectArg(args)
      if (!parsed.ok) return errorResponse(`visitor_invite refused: ${parsed.message} (VISITOR_SUBJECT_INVALID)`)
      const result = await service.invite(parsed.subject, {
        ...(typeof args.ttlDays === 'number' && args.ttlDays > 0 ? { ttlMs: args.ttlDays * DAY_MS } : {}),
        ...(typeof args.note === 'string' && args.note.trim() ? { note: args.note.trim() } : {}),
      })
      if (!result.ok) return errorResponse(`visitor_invite refused: ${result.message} (${result.code})`)
      const verb = result.replaced ? 'Renewed visitor grant for' : 'Granted visitor access to'
      return successResponse(`${verb} ${formatGrant(result.grant, now())}.`)
    },

    async revoke(args) {
      const service = getService()
      if (!service) return unavailable('visitor_revoke')
      const parsed = parseSubjectArg(args)
      if (!parsed.ok) return errorResponse(`visitor_revoke refused: ${parsed.message} (VISITOR_SUBJECT_INVALID)`)
      const result = await service.revoke(parsed.subject)
      if (!result.ok) return errorResponse(`visitor_revoke refused: ${result.message} (${result.code})`)
      return successResponse(`Revoked visitor access for ${visitorSubjectLabel(result.grant.subject)}.`)
    },

    async list() {
      const service = getService()
      if (!service) return unavailable('visitor_list')
      const grants = service.list()
      if (grants.length === 0) return successResponse('No visitor grants are active.')
      const lines = [`${grants.length} active visitor grant(s):`, '']
      for (const grant of grants) {
        lines.push(`- ${formatGrant(grant, now())}${grant.note ? ` — ${grant.note}` : ''}`)
      }
      return successResponse(lines.join('\n'))
    },
  }
}