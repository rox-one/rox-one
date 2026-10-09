/**
 * W1-12 (#1509) — `automation_rule` settings API (UI-SPEC §24: settings API
 * shape only; the Automations canvas is #1096–#1100 and stays out of scope).
 *
 *   GET  /v1/workspaces/{ws}/automation/rules                  → rules + effective settings
 *   PUT  /v1/workspaces/{ws}/automation/rules/{ruleId}         → update enabled / params
 *   GET  /v1/workspaces/{ws}/automation/executions             → history (ruleId, status, limit)
 *   POST /v1/workspaces/{ws}/automation/executions/{key}/retry → re-run the pending steps
 *
 * Check order mirrors the other domain routes: path decode → availability →
 * method → query → bearer → body → revalidate → execute. R1 is per user;
 * R2–R5 are workspace-level and admin-only (DATA-MODEL §5.16) — the role comes
 * from `workspace_member` through the runtime.
 */

import { IdentityDomainError } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { isRuleId, skipReasonFromMarker } from '@rox/core/automation'
import { automationRulesResponseSchema, ruleExecutionsResponseSchema, type AutomationRuleView } from '@rox/shared/automation'
import { RuleSettingsError } from '../../../../../packages/server-core/src/rules/settings.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import { AuthenticationUnavailableError } from '../../auth/verified-actor.ts'
import { HttpFailure, bearer, defineRoute, jsonBody, readBody, send, type WorkspaceRouteContext } from '../../routing.ts'
import type { WorkspaceRulesRuntime } from './runtime.ts'

export interface WorkspaceAutomationHttpAuthority {
  rules: WorkspaceRulesRuntime
  /** Live flag check (the route answers 404 while `automation.rules.v1` is off). */
  enabled: () => boolean
}

async function authPhase<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch (error) {
    if (error instanceof AuthenticationUnavailableError) throw new HttpFailure('SERVICE_UNAVAILABLE', 503)
    throw error
  }
}

function requireAutomation(options: WorkspaceRouteContext['options']): WorkspaceAutomationHttpAuthority {
  const automation = options.automation
  if (!automation || !automation.enabled()) throw new HttpFailure('NOT_FOUND', 404)
  return automation
}

interface BoundSession {
  workspaceId: string
  bound: ReturnType<WorkspaceRouteContext['options']['actorResolver']['authenticate']> extends Promise<infer T> ? T : never
}

async function authenticate(ctx: WorkspaceRouteContext, workspaceSegment: string, revalidate: boolean): Promise<BoundSession> {
  let workspaceId: string
  try { workspaceId = requireUuid(decodeURIComponent(workspaceSegment)) }
  catch { throw new IdentityDomainError('INVALID_PAYLOAD') }
  let bound = await authPhase(() => ctx.options.actorResolver.authenticate(bearer(ctx.req)))
  if (revalidate) bound = await authPhase(() => ctx.options.actorResolver.revalidate(bound))
  requireActor(bound.actor, workspaceId)
  return { workspaceId, bound }
}

function settingsError(error: unknown): never {
  if (error instanceof RuleSettingsError) {
    if (error.code === 'NOT_FOUND') throw new HttpFailure('NOT_FOUND', 404)
    if (error.code === 'FORBIDDEN') throw new IdentityDomainError('FORBIDDEN')
    throw new IdentityDomainError('INVALID_PAYLOAD')
  }
  throw error
}

export const automationRulesRoute = defineRoute<{ workspaceSegment: string; ruleId?: string }>({
  name: 'automation.rules',
  match(path) {
    const single = /^\/v1\/workspaces\/([^/]+)\/automation\/rules\/([^/]+)$/.exec(path)
    if (single?.[1] !== undefined && single[2] !== undefined) return { workspaceSegment: single[1], ruleId: decodeURIComponent(single[2]) }
    const list = /^\/v1\/workspaces\/([^/]+)\/automation\/rules$/.exec(path)
    return list?.[1] !== undefined ? { workspaceSegment: list[1] } : null
  },
  async handle(ctx, match) {
    const automation = requireAutomation(ctx.options)
    if (match.ruleId === undefined) {
      if (ctx.req.method !== 'GET') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'GET')
      const { workspaceId, bound } = await authenticate(ctx, match.workspaceSegment, false)
      const rules: AutomationRuleView[] = await automation.rules.settingsFor(workspaceId).list({
        principalId: bound.actor.principalId,
        isAdmin: await automation.rules.isAdmin(workspaceId, bound.actor.principalId),
      })
      send(ctx.res, 200, automationRulesResponseSchema.parse({ enabled: true, rules }))
      return
    }
    if (!isRuleId(match.ruleId)) throw new IdentityDomainError('INVALID_PAYLOAD')
    if (ctx.req.method !== 'PUT') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'PUT')
    const { workspaceId, bound } = await authenticate(ctx, match.workspaceSegment, false)
    const body = jsonBody(await readBody(ctx.req, ctx.maxBytes, ctx.timeoutMs), ctx.req)
    // Post-body revalidation: a revoke during the request must not apply settings.
    const revalidated = await authPhase(() => ctx.options.actorResolver.revalidate(bound))
    requireActor(revalidated.actor, workspaceId)
    try {
      const view = await automation.rules.settingsFor(workspaceId).update(match.ruleId, body, {
        principalId: revalidated.actor.principalId,
        isAdmin: await automation.rules.isAdmin(workspaceId, revalidated.actor.principalId),
      })
      send(ctx.res, 200, view)
    } catch (error) {
      settingsError(error)
    }
  },
})

export const automationExecutionsRoute = defineRoute<{ workspaceSegment: string; key?: string }>({
  name: 'automation.executions',
  match(path) {
    const retry = /^\/v1\/workspaces\/([^/]+)\/automation\/executions\/([^/]+)\/retry$/.exec(path)
    if (retry?.[1] !== undefined && retry[2] !== undefined) return { workspaceSegment: retry[1], key: decodeURIComponent(retry[2]) }
    const list = /^\/v1\/workspaces\/([^/]+)\/automation\/executions$/.exec(path)
    return list?.[1] !== undefined ? { workspaceSegment: list[1] } : null
  },
  async handle(ctx, match) {
    const automation = requireAutomation(ctx.options)
    if (match.key !== undefined) {
      if (ctx.req.method !== 'POST') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'POST')
      const { workspaceId, bound } = await authenticate(ctx, match.workspaceSegment, true)
      if (!(await automation.rules.isAdmin(workspaceId, bound.actor.principalId))) throw new IdentityDomainError('FORBIDDEN')
      const outcome = await automation.rules.retry(workspaceId, match.key)
      if (!outcome) throw new HttpFailure('NOT_FOUND', 404)
      send(ctx.res, 200, { key: outcome.key, status: outcome.status, steps: outcome.steps.length })
      return
    }
    if (ctx.req.method !== 'GET') throw new HttpFailure('METHOD_NOT_ALLOWED', 405, 'GET')
    const { workspaceId } = await authenticate(ctx, match.workspaceSegment, false)
    const ruleId = ctx.params.get('ruleId') ?? undefined
    if (ruleId !== undefined && !isRuleId(ruleId)) throw new IdentityDomainError('INVALID_PAYLOAD')
    const status = ctx.params.get('status') ?? undefined
    const limitParam = ctx.params.get('limit')
    const limit = limitParam === null ? 50 : Number(limitParam)
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new IdentityDomainError('INVALID_PAYLOAD')
    const records = await automation.rules.executionsFor(workspaceId).list(workspaceId, {
      ...(ruleId ? { ruleId } : {}),
      ...(status ? { status: status as never } : {}),
      limit,
    })
    send(ctx.res, 200, ruleExecutionsResponseSchema.parse({
      executions: records.map(record => {
        const skippedReason = skipReasonFromMarker(record.lastError)
        return {
          ruleExecutionId: record.ruleExecutionId,
          ruleId: record.ruleId,
          idempotencyKey: record.idempotencyKey,
          sourceEventId: record.sourceEventId,
          status: record.status,
          // The stored plan is internal; the API exposes the documented step shape.
          steps: record.steps.map(step => ({
            action: step.action,
            command_id: step.command_id,
            status: step.status,
            ...(step.receipt_status ? { receipt_status: step.receipt_status } : {}),
            ...(step.receipt_ref ? { receipt_ref: step.receipt_ref } : {}),
            ...(step.error ? { error: step.error } : {}),
            ...(step.attempts !== undefined ? { attempts: step.attempts } : {}),
            ...(step.duration_ms !== undefined ? { duration_ms: step.duration_ms } : {}),
            ...(step.finished_at ? { finished_at: step.finished_at } : {}),
          })),
          attempts: record.attempts,
          ...(record.lastError ? { lastError: record.lastError } : {}),
          ...(skippedReason ? { skippedReason } : {}),
          createdAt: record.createdAt,
          ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
        }
      }),
    }))
  },
})

export const RULES_ROUTES = [automationRulesRoute, automationExecutionsRoute] as const