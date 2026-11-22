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

import { createHash } from 'node:crypto'

import type {
  ProviderImage,
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
import type { AuditAction, AuditLog } from '../../../packages/cloud-ops/src/index.ts'
import type { ProviderCapabilities } from '../../../packages/providers/src/types.ts'
import { PROVIDER_IDS } from '../../../packages/providers/src/capabilities.ts'
import {
  DEFAULT_PRODUCTS,
  gpuCentsPerHour,
  retailCentsPerHour,
  serviceFeeCentsPerHour,
} from '../../../packages/cloud-pricing/src/index.ts'
import { generateApiKey, sha256Hex, verifyApiKey } from './auth.ts'
import type { VerifiedApiKey } from './auth.ts'
import { createMemoryStore, GUEST_SCOPES, isScope, nextId, SCOPES } from './store.ts'
import type {
  ApiKeyRecord,
  BillingMode,
  MemoryStore,
  SandboxRecord,
  Scope,
  SnapshotRecord,
  SshKeyRecord,
  Tenant,
  UsageRow,
} from './store.ts'

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
  /** Sold price of this machine, in integer cents per hour. */
  readonly rateCentsPerHour?: number
  /** Whether the wallet pays retail or only the service fee. */
  readonly billingMode?: BillingMode
}

/** What the stop hook is told, after the provider has stopped the machine. */
export interface StopHookInput {
  readonly tenantId: string
  readonly providerId: string
  readonly sandboxId: string
  readonly startedAt: number
  readonly stoppedAt: number
  /** The rate the record was sold at, so settlement matches the meter. */
  readonly rateCentsPerHour?: number
  readonly billingMode?: BillingMode
}

/** What the destroy hook is told; `rolledBack` means the boot never happened. */
export interface DestroyHookInput {
  readonly tenantId: string
  readonly providerId: string
  readonly sandboxId: string
  readonly rolledBack?: boolean
}

/** What one machine's hour costs, before the mode decides who pays it. */
export interface PriceQuote {
  /** Full price when Rox pays the provider. */
  readonly retailCentsPerHour: number
  /** Rox's fee when the customer pays the provider themselves. */
  readonly serviceFeeCentsPerHour: number
}

/** The machine shape a quote is computed from. */
export interface PriceShape {
  readonly cpu: number
  readonly memoryGb: number
  readonly diskGb?: number
  readonly gpu?: SandboxGpu
}

/** Injectable price list; production uses `DEFAULT_PRICE_SHEET`. */
export interface PriceSheet {
  quote(machine: PriceShape): PriceQuote
}

/**
 * The published price list of `@rox/cloud-pricing`, wired to the API.
 * A machine with no disk is priced without the disk term; a card adds its own
 * cents per hour and multiplies by the card count.
 */
export const DEFAULT_PRICE_SHEET: PriceSheet = {
  quote(machine) {
    const gpu =
      machine.gpu === undefined
        ? undefined
        : gpuCentsPerHour(machine.gpu.type, machine.gpu.count)
    const retail = retailCentsPerHour({
      cpu: machine.cpu,
      memoryGb: machine.memoryGb,
      ...(machine.diskGb === undefined ? {} : { diskGb: machine.diskGb }),
      ...(gpu === undefined ? {} : { gpu }),
    })
    return { retailCentsPerHour: retail, serviceFeeCentsPerHour: serviceFeeCentsPerHour(retail) }
  },
}

/** One resolved provider plus who pays for the machine. */
export interface ProviderLease {
  readonly provider: SandboxProvider
  readonly mode: BillingMode
}

/** Public guest entry: off unless the deployment says otherwise. */
export interface GuestOptions {
  readonly enabled: boolean
  /** Trial balance credited on signup; defaults to 2000 cents (20,00 $). */
  readonly trialCents?: number
  /** Sign-ups per address; defaults to five an hour. */
  readonly rateLimit?: RateLimitOptions
}

export interface CloudApiOptions {
  readonly store?: MemoryStore
  /**
   * Per-tenant provider lookup. `null` means this tenant has no credential for
   * that provider, unless a platform key can serve it through `resolveLease`.
   */
  readonly resolveProvider: (
    tenantId: string,
    providerId: string,
  ) => Promise<SandboxProvider | null> | SandboxProvider | null
  /**
   * Provider and payer for one request: the customer's own key (`byok`) or
   * Rox's platform key (`managed`). When absent, `resolveProvider` is wrapped
   * as `byok`, which keeps every existing caller working.
   */
  readonly resolveLease?: (
    tenantId: string,
    providerId: string,
  ) => Promise<ProviderLease | null> | ProviderLease | null
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
  /** Wallet ledger; enables the account routes and the guest trial balance. */
  readonly moneyStore?: MoneyStore
  /** Rox's fee in cents per sandbox-hour, echoed by the account route. */
  readonly rateCentsPerHour?: number
  /** Retail price list; absent keeps the single flat `rateCentsPerHour`. */
  readonly pricing?: PriceSheet
  /** Providers Rox can pay for itself; reported by the catalog as managed. */
  readonly managedProviders?: () => readonly string[]
  /** Public guest sign-up; absent means the route answers `guest_disabled`. */
  readonly guest?: GuestOptions
  /**
   * Client address used to count guest sign-ups. A server in front passes its
   * own `requestIP`; without it the forwarded headers are read, then `local`.
   */
  readonly guestClientIp?: (req: Request) => string | undefined
  /** Staff trail; a guest sign-up is recorded here when supplied. */
  readonly audit?: AuditLog
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
  guest_disabled: 403,
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
  guest_disabled: 'permission_error',
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
/** A guest machine lives at most one day; the trial balance does not rent weeks. */
const GUEST_MAX_TTL_SEC = 86_400
/** Trial money and ceilings the spec fixes for a guest. */
const GUEST_TRIAL_CENTS = 2_000
const GUEST_LIMITS = {
  maxConcurrentSandboxes: 1,
  maxCpuPerSandbox: 16,
  maxMonthlyCents: GUEST_TRIAL_CENTS,
} as const
const GUEST_RATE_LIMIT: RateLimitOptions = { limit: 5, windowMs: 60 * 60 * 1000 }
/**
 * `AuditAction` is a closed union in `@rox/cloud-ops`; a guest sign-up is a
 * new action and keeps its own name. One documented widening, as the runner
 * does for its gate codes.
 */
const GUEST_SIGNUP_ACTION = 'tenant.guest' as AuditAction

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

/** Longest name a customer may give a machine. */
const MAX_DISPLAY_NAME = 64

/**
 * A machine's name: trimmed, at most 64 characters, no control characters.
 * An empty value reads as `undefined` — on boot that means «no name», on rename
 * it means «clear», and both answer as `display_name: null`.
 */
function parseDisplayName(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new ApiError('invalid_request', `Поле ${field} должно быть строкой`)
  }
  const name = value.trim()
  if (name.length === 0) return undefined
  if (name.length > MAX_DISPLAY_NAME) {
    throw new ApiError('invalid_request', `Поле ${field} не длиннее ${MAX_DISPLAY_NAME} символов`)
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new ApiError('invalid_request', `Поле ${field} не должно содержать управляющих символов`)
  }
  return name
}

/** Key types the machine's `authorized_keys` accepts. */
const SSH_KEY_PREFIXES = ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-'] as const
const MAX_SSH_KEY_LENGTH = 4096

/** One pasted public key: a single line of a known type, not a private key. */
function parseSshPublicKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ApiError('invalid_request', 'Поле public_key обязательно: строка открытого ключа')
  }
  const key = value.trim()
  if (key.length === 0 || key.length > MAX_SSH_KEY_LENGTH) {
    throw new ApiError(
      'invalid_request',
      `Открытый ключ должен быть непустой строкой не длиннее ${MAX_SSH_KEY_LENGTH} символов`,
    )
  }
  if (/[\u0000-\u001f\u007f]/.test(key)) {
    throw new ApiError('invalid_request', 'Открытый ключ должен быть одной строкой без управляющих символов')
  }
  if (!SSH_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    throw new ApiError(
      'invalid_request',
      'Открытый ключ должен начинаться с ssh-rsa, ssh-ed25519 или ecdsa-sha2-',
    )
  }
  return key
}

/** `SHA256:` plus base64 of the key blob's digest, the way OpenSSH prints it. */
function sshFingerprint(publicKey: string): string {
  const blob = Buffer.from(publicKey.split(/\s+/)[1] ?? '', 'base64')
  const bytes = blob.length > 0 ? blob : Buffer.from(publicKey, 'utf8')
  const digest = createHash('sha256').update(bytes).digest('base64').replace(/=+$/, '')
  return `SHA256:${digest}`
}

// ============================================================
// Machine session, metrics and port checks
// ============================================================

/**
 * The persistent shell lives in one directory on the machine: a FIFO it reads
 * commands from, a file it writes output to, and the pid of the shell itself.
 */
const SESSION_DIR = '/tmp/rox-session'
const SESSION_FIFO = `${SESSION_DIR}/in`
const SESSION_OUT = `${SESSION_DIR}/out`
const SESSION_PID = `${SESSION_DIR}/pid`
/** How many tenths of a second a command may take before the route gives up. */
const SESSION_WAIT_TENTHS = 150
/** Marker the exec script prints when the session was never started. */
const SESSION_MISSING = 'ROX_NO_SESSION'
/** Ports the machine's own services hold; a site must pick another one. */
const RESERVED_PORTS: readonly number[] = [2280, 2281, 22_220, 33_333]

/**
 * Public names Rox owns. The vendor host and gateway never reach a customer:
 * the signed preview token stays in the first label, and a Worker in front of
 * the provider fetches the origin; SSH resolves through a CNAME.
 */
const PUBLIC_PREVIEW_SUFFIX = (process.env.ROX_PREVIEW_SUFFIX ?? '.rox.computer').trim()
const PUBLIC_SSH_HOST = (process.env.ROX_SSH_HOST ?? 'ssh.rox.computer').trim()

/** A vendor preview host → the same signed label under Rox's own domain. */
function publicPreviewUrl(url: string): string {
  return url.replace(/\.daytonaproxy01\.net$/i, PUBLIC_PREVIEW_SUFFIX)
}

/** A vendor SSH command → Rox's gateway alias, keeping the one-time token. */
function publicSshCommand(command: string): string {
  return command.replace(/@ssh\.app\.daytona\.io(?=\s|$)/i, `@${PUBLIC_SSH_HOST}`)
}

/** Base64 in one step, so no user text reaches the shell unquoted. */
function base64Utf8(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

/**
 * The vendor image's home is `/home/daytona`; customers only ever see `~` and
 * a shell that starts in `/home/rox`. The block is appended once, so repeated
 * session starts do not stack copies of it.
 */
const HOME_ALIAS = '/home/rox'
const REAL_HOME = '/home/daytona'
const HOME_RC_BLOCK = `
# Rox machine home
export HOME=${HOME_ALIAS}
cd ${HOME_ALIAS} 2>/dev/null || true
PS1='rox@rox-computer:\\w\\$ '
`

/**
 * Point `/home/rox` at the image's home and give the shell a Rox prompt.
 *
 * `sudo -n` is best effort: an image without passwordless sudo simply keeps
 * the vendor path, and the caller never fails a boot over a prompt.
 */
function homeSetupScript(): string {
  return [
    `if [ ! -e ${HOME_ALIAS} ] && [ -d ${REAL_HOME} ]; then sudo -n ln -sfn ${REAL_HOME} ${HOME_ALIAS} 2>/dev/null || true; fi`,
    `if [ -f ${REAL_HOME}/.bashrc ] || [ -w ${REAL_HOME} ]; then if ! grep -q 'rox@rox-computer' ${REAL_HOME}/.bashrc 2>/dev/null; then echo ${base64Utf8(HOME_RC_BLOCK)} | base64 -d >> ${REAL_HOME}/.bashrc 2>/dev/null || true; fi; fi`,
  ].join('; ')
}

/**
 * Start (or reuse) a `bash -i` that reads the FIFO forever. `exec 3<>` opens
 * the FIFO read-write so the shell never sees end-of-file between commands.
 * The shell inherits `/home/rox` as home and working directory; when the
 * alias could not be made it falls back to the image's real home.
 */
function sessionStartScript(): string {
  return [
    homeSetupScript(),
    `export HOME=${HOME_ALIAS}`,
    `cd ${HOME_ALIAS} 2>/dev/null || cd ${REAL_HOME} 2>/dev/null || true`,
    `mkdir -p ${SESSION_DIR}`,
    `if [ ! -p ${SESSION_FIFO} ] || [ ! -s ${SESSION_PID} ] || ! kill -0 "$(cat ${SESSION_PID})" 2>/dev/null; then rm -f ${SESSION_FIFO} ${SESSION_OUT} ${SESSION_PID}; mkfifo ${SESSION_FIFO}; setsid nohup bash -c 'export HOME=${HOME_ALIAS}; export PS1="rox@rox-computer:\\w\\$ "; cd ${HOME_ALIAS} 2>/dev/null || cd ${REAL_HOME} 2>/dev/null || true; exec 3<>${SESSION_FIFO}; exec script -qefc "bash --noprofile --norc -i" /dev/null <&3 >${SESSION_OUT} 2>&1' >/dev/null 2>&1 & echo $! > ${SESSION_PID}; fi`,
    'sleep 0.6',
    'echo ready',
    'pwd',
  ].join('; ')
}

/**
 * One command through the session: the payload is base64 so quoting never eats
 * it, the markers tell this call's output from every earlier one, and `pwd`
 * reports where the command left the shell.
 */
function sessionExecScript(marker: string, command: string): string {
  const payload = [
    `printf '\\n${marker}\\n'`,
    `eval "$(echo ${base64Utf8(command)} | base64 -d)"`,
    '__rc=$?',
    'pwd',
    `printf '\\n${marker}:END:%s\\n' "$__rc"`,
  ].join('; ')
  return [
    `if [ ! -p ${SESSION_FIFO} ]; then echo ${SESSION_MISSING}; exit 0; fi`,
    `{ echo ${base64Utf8(payload)} | base64 -d; echo; } > ${SESSION_FIFO}`,
    `i=0; while [ $i -lt ${SESSION_WAIT_TENTHS} ]; do if grep -q '${marker}:END:' ${SESSION_OUT} 2>/dev/null; then break; fi; sleep 0.1; i=$((i+1)); done`,
    `(tail -c 262144 ${SESSION_OUT} 2>/dev/null || true)`,
  ].join('; ')
}

interface SessionOutput {
  readonly stdout: string
  readonly cwd: string
  readonly exitCode: number
}

/** Everything the shell printed between this call's markers, minus its noise. */
function parseSessionOutput(text: string, marker: string): SessionOutput | null {
  // The interactive shell can echo the payload (or its tail) before the start
  // marker; only a line that is exactly the marker is the frame. Matching a
  // substring would pick that echo and swallow the command output.
  const lines = text.replace(/\r/g, '').split('\n')
  let endIndex = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if ((lines[index] ?? '').startsWith(`${marker}:END:`)) {
      endIndex = index
      break
    }
  }
  if (endIndex < 0) return null
  const rc = /^(\d+)/.exec((lines[endIndex] ?? '').slice(`${marker}:END:`.length))
  let startIndex = -1
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    if (lines[index] === marker) {
      startIndex = index
      break
    }
  }
  if (startIndex < 0) return null

  const body = lines.slice(startIndex + 1, endIndex).filter((line) => {
    if (line.trim().length === 0) return false
    if (line.includes(marker)) return false
    if (line.startsWith('bash: cannot set terminal process group')) return false
    if (line.startsWith('bash: no job control in this shell')) return false
    return true
  })
  // The last path inside the frame is the `pwd` the script printed after the
  // user's command; it belongs to cwd, not to the command's stdout.
  let cwd = HOME_ALIAS
  for (let index = body.length - 1; index >= 0; index -= 1) {
    if ((body[index] ?? '').startsWith('/')) {
      cwd = body[index]!
      body.splice(index, 1)
      break
    }
  }
  const stdout = body.join('\n')
  return {
    stdout: stdout.length === 0 ? '' : `${stdout}\n`,
    cwd,
    exitCode: rc === null ? 0 : Number(rc[1]),
  }
}

/**
 * Resource use in one Python pass: two `/proc/stat` samples 200 ms apart, the
 * memory counters, and the root filesystem. The answer is one JSON line.
 */
const METRICS_SCRIPT = `import json, os, time
def cpu():
    with open("/proc/stat") as handle:
        fields = handle.readline().split()[1:]
    values = [int(value) for value in fields]
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return sum(values), idle
total1, idle1 = cpu()
time.sleep(0.2)
total2, idle2 = cpu()
delta_total = total2 - total1
delta_idle = idle2 - idle1
percent = 0.0 if delta_total <= 0 else (delta_total - delta_idle) * 100.0 / delta_total
percent = max(0.0, min(100.0, percent))
meminfo = {}
with open("/proc/meminfo") as handle:
    for line in handle:
        parts = line.split(":")
        if len(parts) == 2:
            meminfo[parts[0].strip()] = parts[1].strip()
def kb(name):
    return int(meminfo.get(name, "0 kB").split()[0])
memory_total = kb("MemTotal")
if "MemAvailable" in meminfo:
    memory_used = memory_total - kb("MemAvailable")
else:
    memory_used = memory_total - (kb("MemFree") + kb("Buffers") + kb("Cached"))
stat = os.statvfs("/")
block = stat.f_frsize
disk_total = stat.f_blocks * block // 1024
disk_used = (stat.f_blocks - stat.f_bfree) * block // 1024
print(json.dumps({"cpu_percent": round(percent, 1), "memory_used_kb": memory_used, "memory_total_kb": memory_total, "disk_used_kb": disk_used, "disk_total_kb": disk_total}))
`

/** Is anything listening on `port` inside the machine, right now? */
function portProbeScript(port: number): string {
  return [
    'import socket, sys',
    'probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)',
    'probe.settimeout(1.0)',
    'try:',
    `    probe.connect(("127.0.0.1", ${port}))`,
    'except OSError:',
    '    sys.exit(1)',
    'finally:',
    '    probe.close()',
    'sys.exit(0)',
  ].join('\n')
}

/** Busiest first, one line per process, no header: the console's process card. */
const PROCESS_LIST_COMMAND = 'ps -eo pid=,user=,pcpu=,rss=,args= --sort=-pcpu | head -30'

interface ProcessRow {
  readonly pid: number
  readonly user: string
  readonly cpuPercent: number
  readonly memoryKb: number
  readonly command: string
}

/** Parse `pid user pcpu rss args…`; a line that does not fit is skipped. */
function parseProcessTable(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    const fields = line.split(/\s+/)
    if (fields.length < 5) continue
    const pid = Number(fields[0])
    if (!Number.isInteger(pid) || pid <= 0) continue
    const cpu = Number(fields[2])
    const rss = Number(fields[3])
    rows.push({
      pid,
      user: fields[1]!,
      cpuPercent: Number.isFinite(cpu) ? Math.round(Math.max(0, cpu) * 10) / 10 : 0,
      memoryKb: Number.isFinite(rss) ? Math.max(0, Math.round(rss)) : 0,
      command: fields.slice(4).join(' '),
    })
  }
  return rows
}

/**
 * One `kill -TERM`, with the machine's own scaffolding refused: init (pid 1),
 * the session shell and the vendor toolbox daemon (`/usr/local/bin/daytona`,
 * which owns exec and files inside the sandbox). Each refusal answers with a
 * marker the route turns into a readable error.
 */
function processKillScript(pid: number): string {
  return [
    `if [ ${pid} -le 1 ]; then echo ROX_PROTECTED; exit 3; fi`,
    `if [ -f ${SESSION_PID} ] && [ "${pid}" = "$(cat ${SESSION_PID} 2>/dev/null || true)" ]; then echo ROX_PROTECTED; exit 3; fi`,
    `cmd=$(cat /proc/${pid}/cmdline 2>/dev/null | tr '\\0' ' ' || true)`,
    'if [ -z "$cmd" ]; then echo ROX_MISSING; exit 4; fi',
    `name=$(cat /proc/${pid}/comm 2>/dev/null || true)`,
    'first=${cmd%% *}',
    'case "$first" in daytona|*/daytona|*toolbox*) echo ROX_PROTECTED; exit 3;; esac',
    'case "$name" in daytona|daytona-daemon|toolbox*) echo ROX_PROTECTED; exit 3;; esac',
    `if kill -TERM ${pid} 2>/dev/null; then echo ok; else echo ROX_MISSING; exit 4; fi`,
  ].join('; ')
}

/**
 * Egress from inside the machine, measured honestly: TCP handshake latency to
 * a public resolver, two HTTP probes (either one proves the internet works),
 * and a 1 MB download for throughput. Anything blocked stays `null`.
 */
const NETWORK_CHECK_NOTE_BLOCKED = 'Исходящая сеть машины закрыта: HTTP-проверка не прошла.'
const NETWORK_CHECK_NOTE_SLOW = 'Интернет есть, но скорость измерить не удалось.'
const NETWORK_CHECK_SCRIPT = `import json, socket, time, urllib.request

def tcp_latency():
    start = time.monotonic()
    try:
        probe = socket.create_connection(("1.1.1.1", 443), timeout=3.0)
    except OSError:
        return None
    probe.close()
    return int(round((time.monotonic() - start) * 1000))

def http_ok(url):
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "rox-network-check"})
        with urllib.request.urlopen(request, timeout=5) as answer:
            return 100 <= answer.status < 500
    except Exception:
        return False

def download_mbps(url):
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "rox-network-check"})
        start = time.monotonic()
        total = 0
        with urllib.request.urlopen(request, timeout=10) as answer:
            while True:
                chunk = answer.read(65536)
                if not chunk:
                    break
                total += len(chunk)
        elapsed = time.monotonic() - start
        if elapsed <= 0 or total <= 0:
            return None
        return round(total * 8 / elapsed / 1000000, 1)
    except Exception:
        return None

latency = tcp_latency()
online = http_ok("https://example.com") or http_ok("https://opencode.ai")
if online:
    speed = download_mbps("https://speed.cloudflare.com/__down?bytes=1000000")
    note = None if speed is not None else "${NETWORK_CHECK_NOTE_SLOW}"
else:
    speed = None
    note = "${NETWORK_CHECK_NOTE_BLOCKED}"
print(json.dumps({"latency_ms": latency, "online": online, "download_mbps": speed, "note": note}))
`

/**
 * Remove one file by absolute path. A directory is refused before `os.remove`
 * so the route never turns into a recursive delete by accident.
 */
function fileDeleteScript(path: string): string {
  return [
    'import base64, os, sys',
    `path = base64.b64decode("${base64Utf8(path)}").decode("utf-8")`,
    'if not os.path.isabs(path):',
    '    sys.exit(2)',
    'if os.path.isdir(path):',
    '    sys.exit(3)',
    'try:',
    '    os.remove(path)',
    'except FileNotFoundError:',
    '    sys.exit(4)',
    'except OSError:',
    '    sys.exit(5)',
  ].join('\n')
}

interface CreateRequest {
  /** Product code from the catalog; its snapshot fixes the resources. */
  readonly product?: string
  /** os is required only when neither a product nor a snapshot is named. */
  readonly os?: SandboxOs
  readonly cpu?: number
  readonly memoryGb?: number
  readonly diskGb?: number
  readonly gpu?: SandboxGpu
  readonly image?: string
  readonly snapshot?: string
  readonly region?: string
  readonly ttlSec?: number
  readonly metadata?: Record<string, string>
  readonly provider?: string
  /** What the customer calls this machine; absent = the console shows the id. */
  readonly displayName?: string
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
  const product = optionalString(body.product, 'product')
  const snapshot = optionalString(body.snapshot, 'snapshot')
  if (product !== undefined && snapshot !== undefined) {
    throw new ApiError('invalid_request', 'product и snapshot взаимоисключающие: продукт уже называет снимок')
  }
  const image = optionalString(body.image, 'image')
  if (image !== undefined && snapshot !== undefined) {
    throw new ApiError('invalid_request', 'image и snapshot взаимоисключающие: выберите одно')
  }
  // A named product or snapshot carries the resources; the caller's numbers
  // are only a cross-check. Without either, the shape must be spelled out.
  const named = product !== undefined || snapshot !== undefined
  const osRaw = body.os
  let os: SandboxOs | undefined
  if (osRaw === undefined || osRaw === null) {
    if (!named) throw new ApiError('invalid_request', 'Поле os обязательно: linux, windows или macos')
  } else {
    if (typeof osRaw !== 'string' || !(OS_VALUES as readonly string[]).includes(osRaw)) {
      throw new ApiError('invalid_request', 'Поле os обязательно: linux, windows или macos')
    }
    os = osRaw as SandboxOs
  }
  const cpu = named ? optionalPositiveNumber(body.cpu, 'cpu') : positiveNumber(body.cpu, 'cpu')
  const memoryGb = named
    ? optionalPositiveNumber(body.memoryGb, 'memoryGb')
    : positiveNumber(body.memoryGb, 'memoryGb')
  const diskGb = optionalPositiveNumber(body.diskGb, 'diskGb')
  const ttlSec = optionalPositiveNumber(body.ttlSec, 'ttlSec')
  if (ttlSec !== undefined && !Number.isInteger(ttlSec)) {
    throw new ApiError('invalid_request', 'Поле ttlSec должно быть целым числом секунд')
  }
  const region = optionalString(body.region, 'region')
  return {
    product,
    os,
    cpu,
    memoryGb,
    diskGb,
    gpu: parseGpu(body.gpu),
    image,
    snapshot,
    region,
    ttlSec,
    metadata: optionalStringMap(body.metadata, 'metadata'),
    provider: optionalString(body.provider, 'provider'),
    displayName: parseDisplayName(body.display_name, 'display_name'),
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
  /** Who presented the key on this request: set by `requireAuth`, read by the journal. */
  const authByRequest = new WeakMap<Request, { tenantId: string; keyLast4: string }>()

  // ---------- responses ----------

  /**
   * Who pays for this machine and what it costs. A record sold before
   * per-machine pricing falls back to the deployment rate and to `byok`,
   * which is exactly how it was billed then.
   */
  function billingJson(record: SandboxRecord): Record<string, unknown> {
    const mode: BillingMode = record.billingMode ?? 'byok'
    const rate = record.rateCentsPerHour ?? options.rateCentsPerHour ?? null
    const retail = record.retailCentsPerHour ?? null
    const fee =
      retail === null
        ? mode === 'byok'
          ? rate
          : null
        : serviceFeeCentsPerHour(retail)
    return {
      mode,
      rate_cents_per_hour: rate,
      retail_cents_per_hour: retail,
      service_fee_cents_per_hour: fee,
    }
  }

  function specJson(record: SandboxRecord): Record<string, unknown> {
    const spec = record.spec
    return {
      os: spec.os,
      cpu: spec.cpu,
      memoryGb: spec.memoryGb,
      diskGb: spec.diskGb ?? null,
      image: spec.image ?? null,
      snapshot: spec.snapshot ?? null,
      gpu: spec.gpu ?? null,
      region: record.region ?? spec.region ?? null,
      ttlSec: spec.ttlSec ?? null,
    }
  }

  function sshKeyJson(key: SshKeyRecord): Record<string, unknown> {
    return {
      id: key.id,
      label: key.label,
      fingerprint: key.fingerprint,
      created_at: iso(key.createdAt),
    }
  }

  function snapshotJson(snapshot: SnapshotRecord): Record<string, unknown> {
    return {
      name: snapshot.name,
      state: snapshot.state ?? null,
      created_at: iso(snapshot.createdAt),
    }
  }

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
      display_name: record.displayName ?? null,
      ssh_keys: (record.sshKeys ?? []).map(sshKeyJson),
      snapshots: (record.snapshots ?? []).map(snapshotJson),
      spec: specJson(record),
      region: record.region ?? record.spec.region ?? null,
      billing: billingJson(record),
    }
  }

  /**
   * One line in the customer's journal. The actor is the tenant's own key, the
   * target is the machine, and `details` never holds a link, a command or a key.
   */
  function auditSandbox(
    record: SandboxRecord,
    action: AuditAction,
    reason: string,
    details: Record<string, unknown>,
  ): void {
    options.audit?.append({
      actorId: `tenant:${record.tenantId}`,
      action,
      targetType: 'sandbox',
      targetId: record.id,
      reason,
      details,
    })
  }

  function keyJson(record: ApiKeyRecord): Record<string, unknown> {
    return {
      id: record.id,
      prefix: record.prefix,
      last4: record.last4,
      scopes: record.scopes,
      created_at: iso(record.createdAt),
      last_used_at: record.lastUsedAt === undefined ? null : iso(record.lastUsedAt),
      revoked_at: record.revokedAt === undefined ? null : iso(record.revokedAt),
    }
  }

  /** Client address as the proxies report it, for the guest limit and the journal. */
  function clientIp(req: Request): string | undefined {
    const forwarded = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim()
    if (forwarded !== undefined && forwarded.length > 0) return forwarded
    const real = (req.headers.get('x-real-ip') ?? '').trim()
    return real.length > 0 ? real : undefined
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
    // The journal names the caller without storing the key itself.
    authByRequest.set(req, { tenantId: verified.tenant.id, keyLast4: verified.key.last4 })
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

  /** What the machine actually is once its product or snapshot is resolved. */
  interface ResolvedMachine {
    os: SandboxOs
    cpu: number
    memoryGb: number
    diskGb?: number
    gpu?: SandboxGpu
    /** Snapshot the provider boots; absent = the provider's own default. */
    snapshot?: string
    /** What the invoice calls this machine. */
    label: string
  }

  /**
   * The caller's numbers are a cross-check, never the price base: a request
   * that says `snapshot: "daytona-gpu"` but asks for one core is refused
   * instead of being billed as a small machine.
   */
  function assertMatchesRequest(request: CreateRequest, machine: ResolvedMachine): void {
    const disagreements: string[] = []
    if (request.os !== undefined && request.os !== machine.os) {
      disagreements.push(`os ${request.os} вместо ${machine.os}`)
    }
    if (request.cpu !== undefined && Math.ceil(request.cpu) !== machine.cpu) {
      disagreements.push(`cpu ${request.cpu} вместо ${machine.cpu}`)
    }
    if (request.memoryGb !== undefined && Math.ceil(request.memoryGb) !== machine.memoryGb) {
      disagreements.push(`память ${request.memoryGb} вместо ${machine.memoryGb} ГБ`)
    }
    if (request.diskGb !== undefined && Math.ceil(request.diskGb) !== machine.diskGb) {
      disagreements.push(`диск ${request.diskGb} вместо ${machine.diskGb ?? '—'} ГБ`)
    }
    if (request.gpu !== undefined) {
      const sameType =
        machine.gpu !== undefined &&
        machine.gpu.type.trim().toLowerCase() === request.gpu.type.trim().toLowerCase()
      const sameCount = machine.gpu !== undefined && machine.gpu.count === request.gpu.count
      if (!sameType || !sameCount) {
        const actual = machine.gpu === undefined ? 'без видеокарты' : `${machine.gpu.count}×${machine.gpu.type}`
        disagreements.push(`видеокарта ${request.gpu.count}×${request.gpu.type} вместо ${actual}`)
      }
    }
    if (disagreements.length > 0) {
      throw new ApiError(
        'invalid_request',
        `Образ даёт другие ресурсы: ${disagreements.join(', ')}. Уберите поля из тела или выберите другой образ`,
      )
    }
  }

  /** Cached live images, so a create and the picker share one vendor call. */
  const imageCache = new Map<string, { at: number; images: ProviderImage[] }>()
  const IMAGE_CACHE_TTL_MS = 60_000

  /** Live images of one lease, or `null` when the provider cannot list them. */
  async function imagesFor(
    tenantId: string,
    providerId: string,
    lease: ProviderLease,
  ): Promise<ProviderImage[] | null> {
    if (lease.provider.listImages === undefined) return null
    const cacheKey = `${tenantId}\u0000${providerId}\u0000${lease.mode}`
    const at = now()
    const cached = imageCache.get(cacheKey)
    if (cached !== undefined && at - cached.at < IMAGE_CACHE_TTL_MS) return cached.images
    const images = await lease.provider.listImages()
    imageCache.set(cacheKey, { at, images })
    return images
  }

  /**
   * Turn a request into the machine it really buys: a catalog product fixes
   * the snapshot and its resources, a named snapshot is looked up in the live
   * list, and only a bare request trusts its own shape.
   */
  async function resolveMachine(
    tenantId: string,
    providerId: string,
    lease: ProviderLease,
    request: CreateRequest,
  ): Promise<ResolvedMachine> {
    if (request.product !== undefined) {
      const product = DEFAULT_PRODUCTS.find((entry) => entry.id === request.product)
      if (product === undefined) {
        throw new ApiError(
          'invalid_request',
          `Неизвестный продукт «${request.product}». Доступны: ${DEFAULT_PRODUCTS.map((entry) => entry.id).join(', ')}`,
        )
      }
      // The shape exists in the table, but this account cannot boot it (no
      // Windows class, no GPU credits). Refuse with the vendor's own reason
      // before a hold, instead of letting the provider fail after a reserve.
      if (product.available === false) {
        throw new ApiError(
          'capability_unavailable',
          product.note ?? `Продукт «${product.id}» сейчас недоступен у провайдера`,
        )
      }
      const machine: ResolvedMachine = {
        os: product.os,
        cpu: product.cpu,
        memoryGb: product.memoryGb,
        diskGb: product.diskGb,
        ...(product.gpu === undefined ? {} : { gpu: product.gpu }),
        snapshot: product.snapshot,
        label: product.name,
      }
      assertMatchesRequest(request, machine)
      return machine
    }

    if (request.snapshot !== undefined) {
      const images = await imagesFor(tenantId, providerId, lease)
      if (images === null) {
        throw new ApiError(
          'invalid_request',
          `Провайдер «${providerId}» не отдаёт список образов: назовите os, cpu и memoryGb вместо snapshot`,
        )
      }
      const image = images.find(
        (entry) => entry.id === request.snapshot || entry.name === request.snapshot,
      )
      if (image === undefined) {
        throw new ApiError(
          'invalid_request',
          `Снимок «${request.snapshot}» не найден среди активных образов «${providerId}»`,
        )
      }
      const machine: ResolvedMachine = {
        os: image.os,
        cpu: image.cpu,
        memoryGb: image.memoryGb,
        diskGb: image.diskGb,
        ...(image.gpu === undefined ? {} : { gpu: image.gpu }),
        snapshot: image.name,
        label: image.label ?? image.name,
      }
      assertMatchesRequest(request, machine)
      return machine
    }

    // The parser guarantees the shape here: without a product or a snapshot,
    // os/cpu/memoryGb were required.
    if (request.os === undefined || request.cpu === undefined || request.memoryGb === undefined) {
      throw new ApiError('invalid_request', 'Поля os, cpu и memoryGb обязательны без product и snapshot')
    }
    return {
      os: request.os,
      cpu: request.cpu,
      memoryGb: request.memoryGb,
      ...(request.diskGb === undefined ? {} : { diskGb: request.diskGb }),
      ...(request.gpu === undefined ? {} : { gpu: request.gpu }),
      label: 'Песочница',
    }
  }

  function enforceDeclared(
    declared: DeclaredCapabilities,
    machine: ResolvedMachine,
    request: CreateRequest,
  ): void {
    if (!declared.os.includes(machine.os)) {
      throw new ApiError(
        'capability_unavailable',
        `Провайдер «${declared.id}» не поддерживает ${machine.os}`,
      )
    }
    if (machine.gpu !== undefined && !declared.gpu) {
      throw new ApiError('capability_unavailable', `Провайдер «${declared.id}» не даёт видеокарт`)
    }
    if (machine.snapshot !== undefined && !declared.snapshot) {
      throw new ApiError('capability_unavailable', `Провайдер «${declared.id}» не умеет снимки`)
    }
    // Same rule as `acceptTtl` in the providers package: 0 = no documented cap.
    if (request.ttlSec !== undefined && declared.maxTtlSec !== 0 && request.ttlSec > declared.maxTtlSec) {
      throw new ApiError('invalid_request', `ttlSec не может быть больше ${declared.maxTtlSec} у провайдера «${declared.id}»`)
    }
    if (request.region !== undefined && declared.regions.length > 0 && !declared.regions.includes(request.region)) {
      throw new ApiError(
        'invalid_request',
        `Площадки «${request.region}» у провайдера «${declared.id}» нет. Доступны: ${declared.regions.join(', ')}`,
      )
    }
  }

  /**
   * Provider and payer for one request. Without `resolveLease` the deployment
   * is byok-only: the customer's own credential decides, exactly as before.
   */
  async function leaseFor(tenantId: string, providerId: string): Promise<ProviderLease | null> {
    if (options.resolveLease !== undefined) {
      return (await options.resolveLease(tenantId, providerId)) ?? null
    }
    const provider = await options.resolveProvider(tenantId, providerId)
    return provider === null ? null : { provider, mode: 'byok' }
  }

  /** A machine resold at this mode's price, or `undefined` without a price list. */
  function quoteFor(machine: ResolvedMachine, mode: BillingMode): PriceQuote | undefined {
    if (options.pricing === undefined) return undefined
    return options.pricing.quote({
      cpu: machine.cpu,
      memoryGb: machine.memoryGb,
      ...(machine.diskGb === undefined ? {} : { diskGb: machine.diskGb }),
      ...(machine.gpu === undefined ? {} : { gpu: machine.gpu }),
    })
  }

  async function providerForRecord(record: SandboxRecord): Promise<SandboxProvider> {
    const lease = await leaseFor(record.tenantId, record.providerId)
    if (!lease) {
      throw new ApiError(
        'capability_unavailable',
        `У арендатора больше нет ключа для провайдера «${record.providerId}»`,
      )
    }
    return lease.provider
  }

  function sandboxFor(tenantId: string, id: string): SandboxRecord {
    const record = store.sandboxes.get(id)
    if (!record || record.tenantId !== tenantId) {
      throw new ApiError('not_found', 'Песочница не найдена')
    }
    return record
  }

  /** Network doors exist only while the machine runs; a stopped one has none. */
  function requireRunning(record: SandboxRecord, what?: string): void {
    if (record.state !== 'running') {
      throw new ApiError(
        'conflict',
        what === undefined
          ? 'Сеть и SSH доступны только у запущенной машины'
          : `${what}: только у запущенной машины`,
      )
    }
  }

  /** The machine's own address is cached for 30 s; `?refresh=1` re-reads it. */
  const networkCache = new Map<string, { at: number; body: Record<string, unknown> }>()
  const NETWORK_CACHE_TTL_MS = 30_000

  /** A link or token never outlives the machine it opens. */
  function liveTtl(record: SandboxRecord, requested: number): number {
    if (record.expiresAt === undefined) return requested
    const remaining = Math.floor((record.expiresAt - now()) / 1000)
    if (remaining <= 0) {
      throw new ApiError('conflict', 'Срок жизни машины истёк: ссылка и SSH больше не нужны')
    }
    return Math.min(requested, remaining)
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

    const lease = await leaseFor(tenant.id, providerId)
    if (!lease) {
      throw new ApiError(
        'capability_unavailable',
        `У арендатора нет ключа для провайдера «${providerId}»: добавьте доступ в консоли`,
      )
    }
    const machine = await resolveMachine(tenant.id, providerId, lease, request)
    enforceDeclared(declared, machine, request)

    const quote = quoteFor(machine, lease.mode)
    const rateCentsPerHour = quote === undefined
      ? options.rateCentsPerHour
      : lease.mode === 'managed'
        ? quote.retailCentsPerHour
        : quote.serviceFeeCentsPerHour

    const id = nextId('sbx_')
    const spec: SandboxSpec = {
      id,
      os: machine.os,
      cpu: machine.cpu,
      memoryGb: machine.memoryGb,
      diskGb: machine.diskGb,
      gpu: machine.gpu,
      image: request.image,
      snapshot: machine.snapshot,
      region: request.region,
      ttlSec: request.ttlSec,
      metadata: request.metadata,
    }

    // The gate runs on the minted id, so the hold and the audit entry name the
    // same sandbox. A throw here means no machine is created and no fee is held.
    await options.beforeCreate?.({
      tenantId: tenant.id,
      providerId,
      sandboxId: id,
      request: { cpu: machine.cpu, memoryGb: machine.memoryGb, ttlSec: request.ttlSec },
      ...(rateCentsPerHour === undefined ? {} : { rateCentsPerHour }),
      billingMode: lease.mode,
    })

    let status: SandboxStatus
    try {
      status = await lease.provider.create(spec)
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
      ...(rateCentsPerHour === undefined ? {} : { rateCentsPerHour }),
      ...(quote === undefined ? {} : { retailCentsPerHour: quote.retailCentsPerHour }),
      billingMode: lease.mode,
      ...(request.region === undefined ? {} : { region: request.region }),
      // The vendor-side id is the only handle `adopt` has after a restart.
      ...(status.providerRef === undefined ? {} : { providerRef: status.providerRef }),
      ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
    }

    store.sandboxes.set(record.id, record)
    store.idempotency.set(`${tenant.id}\u0000${idempotencyKey}`, {
      tenantId: tenant.id,
      key: idempotencyKey,
      fingerprint,
      sandboxId: record.id,
      createdAt: now(),
    })
    // The invoice line is written once, at boot, and keeps the machine's
    // composition even after the machine itself is deleted.
    store.usage.push({
      id: nextId('usage_'),
      tenantId: tenant.id,
      ref: record.id,
      product: 'sandbox',
      label: machine.label,
      ...(machine.snapshot === undefined ? {} : { snapshot: machine.snapshot }),
      billingMode: lease.mode,
      ...(rateCentsPerHour === undefined ? {} : { rateCentsPerHour }),
      ...(quote === undefined ? {} : { retailCentsPerHour: quote.retailCentsPerHour }),
      ...(quote === undefined ? {} : { serviceFeeCentsPerHour: quote.serviceFeeCentsPerHour }),
      cents: record.costCents,
      currency: 'USD',
      createdAt: now(),
      ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    })
    // Home alias and Rox prompt are best effort: a machine without
    // passwordless sudo boots normally and simply keeps the image's path.
    try {
      await lease.provider.exec(record.id, homeSetupScript(), { timeoutMs: 15_000 })
    } catch {
      // A convenience for the terminal, never a condition of the boot.
    }
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
    // Responses are snake_case throughout; the body keeps camelCase for the
    // shape (memoryGb, ttlSec), but the command's own timer is `timeout_sec`.
    const cwd = optionalString(body.cwd, 'cwd')
    const timeoutSec = optionalPositiveNumber(body.timeout_sec, 'timeout_sec')
    const provider = await providerForRecord(record)
    const result = await provider.exec(record.id, command, {
      ...(cwd === undefined ? {} : { cwd }),
      ...(timeoutSec === undefined ? {} : { timeoutMs: timeoutSec * 1000 }),
    })
    return json(200, { stdout: result.stdout, stderr: result.stderr, exit_code: result.exitCode })
  }

  /**
   * The private address the machine sees, and the fact that it has no public
   * address of its own. The address comes from the machine itself, so a
   * provider that cannot run commands simply reports `null` instead of a
   * made-up number.
   */
  async function networkRoute(auth: VerifiedApiKey, id: string, url: URL): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record)
    const cacheKey = `${record.id}:${record.state}`
    const cached = networkCache.get(cacheKey)
    if (url.searchParams.get('refresh') !== '1' && cached !== undefined && now() - cached.at < NETWORK_CACHE_TTL_MS) {
      return json(200, cached.body)
    }
    const provider = await providerForRecord(record)
    let privateIp: string | null = null
    try {
      const result = await provider.exec(record.id, 'hostname -I', { timeoutMs: 5000 })
      const found = result.stdout
        .trim()
        .split(/\s+/)
        .find((value) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))
      privateIp = found ?? null
    } catch {
      // A stopped daemon or a missing `hostname` is not a reason to fail the
      // page: the card says the address was not reported.
    }
    const body = {
      object: 'network',
      sandbox_id: record.id,
      private_ip: privateIp,
      public_ip: null,
      note: 'Публичного адреса у машины нет: снаружи она открыта ссылкой на порт и SSH-шлюзом.',
    }
    networkCache.set(cacheKey, { at: now(), body })
    return json(200, body)
  }

  /**
   * What runs inside the machine, busiest first. The list is read from `ps`,
   * so a machine without it answers an upstream failure instead of an empty
   * card that looks like a quiet box.
   */
  async function processesRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Список процессов')
    const provider = await providerForRecord(record)
    const result = await provider.exec(record.id, PROCESS_LIST_COMMAND, { timeoutMs: 10_000 })
    if (result.exitCode !== 0) {
      throw new ApiError('provider_error', 'Машина не отдала список процессов: ps недоступен')
    }
    return json(200, {
      object: 'list',
      data: parseProcessTable(result.stdout).map((row) => ({
        pid: row.pid,
        user: row.user,
        cpu_percent: row.cpuPercent,
        memory_kb: row.memoryKb,
        command: row.command,
      })),
    })
  }

  /**
   * Stop one process with `kill -TERM`. Init, the session shell and the
   * vendor toolbox are refused with 409; a process already gone is 404.
   */
  async function killProcessRoute(auth: VerifiedApiKey, id: string, rawPid: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Процессы')
    const pid = Number(rawPid)
    if (!Number.isInteger(pid) || pid <= 0 || pid > 4_194_304) {
      throw new ApiError('invalid_request', 'pid должен быть целым положительным числом')
    }
    if (pid === 1) {
      throw new ApiError('conflict', 'Процесс init держит машину: остановить его нельзя')
    }
    const provider = await providerForRecord(record)
    const result = await provider.exec(record.id, processKillScript(pid), { timeoutMs: 10_000 })
    if (result.stdout.includes('ROX_PROTECTED')) {
      throw new ApiError('conflict', 'Этот процесс держит машину или терминал: остановить его нельзя')
    }
    if (result.exitCode !== 0 || !result.stdout.includes('ok')) {
      throw new ApiError('not_found', 'Процесс не найден или уже завершился')
    }
    // The staff journal records the route (path with the pid) and never the
    // command line, which could carry a token; no separate trail entry is
    // written because the shared audit vocabulary has no process action.
    return json(200, { ok: true })
  }

  /**
   * Whether the machine can reach the internet, and how fast. Every number is
   * measured inside the machine; a blocked egress reports nulls and a short
   * note instead of a made-up success.
   */
  async function networkCheckRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Проверка сети')
    const provider = await providerForRecord(record)
    const result = await provider.exec(
      record.id,
      `echo ${base64Utf8(NETWORK_CHECK_SCRIPT)} | base64 -d | python3 -`,
      { timeoutMs: 30_000 },
    )
    if (result.exitCode !== 0) {
      throw new ApiError('provider_error', 'Машина не отдала проверку сети: python3 недоступен')
    }
    let sample: Record<string, unknown>
    try {
      const line = result.stdout.trim().split('\n').pop() ?? ''
      const parsed: unknown = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object')
      }
      sample = parsed as Record<string, unknown>
    } catch {
      throw new ApiError('provider_error', 'Машина не отдала проверку сети: ответ не разобран')
    }
    const latency = sample['latency_ms']
    const speed = sample['download_mbps']
    const online = sample['online'] === true
    const latencyMs = typeof latency === 'number' && Number.isFinite(latency)
      ? Math.max(0, Math.round(latency))
      : null
    const downloadMbps = typeof speed === 'number' && Number.isFinite(speed) ? Math.max(0, speed) : null
    // The machine's own note wins; a script that stayed silent still gets the
    // honest sentence, so a blocked egress never looks like a fast machine.
    const rawNote = sample['note']
    const note = typeof rawNote === 'string' && rawNote.length > 0
      ? rawNote
      : online
        ? (downloadMbps === null ? NETWORK_CHECK_NOTE_SLOW : null)
        : NETWORK_CHECK_NOTE_BLOCKED
    return json(200, {
      object: 'network_check',
      at: iso(now()),
      online,
      latency_ms: latencyMs,
      download_mbps: downloadMbps,
      ...(note === null ? {} : { note }),
    })
  }

  /**
   * A signed link to one HTTP port. The link is a credential, so the answer
   * is never cached: a shared browser cache must not keep it after expiry.
   */
  async function previewRoute(auth: VerifiedApiKey, id: string, req: Request): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record)
    const body = await readJson(req)
    const port = positiveNumber(body.port, 'port')
    if (!Number.isInteger(port) || port > 65_535) {
      throw new ApiError('invalid_request', 'Поле port должно быть целым числом от 1 до 65535')
    }
    if (RESERVED_PORTS.includes(port)) {
      throw new ApiError('invalid_request', 'Этот порт занят службой машины: выберите порт сайта')
    }
    const ttlRaw = optionalPositiveNumber(body.ttl_sec, 'ttl_sec')
    const ttlSec = liveTtl(record, Math.min(Math.max(Math.trunc(ttlRaw ?? 3600), 60), 604_800))
    const provider = await providerForRecord(record)
    if (provider.previewUrl === undefined) {
      throw new ApiError('capability_unavailable', `Провайдер «${provider.providerId}» не умеет открывать сайт`)
    }
    // Signing a link to a closed port hands out a credential that routes
    // nowhere: check the port inside the machine first and refuse with 409.
    const probe = await provider.exec(record.id, `echo ${base64Utf8(portProbeScript(port))} | base64 -d | python3 -`, {
      timeoutMs: 5000,
    })
    if (probe.exitCode !== 0) {
      throw new ApiError('conflict', `На порту ${port} никто не слушает: сначала запустите сайт`)
    }
    const preview = await provider.previewUrl(record.id, port, ttlSec)
    auditSandbox(record, 'sandbox.preview', 'клиент открыл ссылку на порт машины', { port, ttl_sec: ttlSec })
    return new Response(
      JSON.stringify({
        object: 'preview',
        sandbox_id: record.id,
        port,
        url: publicPreviewUrl(preview.url),
        expires_at: preview.expiresAt === undefined ? null : iso(preview.expiresAt),
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    )
  }

  /**
   * A one-shot SSH command. It contains the credential, so it is answered
   * with `no-store` and never written to the journal: the request line names
   * the route, not the command.
   */
  async function sshRoute(auth: VerifiedApiKey, id: string, req: Request): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record)
    const text = await req.text()
    let body: Record<string, unknown> = {}
    if (text.trim().length > 0) {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new ApiError('invalid_request', 'Тело запроса не является корректным JSON')
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ApiError('invalid_request', 'Тело запроса должно быть объектом JSON')
      }
      body = parsed as Record<string, unknown>
    }
    const ttlRaw = optionalPositiveNumber(body.ttl_sec, 'ttl_sec')
    const ttlSec = liveTtl(record, Math.min(Math.max(Math.trunc(ttlRaw ?? 900), 60), 86_400))
    const provider = await providerForRecord(record)
    if (provider.sshAccess === undefined) {
      throw new ApiError('capability_unavailable', `Провайдер «${provider.providerId}» не даёт SSH`)
    }
    const access = await provider.sshAccess(record.id, ttlSec)
    auditSandbox(record, 'sandbox.ssh', 'клиент получил SSH-команду к машине', { ttl_sec: ttlSec })
    return new Response(
      JSON.stringify({
        object: 'ssh_access',
        sandbox_id: record.id,
        command: publicSshCommand(access.command),
        expires_at: access.expiresAt === undefined ? null : iso(access.expiresAt),
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    )
  }

  /** Rename one machine. An empty `display_name` clears the name for good. */
  async function renameSandboxRoute(auth: VerifiedApiKey, id: string, req: Request): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    const body = await readJson(req)
    // A patch that names no field changes nothing: refusing is clearer than
    // answering «ok» to a request that asked for nothing.
    if (!('display_name' in body)) {
      throw new ApiError(
        'invalid_request',
        'Поле display_name обязательно: новое имя или пустая строка, чтобы стереть',
      )
    }
    const name = parseDisplayName(body.display_name, 'display_name')
    if (name === undefined) delete record.displayName
    else record.displayName = name
    return json(200, sandboxJson(record))
  }

  /**
   * Ports something inside the machine listens on, read from `ss -ltnH`. The
   * machine's own service ports are marked, so the console can keep a site off
   * them; the answer is a plain list, because ports change every second.
   */
  async function portsRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Список портов')
    const provider = await providerForRecord(record)
    const result = await provider.exec(record.id, 'ss -ltnH', { timeoutMs: 10_000 })
    if (result.exitCode !== 0) {
      throw new ApiError('provider_error', 'Машина не отдала список портов: ss недоступен')
    }
    const found = new Set<number>()
    for (const line of result.stdout.split('\n')) {
      const fields = line.trim().split(/\s+/)
      if (fields.length < 4) continue
      const local = fields[3] ?? ''
      const port = Number(local.slice(local.lastIndexOf(':') + 1))
      if (Number.isInteger(port) && port > 0 && port <= 65_535) found.add(port)
    }
    const data = [...found]
      .sort((left, right) => left - right)
      .map((port) => ({ port, reserved: RESERVED_PORTS.includes(port) }))
    return json(200, { object: 'list', data })
  }

  /**
   * Live resource use of one machine, sampled by one Python pass inside it.
   * Nothing is invented: a machine that cannot answer is an upstream failure,
   * not a card full of zeros.
   */
  async function metricsRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Метрики')
    const provider = await providerForRecord(record)
    const result = await provider.exec(record.id, `echo ${base64Utf8(METRICS_SCRIPT)} | base64 -d | python3 -`, {
      timeoutMs: 15_000,
    })
    if (result.exitCode !== 0) {
      throw new ApiError('provider_error', 'Машина не отдала метрики: python3 недоступен')
    }
    let sample: Record<string, unknown>
    try {
      const line = result.stdout.trim().split('\n').pop() ?? ''
      const parsed: unknown = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object')
      }
      sample = parsed as Record<string, unknown>
    } catch {
      throw new ApiError('provider_error', 'Машина не отдала метрики: ответ не разобран')
    }
    const kb = (field: string): number => {
      const value = sample[field]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ApiError('provider_error', `Машина не отдала метрики: поле ${field}`)
      }
      return Math.max(0, Math.round(value))
    }
    const rawCpu = sample['cpu_percent']
    const cpuPercent =
      typeof rawCpu === 'number' && Number.isFinite(rawCpu)
        ? Math.round(Math.max(0, Math.min(100, rawCpu)) * 10) / 10
        : 0
    return json(200, {
      object: 'metrics',
      at: iso(now()),
      cpu_percent: cpuPercent,
      memory_used_kb: kb('memory_used_kb'),
      memory_total_kb: kb('memory_total_kb'),
      disk_used_kb: kb('disk_used_kb'),
      disk_total_kb: kb('disk_total_kb'),
    })
  }

  // ---------- persistent shell ----------

  /**
   * Open (or reuse) the machine's one persistent shell. The answer names the
   * state and the directory a later command starts in.
   */
  async function sessionStartRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Терминал')
    const provider = await providerForRecord(record)
    const result = await provider.exec(record.id, sessionStartScript(), { timeoutMs: 35_000 })
    const lines = result.stdout.trim().split('\n').filter((line) => line.length > 0)
    const state = lines[0] === 'ready' ? 'ready' : 'unavailable'
    const cwd = lines.length > 1 && (lines[lines.length - 1] ?? '').startsWith('/')
      ? lines[lines.length - 1]!
      : HOME_ALIAS
    return json(200, { object: 'session', state, cwd })
  }

  /**
   * Run one command in the persistent shell and wait for its end marker. The
   * command travels base64-encoded, so nothing in it is re-quoted or logged.
   */
  async function sessionExecRoute(auth: VerifiedApiKey, id: string, req: Request): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Терминал')
    const body = await readJson(req)
    const command = body.command
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new ApiError('invalid_request', 'Поле command обязательно: что выполнить в машине')
    }
    const provider = await providerForRecord(record)
    const marker = nextId('roxm_')
    const result = await provider.exec(record.id, sessionExecScript(marker, command), { timeoutMs: 20_000 })
    if (result.stdout.includes(SESSION_MISSING)) {
      throw new ApiError('conflict', 'Сессия не запущена: сначала POST /session/start')
    }
    const parsed = parseSessionOutput(result.stdout, marker)
    if (parsed === null) {
      throw new ApiError('provider_error', 'Команда не завершилась за 15 секунд')
    }
    return json(200, {
      stdout: parsed.stdout,
      stderr: '',
      cwd: parsed.cwd,
      exit_code: parsed.exitCode,
    })
  }

  /** Interrupt whatever runs in the session, without closing it. */
  async function sessionInterruptRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Терминал')
    const provider = await providerForRecord(record)
    await provider.exec(
      record.id,
      `if [ -f ${SESSION_PID} ]; then pkill -INT -P "$(cat ${SESSION_PID})" 2>/dev/null || true; fi`,
      { timeoutMs: 10_000 },
    )
    return json(200, { ok: true })
  }

  /** Close the session and remove its directory; nothing is left running. */
  async function sessionStopRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Терминал')
    const provider = await providerForRecord(record)
    await provider.exec(
      record.id,
      `if [ -f ${SESSION_PID} ]; then pkill -TERM -P "$(cat ${SESSION_PID})" 2>/dev/null || true; kill -TERM "$(cat ${SESSION_PID})" 2>/dev/null || true; fi; rm -rf ${SESSION_DIR}; true`,
      { timeoutMs: 10_000 },
    )
    return new Response(null, { status: 204 })
  }

  // ---------- SSH keys ----------

  /**
   * Rewrite the machine's `authorized_keys` from the record. The file holds
   * only public keys; the private half never reaches the server.
   */
  async function writeAuthorizedKeys(
    provider: SandboxProvider,
    id: string,
    keys: readonly SshKeyRecord[],
  ): Promise<void> {
    const dir = '/home/daytona/.ssh'
    const file = `${dir}/authorized_keys`
    await provider.exec(id, `mkdir -p ${dir} && chmod 700 ${dir} && touch ${file} && chmod 600 ${file}`, {
      timeoutMs: 10_000,
    })
    const body = keys.length === 0 ? '' : `${keys.map((key) => key.publicKey).join('\n')}\n`
    await provider.writeFile(id, file, new TextEncoder().encode(body))
  }

  function listSshKeysRoute(auth: VerifiedApiKey, id: string): Response {
    const record = sandboxFor(auth.tenant.id, id)
    return json(200, { object: 'list', data: (record.sshKeys ?? []).map(sshKeyJson) })
  }

  /**
   * Register one public key. The response is metadata only: the key body is
   * public by definition but the list stays a fingerprint list.
   */
  async function addSshKeyRoute(auth: VerifiedApiKey, id: string, req: Request): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'SSH-ключи')
    const body = await readJson(req)
    const publicKey = parseSshPublicKey(body.public_key)
    const rawLabel = body.label
    if (rawLabel !== undefined && rawLabel !== null && typeof rawLabel !== 'string') {
      throw new ApiError('invalid_request', 'Поле label должно быть строкой')
    }
    const label = (typeof rawLabel === 'string' && rawLabel.trim().length > 0 ? rawLabel.trim() : 'Ключ').slice(0, 64)
    const provider = await providerForRecord(record)
    const key: SshKeyRecord = {
      id: nextId('ssh_'),
      label,
      publicKey,
      fingerprint: sshFingerprint(publicKey),
      createdAt: now(),
    }
    const keys = [...(record.sshKeys ?? []), key]
    record.sshKeys = keys
    try {
      await writeAuthorizedKeys(provider, record.id, keys)
    } catch (err) {
      record.sshKeys = keys.filter((entry) => entry.id !== key.id)
      throw err
    }
    auditSandbox(record, 'sandbox.ssh_key', 'клиент добавил открытый ключ к машине', { label: key.label })
    return json(201, sshKeyJson(key))
  }

  async function deleteSshKeyRoute(auth: VerifiedApiKey, id: string, keyId: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'SSH-ключи')
    const keys = record.sshKeys ?? []
    const key = keys.find((entry) => entry.id === keyId)
    if (key === undefined) throw new ApiError('not_found', 'SSH-ключ не найден')
    const provider = await providerForRecord(record)
    const remaining = keys.filter((entry) => entry.id !== key.id)
    await writeAuthorizedKeys(provider, record.id, remaining)
    record.sshKeys = remaining
    auditSandbox(record, 'sandbox.ssh_key', 'клиент убрал открытый ключ с машины', { label: key.label })
    return new Response(null, { status: 204 })
  }

  // ---------- snapshots ----------

  const SNAPSHOT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/

  /** Images this machine took, with the state the provider reports now. */
  async function listSnapshotsRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    const stored = record.snapshots ?? []
    if (stored.length > 0) {
      try {
        const provider = await providerForRecord(record)
        if (provider.listImages !== undefined) {
          const images = await provider.listImages()
          record.snapshots = stored.map((snapshot) => {
            const image = images.find((entry) => entry.name === snapshot.name || entry.id === snapshot.name)
            if (image === undefined) return snapshot
            return { ...snapshot, ...(image.state === undefined ? {} : { state: image.state }) }
          })
        }
      } catch {
        // A missing provider key or a listing failure is not a reason to hide
        // what was already taken; the stored state stays as it was.
      }
    }
    return json(200, { object: 'list', data: (record.snapshots ?? []).map(snapshotJson) })
  }

  /**
   * Freeze the machine's disk under a safe name. A named snapshot is checked
   * against the same alphabet the provider accepts, so a raw body cannot
   * travel into a vendor route.
   */
  async function createSnapshotRoute(auth: VerifiedApiKey, id: string, req: Request): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Снимки')
    const body = await readJson(req)
    const requested = optionalString(body.name, 'name')
    if (requested !== undefined && !SNAPSHOT_NAME.test(requested.trim())) {
      throw new ApiError(
        'invalid_request',
        'Имя снимка: латиница, цифры, «.», «_», «-», до 63 символов и не с дефиса',
      )
    }
    const name = requested === undefined
      ? `rox-${nextId('').slice(0, 8)}-${Math.floor(now() / 1000)}`
      : requested.trim()
    const provider = await providerForRecord(record)
    if (provider.createSnapshot === undefined) {
      throw new ApiError('capability_unavailable', `Провайдер «${provider.providerId}» не умеет делать снимки`)
    }
    const created = await provider.createSnapshot(record.id, name)
    const storedName = created.name.length > 0 ? created.name : name
    const state = created.state ?? 'building'
    const snapshot: SnapshotRecord = { name: storedName, createdAt: now(), state }
    const snapshots = [...(record.snapshots ?? [])]
    const index = snapshots.findIndex((entry) => entry.name === storedName)
    if (index >= 0) snapshots[index] = snapshot
    else snapshots.push(snapshot)
    record.snapshots = snapshots
    auditSandbox(record, 'sandbox.snapshot', 'клиент снял снимок диска машины', { name: storedName })
    return json(201, { object: 'snapshot', name: storedName, state })
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

  async function listFilesRoute(auth: VerifiedApiKey, id: string, url: URL): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record)
    const path = (url.searchParams.get('path') ?? '/home/daytona').trim()
    if (!path.startsWith('/') || path.split('/').includes('..') || /[\n\r\0]/.test(path)) {
      throw new ApiError('invalid_request', 'Путь к каталогу должен быть абсолютным и без «..»')
    }
    const provider = await providerForRecord(record)
    if (provider.listFiles === undefined) {
      throw new ApiError('capability_unavailable', `Провайдер «${provider.providerId}» не показывает файлы`)
    }
    const entries = await provider.listFiles(record.id, path)
    return json(200, {
      object: 'list',
      path,
      data: entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        is_dir: entry.isDir,
        size: entry.size,
        modified_at: entry.modifiedAt === undefined ? null : iso(entry.modifiedAt),
      })),
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

  /**
   * Remove one file. The path is absolute and free of `..`; the script itself
   * refuses a directory, so a mistaken path can never wipe a tree.
   */
  async function deleteFileRoute(auth: VerifiedApiKey, id: string, url: URL): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    requireRunning(record, 'Удаление файла')
    const path = url.searchParams.get('path')
    if (path === null || path.length === 0) {
      throw new ApiError('invalid_request', 'Параметр path обязателен: какой файл удалить')
    }
    if (!path.startsWith('/') || path.split('/').includes('..') || /[\n\r\0]/.test(path)) {
      throw new ApiError('invalid_request', 'Путь к файлу должен быть абсолютным и без «..»')
    }
    const provider = await providerForRecord(record)
    const result = await provider.exec(
      record.id,
      `echo ${base64Utf8(fileDeleteScript(path))} | base64 -d | python3 -`,
      { timeoutMs: 15_000 },
    )
    if (result.exitCode === 3) {
      throw new ApiError('invalid_request', 'Удалить можно только файл, а не каталог')
    }
    if (result.exitCode === 4) {
      throw new ApiError('not_found', 'Файл не найден')
    }
    if (result.exitCode !== 0) {
      throw new ApiError('provider_error', 'Машина не удалила файл')
    }
    return new Response(null, { status: 204 })
  }

  async function stopRoute(auth: VerifiedApiKey, id: string): Promise<Response> {
    const record = sandboxFor(auth.tenant.id, id)
    const provider = await providerForRecord(record)
    await provider.stop(record.id)
    record.state = 'stopped'
    // Metered from the moment the machine started; a record that never reported
    // a start is metered from its creation instead of from an invented time.
    const stoppedAt = now()
    await options.afterStop?.({
      tenantId: record.tenantId,
      providerId: record.providerId,
      sandboxId: record.id,
      startedAt: record.startedAt ?? record.createdAt,
      stoppedAt,
      ...(record.rateCentsPerHour === undefined ? {} : { rateCentsPerHour: record.rateCentsPerHour }),
      ...(record.billingMode === undefined ? {} : { billingMode: record.billingMode }),
    })
    // The invoice line closes with the same span the wallet settled: a stop
    // updates its amount and time, and deleting the machine later keeps it.
    const rate = record.rateCentsPerHour ?? options.rateCentsPerHour
    if (rate !== undefined) {
      const elapsedMs = Math.max(0, stoppedAt - (record.startedAt ?? record.createdAt))
      record.costCents = Math.max(1, Math.ceil((elapsedMs / 3_600_000) * rate))
    }
    const line = store.usage.find((row) => row.tenantId === record.tenantId && row.ref === record.id)
    if (line !== undefined) {
      line.cents = record.costCents
      line.stoppedAt = stoppedAt
      if (record.startedAt !== undefined) line.startedAt = record.startedAt
    }
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
      api_key: generated.secret,
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

  // There is deliberately no customer top-up: adding money is the staff
  // credit under `/v1/admin/tenants/{id}/credit`. The removed route would let
  // any key that once carried `billing:write` mint its own balance, and the
  // stored scopes of existing keys cannot be rewritten from here.

  // ---------- guest ----------

  /**
   * A trial account without registration: one tenant, one key, one trial
   * balance. Off unless the deployment enables it, limited per address, and
   * the tenant carries ceilings that make the trial last about a day.
   *
   * The response holds the only copy of the secret; nothing about the platform
   * key behind managed machines appears here.
   */
  async function guestRoute(req: Request): Promise<Response> {
    const guest = options.guest
    if (guest === undefined || !guest.enabled) {
      throw new ApiError('guest_disabled', 'Гостевой вход выключен: получите ключ API у дежурного')
    }
    const wallet = options.moneyStore
    if (wallet === undefined) {
      throw new ApiError(
        'capability_unavailable',
        'Гостевой вход не поддерживается этой сборкой: кошелёк не подключён',
      )
    }

    const perAddress = guest.rateLimit ?? GUEST_RATE_LIMIT
    // Counted by client address, not by key: a guest is exactly the caller who
    // has no key yet, and three sign-ups from one address is already a crowd.
    const address = options.guestClientIp?.(req) ?? clientIp(req) ?? 'local'
    const windowKey = `guest\u0000${address}`
    const at = now()
    const bucket = buckets.get(windowKey)
    if (bucket === undefined || at - bucket.windowStart >= perAddress.windowMs) {
      buckets.set(windowKey, { windowStart: at, count: 1 })
    } else {
      bucket.count += 1
      if (bucket.count > perAddress.limit) {
        throw new ApiError(
          'rate_limited',
          `Слишком много гостевых входов с одного адреса: не больше ${perAddress.limit} за ${Math.round(perAddress.windowMs / 60_000)} минут`,
        )
      }
    }

    const trialCents = guest.trialCents ?? GUEST_TRIAL_CENTS
    const tenant = store.addTenant('Гость', {
      guest: true,
      limits: {
        maxConcurrentSandboxes: GUEST_LIMITS.maxConcurrentSandboxes,
        maxCpuPerSandbox: GUEST_LIMITS.maxCpuPerSandbox,
        maxMonthlyCents: trialCents,
        maxTtlSec: GUEST_MAX_TTL_SEC,
      },
    })
    wallet.saveAccount({
      id: tenant.id,
      paid: true,
      balanceCents: 0,
      reservedCents: 0,
      monthlyCapCents: trialCents,
      monthSpentCents: 0,
    })
    const credited = topUp(wallet, tenant.id, trialCents, at)

    const generated = generateApiKey()
    const record: ApiKeyRecord = {
      id: nextId('key_'),
      tenantId: tenant.id,
      prefix: generated.prefix,
      last4: generated.last4,
      hash: generated.hash,
      // No keys:write and no billing:write: a trial cannot mint itself more.
      scopes: GUEST_SCOPES,
      createdAt: at,
    }
    store.addApiKey(record)

    options.audit?.append({
      actorId: 'guest',
      action: GUEST_SIGNUP_ACTION,
      targetType: 'tenant',
      targetId: tenant.id,
      reason: 'гостевой вход с сайта',
      details: {
        trial_cents: trialCents,
        key_id: record.id,
        ip: address,
      },
    })

    return json(201, {
      object: 'guest',
      tenant: { id: tenant.id, name: tenant.name },
      api_key: generated.secret,
      balance_cents: credited.account.balanceCents,
    })
  }

  // ---------- catalog / images ----------

  /**
   * What the site sells: the eight machines with both prices, the providers a
   * deployment declares, and which of them Rox can pay for itself. A customer
   * reads `cents_per_hour`; `service_fee_cents_per_hour` is the byok column.
   */
  function catalogRoute(): Response {
    return json(200, {
      object: 'catalog',
      products: DEFAULT_PRODUCTS.map((product) => ({
        id: product.id,
        name: product.name,
        snapshot: product.snapshot,
        os: product.os,
        cpu: product.cpu,
        memory_gb: product.memoryGb,
        disk_gb: product.diskGb,
        gpu: product.gpu ?? null,
        cents_per_hour: product.centsPerHour,
        service_fee_cents_per_hour: serviceFeeCentsPerHour(product.centsPerHour),
        available: product.available !== false,
        note: product.note ?? null,
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
      managed_providers: options.managedProviders?.() ?? [],
    })
  }

  /**
   * Images one customer can actually boot: their own key first, the platform
   * key when they have none. A provider without a list route, or a listing
   * failure, is a capability answer rather than an empty list that would read
   * as «nothing exists».
   */
  async function imagesRoute(auth: VerifiedApiKey, providerId: string): Promise<Response> {
    const declared = declaredCapabilities(providerId)
    if (!declared) {
      throw new ApiError(
        'provider_unknown',
        `Неизвестный провайдер «${providerId}». Доступны: ${allowedProviderList()}`,
      )
    }
    const lease = await leaseFor(auth.tenant.id, providerId)
    if (!lease) {
      throw new ApiError(
        'capability_unavailable',
        `У арендатора нет ключа для провайдера «${providerId}», и платформенного ключа нет`,
      )
    }
    if (lease.provider.listImages === undefined) {
      throw new ApiError(
        'capability_unavailable',
        `Провайдер «${providerId}» не отдаёт список образов: выбирайте снимок по имени`,
      )
    }
    const images: ProviderImage[] = await lease.provider.listImages()
    return json(200, {
      object: 'list',
      provider: providerId,
      mode: lease.mode,
      data: images.map((image) => ({
        id: image.id,
        name: image.name,
        ...(image.label === undefined ? {} : { label: image.label }),
        os: image.os,
        cpu: image.cpu,
        memoryGb: image.memoryGb,
        diskGb: image.diskGb,
        gpu: image.gpu ?? null,
        state: image.state ?? 'active',
      })),
    })
  }

  /**
   * The customer's own journal. A tenant never sees staff actions or another
   * tenant's rows: an entry belongs here when it was written in the tenant's
   * name, against the tenant, against one of its machines, or carries the
   * tenant id in its details (the staff stop does).
   */
  function customerAuditRoute(auth: VerifiedApiKey, url: URL): Response {
    const audit = options.audit
    if (audit === undefined) return json(200, { object: 'list', data: [] })
    const raw = url.searchParams.get('limit')
    let limit = DEFAULT_LIMIT
    if (raw !== null) {
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        throw new ApiError('invalid_request', `limit должен быть целым числом от 1 до ${MAX_LIMIT}`)
      }
      limit = parsed
    }
    const action = url.searchParams.get('action')
    const since = url.searchParams.get('since')
    if (since !== null && Number.isNaN(Date.parse(since))) {
      throw new ApiError('invalid_request', 'since должен быть датой в формате ISO-8601')
    }
    const owned = new Set(store.sandboxesOf(auth.tenant.id).map((record) => record.id))
    owned.add(auth.tenant.id)
    // The store filters by one target id; a tenant owns several, so the shared
    // filters run here and the ownership check is applied to every row.
    const entries = audit
      .list({
        ...(action === null ? {} : { action: action as AuditAction }),
        ...(since === null ? {} : { from: since }),
      })
      .filter((entry) => {
        if (entry.actorId === `tenant:${auth.tenant.id}`) return true
        if (owned.has(entry.targetId)) return true
        return String(entry.details?.['tenant_id'] ?? '') === auth.tenant.id
      })
      .slice(-limit)
      .reverse()
    return json(200, {
      object: 'list',
      data: entries.map((entry) => ({
        id: entry.id,
        tenant_id: auth.tenant.id,
        actor: entry.actorId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        reason: entry.reason,
        at: entry.at,
        details: entry.details ?? null,
        // The audit chain has no HTTP request id of its own; the row id is
        // what a person quotes, and the field stays in the shape for the UI.
        request_id: null,
      })),
    })
  }

  /** One invoice line as the console and the CSV show it. */
  function usageJson(row: UsageRow): Record<string, unknown> {
    return {
      id: row.id,
      ref: row.ref,
      product: row.product,
      label: row.label ?? null,
      snapshot: row.snapshot ?? null,
      billing_mode: row.billingMode ?? 'byok',
      rate_cents_per_hour: row.rateCentsPerHour ?? null,
      retail_cents_per_hour: row.retailCentsPerHour ?? null,
      service_fee_cents_per_hour: row.serviceFeeCentsPerHour ?? null,
      cents: row.cents,
      currency: row.currency,
      created_at: new Date(row.createdAt).toISOString(),
      started_at: row.startedAt === undefined ? null : new Date(row.startedAt).toISOString(),
      stopped_at: row.stoppedAt === undefined ? null : new Date(row.stoppedAt).toISOString(),
    }
  }

  /** CSV fields with quotes doubled, so a label with a comma stays one cell. */
  function csvCell(value: string | number | null): string {
    if (value === null) return ''
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }

  function usageRoute(auth: VerifiedApiKey, url: URL): Response {
    const rows = store.usage.filter((row) => row.tenantId === auth.tenant.id)
    if (url.searchParams.get('format') === 'csv') {
      const header = [
        'id',
        'ref',
        'label',
        'snapshot',
        'billing_mode',
        'rate_cents_per_hour',
        'retail_cents_per_hour',
        'service_fee_cents_per_hour',
        'cents',
        'currency',
        'created_at',
        'started_at',
        'stopped_at',
      ]
      const lines = rows.map((row) => {
        const view = usageJson(row)
        return header.map((key) => csvCell(view[key] as string | number | null)).join(',')
      })
      return new Response([header.join(','), ...lines].join('\n'), {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8' },
      })
    }
    return json(200, { object: 'list', data: rows.map(usageJson) })
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

    // Public: no key, because the whole point is the key it hands back.
    if (segments.length === 2 && segments[1] === 'guest' && method === 'POST') {
      return guestRoute(req)
    }

    if (segments.length === 2 && segments[1] === 'catalog' && method === 'GET') {
      requireAuth(req)
      return catalogRoute()
    }

    if (segments.length === 4 && segments[1] === 'providers' && segments[3] === 'images' && method === 'GET') {
      return imagesRoute(requireAuth(req, 'sandboxes:read'), segments[2]!)
    }

    if (segments[1] === 'usage' && segments.length === 2 && method === 'GET') {
      return usageRoute(requireAuth(req, 'billing:read'), url)
    }

    if (segments[1] === 'audit' && segments.length === 2 && method === 'GET') {
      return customerAuditRoute(requireAuth(req), url)
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
        if (method === 'PATCH') return renameSandboxRoute(requireAuth(req, 'sandboxes:write'), id, req)
        if (method === 'DELETE') return deleteRoute(requireAuth(req, 'sandboxes:write'), id)
      }
      if (segments.length === 5 && segments[3] === 'files' && segments[4] === 'list' && method === 'GET') {
        return listFilesRoute(requireAuth(req, 'sandboxes:read'), segments[2], url)
      }
      if (segments.length === 5 && segments[3] === 'session' && method === 'POST') {
        const id = segments[2]
        const step = segments[4]
        if (step === 'start') return sessionStartRoute(requireAuth(req, 'sandboxes:write'), id)
        if (step === 'exec') return sessionExecRoute(requireAuth(req, 'sandboxes:write'), id, req)
        if (step === 'interrupt') return sessionInterruptRoute(requireAuth(req, 'sandboxes:write'), id)
        if (step === 'stop') return sessionStopRoute(requireAuth(req, 'sandboxes:write'), id)
      }
      if (segments.length === 5 && segments[3] === 'ssh-keys' && method === 'DELETE') {
        return deleteSshKeyRoute(requireAuth(req, 'sandboxes:write'), segments[2], segments[4])
      }
      if (
        segments.length === 6 &&
        segments[3] === 'processes' &&
        segments[5] === 'kill' &&
        method === 'POST'
      ) {
        return killProcessRoute(requireAuth(req, 'sandboxes:write'), segments[2], segments[4])
      }
      if (segments.length === 4) {
        const id = segments[2]
        const action = segments[3]
        if (action === 'exec' && method === 'POST') {
          return execRoute(requireAuth(req, 'sandboxes:write'), id, req)
        }
        if (action === 'processes' && method === 'GET') {
          return processesRoute(requireAuth(req, 'sandboxes:read'), id)
        }
        if (action === 'network-check' && method === 'GET') {
          return networkCheckRoute(requireAuth(req, 'sandboxes:read'), id)
        }
        if (action === 'ports' && method === 'GET') {
          return portsRoute(requireAuth(req, 'sandboxes:read'), id)
        }
        if (action === 'metrics' && method === 'GET') {
          return metricsRoute(requireAuth(req, 'sandboxes:read'), id)
        }
        if (action === 'network' && method === 'GET') {
          return networkRoute(requireAuth(req, 'sandboxes:read'), id, url)
        }
        if (action === 'preview' && method === 'POST') {
          return previewRoute(requireAuth(req, 'sandboxes:write'), id, req)
        }
        if (action === 'ssh' && method === 'POST') {
          return sshRoute(requireAuth(req, 'sandboxes:write'), id, req)
        }
        if (action === 'ssh-keys' && method === 'GET') {
          return listSshKeysRoute(requireAuth(req, 'sandboxes:read'), id)
        }
        if (action === 'ssh-keys' && method === 'POST') {
          return addSshKeyRoute(requireAuth(req, 'sandboxes:write'), id, req)
        }
        if (action === 'snapshots' && method === 'GET') {
          return listSnapshotsRoute(requireAuth(req, 'sandboxes:read'), id)
        }
        if (action === 'snapshots' && method === 'POST') {
          return createSnapshotRoute(requireAuth(req, 'sandboxes:write'), id, req)
        }
        if (action === 'files' && method === 'GET') {
          return readFileRoute(requireAuth(req, 'sandboxes:read'), id, url)
        }
        if (action === 'files' && method === 'PUT') {
          return writeFileRoute(requireAuth(req, 'sandboxes:write'), id, url, req)
        }
        if (action === 'files' && method === 'DELETE') {
          return deleteFileRoute(requireAuth(req, 'sandboxes:write'), id, url)
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
      const startedAt = now()
      const path = new URL(req.url).pathname
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
      // Bodyless by design: a staff journal an operator reads must never hold
      // a request body or an Authorization header, only who called and how it
      // ended. A failure to journal must not fail the call itself.
      try {
        const auth = authByRequest.get(req)
        const ip = clientIp(req)
        store.recordRequest({
          at: startedAt,
          method: req.method.toUpperCase(),
          path,
          status: response.status,
          durationMs: Math.max(0, now() - startedAt),
          requestId,
          ...(auth === undefined ? {} : { tenantId: auth.tenantId, keyLast4: auth.keyLast4 }),
          ...(ip === undefined ? {} : { ip }),
        })
      } catch {
        // The journal is diagnostics; the response is the contract.
      }
      return response
    },
  }
}
