/**
 * W1-12 (#1509) — `automation_rule` settings service (UI-SPEC §24: settings API
 * shape only; the canvas UI is out of scope).
 *
 * The same view shape is served by the local authority (this service, backed by
 * `SqliteRulesStore`) and by the workspace service
 * (`apps/workspace-service/src/modules/rules/settings.ts`, backed by Postgres
 * and enforcing the admin / per-user split of DATA-MODEL §5.16).
 */

import {
  RULE_IDS,
  defaultRuleSettings,
  isRuleId,
  type RuleId,
  type RuleSettings,
} from '@rox/core/automation'
import { RULE_PARAMS_SCHEMAS, automationRuleUpdateSchema, type AutomationRuleUpdate, type AutomationRuleView } from '@rox/shared/automation'
import type { RuleSettingsRow, RuleSettingsStore } from './store'
import { mergeParams } from './host'

export const RULE_SCOPE: Readonly<Record<RuleId, 'workspace' | 'principal'>> = {
  R1: 'principal', R2: 'workspace', R3: 'workspace', R4: 'workspace', R5: 'workspace',
}

export interface RuleSettingsActor {
  principalId: string
  /** Workspace admins manage R2–R5; R1 is per-user. */
  isAdmin: boolean
}

export class RuleSettingsError extends Error {
  constructor(readonly code: 'INVALID_PAYLOAD' | 'FORBIDDEN' | 'NOT_FOUND', message: string) {
    super(message)
    this.name = 'RuleSettingsError'
  }
}

function requireRuleId(value: string): RuleId {
  if (!isRuleId(value)) throw new RuleSettingsError('NOT_FOUND', `Unknown rule: ${value}`)
  return value
}

/** Validate a params patch against the rule's schema. */
export function validateRuleParams(ruleId: RuleId, params: Record<string, unknown>): Record<string, unknown> {
  const schema = RULE_PARAMS_SCHEMAS[ruleId]
  if (!schema) return params
  const parsed = schema.safeParse(params)
  if (!parsed.success) throw new RuleSettingsError('INVALID_PAYLOAD', `Invalid params for ${ruleId}`)
  return parsed.data as Record<string, unknown>
}

/** Effective view of one rule from the stored rows (per-principal row wins). */
export function ruleView(ruleId: RuleId, rows: readonly RuleSettingsRow[], principalId?: string | null): AutomationRuleView {
  const scoped = principalId ? rows.find(row => row.ruleId === ruleId && row.principalId === principalId) : undefined
  const workspace = rows.find(row => row.ruleId === ruleId && row.principalId === null)
  const effective = scoped ?? workspace
  if (!effective) {
    const defaults = defaultRuleSettings(ruleId)
    return { ruleId, scope: RULE_SCOPE[ruleId], enabled: defaults.enabled, params: {}, source: 'default' }
  }
  return {
    ruleId,
    scope: RULE_SCOPE[ruleId],
    enabled: effective.enabled,
    params: mergeParams(workspace?.params ?? {}, effective.params),
    source: scoped ? 'principal' : 'workspace',
    ...(effective.updatedAt ? { updatedAt: effective.updatedAt } : {}),
    ...(effective.updatedBy ? { updatedBy: effective.updatedBy } : {}),
  }
}

export function ruleViews(rows: readonly RuleSettingsRow[], principalId?: string | null): AutomationRuleView[] {
  return RULE_IDS.map(ruleId => ruleView(ruleId, rows, principalId))
}

export interface RuleSettingsServiceOptions {
  store: RuleSettingsStore
  workspaceId: string
  now?: () => Date
  newId?: () => string
  /** Host policy: only admins may flip R2–R5 (DATA-MODEL §5.16 "Opt-out"). */
  isAdmin?: (actor: RuleSettingsActor) => boolean | Promise<boolean>
}

export class RuleSettingsService {
  constructor(private readonly options: RuleSettingsServiceOptions) {}

  async list(actor: RuleSettingsActor): Promise<AutomationRuleView[]> {
    const rows = await this.options.store.listSettings(this.options.workspaceId)
    return ruleViews(rows, actor.principalId)
  }

  async effective(ruleId: string, principalId?: string | null): Promise<RuleSettings> {
    const id = requireRuleId(ruleId)
    const row = await this.options.store.read(this.options.workspaceId, id, principalId ?? null)
    if (!row) return defaultRuleSettings(id)
    const workspaceRow = principalId ? await this.options.store.read(this.options.workspaceId, id, null) : null
    return {
      ruleId: id,
      enabled: row.enabled,
      params: mergeParams(workspaceRow?.params ?? {}, row.params),
      source: principalId ? 'principal' : 'workspace',
    }
  }

  /** Apply a settings patch; returns the effective view of the rule. */
  async update(ruleId: string, patch: unknown, actor: RuleSettingsActor): Promise<AutomationRuleView> {
    const id = requireRuleId(ruleId)
    const parsed = automationRuleUpdateSchema.safeParse(patch)
    if (!parsed.success) throw new RuleSettingsError('INVALID_PAYLOAD', `Invalid ${id} settings update`)
    const update: AutomationRuleUpdate = parsed.data
    if (RULE_SCOPE[id] === 'workspace') {
      const admin = this.options.isAdmin ? await this.options.isAdmin(actor) : false
      if (!admin) throw new RuleSettingsError('FORBIDDEN', `${id} is managed by workspace admins`)
      if (update.principalId) throw new RuleSettingsError('INVALID_PAYLOAD', `${id} is a workspace rule`)
    } else if (update.principalId && update.principalId !== actor.principalId) {
      throw new RuleSettingsError('FORBIDDEN', `${id} settings are per user`)
    }
    const principalId = RULE_SCOPE[id] === 'principal' ? actor.principalId : null
    const current = await this.options.store.read(this.options.workspaceId, id, principalId)
    const params = update.params ? validateRuleParams(id, update.params) : current?.params ?? {}
    const now = (this.options.now?.() ?? new Date()).toISOString()
    await this.options.store.upsert({
      automationRuleId: current?.automationRuleId ?? this.options.newId?.() ?? `${this.options.workspaceId}:${id}:${principalId ?? 'workspace'}`,
      ruleId: id,
      workspaceId: this.options.workspaceId,
      enabled: update.enabled ?? current?.enabled ?? true,
      params,
      scope: RULE_SCOPE[id],
      principalId,
      updatedBy: actor.principalId,
      updatedAt: now,
    })
    const rows = await this.options.store.listSettings(this.options.workspaceId)
    return ruleView(id, rows, RULE_SCOPE[id] === 'principal' ? actor.principalId : null)
  }
}