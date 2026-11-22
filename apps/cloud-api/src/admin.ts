/**
 * Staff panel API for Rox Cloud (BYOK).
 *
 * A second, separate surface from the customer API in `app.ts`: it answers
 * only under `/admin/`, only with the shared staff key, and it never takes a
 * tenant id from a request as a fact — every row it prints comes from the
 * control-plane stores themselves.
 *
 * Three rules hold here:
 * - one credential, constant-time compare: a wrong key and a missing key get
 *   the same answer, and a deployment without `ROX_ADMIN_KEY` answers 404
 *   instead of inventing a default password;
 * - the credential and key views are allowlist projections: `ciphertext`,
 *   `iv`, `tag` and the plaintext secret are never read, so they cannot leak;
 * - every staff write leaves an audit row with the reason that was given; a
 *   write without a reason is refused before anything changes.
 *
 * The two-person kill switch meets one staff key here. The switch refuses an
 * approval by the same identity that requested it, so the request and the
 * approval are recorded as two named steps (`staff:requester`, then `staff`):
 * one staff key cannot arm the switch in a single action, and the trail names
 * both steps.
 */

import { createHash, timingSafeEqual } from 'node:crypto'

import type { KeyStore, ProviderCredential } from '../../../packages/cloud-keys/src/index.ts'
import { listCredentials } from '../../../packages/cloud-keys/src/index.ts'
import type {
  AuditAction,
  AuditLog,
  KillProvider,
  KillRequest,
  KillScope,
  KillSwitch,
} from '../../../packages/cloud-ops/src/index.ts'
import { OpsError } from '../../../packages/cloud-ops/src/index.ts'
import type { Account, LedgerEntry, MoneyStore } from '../../../packages/cloud-runner/src/entitlement.ts'
import { topUp } from '../../../packages/cloud-runner/src/entitlement.ts'
import type { AccountLimits } from '../../../packages/cloud-runner/src/limits.ts'
import type { SandboxState } from '../../../packages/cloud-runner/src/sandbox.ts'
import { CloudRunnerError } from '../../../packages/cloud-runner/src/types.ts'
import type { MemoryStore, ApiKeyRecord, RequestRow, SandboxRecord, Tenant } from './store.ts'
import { REQUEST_LOG_CAPACITY, SCOPES, nextId } from './store.ts'
import { generateApiKey } from './auth.ts'

// ============================================================
// Options
// ============================================================

export interface AdminOptions {
  /** Control-plane state: tenants, API keys, sandboxes. */
  readonly store: MemoryStore
  /** Encrypted customer provider keys; only metadata is read here. */
  readonly keyStore: KeyStore
  /** Wallet and ledger; account ids are tenant ids. */
  readonly moneyStore: MoneyStore
  /** Append-only staff trail. */
  readonly audit: AuditLog
  readonly killSwitch: KillSwitch
  /**
   * Ceilings the panel prints next to an account. The same object the runtime
   * enforces, so the panel never advertises a limit the boot path does not use.
   */
  readonly limits: AccountLimits
  /**
   * Shared staff key. Absent means the panel is not configured and every
   * route answers 404 — no default key is invented.
   */
  readonly adminKey?: string
  /**
   * Platform credentials Rox pays with, as `{provider, last4}`. Only the last
   * four characters ever reach the panel; the key itself lives in `platform.ts`.
   */
  readonly platformKeys?: () => readonly { readonly provider: string; readonly last4: string | null }[]
  /**
   * The request journal of the front door. The orchestrator passes the ring
   * that records every call, staff and support included; without it the panel
   * falls back to the customer API's own ring.
   */
  readonly requests?: () => readonly RequestRow[]
  /** Stop one machine at its provider and settle the wallet. */
  readonly stopResource: (tenantId: string, sandboxId: string) => Promise<void>
  readonly now?: () => number
}

export interface AdminApp {
  handle(req: Request): Promise<Response>
}

// ============================================================
// Errors
// ============================================================

const STATUS_BY_CODE = {
  invalid_request: 400,
  authentication_required: 401,
  permission_denied: 403,
  not_found: 404,
  conflict: 409,
  provider_error: 502,
} as const

type AdminErrorCode = keyof typeof STATUS_BY_CODE

const TYPE_BY_CODE: Record<AdminErrorCode, string> = {
  invalid_request: 'invalid_request_error',
  authentication_required: 'authentication_error',
  permission_denied: 'permission_error',
  not_found: 'not_found_error',
  conflict: 'conflict_error',
  provider_error: 'provider_error',
}

/** Same envelope as the public API, so the panel parses one shape everywhere. */
class AdminError extends Error {
  readonly code: AdminErrorCode
  readonly status: number

  constructor(code: AdminErrorCode, message: string) {
    super(message)
    this.name = 'AdminError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
  }
}

function fromOpsError(err: OpsError): AdminError {
  switch (err.code) {
    case 'not_found':
      return new AdminError('not_found', err.message)
    case 'second_person_required':
      return new AdminError('conflict', err.message)
    case 'invalid_state':
      return new AdminError('conflict', err.message)
    case 'secret_in_audit':
    case 'invalid_input':
    default:
      return new AdminError('invalid_request', err.message)
  }
}

function toAdminError(err: unknown): AdminError {
  if (err instanceof AdminError) return err
  if (err instanceof OpsError) return fromOpsError(err)
  // A provider failure while stopping is an upstream failure, not a bad request.
  if (err instanceof CloudRunnerError) {
    return new AdminError('provider_error', `Провайдер не смог остановить машину: ${err.message}`)
  }
  const detail = err instanceof Error ? err.message : String(err)
  return new AdminError('provider_error', `Непредвиденная ошибка: ${detail}`)
}

// ============================================================
// Small helpers
// ============================================================

const DEFAULT_AUDIT_LIMIT = 100
const MAX_AUDIT_LIMIT = 500

/** One staff credit: at least a cent, and never more than 100 000 dollars in cents. */
const MAX_CREDIT_CENTS = 10_000_000
/** The reason is free text, but a wallet row must stay readable. */
const MAX_REASON_CHARS = 200
/** A tenant detail shows the newest staff actions, not the whole journal. */
const TENANT_AUDIT_LIMIT = 50

/** Identities recorded by the switch. See the note at the top of the file. */
const STAFF_ACTOR = 'staff'
const STAFF_REQUESTER = 'staff:requester'

/**
 * `AuditAction` is a closed union in `@rox/cloud-ops`; a key rotation is a new
 * staff action and keeps its own name in the trail. One documented widening
 * here, the same way the runner widens its gate codes.
 */
const ROTATE_KEY_ACTION = 'tenant.rotate_key' as AuditAction

const KILL_PROVIDERS: readonly KillProvider[] = ['daytona', 'modal', 'e2b']

const ALL_STATES: readonly SandboxState[] = [
  'queued',
  'starting',
  'running',
  'paused',
  'stopping',
  'stopped',
  'failed',
  'expired',
]

/** States that still occupy capacity; the rest are finished. */
const ACTIVE_STATES: readonly SandboxState[] = ['queued', 'starting', 'running', 'paused', 'stopping']

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Same-length comparison: both sides are hashed first, so timing leaks nothing. */
function sameSecret(presented: string, expected: string): boolean {
  const left = createHash('sha256').update(presented, 'utf8').digest()
  const right = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(left, right)
}

function requireReason(value: unknown, field: string, action: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AdminError('invalid_request', `Поле ${field} обязательно: причина действия «${action}»`)
  }
  return value.trim()
}

/** Same rule, plus the length a wallet or limit change is allowed to carry. */
function requireReasonUnder(value: unknown, field: string, action: string): string {
  const reason = requireReason(value, field, action)
  if (reason.length > MAX_REASON_CHARS) {
    throw new AdminError(
      'invalid_request',
      `Поле ${field} должно быть не длиннее ${MAX_REASON_CHARS} символов, получено ${reason.length}`,
    )
  }
  return reason
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (text.trim().length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AdminError('invalid_request', 'Тело запроса не является корректным JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AdminError('invalid_request', 'Тело запроса должно быть объектом JSON')
  }
  return parsed as Record<string, unknown>
}

// ============================================================
// App
// ============================================================

export function createAdminApp(options: AdminOptions): AdminApp {
  const { store, keyStore, moneyStore, audit, killSwitch, limits, adminKey, stopResource } = options
  const now = options.now ?? (() => Date.now())

  // ---------- projections ----------

  function resourceJson(record: SandboxRecord): Record<string, unknown> {
    return {
      id: record.id,
      tenant_id: record.tenantId,
      provider: record.providerId,
      state: record.state,
      created_at: iso(record.createdAt),
      expires_at: record.expiresAt === undefined ? null : iso(record.expiresAt),
      cost_cents: record.costCents,
      region: record.region ?? record.spec.region ?? null,
      billing_mode: record.billingMode ?? 'byok',
      rate_cents_per_hour: record.rateCentsPerHour ?? null,
      // The stored request, in the same shape the customer API reports, so the
      // staff table can print cpu / memory / disk / GPU instead of «не передан».
      spec: {
        os: record.spec.os,
        cpu: record.spec.cpu,
        memoryGb: record.spec.memoryGb,
        diskGb: record.spec.diskGb ?? null,
        gpu: record.spec.gpu ?? null,
        image: record.spec.image ?? null,
        snapshot: record.spec.snapshot ?? null,
        region: record.region ?? record.spec.region ?? null,
        ttlSec: record.spec.ttlSec ?? null,
      },
    }
  }

  function tenantJson(tenant: Tenant): Record<string, unknown> {
    const account = moneyStore.getAccount(tenant.id)
    return {
      id: tenant.id,
      name: tenant.name,
      created_at: iso(tenant.createdAt),
      guest: tenant.guest === true,
      balance_cents: account?.balanceCents ?? 0,
      reserved_cents: account?.reservedCents ?? 0,
      month_spent_cents: account?.monthSpentCents ?? 0,
      monthly_cap_cents: account?.monthlyCapCents ?? 0,
      sandboxes: store.sandboxesOf(tenant.id).length,
      credentials: listCredentials(keyStore, tenant.id).length,
      keys: tenantApiKeys(tenant.id).length,
    }
  }

  /** Every key of one tenant, newest first, including the revoked ones. */
  function tenantApiKeys(tenantId: string): ApiKeyRecord[] {
    const rows: ApiKeyRecord[] = []
    for (const record of store.apiKeys.values()) {
      if (record.tenantId === tenantId) rows.push(record)
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  }

  /**
   * A customer key as the panel shows it: recognition data, the wallet behind
   * it and whether it still works. The secret and its hash stay out.
   */
  function apiKeyJson(record: ApiKeyRecord): Record<string, unknown> {
    const tenant = store.tenants.get(record.tenantId)
    const account = moneyStore.getAccount(record.tenantId)
    return {
      id: record.id,
      tenant_id: record.tenantId,
      tenant_name: tenant?.name ?? null,
      guest: tenant?.guest === true,
      prefix: record.prefix,
      last4: record.last4,
      scopes: record.scopes,
      created_at: iso(record.createdAt),
      last_used_at: record.lastUsedAt === undefined ? null : iso(record.lastUsedAt),
      revoked_at: record.revokedAt === undefined ? null : iso(record.revokedAt),
      balance_cents: account?.balanceCents ?? 0,
      reserved_cents: account?.reservedCents ?? 0,
    }
  }

  /**
   * Allowlist projection of one credential. `ciphertext`, `iv`, `tag` and the
   * plaintext secret are never read here, so they cannot reach a response.
   */
  function credentialJson(credential: ProviderCredential): Record<string, unknown> {
    return {
      id: credential.id,
      tenant_id: credential.tenantId,
      provider: credential.provider,
      label: credential.label,
      fingerprint: credential.fingerprint,
      last4: credential.last4,
      status: credential.status,
      spend_cap_cents: credential.spendCapCents,
      regions: credential.regions ?? [],
      products: credential.products ?? [],
      health: credential.health,
      created_at: credential.createdAt,
      checked_at: credential.checkedAt,
      expires_at: credential.expiresAt ?? null,
    }
  }

  function killJson(request: KillRequest): Record<string, unknown> {
    return {
      id: request.id,
      scope: request.scope,
      enabled: request.enabled,
      reason: request.reason,
      by: request.by,
      approved_by: request.approvedBy ?? null,
      at: request.at,
      state: request.state,
    }
  }

  function auditJson(entry: {
    id: string
    at: string
    actorId: string
    action: string
    targetType: string
    targetId: string
    reason: string
    ticket?: string
    details?: Record<string, unknown>
  }): Record<string, unknown> {
    return {
      id: entry.id,
      at: entry.at,
      actor_id: entry.actorId,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId,
      reason: entry.reason,
      ticket: entry.ticket ?? null,
      details: entry.details ?? null,
    }
  }

  /**
   * The tenant detail prints only what the panel shows: the reason and the
   * actor, not the chain links. `hash` and `prevHash` would invite a client to
   * verify a chain it cannot read in full.
   */
  function detailAuditJson(entry: {
    id: string
    at: string
    actorId: string
    action: string
    targetType: string
    targetId: string
    reason: string
  }): Record<string, unknown> {
    return {
      id: entry.id,
      actor_id: entry.actorId,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId,
      reason: entry.reason,
      at: entry.at,
    }
  }

  /** Account view: a tenant without a wallet reads as zeros, never as an error. */
  function accountJson(account: Account | undefined): Record<string, unknown> {
    return {
      paid: account?.paid ?? false,
      balance_cents: account?.balanceCents ?? 0,
      reserved_cents: account?.reservedCents ?? 0,
      monthly_cap_cents: account?.monthlyCapCents ?? 0,
      month_spent_cents: account?.monthSpentCents ?? 0,
    }
  }

  /**
   * One ledger row. `counterparty` stays out: the panel shows a wallet, not the
   * double-entry bookkeeping behind it.
   */
  function ledgerJson(entry: LedgerEntry): Record<string, unknown> {
    return {
      id: entry.id,
      kind: entry.kind,
      amount_cents: entry.amountCents,
      balance_after_cents: entry.balanceAfterCents,
      reserved_after_cents: entry.reservedAfterCents,
      ref: entry.ref,
      at: iso(entry.at),
      ...(entry.shortfallCents !== undefined ? { shortfall_cents: entry.shortfallCents } : {}),
    }
  }

  function limitsJson(value: AccountLimits): Record<string, unknown> {
    return {
      max_concurrent_sandboxes: value.maxConcurrentSandboxes,
      max_cpu_per_sandbox: value.maxCpuPerSandbox,
      max_monthly_cents: value.maxMonthlyCents,
    }
  }

  /** `0` means «не ограничено», so the tighter positive ceiling wins. */
  function tighterCeiling(a: number, b: number): number {
    if (a <= 0) return b
    if (b <= 0) return a
    return Math.min(a, b)
  }

  /**
   * What one tenant is actually held to: the deployment ceiling, narrowed by
   * the tenant's own profile. The same numbers `beforeCreate` enforces.
   */
  function effectiveLimits(tenant: Tenant): AccountLimits {
    const own = tenant.limits
    if (own === undefined) return limits
    return {
      maxConcurrentSandboxes: tighterCeiling(limits.maxConcurrentSandboxes, own.maxConcurrentSandboxes),
      maxCpuPerSandbox: tighterCeiling(limits.maxCpuPerSandbox, own.maxCpuPerSandbox),
      maxMonthlyCents: tighterCeiling(limits.maxMonthlyCents, own.maxMonthlyCents),
    }
  }

  // ---------- authentication ----------

  function requireStaff(req: Request): void {
    const header = (req.headers.get('authorization') ?? '').trim()
    const match = /^bearer\s+(.+)$/i.exec(header)
    if (!match || adminKey === undefined) {
      throw new AdminError(
        'authentication_required',
        'Нужен ключ дежурного: заголовок Authorization: Bearer …',
      )
    }
    if (!sameSecret(match[1].trim(), adminKey)) {
      throw new AdminError('authentication_required', 'Ключ дежурного не совпадает')
    }
  }

  // ---------- overview ----------

  function overviewRoute(): Response {
    let activeSandboxes = 0
    for (const record of store.sandboxes.values()) {
      if (ACTIVE_STATES.includes(record.state)) activeSandboxes += 1
    }
    let credentials = 0
    let balanceCents = 0
    for (const tenant of store.tenants.values()) {
      credentials += listCredentials(keyStore, tenant.id).length
      balanceCents += moneyStore.getAccount(tenant.id)?.balanceCents ?? 0
    }
    const openKillSwitches = killSwitch.list().filter((entry) => entry.state === 'active').length
    return json(200, {
      tenants: store.tenants.size,
      guests: [...store.tenants.values()].filter((tenant) => tenant.guest === true).length,
      active_sandboxes: activeSandboxes,
      credentials,
      balance_cents_total: balanceCents,
      open_kill_switches: openKillSwitches,
      // Last four only: the panel must show that a platform key exists, never
      // the key itself.
      platform_keys: (options.platformKeys?.() ?? []).map((entry) => ({
        provider: entry.provider,
        present: entry.last4 !== null,
        last4: entry.last4,
      })),
    })
  }

  // ---------- tenants ----------

  function tenantsRoute(): Response {
    const data = [...store.tenants.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(tenantJson)
    return json(200, { object: 'list', data })
  }

  function requireTenant(id: string): Tenant {
    const tenant = store.tenants.get(id)
    if (!tenant) throw new AdminError('not_found', 'Арендатор не найден')
    return tenant
  }

  /**
   * A tenant can exist before its wallet does; the first staff write creates
   * it empty. The `paid` flag is not invented here — money in is not the same
   * decision as permission to provision, so the panel sets that one explicitly.
   */
  function ensureAccount(tenant: Tenant): Account {
    const existing = moneyStore.getAccount(tenant.id)
    if (existing !== undefined) return existing
    const created: Account = {
      id: tenant.id,
      paid: false,
      balanceCents: 0,
      reservedCents: 0,
      monthlyCapCents: 0,
      monthSpentCents: 0,
    }
    moneyStore.saveAccount(created)
    return created
  }

  /** One tenant as the panel reads it: wallet, ceilings, machines, money trail. */
  function tenantDetailRoute(id: string): Response {
    const tenant = requireTenant(id)
    // Newest first everywhere: an operator looks at what just happened.
    const sandboxes = store
      .sandboxesOf(tenant.id)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
      .map(resourceJson)
    // Newest first by time; rows written at the same instant stay in append
    // order, so the customer side of a double-entry pair reads before its
    // counter-entry instead of after it.
    const ledger = [...moneyStore.listLedger(tenant.id)]
      .sort((a, b) => b.at - a.at)
      .map(ledgerJson)
    const auditRows = audit
      .list({ targetId: tenant.id, limit: TENANT_AUDIT_LIMIT })
      .reverse()
      .map(detailAuditJson)
    return json(200, {
      tenant: tenantJson(tenant),
      account: accountJson(moneyStore.getAccount(tenant.id)),
      limits: limitsJson(effectiveLimits(tenant)),
      sandboxes,
      ledger,
      audit: auditRows,
      keys: tenantApiKeys(tenant.id).map(apiKeyJson),
    })
  }

  /** Credit the wallet. The money goes through `topUp`, this route only guards it. */
  async function creditRoute(id: string, req: Request): Promise<Response> {
    const tenant = requireTenant(id)
    const body = await readJson(req)
    const amount = body.amountCents
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > MAX_CREDIT_CENTS) {
      throw new AdminError(
        'invalid_request',
        `Поле amountCents обязательно и должно быть целым числом центов от 1 до ${MAX_CREDIT_CENTS}`,
      )
    }
    const reason = requireReasonUnder(body.reason, 'reason', 'пополнение кошелька')
    ensureAccount(tenant)
    const result = topUp(moneyStore, tenant.id, amount, now())
    // The customer side of the double-entry pair: the money that came in.
    const entry = result.entries.find((row) => row.counterparty === 'customer')
    if (entry === undefined) {
      throw new AdminError('provider_error', 'Кошелёк не записал пополнение')
    }
    audit.append({
      actorId: STAFF_ACTOR,
      action: 'tenant.credit',
      targetType: 'tenant',
      targetId: tenant.id,
      reason,
      details: {
        amount_cents: amount,
        balance_after_cents: result.account.balanceCents,
        ledger_entry: entry.id,
      },
    })
    return json(200, {
      tenant: tenantJson(tenant),
      account: accountJson(result.account),
      entry: ledgerJson(entry),
    })
  }

  /**
   * Change the ceilings or the paid flag. Every write needs a reason.
   *
   * Concurrency, cores and the monthly cap live on the tenant profile, which
   * `beforeCreate` reads; the monthly number is mirrored into the wallet's
   * `monthlyCapCents` so both sides of the pilot agree. `monthlyCapCents` stays
   * accepted as the older name for the same ceiling.
   */
  async function limitsRoute(id: string, req: Request): Promise<Response> {
    const tenant = requireTenant(id)
    const body = await readJson(req)
    const rawCap = body.monthlyCapCents
    const rawMonthly = body.maxMonthlyCents
    const rawPaid = body.paid
    const rawConcurrency = body.maxConcurrentSandboxes
    const rawCpu = body.maxCpuPerSandbox
    if (
      rawCap === undefined &&
      rawMonthly === undefined &&
      rawPaid === undefined &&
      rawConcurrency === undefined &&
      rawCpu === undefined
    ) {
      throw new AdminError(
        'invalid_request',
        'Нужно хотя бы одно поле: maxConcurrentSandboxes, maxCpuPerSandbox, maxMonthlyCents (или monthlyCapCents) либо paid',
      )
    }
    const ceiling = (value: unknown, field: string): number => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new AdminError('invalid_request', `Поле ${field} должно быть целым числом не меньше нуля`)
      }
      return value
    }
    if (rawCap !== undefined && rawMonthly !== undefined && rawCap !== rawMonthly) {
      throw new AdminError(
        'invalid_request',
        'monthlyCapCents и maxMonthlyCents — одно и то же; задайте одно значение',
      )
    }
    const monthly =
      rawMonthly !== undefined
        ? ceiling(rawMonthly, 'maxMonthlyCents')
        : rawCap !== undefined
          ? ceiling(rawCap, 'monthlyCapCents')
          : undefined
    const concurrency =
      rawConcurrency === undefined
        ? undefined
        : ceiling(rawConcurrency, 'maxConcurrentSandboxes')
    const cpu = rawCpu === undefined ? undefined : ceiling(rawCpu, 'maxCpuPerSandbox')
    let paid: boolean | undefined
    if (rawPaid !== undefined) {
      if (typeof rawPaid !== 'boolean') {
        throw new AdminError('invalid_request', 'Поле paid должно быть true или false')
      }
      paid = rawPaid
    }
    const reason = requireReasonUnder(body.reason, 'reason', 'изменение лимитов арендатора')

    const previous = tenant.limits
    const profileChanged = monthly !== undefined || concurrency !== undefined || cpu !== undefined
    if (profileChanged) {
      store.tenants.set(tenant.id, {
        ...tenant,
        limits: {
          maxConcurrentSandboxes: concurrency ?? previous?.maxConcurrentSandboxes ?? 0,
          maxCpuPerSandbox: cpu ?? previous?.maxCpuPerSandbox ?? 0,
          maxMonthlyCents: monthly ?? previous?.maxMonthlyCents ?? 0,
          ...(previous?.maxTtlSec === undefined ? {} : { maxTtlSec: previous.maxTtlSec }),
        },
      })
    }

    const base = ensureAccount(tenant)
    const next: Account = {
      ...base,
      monthlyCapCents: monthly ?? base.monthlyCapCents,
      paid: paid ?? base.paid,
    }
    moneyStore.saveAccount(next)
    audit.append({
      actorId: STAFF_ACTOR,
      action: 'tenant.limits',
      targetType: 'tenant',
      targetId: tenant.id,
      reason,
      details: {
        ...(monthly !== undefined ? { monthly_cap_cents: monthly } : {}),
        ...(concurrency !== undefined ? { max_concurrent_sandboxes: concurrency } : {}),
        ...(cpu !== undefined ? { max_cpu_per_sandbox: cpu } : {}),
        ...(paid !== undefined ? { paid } : {}),
      },
    })
    const updated = store.tenants.get(tenant.id) ?? tenant
    return json(200, {
      tenant: tenantJson(updated),
      account: accountJson(next),
      limits: limitsJson(effectiveLimits(updated)),
    })
  }

  /**
   * Replace every key of one tenant with a single new one.
   *
   * Revoking rather than deleting keeps the trail readable — the panel shows
   * what a rotation replaced — while authentication rejects the old secrets
   * from this instant. The new secret appears in this response and never again.
   */
  async function rotateKeyRoute(id: string, req: Request): Promise<Response> {
    const tenant = requireTenant(id)
    const body = await readJson(req)
    const reason = requireReasonUnder(body.reason, 'reason', 'перевыпуск ключа')
    const at = now()
    const revoked = store.revokeTenantKeys(tenant.id, at)
    const generated = generateApiKey()
    const record: ApiKeyRecord = {
      id: nextId('key_'),
      tenantId: tenant.id,
      prefix: generated.prefix,
      last4: generated.last4,
      hash: generated.hash,
      scopes: SCOPES,
      createdAt: at,
    }
    store.addApiKey(record)
    audit.append({
      actorId: STAFF_ACTOR,
      action: ROTATE_KEY_ACTION,
      targetType: 'tenant',
      targetId: tenant.id,
      reason,
      details: { revoked_keys: revoked, key_id: record.id, key_last4: record.last4 },
    })
    return json(200, {
      tenant: tenantJson(tenant),
      revoked,
      key: {
        id: record.id,
        api_key: generated.secret,
        prefix: record.prefix,
        last4: record.last4,
        scopes: record.scopes,
        created_at: iso(record.createdAt),
      },
    })
  }

  // ---------- resources ----------

  function resourcesRoute(url: URL): Response {
    const tenantFilter = url.searchParams.get('tenant')
    const providerFilter = url.searchParams.get('provider')
    const stateFilter = url.searchParams.get('state')
    if (stateFilter !== null && !(ALL_STATES as readonly string[]).includes(stateFilter)) {
      throw new AdminError(
        'invalid_request',
        `Параметр state должен быть одним из: ${ALL_STATES.join(', ')}`,
      )
    }
    const rows: SandboxRecord[] = []
    for (const record of store.sandboxes.values()) {
      if (tenantFilter !== null && record.tenantId !== tenantFilter) continue
      if (providerFilter !== null && record.providerId !== providerFilter) continue
      if (stateFilter !== null && record.state !== stateFilter) continue
      rows.push(record)
    }
    // Newest first: an operator looks at what just happened, not at the oldest.
    rows.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    return json(200, { object: 'list', data: rows.map(resourceJson) })
  }

  async function stopResourceRoute(id: string, req: Request): Promise<Response> {
    const record = store.sandboxes.get(id)
    if (!record) throw new AdminError('not_found', 'Машина не найдена')
    const body = await readJson(req)
    const reason = requireReason(body.reason, 'reason', 'остановка машины')
    await stopResource(record.tenantId, record.id)
    audit.append({
      actorId: STAFF_ACTOR,
      action: 'sandbox.stop',
      targetType: 'sandbox',
      targetId: record.id,
      reason,
      details: {
        tenant_id: record.tenantId,
        provider: record.providerId,
        state: record.state,
        stopped_at: iso(now()),
      },
    })
    return json(200, resourceJson(record))
  }

  // ---------- provider credentials ----------

  function credentialsRoute(): Response {
    const data: Record<string, unknown>[] = []
    const tenants = [...store.tenants.values()].sort((a, b) => a.createdAt - b.createdAt)
    for (const tenant of tenants) {
      for (const credential of listCredentials(keyStore, tenant.id)) data.push(credentialJson(credential))
    }
    return json(200, { object: 'list', data })
  }

  // ---------- kill switch ----------

  function parseScope(value: unknown): KillScope {
    if (value === undefined || value === null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new AdminError('invalid_request', 'Поле scope должно быть объектом {provider?, region?, product?}')
    }
    const raw = value as Record<string, unknown>
    const scope: KillScope = {}
    if (raw.provider !== undefined && raw.provider !== null) {
      if (typeof raw.provider !== 'string' || !(KILL_PROVIDERS as readonly string[]).includes(raw.provider)) {
        throw new AdminError(
          'invalid_request',
          `Поле scope.provider должно быть одним из: ${KILL_PROVIDERS.join(', ')}`,
        )
      }
      scope.provider = raw.provider as KillProvider
    }
    for (const field of ['region', 'product'] as const) {
      const entry = raw[field]
      if (entry === undefined || entry === null) continue
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        throw new AdminError('invalid_request', `Поле scope.${field} должно быть непустой строкой`)
      }
      scope[field] = entry.trim()
    }
    return scope
  }

  function killListRoute(): Response {
    return json(200, { object: 'list', data: killSwitch.list().map(killJson) })
  }

  async function killRequestRoute(req: Request): Promise<Response> {
    const body = await readJson(req)
    const scope = parseScope(body.scope)
    if (typeof body.enabled !== 'boolean') {
      throw new AdminError('invalid_request', 'Поле enabled обязательно: true блокирует, false снимает')
    }
    const reason = requireReason(body.reason, 'reason', 'рубильник')
    const created = killSwitch.request({ scope, enabled: body.enabled, reason }, STAFF_REQUESTER)
    audit.append({
      actorId: STAFF_REQUESTER,
      action: 'killswitch.set',
      targetType: 'killswitch',
      targetId: created.id,
      reason,
      details: { scope: created.scope, enabled: created.enabled, state: created.state },
    })
    return json(200, killJson(created))
  }

  function findKillRequest(id: string): KillRequest {
    const found = killSwitch.list().find((entry) => entry.id === id)
    if (!found) throw new AdminError('not_found', 'Запрос блокировки не найден')
    return found
  }

  async function killApproveRoute(id: string, req: Request): Promise<Response> {
    const existing = findKillRequest(id)
    const body = await readJson(req)
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length > 0
        ? body.reason.trim()
        : `второй сотрудник подтвердил запрос: ${existing.reason}`
    const approved = killSwitch.approve(id, STAFF_ACTOR)
    audit.append({
      actorId: STAFF_ACTOR,
      action: 'killswitch.approve',
      targetType: 'killswitch',
      targetId: approved.id,
      reason,
      details: { scope: approved.scope, enabled: approved.enabled, state: approved.state },
    })
    return json(200, killJson(approved))
  }

  async function killDisableRoute(id: string, req: Request): Promise<Response> {
    const body = await readJson(req)
    const reason = requireReason(body.reason, 'reason', 'снятие блокировки')
    const disabled = killSwitch.disable(id, STAFF_ACTOR, reason)
    audit.append({
      actorId: STAFF_ACTOR,
      action: 'killswitch.set',
      targetType: 'killswitch',
      targetId: disabled.id,
      reason,
      details: { scope: disabled.scope, enabled: disabled.enabled, state: disabled.state },
    })
    return json(200, killJson(disabled))
  }

  // ---------- customer keys ----------

  /** Every customer key with the wallet behind it; revoked rows stay visible. */
  function keysRoute(url: URL): Response {
    const tenantFilter = url.searchParams.get('tenant')
    const data: Record<string, unknown>[] = []
    for (const tenant of [...store.tenants.values()].sort((a, b) => a.createdAt - b.createdAt)) {
      if (tenantFilter !== null && tenant.id !== tenantFilter) continue
      for (const record of tenantApiKeys(tenant.id)) data.push(apiKeyJson(record))
    }
    return json(200, { object: 'list', data })
  }

  // ---------- request journal ----------

  function requestJson(row: RequestRow): Record<string, unknown> {
    return {
      at: iso(row.at),
      method: row.method,
      path: row.path,
      status: row.status,
      duration_ms: row.durationMs,
      tenant_id: row.tenantId ?? null,
      key_last4: row.keyLast4 ?? null,
      ip: row.ip ?? null,
      request_id: row.requestId ?? null,
    }
  }

  /**
   * The newest calls first. The front door's ring is the real journal (it sees
   * staff and support calls too); the customer API's own ring is the fallback
   * for a deployment or test that only wired `createApp`.
   */
  function requestsRoute(url: URL): Response {
    const raw = url.searchParams.get('limit')
    let limit = DEFAULT_AUDIT_LIMIT
    if (raw !== null) {
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_AUDIT_LIMIT) {
        throw new AdminError(
          'invalid_request',
          `limit должен быть целым числом от 1 до ${MAX_AUDIT_LIMIT}`,
        )
      }
      limit = parsed
    }
    const tenantFilter = url.searchParams.get('tenant')
    const source = options.requests?.() ?? store.requests
    const rows = source.filter((row) => tenantFilter === null || row.tenantId === tenantFilter)
    return json(200, {
      object: 'list',
      capacity: REQUEST_LOG_CAPACITY,
      data: rows.slice(-limit).reverse().map(requestJson),
    })
  }

  // ---------- audit ----------

  /**
   * The staff trail with the filters the panel offers: one tenant (the entry's
   * `target_id`), one action, and a lower time bound. `limit` keeps the newest
   * matches, and the answer is newest first.
   */
  function auditRoute(url: URL): Response {
    const raw = url.searchParams.get('limit')
    let limit = DEFAULT_AUDIT_LIMIT
    if (raw !== null) {
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_AUDIT_LIMIT) {
        throw new AdminError(
          'invalid_request',
          `limit должен быть целым числом от 1 до ${MAX_AUDIT_LIMIT}`,
        )
      }
      limit = parsed
    }
    const tenant = url.searchParams.get('tenant')
    const action = url.searchParams.get('action')
    const since = url.searchParams.get('since')
    if (since !== null && Number.isNaN(Date.parse(since))) {
      throw new AdminError(
        'invalid_request',
        'since должен быть датой в формате ISO-8601, например 2026-11-22T00:00:00Z',
      )
    }
    // The store returns the newest N in append order; the journal reads top-down.
    const entries = audit
      .list({
        ...(tenant === null ? {} : { targetId: tenant }),
        ...(action === null ? {} : { action: action as AuditAction }),
        ...(since === null ? {} : { from: since }),
        limit,
      })
      .reverse()
    return json(200, { object: 'list', data: entries.map(auditJson) })
  }

  // ---------- routing ----------

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const segments = url.pathname.split('/').filter((part) => part.length > 0)
    const method = req.method.toUpperCase()

    // The staff JSON API lives under `/v1/admin`, because `/admin/*` is now
    // the staff pages the single-page app serves.
    if (segments[0] !== 'v1' || segments[1] !== 'admin') {
      throw new AdminError('not_found', 'Такого адреса нет')
    }
    requireStaff(req)

    if (segments.length === 3) {
      switch (segments[2]) {
        case 'overview':
          if (method === 'GET') return overviewRoute()
          break
        case 'tenants':
          if (method === 'GET') return tenantsRoute()
          break
        case 'resources':
          if (method === 'GET') return resourcesRoute(url)
          break
        case 'credentials':
          if (method === 'GET') return credentialsRoute()
          break
        case 'keys':
          if (method === 'GET') return keysRoute(url)
          break
        case 'requests':
          if (method === 'GET') return requestsRoute(url)
          break
        case 'killswitch':
          if (method === 'GET') return killListRoute()
          if (method === 'POST') return killRequestRoute(req)
          break
        case 'audit':
          if (method === 'GET') return auditRoute(url)
          break
        case 'health':
          if (method === 'GET') {
            return json(200, { ok: true, runtime: typeof stopResource === 'function' })
          }
          break
        default:
          break
      }
    }

    if (segments[2] === 'resources' && segments.length === 5 && segments[4] === 'stop' && method === 'POST') {
      return stopResourceRoute(segments[3]!, req)
    }

    if (segments[2] === 'tenants' && segments.length === 4) {
      if (method === 'GET') return tenantDetailRoute(segments[3]!)
      if (method === 'PATCH') return limitsRoute(segments[3]!, req)
    }

    if (segments[2] === 'tenants' && segments.length === 5 && method === 'POST') {
      if (segments[4] === 'credit') return creditRoute(segments[3]!, req)
      if (segments[4] === 'rotate-key') return rotateKeyRoute(segments[3]!, req)
    }

    if (segments[2] === 'killswitch' && segments.length === 5 && method === 'POST') {
      if (segments[4] === 'approve') return killApproveRoute(segments[3]!, req)
      if (segments[4] === 'disable') return killDisableRoute(segments[3]!, req)
    }

    throw new AdminError('not_found', 'Такого адреса нет')
  }

  return {
    async handle(req: Request): Promise<Response> {
      const requestId = nextId('req_')
      let response: Response
      if (adminKey === undefined) {
        // Not configured: no hint that a key would help, and no default key.
        response = json(404, {
          error: {
            type: 'not_found_error',
            code: 'not_found',
            message: 'Панель дежурного не настроена: задайте ROX_ADMIN_KEY',
            request_id: requestId,
          },
        })
        response.headers.set('x-request-id', requestId)
        return response
      }
      if (req.method.toUpperCase() === 'OPTIONS') {
        // Preflight is answered before any credential is read, so a browser can
        // see the CORS answer without presenting the staff key.
        response = new Response(null, { status: 204 })
        response.headers.set('x-request-id', requestId)
        return response
      }
      try {
        response = await route(req)
      } catch (err) {
        const adminError = toAdminError(err)
        response = json(adminError.status, {
          error: {
            type: TYPE_BY_CODE[adminError.code],
            code: adminError.code,
            message: adminError.message,
            request_id: requestId,
          },
        })
      }
      response.headers.set('x-request-id', requestId)
      return response
    },
  }
}
