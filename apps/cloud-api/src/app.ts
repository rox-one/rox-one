/**
 * Rox Cloud public HTTP API (BYOK).
 *
 * One contract in front of customer-owned sandbox providers. The tenant always
 * comes from the presented API key, never from the body, and the provider is
 * resolved per tenant: in BYOK mode the customer's own credential decides
 * which providers exist for them.
 *
 * Error envelope is uniform: `{error:{type, code, message, request_id}}`.
 * Every response carries `x-request-id`.
 */

import type {
  SandboxGpu,
  SandboxOs,
  SandboxProvider,
  SandboxSpec,
  SandboxStatus,
} from '../../../packages/cloud-runner/src/sandbox.ts'
import { CloudRunnerError } from '../../../packages/cloud-runner/src/types.ts'
import type { Account, MoneyStore } from '../../../packages/cloud-runner/src/entitlement.ts'
import { topUp } from '../../../packages/cloud-runner/src/entitlement.ts'
import type { KeyStore, ProviderCredential, ProviderId } from '../../../packages/cloud-keys/src/index.ts'
import {
  KeyStoreError,
  addCredential,
  disableCredential,
  listCredentials,
  promoteCredential,
} from '../../../packages/cloud-keys/src/index.ts'
import type { ProviderCapabilities } from '../../../packages/providers/src/types.ts'
import { PROVIDER_IDS } from '../../../packages/providers/src/capabilities.ts'
import { CLOUD_PRODUCTS } from '../../../packages/ui/src/lib/product-names.ts'
import { generateApiKey, sha256Hex, verifyApiKey } from './auth.ts'
import type { VerifiedApiKey } from './auth.ts'
import { createMemoryStore, isScope, nextId, SCOPES } from './store.ts'
import type { ApiKeyRecord, MemoryStore, SandboxRecord, Scope, Tenant } from './store.ts'

// ============================================================
// Public options
// ============================================================

/**
 * What one provider can do, exactly as the shared provider contract describes
 * it (`packages/providers/src/types.ts`), with the id left open: the catalog is
 * fed by configuration, and a deployment whose adapters are not wired yet (the
 * local stub) still gets an honest entry instead of a borrowed vendor id.
 */
export type DeclaredCapabilities = Omit<ProviderCapabilities, 'id'> & { readonly id: string }

export interface RateLimitOptions {
  readonly limit: number
  readonly windowMs: number
}

/** What the pre-create hook is told, before any provider call happens. */
export interface CreateHookInput {
  readonly tenantId: string
  readonly providerId: string
  /** Minted here, so the hold and the audit entry name the same id. */
  readonly sandboxId: string
  readonly request: {
    readonly cpu: number
    readonly memoryGb: number
    readonly ttlSec?: number
  }
}

/** What the stop hook is told, after the provider has stopped the machine. */
export interface StopHookInput {
  readonly tenantId: string
  readonly providerId: string
  readonly sandboxId: string
  readonly startedAt: number
  readonly stoppedAt: number
}

/** What the destroy hook is told; `rolledBack` means the boot never happened. */
export interface DestroyHookInput {
  readonly tenantId: string
  readonly providerId: string
  readonly sandboxId: string
  readonly rolledBack?: boolean
}

export interface CloudApiOptions {
  readonly store?: MemoryStore
  /**
   * Per-tenant provider lookup. `null` means this tenant has no credential for
   * that provider, which the API reports as `capability_unavailable`.
   */
  readonly resolveProvider: (
    tenantId: string,
    providerId: string,
  ) => Promise<SandboxProvider | null> | SandboxProvider | null
  /** Capabilities declared by the caller. Nothing is guessed here. */
  readonly listCapabilities: () => readonly DeclaredCapabilities[]
  /** Provider id used when the request body omits `provider`. */
  readonly defaultProvider?: string
  /**
   * Called once per boot, after the provider resolved and before it is asked
   * to create anything. A throw refuses the boot and creates nothing.
   */
  readonly beforeCreate?: (input: CreateHookInput) => Promise<void> | void
  /** Called after the provider stopped a machine, with the metered span. */
  readonly afterStop?: (input: StopHookInput) => Promise<void> | void
  /**
   * Called after a machine is gone at the provider. Also used with
   * `rolledBack: true` when a boot failed, so a hold is never stranded.
   */
  readonly afterDestroy?: (input: DestroyHookInput) => Promise<void> | void
  /** Encrypted customer provider keys; enables the credential routes. */
  readonly keyStore?: KeyStore
  /** AES-256 key for the credential vault; required with `keyStore`. */
  readonly masterKey?: Uint8Array
  /** Wallet ledger; enables the account routes. */
  readonly moneyStore?: MoneyStore
  /** Rox's platform fee in cents per sandbox-hour, echoed by the account route. */
  readonly rateCentsPerHour?: number
  readonly now?: () => number
  readonly rateLimit?: RateLimitOptions
}

export interface CloudApp {
  readonly store: MemoryStore
  handle(req: Request): Promise<Response>
}

// ============================================================
// Errors
// ============================================================

const STATUS_BY_CODE = {
  invalid_request: 400,
  idempotency_key_required: 400,
  provider_unknown: 400,
  capability_unavailable: 400,
  sandbox_too_large: 400,
  authentication_required: 401,
  entitlement_required: 402,
  insufficient_balance: 402,
  budget_exceeded: 402,
  permission_denied: 403,
  not_found: 404,
  conflict: 409,
  kill_switch_active: 409,
  concurrency_exceeded: 409,
  monthly_cap_exceeded: 409,
  rate_limited: 429,
  provider_error: 502,
} as const

type ErrorCode = keyof typeof STATUS_BY_CODE

const TYPE_BY_CODE: Record<ErrorCode, string> = {
  invalid_request: 'invalid_request_error',
  idempotency_key_required: 'invalid_request_error',
  provider_unknown: 'invalid_request_error',
  capability_unavailable: 'invalid_request_error',
  sandbox_too_large: 'invalid_request_error',
  authentication_required: 'authentication_error',
  entitlement_required: 'payment_error',
  insufficient_balance: 'payment_error',
  budget_exceeded: 'payment_error',
  permission_denied: 'permission_error',
  not_found: 'not_found_error',
  conflict: 'conflict_error',
  kill_switch_active: 'conflict_error',
  concurrency_exceeded: 'conflict_error',
  monthly_cap_exceeded: 'conflict_error',
  rate_limited: 'rate_limit_error',
  provider_error: 'provider_error',
}

class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
  }
}

/** Translate a provider, wallet or gate failure into the public vocabulary. */
function fromRunnerError(err: CloudRunnerError): ApiError {
  // The runner's own union covers provider failures; the wallet, the account
  // limits and the kill switch add their own reasons, so the code is read as a
  // string here rather than narrowing the whole API to the provider union.
  const code: string = err.code
  switch (code) {
    case 'not_found':
      return new ApiError('not_found', 'Песочница не найдена у провайдера')
    case 'provider_unknown':
      return new ApiError('provider_unknown', `Провайдер не найден: ${err.message}`)
    case 'capability_unavailable':
      return new ApiError('capability_unavailable', `Провайдер не умеет этого: ${err.message}`)
    case 'path_traversal':
      return new ApiError('invalid_request', 'Путь к файлу недопустим')
    case 'invalid_spec':
    case 'artifact_too_large':
      return new ApiError('invalid_request', `Запрос отклонён провайдером: ${err.message}`)
    case 'cancelled':
      return new ApiError('conflict', 'Операция отменена провайдером')
    // Gate refusals keep their own code, so a client can act on «wallet empty»
    // differently from «account limits» without parsing a message.
    case 'kill_switch_active':
      return new ApiError('kill_switch_active', err.message)
    case 'concurrency_exceeded':
      return new ApiError('concurrency_exceeded', err.message)
    case 'monthly_cap_exceeded':
      return new ApiError('monthly_cap_exceeded', err.message)
    case 'sandbox_too_large':
      return new ApiError('sandbox_too_large', err.message)
    case 'entitlement_required':
      return new ApiError('entitlement_required', err.message)
    case 'insufficient_balance':
      return new ApiError('insufficient_balance', err.message)
    case 'budget_exceeded':
      return new ApiError('budget_exceeded', err.message)
    default:
      return new ApiError('provider_error', `Провайдер недоступен: ${err.message}`)
  }
}

/** Credential vault rejections: no secret is involved, only a reason. */
function fromKeyStoreError(err: KeyStoreError): ApiError {
  switch (err.code) {
    case 'credential_not_found':
      return new ApiError('not_found', 'Ключ провайдера не найден')
    case 'duplicate_fingerprint':
      return new ApiError('conflict', 'Этот ключ провайдера уже добавлен у арендатора')
    default:
      return new ApiError('invalid_request', `Ключ провайдера отклонён: ${err.message}`)
  }
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof CloudRunnerError) return fromRunnerError(err)
  if (err instanceof KeyStoreError) return fromKeyStoreError(err)
  // The contract allows 400/401/402/403/404/409/429/502 only, so an unexpected
  // failure is reported as an upstream failure rather than a ninth status.
  const detail = err instanceof Error ? err.message : String(err)
  return new ApiError('provider_error', `Непредвиденная ошибка: ${detail}`)
}

// ============================================================
// Small helpers
// ============================================================

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const DEFAULT_RATE_LIMIT: RateLimitOptions = { limit: 600, windowMs: 60_000 }
const OS_VALUES: readonly SandboxOs[] = ['linux', 'windows', 'macos']

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (text.trim().length === 0) throw new ApiError('invalid_request', 'Тело запроса пустое')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ApiError('invalid_request', 'Тело запроса не является корректным JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('invalid_request', 'Тело запроса должно быть объектом JSON')
  }
  return parsed as Record<string, unknown>
}

function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ApiError('invalid_request', `Поле ${field} обязательно и должно быть положительным числом`)
  }
  return value
}

function optionalPositiveNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined
  return positiveNumber(value, field)
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError('invalid_request', `Поле ${field} должно быть непустой строкой`)
  }
  return value
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new ApiError('invalid_request', `Поле ${field} должно быть списком строк`)
  }
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new ApiError('invalid_request', `Поле ${field} должно быть списком непустых строк`)
    }
    out.push(entry)
  }
  return out
}

function optionalStringMap(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('invalid_request', `Поле ${field} должно быть объектом «строка → строка»`)
  }
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      throw new ApiError('invalid_request', `Поле ${field}.${key} должно быть строкой`)
    }
    out[key] = entry
  }
  return out
}

interface CreateRequest {
  readonly os: SandboxOs
  readonly cpu: number
  readonly memoryGb: number
  readonly diskGb?: number
  readonly gpu?: SandboxGpu
  readonly image?: string
  readonly snapshot?: string
  readonly ttlSec?: number
  readonly metadata?: Record<string, string>
  readonly provider?: string
}

function parseGpu(value: unknown): SandboxGpu | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('invalid_request', 'Поле gpu должно быть объектом {type, count, spot?}')
  }
  const raw = value as Record<string, unknown>
  const type = raw.type
  if (typeof type !== 'string' || type.length === 0) {
    throw new ApiError('invalid_request', 'Поле gpu.type обязательно: модель видеокарты')
  }
  const count = positiveNumber(raw.count, 'gpu.count')
  if (!Number.isInteger(count)) throw new ApiError('invalid_request', 'Поле gpu.count должно быть целым числом')
  if (raw.spot !== undefined && typeof raw.spot !== 'boolean') {
    throw new ApiError('invalid_request', 'Поле gpu.spot должно быть true или false')
  }
  return raw.spot === undefined ? { type, count } : { type, count, spot: raw.spot }
}

function parseCreateRequest(body: Record<string, unknown>): CreateRequest {
  const os = body.os
  if (typeof os !== 'string' || !(OS_VALUES as readonly string[]).includes(os)) {
    throw new ApiError('invalid_request', 'Поле os обязательно: linux, windows или macos')
  }
  const cpu = positiveNumber(body.cpu, 'cpu')
  const memoryGb = positiveNumber(body.memoryGb, 'memoryGb')
  const diskGb = optionalPositiveNumber(body.diskGb, 'diskGb')
  const ttlSec = optionalPositiveNumber(body.ttlSec, 'ttlSec')
  if (ttlSec !== undefined && !Number.isInteger(ttlSec)) {
    throw new ApiError('invalid_request', 'Поле ttlSec должно быть целым числом секунд')
  }
  const image = optionalString(body.image, 'image')
  const snapshot = optionalString(body.snapshot, 'snapshot')
  if (image !== undefined && snapshot !== undefined) {
    throw new ApiError('invalid_request', 'image и snapshot взаимоисключающие: выберите одно')
  }
  return {
    os: os as SandboxOs,
    cpu,
    memoryGb,
    diskGb,
    gpu: parseGpu(body.gpu),
    image,
    snapshot,
    ttlSec,
    metadata: optionalStringMap(body.metadata, 'metadata'),
    provider: optionalString(body.provider, 'provider'),
  }
}

// ============================================================
// App
// ============================================================

export function createApp(options: CloudApiOptions): CloudApp {
  const store = options.store ?? createMemoryStore()
  const now = options.now ?? (() => Date.now())
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT
  const buckets = new Map<string, { windowStart: number; count: number }>()
  const inFlight = new Map<string, { fingerprint: string; promise: Promise<SandboxRecord> }>()

  // ---------- responses ----------

  function sandboxJson(record: SandboxRecord): Record<string, unknown> {
    return {
      id: record.id,
      object: 'sandbox',
      provider: record.providerId,
      state: record.state,
      created_at: iso(record.createdAt),
      expires_at: record.expiresAt === undefined ? null : iso(record.expiresAt),
      cost_so_far_cents: record.costCents,
      cost_so_far_usd: (record.costCents / 100).toFixed(2),
      routing_reason: record.routingReason ?? null,
    }
  }

  function keyJson(record: ApiKeyRecord): Record<string, unknown> {
    return {
      id: record.id,
      prefix: record.prefix,
      last4: record.last4,
      scopes: record.scopes,
      created_at: iso(record.createdAt),
      last_used_at: record.lastUsedAt === undefined ? null : iso(record.lastUsedAt),
    }
  }

  // ---------- authentication ----------

  function requireAuth(req: Request, scope?: Scope): VerifiedApiKey {
    const header = (req.headers.get('authorization') ?? '').trim()
    const match = /^bearer\s+(.+)$/i.exec(header)
    if (!match) {
      throw new ApiError('authentication_required', 'Нужен ключ API: заголовок Authorization: Bearer rox_sk_live_…')
    }
    const verified = verifyApiKey(store, match[1].trim(), now())
    if (!verified) throw new ApiError('authentication_required', 'Ключ API неизвестен или отозван')
    if (scope !== undefined && !verified.scopes.includes(scope)) {
      throw new ApiError('permission_denied', `Ключу не разрешено право ${scope}`)
    }
    consumeRateLimit(verified.key.id)
    return verified
  }

  function consumeRateLimit(keyId: string): void {
    const at = now()
    const bucket = buckets.get(keyId)
    if (!bucket || at - bucket.windowStart >= rateLimit.windowMs) {
      buckets.set(keyId, { windowStart: at, count: 1 })
      return
    }
    bucket.count += 1
    if (bucket.count > rateLimit.limit) {
      throw new ApiError('rate_limited', `Слишком много запросов: не больше ${rateLimit.limit} за ${Math.round(rateLimit.windowMs / 1000)} секунд`)
    }
  }

  // ---------- provider resolution ----------

  function declaredCapabilities(providerId: string): DeclaredCapabilities | undefined {
    return options.listCapabilities().find((entry) => entry.id === providerId)
  }

  function allowedProviderList(): string {
    const ids = options.listCapabilities().map((entry) => entry.id)
    return ids.length === 0 ? 'ни одного провайдера не подключено' : ids.join(', ')
  }

  function enforceDeclared(declared: DeclaredCapabilities, request: CreateRequest): void {
    if (!declared.os.includes(request.os)) {
      throw new ApiError(
        'capability_unavailable',
        `Провайдер «${declared.id}» не поддерживает ${request.os}`,
      )
    }
    if (request.gpu !== undefined && !declared.gpu) {
      throw new ApiError('capability_unavailable', `Провайдер «${declared.id}» не даёт видеокарт`)
    }
    if (request.snapshot !== undefined && !declared.snapshot) {
      throw new ApiError('capability_unavailable', `Провайдер «${declared.id}» не умеет снимки`)
    }
    // Same rule as `acceptTtl` in the providers package: 0 = no documented cap.
    if (request.ttlSec !== undefined && declared.maxTtlSec !== 0 && request.ttlSec > declared.maxTtlSec) {
      throw new ApiError('invalid_request', `ttlSec не может быть больше ${declared.maxTtlSec} у провайдера «${declared.id}»`)
    }
  }

  async function providerForRecord(record: SandboxRecord): Promise<SandboxProvider> {
    const provider = await options.resolveProvider(record.tenantId, record.providerId)
    if (!provider) {
      throw new ApiError(
        'capability_unavailable',
        `У арендатора больше нет ключа для провайдера «${record.providerId}»`,
      )
    }
    return provider
  }

  function sandboxFor(tenantId: string, id: string): SandboxRecord {
    const record = store.sandboxes.get(id)
    if (!record || record.tenantId !== tenantId) {
      throw new ApiError('not_found', 'Песочница не найдена')
    }
    return record
  }

  // ---------- sandboxes ----------

  function routingReason(tenant: Tenant, providerId: string, requested: string | undefined): string {
    return requested === undefined
      ? `Провайдер по умолчанию «${providerId}», ключ арендатора ${tenant.id}`
      : `Провайдер «${providerId}» выбран в запросе, ключ арендатора ${tenant.id}`
  }

  async function bootSandbox(
    tenant: Tenant,
    request: CreateRequest,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<SandboxRecord> {
    const providerId = request.provider ?? options.defaultProvider ?? ''
    const declared = declaredCapabilities(providerId)
    if (!declared) {
      throw new ApiError(
        'provider_unknown',
        `Неизвестный провайдер «${providerId || '(не указан)'}». Доступны: ${allowedProviderList()}`,
      )
    }
    enforceDeclared(declared, request)

    const provider = await options.resolveProvider(tenant.id, providerId)
    if (!provider) {
      throw new ApiError(
        'capability_unavailable',
        `У арендатора нет ключа для провайдера «${providerId}»: добавьте доступ в консоли`,
      )
    }

    const id = nextId('sbx_')
    const spec: SandboxSpec = {
      id,
      os: request.os,
      cpu: request.cpu,
      memoryGb: request.memoryGb,
      diskGb: request.diskGb,
      gpu: request.gpu,
      image: request.image,
      snapshot: request.snapshot,
      ttlSec: request.ttlSec,
      metadata: request.metadata,
    }

    // The gate runs on the minted id, so the hold and the audit entry name the
    // same sandbox. A throw here means no machine is created and no fee is held.
    await options.beforeCreate?.({
      tenantId: tenant.id,
      providerId,
      sandboxId: id,
      request: { cpu: request.cpu, memoryGb: request.memoryGb, ttlSec: request.ttlSec },
    })

    let status: SandboxStatus
    try {
      status = await provider.create(spec)
    } catch (err) {
      // Nothing booted, so a hold taken a moment ago must go back. The original
      // failure is what the caller must see, so a rollback error never masks it.
      try {
        await options.afterDestroy?.({ tenantId: tenant.id, providerId, sandboxId: id, rolledBack: true })
      } catch {
        // The hold stays visible in the wallet; the boot failure is the answer.
      }
      throw err
    }
    const createdAt = status.createdAt ?? now()
    const expiresAt =
      status.expiresAt ?? (request.ttlSec === undefined ? undefined : createdAt + request.ttlSec * 1000)
    const record: SandboxRecord = {
      id,
      tenantId: tenant.id,
      providerId: status.provider || providerId,
      state: status.state,
      createdAt,
      startedAt: status.startedAt,
      expiresAt,
      costCents: status.costSoFarUsd === undefined ? 0 : Math.round(status.costSoFarUsd * 100),
      routingReason: status.routingReason ?? routingReason(tenant, providerId, request.provider),
      spec,
    }

    store.sandboxes.set(record.id, record)
    store.idempotency.set(`${tenant.id}\u0000${idempotencyKey}`, {
      tenantId: tenant.id,
      key: idempotencyKey,
      fingerprint,
      sandboxId: record.id,
      createdAt: now(),
    })
    store.usage.push({
      id: nextId('usage_'),
      tenantId: tenant.id,
      ref: record.id,
      product: 'sandbox',
      cents: record.costCents,
      currency: 'USD',
      createdAt: now(),
    })
    return record
  }

  async function createSandboxRoute(auth: VerifiedApiKey, req: Request): Promise<Response> {
    const idempotencyKey = (req.headers.get('idempotency-key') ?? '').trim()
    if (idempotencyKey.length === 0) {
      throw new ApiError(
        'idempotency_key_required',
        'Нужен заголовок Idempotency-Key: он не даёт запустить вторую машину по тому же запросу',
      )
    }
    const body = await readJson(req)
    const request = parseCreateRequest(body)
    const fingerprint = sha256Hex(JSON.stringify(request))
    const idempotencyId = `${auth.tenant.id}\u0000${idempotencyKey}`

    const existing = store.idempotency.get(idempotencyId)
    if (existing) {
      if (now() - existing.createdAt > IDEMPOTENCY_TTL_MS) {
        store.idempotency.delete(idempotencyId)
      } else if (existing.fingerprint !== fingerprint) {
        throw new ApiError(
          'conflict',
          'Этот Idempotency-Key уже использован с другим телом запроса',
        )
      } else {
        const record = store.sandboxes.get(existing.sandboxId)
        if (record) return json(200, sandboxJson(record))
        store.idempotency.delete(idempotencyId)
      }
    }

    const pending = inFlight.get(idempotencyId)
    if (pending) {
      if (pending.fingerprint !== fingerprint) {
        throw new ApiError(
          'conflict',
          'Этот Idempotency-Key уже использован с другим телом запроса',
        )
      }
      return json(200, sandboxJson(await pending.promise))
    }

    const work = bootSandbox(auth.tenant, request, idempotencyKey, fingerprint)
    inFlight.set(idempotencyId, { fingerprint, promise: work })
    try {
      return json(201, sandboxJson(await work))
    } finally {
      inFlight.delete(idempotencyId)
    }
  }

  function listSandboxesRoute(auth: VerifiedApiKey, url: URL): Response {
    const limitRaw = url.searchParams.get('limit')
    let limit = DEFAULT_LIMIT
    if (limitRaw !== null) {
      const parsed = Number(limitRaw)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        throw new ApiError('invalid_request', `limit должен быть целым числом от 1 до ${MAX_LIMIT}`)
      }
      limit = parsed
    }

    const all = store.sandboxesOf(auth.tenant.id)
    let start = 0
    const after = url.searchParams.get('starting_after')
    if (after !== null) {
      const index = all.findIndex((record) => record.id === after)
      if (index < 0) {
        throw new ApiError('invalid_request', 'starting_after указывает на несуществующую песочницу')
      }
      start = index + 1
    }

    const page = all.slice(start, start + limit)
    const hasMore = start + page.length < all.length
    const last = page.length === 0 ? undefined : page[page.length - 1]
    return json(200, {
      object: 'list',
      data: page.map(sandboxJson),
      has_more: hasMore,
      next_cursor: hasMore && last !== undefined ? last.id : null,
    })
  }

  async function execRoute(auth: VerifiedApiKey, id: string, req: Request): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    const body = await readJson(req)
    const command = body.command
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new ApiError('invalid_request', 'Поле command обязательно: что выполнить в машине')
    }
    const timeoutSec = optionalPositiveNumber(body.timeoutSec, 'timeoutSec')
    const provider = await providerForRecord(record)
    const result = await provider.exec(
      record.id,
      command,
      timeoutSec === undefined ? undefined : { timeoutMs: timeoutSec * 1000 },
    )
    return json(200, { stdout: result.stdout, stderr: result.stderr, exit_code: result.exitCode })
  }

  async function readFileRoute(auth: VerifiedApiKey, id: string, url: URL): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    const path = url.searchParams.get('path')
    if (path === null || path.length === 0) {
      throw new ApiError('invalid_request', 'Параметр path обязателен: какой файл читать')
    }
    const provider = await providerForRecord(record)
    // `slice` lands the bytes in a fresh ArrayBuffer: a provider may hand back
    // a view over shared memory, which `Response` does not accept as a body.
    const bytes = (await provider.readFile(record.id, path)).slice()
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.byteLength),
      },
    })
  }

  async function writeFileRoute(auth: VerifiedApiKey, id: string, url: URL, req: Request): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    const path = url.searchParams.get('path')
    if (path === null || path.length === 0) {
      throw new ApiError('invalid_request', 'Параметр path обязателен: какой файл писать')
    }
    const provider = await providerForRecord(record)
    const bytes = new Uint8Array(await req.arrayBuffer())
    await provider.writeFile(record.id, path, bytes)
    return new Response(null, { status: 204 })
  }

  async function stopRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    const provider = await providerForRecord(record)
    await provider.stop(record.id)
    record.state = 'stopped'
    // Metered from the moment the machine started; a record that never reported
    // a start is metered from its creation instead of from an invented time.
    await options.afterStop?.({
      tenantId: record.tenantId,
      providerId: record.providerId,
      sandboxId: record.id,
      startedAt: record.startedAt ?? record.createdAt,
      stoppedAt: now(),
    })
    return json(200, sandboxJson(record))
  }

  async function deleteRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    const provider = await providerForRecord(record)
    try {
      await provider.destroy(record.id)
    } catch (err) {
      // Already gone at the vendor is the outcome we want; anything else is real.
      if (!(err instanceof CloudRunnerError && err.code === 'not_found')) throw err
    }
    store.dropSandbox(record.id)
    // Whatever is still held for this sandbox goes back; a released hold is
    // not re-released and a settled one is never charged twice.
    await options.afterDestroy?.({
      tenantId: record.tenantId,
      providerId: record.providerId,
      sandboxId: record.id,
    })
    return new Response(null, { status: 204 })
  }

  // ---------- keys ----------

  async function createKeyRoute(auth: VerifiedApiKey, req: Request): Promise<Response> {
    const body = await readJson(req)
    const raw = body.scopes
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new ApiError('invalid_request', `Поле scopes обязательно: непустой список из ${SCOPES.join(', ')}`)
    }
    const scopes: Scope[] = []
    for (const entry of raw) {
      if (typeof entry !== 'string' || !isScope(entry)) {
        throw new ApiError('invalid_request', `Неизвестное право «${String(entry)}». Возможные: ${SCOPES.join(', ')}`)
      }
      if (!auth.scopes.includes(entry)) {
        throw new ApiError('permission_denied', `Нельзя выдать право ${entry}: у текущего ключа его нет`)
      }
      if (!scopes.includes(entry)) scopes.push(entry)
    }

    const generated = generateApiKey()
    const record: ApiKeyRecord = {
      id: nextId('key_'),
      tenantId: auth.tenant.id,
      prefix: generated.prefix,
      last4: generated.last4,
      hash: generated.hash,
      scopes,
      createdAt: now(),
    }
    store.addApiKey(record)
    return json(201, {
      id: record.id,
      secret: generated.secret,
      prefix: record.prefix,
      last4: record.last4,
      scopes: record.scopes,
      created_at: iso(record.createdAt),
    })
  }

  function listKeysRoute(auth: VerifiedApiKey): Response {
    const data: Record<string, unknown>[] = []
    for (const record of store.apiKeys.values()) {
      if (record.tenantId === auth.tenant.id) data.push(keyJson(record))
    }
    return json(200, { object: 'list', data })
  }

  function deleteKeyRoute(auth: VerifiedApiKey, id: string): Response {
    const record = store.apiKeys.get(id)
    if (!record || record.tenantId !== auth.tenant.id) {
      throw new ApiError('not_found', 'Ключ не найден')
    }
    store.removeApiKey(id)
    return new Response(null, { status: 204 })
  }

  // ---------- provider credentials ----------

  function requireVault(): { store: KeyStore; masterKey: Uint8Array } {
    if (!options.keyStore || !options.masterKey) {
      throw new ApiError(
        'invalid_request',
        'Хранилище ключей провайдеров не подключено в этой сборке',
      )
    }
    return { store: options.keyStore, masterKey: options.masterKey }
  }

  /**
   * Allowlist projection of one credential. `ciphertext`, `iv`, `tag` and the
   * plaintext secret are never read here, so they cannot reach a response.
   */
  function credentialJson(credential: ProviderCredential): Record<string, unknown> {
    return {
      id: credential.id,
      object: 'provider_credential',
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

  async function createCredentialRoute(auth: VerifiedApiKey, req: Request): Promise<Response> {
    const vault = requireVault()
    const body = await readJson(req)
    const provider = body.provider
    if (typeof provider !== 'string' || !(PROVIDER_IDS as readonly string[]).includes(provider)) {
      throw new ApiError(
        'invalid_request',
        `Поле provider обязательно: ${PROVIDER_IDS.join(', ')}`,
      )
    }
    const secret = body.secret
    if (typeof secret !== 'string' || secret.trim().length === 0) {
      throw new ApiError('invalid_request', 'Поле secret обязательно: ключ провайдера этой команды')
    }
    // Required on purpose: a cap that defaults to zero reads as «spend nothing»
    // to the vault gate, so a caller must state the ceiling it accepts.
    const spendCapCents = body.spendCapCents
    if (typeof spendCapCents !== 'number' || !Number.isInteger(spendCapCents) || spendCapCents < 0) {
      throw new ApiError(
        'invalid_request',
        'Поле spendCapCents обязательно: целое число центов не меньше нуля',
      )
    }

    const credential = addCredential(vault.store, vault.masterKey, {
      tenantId: auth.tenant.id,
      provider: provider as ProviderId,
      label: optionalString(body.label, 'label') ?? provider,
      secret,
      spendCapCents,
      regions: optionalStringArray(body.regions, 'regions'),
      products: optionalStringArray(body.products, 'products'),
    })
    return json(201, credentialJson(credential))
  }

  function listCredentialRoute(auth: VerifiedApiKey): Response {
    const vault = requireVault()
    const data = listCredentials(vault.store, auth.tenant.id).map(credentialJson)
    return json(200, { object: 'list', data })
  }

  function promoteCredentialRoute(auth: VerifiedApiKey, id: string): Response {
    const vault = requireVault()
    return json(200, credentialJson(promoteCredential(vault.store, auth.tenant.id, id)))
  }

  function disableCredentialRoute(auth: VerifiedApiKey, id: string): Response {
    const vault = requireVault()
    // The tenant turned the key off; it stays visible as `disabled` so the
    // panel can show what was rotated away instead of a silent disappearance.
    return json(200, credentialJson(disableCredential(vault.store, auth.tenant.id, id)))
  }

  // ---------- account ----------

  function requireWallet(): MoneyStore {
    if (!options.moneyStore) {
      throw new ApiError('invalid_request', 'Кошелёк не подключён в этой сборке')
    }
    return options.moneyStore
  }

  /** One account view. A tenant without a wallet reads as zero, not as an error. */
  function accountJson(account: Account | undefined): Record<string, unknown> {
    const balanceCents = account?.balanceCents ?? 0
    return {
      object: 'account',
      balance_cents: balanceCents,
      reserved_cents: account?.reservedCents ?? 0,
      month_spent_cents: account?.monthSpentCents ?? 0,
      monthly_cap_cents: account?.monthlyCapCents ?? 0,
      rate_cents_per_hour: options.rateCentsPerHour ?? null,
      currency: 'USD',
      balance_usd: (balanceCents / 100).toFixed(2),
    }
  }

  function accountRoute(auth: VerifiedApiKey): Response {
    const wallet = requireWallet()
    return json(200, accountJson(wallet.getAccount(auth.tenant.id)))
  }

  async function topUpRoute(auth: VerifiedApiKey, req: Request): Promise<Response> {
    const wallet = requireWallet()
    const body = await readJson(req)
    const amount = body.amountCents
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      throw new ApiError(
        'invalid_request',
        'Поле amountCents обязательно и должно быть целым числом центов больше нуля',
      )
    }
    if (!wallet.getAccount(auth.tenant.id)) {
      // In this slice a top-up is what makes an account paid: there is no
      // separate payment capture step in front of it yet.
      wallet.saveAccount({
        id: auth.tenant.id,
        paid: true,
        balanceCents: 0,
        reservedCents: 0,
        monthlyCapCents: 0,
        monthSpentCents: 0,
      })
    }
    const result = topUp(wallet, auth.tenant.id, amount, now())
    return json(200, accountJson(result.account))
  }

  // ---------- catalog / usage ----------

  function catalogRoute(): Response {
    return json(200, {
      object: 'catalog',
      products: CLOUD_PRODUCTS.map((product) => ({
        id: product.id,
        name: product.name,
        name_en: product.nameEn,
      })),
      providers: options.listCapabilities().map((entry) => ({
        id: entry.id,
        os: entry.os,
        gpu: entry.gpu,
        pause: entry.pause,
        snapshot: entry.snapshot,
        volume: entry.volume,
        streaming: entry.streaming,
        max_ttl_sec: entry.maxTtlSec,
        regions: entry.regions,
      })),
    })
  }

  function usageRoute(auth: VerifiedApiKey): Response {
    const data: Record<string, unknown>[] = []
    for (const row of store.usage) {
      if (row.tenantId !== auth.tenant.id) continue
      data.push({ ref: row.ref, product: row.product, cents: row.cents, currency: row.currency })
    }
    return json(200, { object: 'list', data })
  }

  // ---------- request routing ----------

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const segments = url.pathname.split('/').filter((part) => part.length > 0)
    const method = req.method.toUpperCase()

    if (segments.length === 1 && segments[0] === 'health' && method === 'GET') {
      return json(200, { ok: true })
    }

    if (segments[0] !== 'v1') throw new ApiError('not_found', 'Такого адреса нет')

    if (segments.length === 2 && segments[1] === 'catalog' && method === 'GET') {
      requireAuth(req)
      return catalogRoute()
    }

    if (segments[1] === 'usage' && segments.length === 2 && method === 'GET') {
      return usageRoute(requireAuth(req, 'billing:read'))
    }

    if (segments[1] === 'keys') {
      if (segments.length === 2 && method === 'POST') {
        return createKeyRoute(requireAuth(req, 'keys:write'), req)
      }
      if (segments.length === 2 && method === 'GET') {
        return listKeysRoute(requireAuth(req, 'keys:write'))
      }
      if (segments.length === 3 && method === 'DELETE') {
        return deleteKeyRoute(requireAuth(req, 'keys:write'), segments[2])
      }
    }

    if (segments[1] === 'provider-credentials') {
      if (segments.length === 2 && method === 'POST') {
        return createCredentialRoute(requireAuth(req, 'keys:write'), req)
      }
      if (segments.length === 2 && method === 'GET') {
        return listCredentialRoute(requireAuth(req, 'keys:write'))
      }
      if (segments.length === 4 && segments[3] === 'promote' && method === 'POST') {
        return promoteCredentialRoute(requireAuth(req, 'keys:write'), segments[2])
      }
      if (segments.length === 3 && method === 'DELETE') {
        return disableCredentialRoute(requireAuth(req, 'keys:write'), segments[2])
      }
    }

    if (segments[1] === 'account') {
      if (segments.length === 2 && method === 'GET') {
        return accountRoute(requireAuth(req))
      }
      if (segments.length === 3 && segments[2] === 'topup' && method === 'POST') {
        return topUpRoute(requireAuth(req, 'keys:write'), req)
      }
    }

    if (segments[1] === 'sandboxes') {
      if (segments.length === 2 && method === 'POST') {
        return createSandboxRoute(requireAuth(req, 'sandboxes:write'), req)
      }
      if (segments.length === 2 && method === 'GET') {
        return listSandboxesRoute(requireAuth(req, 'sandboxes:read'), url)
      }
      if (segments.length === 3) {
        const id = segments[2]
        if (method === 'GET') {
          const auth = requireAuth(req, 'sandboxes:read')
          return json(200, sandboxJson(sandboxFor(auth.tenant.id, id)))
        }
        if (method === 'DELETE') return deleteRoute(requireAuth(req, 'sandboxes:write'), id)
      }
      if (segments.length === 4) {
        const id = segments[2]
        const action = segments[3]
        if (action === 'exec' && method === 'POST') {
          return execRoute(requireAuth(req, 'sandboxes:write'), id, req)
        }
        if (action === 'files' && method === 'GET') {
          return readFileRoute(requireAuth(req, 'sandboxes:read'), id, url)
        }
        if (action === 'files' && method === 'PUT') {
          return writeFileRoute(requireAuth(req, 'sandboxes:write'), id, url, req)
        }
        if (action === 'stop' && method === 'POST') {
          return stopRoute(requireAuth(req, 'sandboxes:write'), id)
        }
      }
    }

    throw new ApiError('not_found', 'Такого адреса нет')
  }

  return {
    store,
    async handle(req: Request): Promise<Response> {
      const requestId = nextId('req_')
      let response: Response
      try {
        response = await route(req)
      } catch (err) {
        const apiError = toApiError(err)
        response = json(apiError.status, {
          error: {
            type: TYPE_BY_CODE[apiError.code],
            code: apiError.code,
            message: apiError.message,
            request_id: requestId,
          },
        })
      }
      response.headers.set('x-request-id', requestId)
      return response
    },
  }
}
