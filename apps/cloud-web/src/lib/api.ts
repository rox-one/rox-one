/**
 * Typed client for the Rox Cloud API.
 *
 * One origin: every URL is relative, so the browser never needs a second host
 * name and the customer key never leaves this tab. The customer API lives under
 * `/v1`; the staff JSON API lives under `/v1/admin`; `/admin` and `/status` are
 * application pages, not API routes.
 *
 * Errors are parsed from `{ error: { code, message, request_id } }` into
 * `ApiError`, so a page can show the server's own words plus the request id.
 */
import { apiUrl, getAdminKey, getClientKey } from './session'

export type AuthKind = 'client' | 'admin' | 'none'
export type BillingMode = 'managed' | 'byok'

// ============================================================
// Errors
// ============================================================

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  readonly retryAfterSec: number | null

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string | null = null,
    retryAfterSec: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.retryAfterSec = retryAfterSec
  }

  get isAuthError(): boolean {
    return this.status === 401
  }

  /** One line for a toast: the message, the code and the request id. */
  toString(): string {
    const tail = `${this.code}${this.requestId === null ? '' : `, запрос ${this.requestId}`}`
    return `${this.message} (${tail})`
  }
}

interface ParsedError {
  code?: unknown
  message?: unknown
  requestId?: unknown
}

function readErrorBody(payload: unknown): ParsedError {
  if (payload === null || typeof payload !== 'object' || !('error' in payload)) return {}
  const error = payload.error
  if (error === null || typeof error !== 'object') return {}
  return {
    code: 'code' in error ? error.code : undefined,
    message: 'message' in error ? error.message : undefined,
    requestId: 'request_id' in error ? error.request_id : undefined,
  }
}

// ============================================================
// Request core
// ============================================================

export type QueryValue = string | number | boolean | null | undefined
export type Query = Record<string, QueryValue>

export interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  /** Which session key signs the call; defaults by path. */
  auth?: AuthKind
  signal?: AbortSignal
  /** How to read a successful body. JSON is the default. */
  parse?: 'json' | 'text' | 'blob' | 'none'
}

function withQuery(path: string, query?: Query): string {
  if (query === undefined) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text.length === 0 ? path : `${path}?${text}`
}

function defaultAuth(path: string): AuthKind {
  return path.startsWith('/v1/admin') ? 'admin' : 'client'
}

function isRawBody(value: unknown): value is BodyInit {
  if (typeof value === 'string') return true
  if (typeof value !== 'object' || value === null) return false
  return (
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  )
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get('retry-after')
  if (raw === null) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `rox-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** ISO time from the wire, or `null` when the field is absent or unreadable. */
function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const at = Date.parse(value)
  return Number.isFinite(at) ? at : null
}

function asRow(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** One key from `ssh-keys`: metadata only, the public key material is never echoed. */
function parseSshKey(row: unknown): SshKeyInfo {
  const item = asRow(row)
  return {
    id: typeof item.id === 'string' ? item.id : '',
    label: typeof item.label === 'string' ? item.label : '',
    fingerprint: typeof item.fingerprint === 'string' ? item.fingerprint : '',
    createdAt: parseTime(item.created_at),
  }
}

function parseSnapshot(row: unknown): SnapshotInfo {
  const item = asRow(row)
  return {
    name: typeof item.name === 'string' ? item.name : '',
    state: typeof item.state === 'string' ? item.state : '',
    createdAt: parseTime(item.created_at),
  }
}

/**
 * A sandbox row: every field passes through untouched, while the two nested
 * lists and the display name take their camelCase shape from the contract.
 */
function parseSandbox(payload: unknown): Sandbox {
  const row = asRow(payload)
  const out: Record<string, unknown> = { ...row }
  out.display_name = typeof row.display_name === 'string' && row.display_name.length > 0 ? row.display_name : null
  if (Array.isArray(row.ssh_keys)) out.ssh_keys = row.ssh_keys.map(parseSshKey)
  if (Array.isArray(row.snapshots)) out.snapshots = row.snapshots.map(parseSnapshot)
  return out as unknown as Sandbox
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  const auth = options.auth ?? defaultAuth(path)
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers }

  if (auth !== 'none') {
    const key = auth === 'admin' ? getAdminKey() : getClientKey()
    if (key.length === 0) {
      throw new ApiError(
        401,
        'authentication_required',
        auth === 'admin'
          ? 'Нужен ключ дежурного: войдите в панель по ключу'
          : 'Нужен ключ API: получите гостевой доступ или введите ключ',
      )
    }
    headers.authorization = `Bearer ${key}`
  }

  let body: BodyInit | undefined
  if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    if (isRawBody(options.body)) {
      body = options.body
    } else {
      body = JSON.stringify(options.body)
      headers['content-type'] ??= 'application/json'
    }
  }

  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: 'same-origin',
    })
  } catch (err) {
    if (options.signal?.aborted === true) {
      throw new ApiError(0, 'request_aborted', 'Запрос отменён')
    }
    const detail = err instanceof Error ? err.message : String(err)
    throw new ApiError(0, 'network_error', `Сервер не отвечает: ${detail}`)
  }

  if (!response.ok) {
    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text.trim().length === 0 ? null : JSON.parse(text)
    } catch {
      payload = null
    }
    const parsed = readErrorBody(payload)
    const code = typeof parsed.code === 'string' ? parsed.code : `http_${response.status}`
    const message =
      typeof parsed.message === 'string' && parsed.message.length > 0
        ? parsed.message
        : `Запрос не удался (${response.status})`
    const headerId = response.headers.get('x-request-id')
    const requestId =
      typeof parsed.requestId === 'string' && parsed.requestId.length > 0
        ? parsed.requestId
        : headerId
    throw new ApiError(response.status, code, message, requestId, retryAfter(response))
  }

  if (response.status === 204 || options.parse === 'none') return undefined as T
  if (options.parse === 'blob') return (await response.blob()) as T

  const text = await response.text()
  if (options.parse === 'text') return text as T
  if (text.trim().length === 0) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(response.status, 'invalid_response', 'Ответ сервера не является JSON', response.headers.get('x-request-id'))
  }
}

// ============================================================
// Shared JSON shapes
// ============================================================

export interface ListResponse<T> {
  object?: 'list'
  data: T[]
  [key: string]: unknown
}

export interface ProviderCapability {
  id: string
  os?: string[]
  gpu?: string[]
  pause?: boolean
  snapshot?: boolean
  volume?: boolean
  streaming?: boolean
  max_ttl_sec?: number
  regions?: string[]
  [key: string]: unknown
}

export interface ProviderRegion {
  id: string
  label?: string
  dedicated?: boolean
  [key: string]: unknown
}

export interface GpuSpec {
  type: string
  count: number
  spot?: boolean
  [key: string]: unknown
}

export interface CatalogProduct {
  id: string
  name: string
  name_en?: string
  os?: string
  cpu?: number
  memory_gb?: number
  disk_gb?: number
  gpu?: GpuSpec | null
  snapshot?: string
  region?: string | null
  /** Full price of one hour on the platform key, in cents. */
  cents_per_hour?: number
  /** What a customer with their own provider key pays Rox per hour. */
  service_fee_cents_per_hour?: number
  modes?: BillingMode[]
  [key: string]: unknown
}

export interface Catalog {
  object?: 'catalog'
  products: CatalogProduct[]
  providers?: ProviderCapability[]
  regions?: ProviderRegion[]
  managed_providers?: string[]
  modes?: BillingMode[]
  [key: string]: unknown
}

export interface ProviderImage {
  id: string
  name: string
  label?: string
  os?: string
  cpu?: number
  memoryGb?: number
  diskGb?: number
  gpu?: GpuSpec | null
  state?: string
  region?: string | null
  [key: string]: unknown
}

export interface ProviderImageList {
  object?: 'list'
  provider: string
  /** Which key the listing used: the customer's own or the platform one. */
  mode?: BillingMode
  data: ProviderImage[]
  [key: string]: unknown
}

export type SandboxState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'expired'

export interface SandboxSpec {
  os?: string
  cpu?: number
  memoryGb?: number
  diskGb?: number | null
  gpu?: GpuSpec | null
  image?: string | null
  snapshot?: string | null
  region?: string | null
  ttlSec?: number | null
  [key: string]: unknown
}

export interface SandboxBilling {
  mode?: BillingMode
  rate_cents_per_hour?: number | null
  retail_cents_per_hour?: number | null
  service_fee_cents_per_hour?: number | null
  [key: string]: unknown
}

export interface Sandbox {
  id: string
  object?: 'sandbox'
  provider: string
  state: SandboxState
  created_at: string
  expires_at?: string | null
  cost_so_far_cents?: number
  cost_so_far_usd?: string
  routing_reason?: string | null
  product?: string
  spec?: SandboxSpec
  billing?: SandboxBilling
  /** Customer-facing name; null when the machine is shown by its id. */
  display_name?: string | null
  /** Keys registered on the machine, metadata only. */
  ssh_keys?: SshKeyInfo[]
  /** Checkpoints saved from the machine. */
  snapshots?: SnapshotInfo[]
  [key: string]: unknown
}

export interface Account {
  object?: 'account'
  balance_cents: number
  reserved_cents: number
  month_spent_cents: number
  monthly_cap_cents: number
  rate_cents_per_hour?: number | null
  currency?: string
  balance_usd?: string
  paid?: boolean
  [key: string]: unknown
}

export interface UsageRow {
  ref: string
  product: string
  cents: number
  currency?: string
  at: string
  [key: string]: unknown
}

export interface ApiKeyRow {
  id: string
  prefix: string
  last4: string
  scopes: string[]
  created_at: string
  last_used_at?: string | null
  /** Present only in the response that creates the key; never stored by the UI. */
  api_key?: string
  [key: string]: unknown
}

export interface ProviderCredential {
  id: string
  object?: 'provider_credential'
  tenant_id?: string
  provider: string
  label: string
  fingerprint: string
  last4: string
  status: string
  spend_cap_cents: number
  regions?: string[]
  products?: string[]
  health?: string
  created_at: string
  checked_at?: string
  expires_at?: string | null
  [key: string]: unknown
}

export interface GuestSession {
  object: 'guest'
  tenant: { id: string; name: string }
  api_key: string
  balance_cents: number
  [key: string]: unknown
}

export interface ExecInput {
  command: string
  cwd?: string
  /**
   * Command deadline in whole seconds. The server reads `timeoutSec`; the
   * reviewed contract names it `timeout_sec`, so both are accepted here and
   * the call sends both spellings until the wire settles on one.
   */
  timeoutSec?: number
  timeout_sec?: number
}

/** Friendly result: the wire `exit_code` is exposed as `exitCode`. */
export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modifiedAt: number | null
}

export interface NetworkInfo {
  privateIp: string | null
  publicIp: string | null
  note: string
}

export interface PreviewLink {
  port: number
  url: string
  expiresAt: number | null
}

export interface SshAccess {
  command: string
  expiresAt: number | null
}

/** One TCP port listening inside the machine; `reserved` marks Rox's own services. */
export interface PortInfo {
  port: number
  reserved: boolean
}

/** Live resource use of a running machine, sampled at `at`. */
export interface MetricsInfo {
  at: number | null
  cpuPercent: number
  memoryUsedKb: number
  memoryTotalKb: number
  diskUsedKb: number
  diskTotalKb: number
}

/** One command run inside the machine's persistent shell session. */
export interface SessionExecResult {
  stdout: string
  stderr: string
  cwd: string
  exitCode: number | null
}

/** A key registered on the machine; the public key material is never sent back. */
export interface SshKeyInfo {
  id: string
  label: string
  fingerprint: string
  createdAt: number | null
}

/** A named checkpoint of the machine's disk. */
export interface SnapshotInfo {
  name: string
  state: string
  createdAt: number | null
}

export interface CreateSandboxInput {
  /** A pricing product id; it fixes the snapshot and its resources. */
  product?: string
  /** A live provider image id; mutually exclusive with `product`. */
  snapshot?: string
  os?: string
  cpu?: number
  memoryGb?: number
  diskGb?: number
  ttlSec?: number
  image?: string
  gpu?: GpuSpec
  region?: string
  provider?: string
  metadata?: Record<string, string>
  /** Friendly name shown in the console; sent as `display_name`. */
  displayName?: string
  /** Defaults to a fresh random UUID; reuse it to retry the same boot safely. */
  idempotencyKey?: string
}

export interface CreateCredentialInput {
  provider: string
  label?: string
  secret: string
  spendCapCents: number
  regions?: string[]
  products?: string[]
}

// ============================================================
// Staff JSON shapes
// ============================================================

export interface AccountLimits {
  max_concurrent_sandboxes: number
  max_cpu_per_sandbox: number
  max_monthly_cents: number
  [key: string]: unknown
}

export interface LedgerEntry {
  id: string
  kind: string
  amount_cents: number
  balance_after_cents: number
  reserved_after_cents: number
  ref: string
  at: string
  shortfall_cents?: number
  [key: string]: unknown
}

export interface AuditEntry {
  id: string
  at: string
  actor_id: string
  action: string
  target_type: string
  target_id: string
  reason: string
  ticket?: string | null
  details?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface Tenant {
  id: string
  name: string
  created_at: string
  balance_cents: number
  reserved_cents: number
  month_spent_cents: number
  sandboxes: number
  credentials: number
  /** How many API keys the tenant has, revoked rows included. */
  keys: number
  guest?: boolean
  [key: string]: unknown
}

export interface AdminResource {
  id: string
  tenant_id: string
  provider: string
  state: SandboxState
  created_at: string
  expires_at?: string | null
  cost_cents: number
  region?: string | null
  billing_mode?: BillingMode
  rate_cents_per_hour?: number | null
  [key: string]: unknown
}

export interface TenantDetail {
  tenant: Tenant
  account: Account
  limits: AccountLimits
  sandboxes: AdminResource[]
  ledger: LedgerEntry[]
  audit: AuditEntry[]
  keys: AdminKeyRow[]
  [key: string]: unknown
}

export interface PlatformKeyStatus {
  provider: string
  present: boolean
  last4: string | null
  [key: string]: unknown
}

export interface AdminOverview {
  tenants: number
  guests?: number
  active_sandboxes: number
  credentials: number
  balance_cents_total: number
  open_kill_switches: number
  /** Presence and last four only; the key itself never leaves the server. */
  platform_keys?: PlatformKeyStatus[]
  [key: string]: unknown
}

export interface AdminKeyRow {
  id: string
  tenant_id: string
  tenant_name?: string | null
  prefix?: string
  last4: string
  scopes?: string[]
  created_at?: string
  last_used_at?: string | null
  revoked_at?: string | null
  balance_cents?: number
  reserved_cents?: number
  status?: string
  guest?: boolean
  [key: string]: unknown
}

export interface RequestLogRow {
  at: string
  method: string
  path: string
  status: number
  duration_ms?: number
  tenant_id?: string | null
  key_last4?: string | null
  ip?: string | null
  [key: string]: unknown
}

export interface RotatedKeyMaterial {
  id: string
  /** Returned once, at rotation time; the old key stops working. */
  api_key?: string
  prefix: string
  last4: string
  scopes: string[]
  created_at: string
  [key: string]: unknown
}

export interface RotatedKey {
  tenant: Tenant
  /** How many old keys the rotation revoked. */
  revoked: number
  key: RotatedKeyMaterial
  [key: string]: unknown
}

export interface TenantLimitsResult {
  tenant: Tenant
  account: Account
  limits?: AccountLimits
  [key: string]: unknown
}

export interface TenantCreditResult {
  tenant: Tenant
  account: Account
  entry: LedgerEntry
  [key: string]: unknown
}

export interface TenantLimitsPatch {
  monthlyCapCents?: number
  /** The reviewed name for the same ceiling; send one of the two. */
  maxMonthlyCents?: number
  paid?: boolean
  maxConcurrentSandboxes?: number
  maxCpuPerSandbox?: number
  reason: string
}

export type TicketStatus = 'open' | 'pending' | 'resolved'
export type TicketPriority = 'low' | 'normal' | 'high'

export interface TicketMessage {
  id: string
  author_role: 'customer' | 'staff'
  author_id?: string
  body: string
  created_at: string
  [key: string]: unknown
}

export interface Ticket {
  id: string
  object?: 'ticket'
  subject: string
  status: TicketStatus
  priority: TicketPriority
  tenant_id?: string
  created_at: string
  updated_at: string
  messages: TicketMessage[]
  [key: string]: unknown
}

export type IncidentSeverity = 'minor' | 'major' | 'critical'
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'

export interface IncidentScope {
  provider?: string
  region?: string
  product?: string
}

export interface IncidentUpdate {
  id: string
  status: IncidentStatus
  note: string
  at: string
  [key: string]: unknown
}

export interface Incident {
  id: string
  object?: 'incident'
  title: string
  public_summary: string
  severity: IncidentSeverity
  status: IncidentStatus
  scopes: IncidentScope[]
  created_at: string
  updated_at: string
  timeline: IncidentUpdate[]
  [key: string]: unknown
}

export type AbuseDecision = 'none' | 'warn' | 'throttle' | 'stop'
export type AbuseFlagState = 'open' | 'dismissed' | 'confirmed'

export interface AbuseEvidence {
  cpu_pct: number
  egress_bytes_per_min: number
  outbound_connections: number
  previous_cpu_pct?: number | null
  thresholds: {
    cpu_pct: number
    egress_bytes_per_min: number
    outbound_connections: number
  }
  [key: string]: unknown
}

export interface AbuseFlag {
  id: string
  object?: 'abuse_flag'
  tenant_id: string
  sandbox_id: string
  at: string
  decision: AbuseDecision
  reason: string
  evidence: AbuseEvidence
  state: AbuseFlagState
  dismissed_reason?: string | null
  confirmed_by?: string | null
  decided_at?: string | null
  [key: string]: unknown
}

export interface KillScope {
  provider?: string
  region?: string
  product?: string
}

export interface KillRequestRow {
  id: string
  scope: KillScope
  enabled: boolean
  reason: string
  by: string
  approved_by?: string | null
  at: string
  state: string
  [key: string]: unknown
}

export interface PublicIncident {
  title: string
  public_summary: string
  severity: IncidentSeverity
  status: IncidentStatus
  updated_at: string
  [key: string]: unknown
}

export interface PublicStatus {
  object?: string
  incidents?: PublicIncident[]
  [key: string]: unknown
}

// ============================================================
// The client
// ============================================================

const enc = encodeURIComponent

/** Customer surface: everything the console needs, plus the public doors. */
export const api = {
  catalog: () => request<Catalog>('/v1/catalog'),

  account: () => request<Account>('/v1/account'),

  usage: (query?: Query) => request<ListResponse<UsageRow>>(withQuery('/v1/usage', query)),

  sandboxes: async (query?: Query): Promise<ListResponse<Sandbox>> => {
    const raw = await request<ListResponse<unknown>>(withQuery('/v1/sandboxes', query))
    const rows = Array.isArray(raw.data) ? raw.data : []
    return { ...raw, data: rows.map(parseSandbox) }
  },

  sandbox: async (id: string) => parseSandbox(await request<unknown>(`/v1/sandboxes/${enc(id)}`)),

  /** Rename the machine; an empty name clears it. */
  updateSandbox: async (id: string, input: { displayName: string }) =>
    parseSandbox(
      await request<unknown>(`/v1/sandboxes/${enc(id)}`, {
        method: 'PATCH',
        body: { display_name: input.displayName },
      }),
    ),

  createSandbox: async (input: CreateSandboxInput) => {
    const { idempotencyKey, displayName, ...rest } = input
    const raw = await request<unknown>('/v1/sandboxes', {
      method: 'POST',
      body: displayName === undefined ? rest : { ...rest, display_name: displayName },
      headers: { 'idempotency-key': idempotencyKey ?? newIdempotencyKey() },
    })
    return parseSandbox(raw)
  },

  stopSandbox: async (id: string) =>
    parseSandbox(await request<unknown>(`/v1/sandboxes/${enc(id)}/stop`, { method: 'POST' })),

  deleteSandbox: (id: string) =>
    request<void>(`/v1/sandboxes/${enc(id)}`, { method: 'DELETE', parse: 'none' }),

  /** Ports listening inside the machine, from `ss -ltnH`. */
  ports: async (id: string): Promise<PortInfo[]> => {
    const raw = await request<{ data?: unknown }>(`/v1/sandboxes/${enc(id)}/ports`)
    const rows = Array.isArray(raw.data) ? raw.data : []
    return rows.map((row) => {
      const item = asRow(row)
      return {
        port: typeof item.port === 'number' ? item.port : 0,
        reserved: item.reserved === true,
      }
    })
  },

  metrics: async (id: string): Promise<MetricsInfo> => {
    const raw = await request<Record<string, unknown>>(`/v1/sandboxes/${enc(id)}/metrics`)
    return {
      at: parseTime(raw.at),
      cpuPercent: typeof raw.cpu_percent === 'number' ? raw.cpu_percent : 0,
      memoryUsedKb: typeof raw.memory_used_kb === 'number' ? raw.memory_used_kb : 0,
      memoryTotalKb: typeof raw.memory_total_kb === 'number' ? raw.memory_total_kb : 0,
      diskUsedKb: typeof raw.disk_used_kb === 'number' ? raw.disk_used_kb : 0,
      diskTotalKb: typeof raw.disk_total_kb === 'number' ? raw.disk_total_kb : 0,
    }
  },

  /** Open or reuse the machine's persistent shell; `cwd` is where it starts. */
  sessionStart: async (id: string): Promise<{ state: string; cwd: string }> => {
    const raw = await request<Record<string, unknown>>(`/v1/sandboxes/${enc(id)}/session/start`, {
      method: 'POST',
    })
    return {
      state: typeof raw.state === 'string' ? raw.state : 'ready',
      cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    }
  },

  sessionExec: async (id: string, command: string): Promise<SessionExecResult> => {
    const raw = await request<Record<string, unknown>>(`/v1/sandboxes/${enc(id)}/session/exec`, {
      method: 'POST',
      body: { command },
    })
    return {
      stdout: typeof raw.stdout === 'string' ? raw.stdout : '',
      stderr: typeof raw.stderr === 'string' ? raw.stderr : '',
      cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
      exitCode: typeof raw.exit_code === 'number' ? raw.exit_code : null,
    }
  },

  sessionInterrupt: (id: string) =>
    request<{ ok: boolean }>(`/v1/sandboxes/${enc(id)}/session/interrupt`, { method: 'POST' }),

  sessionStop: (id: string) =>
    request<void>(`/v1/sandboxes/${enc(id)}/session/stop`, { method: 'POST', parse: 'none' }),

  exec: async (id: string, input: ExecInput): Promise<ExecResult> => {
    const timeoutSec = input.timeoutSec ?? input.timeout_sec
    const body = {
      command: input.command,
      cwd: input.cwd,
      timeoutSec,
      timeout_sec: timeoutSec,
    }
    const raw = await request<{
      stdout?: unknown
      stderr?: unknown
      exit_code?: unknown
    }>(`/v1/sandboxes/${enc(id)}/exec`, { method: 'POST', body })
    return {
      stdout: typeof raw.stdout === 'string' ? raw.stdout : '',
      stderr: typeof raw.stderr === 'string' ? raw.stderr : '',
      exitCode: typeof raw.exit_code === 'number' ? raw.exit_code : null,
    }
  },

  /** Directory entries for the machine's file browser. */
  listFiles: async (id: string, path: string): Promise<FileEntry[]> => {
    const raw = await request<{ data?: unknown }>(
      withQuery(`/v1/sandboxes/${enc(id)}/files/list`, { path }),
    )
    const rows = Array.isArray(raw.data) ? raw.data : []
    return rows.map((row) => {
      const item = row as Record<string, unknown>
      return {
        name: typeof item.name === 'string' ? item.name : '',
        path: typeof item.path === 'string' ? item.path : '',
        isDir: item.is_dir === true,
        size: typeof item.size === 'number' ? item.size : 0,
        modifiedAt: parseTime(item.modified_at),
      }
    })
  },

  network: async (id: string, refresh = false): Promise<NetworkInfo> => {
    const raw = await request<Record<string, unknown>>(
      withQuery(`/v1/sandboxes/${enc(id)}/network`, { refresh: refresh ? 1 : undefined }),
    )
    return {
      privateIp: typeof raw.private_ip === 'string' ? raw.private_ip : null,
      publicIp: typeof raw.public_ip === 'string' ? raw.public_ip : null,
      note: typeof raw.note === 'string' ? raw.note : '',
    }
  },

  preview: async (id: string, port: number): Promise<PreviewLink> => {
    const raw = await request<Record<string, unknown>>(`/v1/sandboxes/${enc(id)}/preview`, {
      method: 'POST',
      body: { port },
    })
    return {
      port: typeof raw.port === 'number' ? raw.port : port,
      url: typeof raw.url === 'string' ? raw.url : '',
      expiresAt: parseTime(raw.expires_at),
    }
  },

  ssh: async (id: string): Promise<SshAccess> => {
    const raw = await request<Record<string, unknown>>(`/v1/sandboxes/${enc(id)}/ssh`, {
      method: 'POST',
      body: {},
    })
    return {
      command: typeof raw.command === 'string' ? raw.command : '',
      expiresAt: parseTime(raw.expires_at),
    }
  },

  /** Keys registered on the machine; metadata only, never the key material. */
  sshKeys: async (id: string): Promise<SshKeyInfo[]> => {
    const raw = await request<{ data?: unknown }>(`/v1/sandboxes/${enc(id)}/ssh-keys`)
    const rows = Array.isArray(raw.data) ? raw.data : []
    return rows.map(parseSshKey)
  },

  addSshKey: async (id: string, input: { publicKey: string; label?: string }): Promise<SshKeyInfo> => {
    const body: Record<string, unknown> = { public_key: input.publicKey }
    if (input.label !== undefined) body.label = input.label
    const raw = await request<unknown>(`/v1/sandboxes/${enc(id)}/ssh-keys`, { method: 'POST', body })
    return parseSshKey(raw)
  },

  deleteSshKey: (id: string, keyId: string) =>
    request<void>(`/v1/sandboxes/${enc(id)}/ssh-keys/${enc(keyId)}`, { method: 'DELETE', parse: 'none' }),

  /** Checkpoints saved from the machine. */
  snapshots: async (id: string): Promise<SnapshotInfo[]> => {
    const raw = await request<{ data?: unknown }>(`/v1/sandboxes/${enc(id)}/snapshots`)
    const rows = Array.isArray(raw.data) ? raw.data : []
    return rows.map(parseSnapshot)
  },

  createSnapshot: async (id: string, input: { name?: string } = {}): Promise<SnapshotInfo> => {
    const body = input.name === undefined ? {} : { name: input.name }
    const raw = await request<unknown>(`/v1/sandboxes/${enc(id)}/snapshots`, { method: 'POST', body })
    return parseSnapshot(raw)
  },

  /** Files are read as UTF-8 text; the console shows text, not binary. */
  readFile: (id: string, path: string) =>
    request<string>(withQuery(`/v1/sandboxes/${enc(id)}/files`, { path }), { parse: 'text' }),

  /** Raw bytes of one file, so the browser can save it without reading it as text. */
  downloadFile: (id: string, path: string) =>
    request<Blob>(withQuery(`/v1/sandboxes/${enc(id)}/files`, { path }), { parse: 'blob' }),

  writeFile: (id: string, path: string, content: string | Blob) => {
    const body = typeof content === 'string' ? new Blob([content], { type: 'text/plain; charset=utf-8' }) : content
    return request<void>(withQuery(`/v1/sandboxes/${enc(id)}/files`, { path }), {
      method: 'PUT',
      body,
      parse: 'none',
    })
  },

  keys: () => request<ListResponse<ApiKeyRow>>('/v1/keys'),

  createKey: async (scopes: string[]): Promise<ApiKeyRow> => {
    const raw = await request<ApiKeyRow & { secret?: unknown }>('/v1/keys', {
      method: 'POST',
      body: { scopes },
    })
    const apiKey = typeof raw.api_key === 'string' ? raw.api_key : typeof raw.secret === 'string' ? raw.secret : undefined
    return { ...raw, api_key: apiKey }
  },

  deleteKey: (id: string) => request<void>(`/v1/keys/${enc(id)}`, { method: 'DELETE', parse: 'none' }),

  /** Provider capabilities, taken from the catalog that already carries them. */
  providers: async (): Promise<ProviderCapability[]> => {
    const catalog = await request<Catalog>('/v1/catalog')
    return Array.isArray(catalog.providers) ? catalog.providers : []
  },

  providerImages: (providerId: string) =>
    request<ProviderImageList>(`/v1/providers/${enc(providerId)}/images`),

  credentials: () => request<ListResponse<ProviderCredential>>('/v1/provider-credentials'),

  addCredential: (input: CreateCredentialInput) =>
    request<ProviderCredential>('/v1/provider-credentials', { method: 'POST', body: input }),

  removeCredential: (id: string) =>
    request<ProviderCredential>(`/v1/provider-credentials/${enc(id)}`, { method: 'DELETE' }),

  /** The customer's own journal of actions that touched this tenant. */
  audit: (query?: Query) => request<ListResponse<AuditEntry>>(withQuery('/v1/audit', query)),

  guest: () =>
    request<GuestSession>('/v1/guest', { method: 'POST', auth: 'none', body: {} }),

  /** Public incident list; no key, no tenant data. */
  status: () => request<PublicStatus>('/v1/status', { auth: 'none' }),

  /** Escape hatch for a route that has no wrapper yet. */
  request,

  /** Staff surface: `/v1/admin/*`, signed by the staff key from sessionStorage. */
  admin: {
    overview: () => request<AdminOverview>('/v1/admin/overview'),

    tenants: (query?: Query) => request<ListResponse<Tenant>>(withQuery('/v1/admin/tenants', query)),

    tenant: (id: string) => request<TenantDetail>(`/v1/admin/tenants/${enc(id)}`),

    credit: (id: string, amountCents: number, reason: string) =>
      request<TenantCreditResult>(`/v1/admin/tenants/${enc(id)}/credit`, {
        method: 'POST',
        body: { amountCents, reason },
      }),

    rotateKey: async (id: string, reason: string): Promise<RotatedKey> => {
      const raw = await request<RotatedKey & { key: RotatedKeyMaterial & { secret?: unknown } }>(
        `/v1/admin/tenants/${enc(id)}/rotate-key`,
        { method: 'POST', body: { reason } },
      )
      const apiKey =
        typeof raw.key.api_key === 'string'
          ? raw.key.api_key
          : typeof raw.key.secret === 'string'
            ? raw.key.secret
            : undefined
      return { ...raw, key: { ...raw.key, api_key: apiKey } }
    },

    limits: (id: string, patch: TenantLimitsPatch) =>
      request<TenantLimitsResult>(`/v1/admin/tenants/${enc(id)}`, { method: 'PATCH', body: patch }),

    resources: (query?: Query) =>
      request<ListResponse<AdminResource>>(withQuery('/v1/admin/resources', query)),

    stopResource: (id: string, reason: string) =>
      request<AdminResource>(`/v1/admin/resources/${enc(id)}/stop`, {
        method: 'POST',
        body: { reason },
      }),

    keys: (query?: Query) => request<ListResponse<AdminKeyRow>>(withQuery('/v1/admin/keys', query)),

    credentials: (query?: Query) =>
      request<ListResponse<ProviderCredential>>(withQuery('/v1/admin/credentials', query)),

    audit: (query?: Query) => request<ListResponse<AuditEntry>>(withQuery('/v1/admin/audit', query)),

    requests: (query?: Query) =>
      request<ListResponse<RequestLogRow>>(withQuery('/v1/admin/requests', query)),

    tickets: (query?: Query) => request<ListResponse<Ticket>>(withQuery('/v1/admin/tickets', query)),

    replyTicket: (id: string, authorId: string, body: string) =>
      request<Ticket>(`/v1/admin/tickets/${enc(id)}/reply`, {
        method: 'POST',
        body: { authorId, body },
      }),

    resolveTicket: (id: string, authorId: string) =>
      request<Ticket>(`/v1/admin/tickets/${enc(id)}/resolve`, {
        method: 'POST',
        body: { authorId },
      }),

    incidents: () => request<ListResponse<Incident>>('/v1/admin/incidents'),

    openIncident: (input: {
      title: string
      publicSummary: string
      severity: IncidentSeverity
      scopes?: IncidentScope[]
    }) => request<Incident>('/v1/admin/incidents', { method: 'POST', body: input }),

    updateIncident: (id: string, status: IncidentStatus, note: string) =>
      request<Incident>(`/v1/admin/incidents/${enc(id)}/update`, {
        method: 'POST',
        body: { status, note },
      }),

    resolveIncident: (id: string, note: string) =>
      request<Incident>(`/v1/admin/incidents/${enc(id)}/resolve`, { method: 'POST', body: { note } }),

    abuse: (query?: Query) => request<ListResponse<AbuseFlag>>(withQuery('/v1/admin/abuse', query)),

    confirmAbuse: (id: string, staffId: string) =>
      request<AbuseFlag>(`/v1/admin/abuse/${enc(id)}/confirm`, {
        method: 'POST',
        body: { staffId },
      }),

    dismissAbuse: (id: string, reason: string) =>
      request<AbuseFlag>(`/v1/admin/abuse/${enc(id)}/dismiss`, { method: 'POST', body: { reason } }),

    killList: () => request<ListResponse<KillRequestRow>>('/v1/admin/killswitch'),

    killRequest: (scope: KillScope, enabled: boolean, reason: string) =>
      request<KillRequestRow>('/v1/admin/killswitch', {
        method: 'POST',
        body: { scope, enabled, reason },
      }),

    killApprove: (id: string) =>
      request<KillRequestRow>(`/v1/admin/killswitch/${enc(id)}/approve`, { method: 'POST' }),

    /** `disable` is the cancel path: it lifts an active or pending block with a reason. */
    killCancel: (id: string, reason: string) =>
      request<KillRequestRow>(`/v1/admin/killswitch/${enc(id)}/disable`, {
        method: 'POST',
        body: { reason },
      }),

    request,
  },
}

export type CloudApi = typeof api
