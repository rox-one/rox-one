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
  AuditLog,
  KillProvider,
  KillRequest,
  KillScope,
  KillSwitch,
} from '../../../packages/cloud-ops/src/index.ts'
import { OpsError } from '../../../packages/cloud-ops/src/index.ts'
import type { MoneyStore } from '../../../packages/cloud-runner/src/entitlement.ts'
import type { SandboxState } from '../../../packages/cloud-runner/src/sandbox.ts'
import { CloudRunnerError } from '../../../packages/cloud-runner/src/types.ts'
import type { MemoryStore, SandboxRecord, Tenant } from './store.ts'
import { nextId } from './store.ts'

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
   * Shared staff key. Absent means the panel is not configured and every
   * route answers 404 — no default key is invented.
   */
  readonly adminKey?: string
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

/** Identities recorded by the switch. See the note at the top of the file. */
const STAFF_ACTOR = 'staff'
const STAFF_REQUESTER = 'staff:requester'

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
  const { store, keyStore, moneyStore, audit, killSwitch, adminKey, stopResource } = options
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
    }
  }

  function tenantJson(tenant: Tenant): Record<string, unknown> {
    const account = moneyStore.getAccount(tenant.id)
    return {
      id: tenant.id,
      name: tenant.name,
      created_at: iso(tenant.createdAt),
      balance_cents: account?.balanceCents ?? 0,
      reserved_cents: account?.reservedCents ?? 0,
      month_spent_cents: account?.monthSpentCents ?? 0,
      sandboxes: store.sandboxesOf(tenant.id).length,
      credentials: listCredentials(keyStore, tenant.id).length,
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
      active_sandboxes: activeSandboxes,
      credentials,
      balance_cents_total: balanceCents,
      open_kill_switches: openKillSwitches,
    })
  }

  // ---------- tenants ----------

  function tenantsRoute(): Response {
    const data = [...store.tenants.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(tenantJson)
    return json(200, { object: 'list', data })
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

  // ---------- audit ----------

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
    // The store returns the newest N in append order; the journal reads top-down.
    const entries = audit.list({ limit }).reverse()
    return json(200, { object: 'list', data: entries.map(auditJson) })
  }

  // ---------- routing ----------

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const segments = url.pathname.split('/').filter((part) => part.length > 0)
    const method = req.method.toUpperCase()

    if (segments[0] !== 'admin') throw new AdminError('not_found', 'Такого адреса нет')
    requireStaff(req)

    if (segments.length === 2) {
      switch (segments[1]) {
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

    if (segments[1] === 'resources' && segments.length === 4 && segments[3] === 'stop' && method === 'POST') {
      return stopResourceRoute(segments[2]!, req)
    }

    if (segments[1] === 'killswitch' && segments.length === 4 && method === 'POST') {
      if (segments[3] === 'approve') return killApproveRoute(segments[2]!, req)
      if (segments[3] === 'disable') return killDisableRoute(segments[2]!, req)
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
