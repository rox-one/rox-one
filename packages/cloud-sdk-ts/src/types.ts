/**
 * Wire types of the Rox Cloud API, mirrored field for field from
 * `apps/cloud-api/openapi.yaml`.
 *
 * Two rules hold across every shape here: money is integer cents and every
 * `*_usd` companion is a two-decimal string; the tenant is decided by the API
 * key that made the call, never by a field in a request body.
 */

/** Scopes a key can hold. A key may only grant scopes its creator already has. */
export type Scope = 'sandboxes:read' | 'sandboxes:write' | 'keys:write' | 'billing:read'

/** Operating systems a sandbox can boot. */
export type SandboxOs = 'linux' | 'windows' | 'macos'

/** Lifecycle of one sandbox record. */
export type SandboxState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'stopping'
  | 'failed'
  | 'expired'

/** Providers the cloud API can drive with a customer-owned key. */
export type ProviderId = 'daytona' | 'modal' | 'e2b'

/** Whether a provider credential may be used to authorize a spend. */
export type CredentialStatus = 'active' | 'standby' | 'disabled' | 'expired'

/** Result of the last probe of a provider credential. */
export type CredentialHealth = 'ok' | 'degraded' | 'invalid' | 'unknown'

/** The GPU slice a sandbox asks for. */
export interface SandboxGpuSpec {
  type: string
  count: number
  spot?: boolean
}

/**
 * `SandboxCreateRequest`: what to boot. `image` and `snapshot` are mutually
 * exclusive, and `ttlSec` cannot exceed the provider's `max_ttl_sec`.
 */
export interface SandboxSpecInput {
  os: SandboxOs
  cpu: number
  memoryGb: number
  diskGb?: number
  gpu?: SandboxGpuSpec
  image?: string
  snapshot?: string
  ttlSec?: number
  metadata?: Record<string, string>
  provider?: string
}

/** One sandbox record, as every sandbox endpoint reports it. */
export interface Sandbox {
  id: string
  object: 'sandbox'
  provider: string
  state: SandboxState
  created_at: string
  expires_at: string | null
  cost_so_far_cents: number
  cost_so_far_usd: string
  routing_reason: string | null
}

/** A `{object:'list', data}` body: keys, provider credentials and usage. */
export interface ListResponse<T> {
  object: 'list'
  data: T[]
}

/** A cursor-paginated list, as `GET /v1/sandboxes` returns it. */
export interface Page<T> extends ListResponse<T> {
  has_more: boolean
  next_cursor: string | null
}

/** One page of sandboxes. */
export type SandboxList = Page<Sandbox>

/** Result of one command run inside a sandbox. */
export interface ExecResult {
  stdout: string
  stderr: string
  exit_code: number
}

/** Key metadata. The secret itself is never part of this shape. */
export interface ApiKey {
  id: string
  prefix: string
  last4: string
  scopes: Scope[]
  created_at: string
  last_used_at: string | null
}

/** A freshly minted key: the only response that ever carries the secret. */
export type ApiKeyCreated = ApiKey & { secret: string }

/** Balance and month limits of the current tenant. */
export interface Account {
  object: 'account'
  balance_cents: number
  reserved_cents: number
  month_spent_cents: number
  monthly_cap_cents: number
  rate_cents_per_hour: number | null
  currency: 'USD'
  balance_usd: string
}

/**
 * Metadata of one customer-owned provider key. The plaintext secret and the
 * stored `ciphertext`, `iv` and `tag` never appear in a response.
 */
export interface ProviderCredential {
  id: string
  object: 'provider_credential'
  provider: ProviderId
  label: string
  fingerprint: string
  last4: string
  status: CredentialStatus
  spend_cap_cents: number
  regions: string[]
  products: string[]
  health: CredentialHealth
  created_at: string
  checked_at: string | null
  expires_at: string | null
}
