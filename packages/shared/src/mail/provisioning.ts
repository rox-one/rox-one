/**
 * Mailbox provisioning for Rox (spec §2.3–2.4), transport-agnostic so the
 * same function can run in the Rox main process (local pilot, today) and in
 * the rox.one signup hook (`databaseHooks.user.create.after` → worker, later).
 *
 *   1. Pick a handle (profile/login → fallback), walk handle, handle2, …
 *   2. Account exists with our owner marker → adopt; with another marker →
 *      skip (never adopt a foreign account); absent → create with a random
 *      password that is never stored.
 *   3. As the user, mint a device-scoped app password (server-generated,
 *      returned once) and hand it to `secrets.put` (Keychain-backed
 *      CredentialManager in Rox). The account password is discarded.
 *   4. Verify: a JMAP Session with the app password answers for the same
 *      account → READY.
 *
 * Idempotent: rerunning with the same owner finds the same account; a lost
 * app password is repaired by resetting the (discarded) account password and
 * minting a new app password. Secrets never reach logs or thrown messages.
 *
 * Two transports live here:
 *  - `provisionMailbox` — direct Stalwart management (loopback pilot / dev),
 *    needs admin credentials.
 *  - `provisionMailboxViaService` — the public Rox mail host
 *    (`POST /api/provision`, Bearer Rox access token), no admin credentials
 *    in the client.
 */
import { JmapClient, JmapError, normalizeBaseUrl, type FetchLike } from './jmap-client'
import { StalwartAdmin, createAppPassword, generateMailboxPassword, ownerMarker, type AdminCredentials } from './stalwart-admin'
import { handleVariants, pickHandle } from './handle'

export type MailboxState = 'PENDING' | 'PROVISIONING' | 'PROVISIONED' | 'READY' | 'NEEDS_REPAIR'

/** Per-user mailbox storage quota applied at provisioning time (product default: 1 GiB). */
export const DEFAULT_MAILBOX_QUOTA_BYTES = 1024 ** 3
/** Accepted range for a mailbox quota: 256 MiB … 1 TiB. */
export const MIN_MAILBOX_QUOTA_BYTES = 256 * 1024 ** 2
export const MAX_MAILBOX_QUOTA_BYTES = 1024 ** 4

/** Validate a caller-supplied quota, applying the default when omitted. */
export function resolveMailboxQuotaBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAILBOX_QUOTA_BYTES
  if (!Number.isInteger(value) || value < MIN_MAILBOX_QUOTA_BYTES || value > MAX_MAILBOX_QUOTA_BYTES) {
    throw new ProvisionError(
      `Mailbox quota must be an integer between ${MIN_MAILBOX_QUOTA_BYTES} and ${MAX_MAILBOX_QUOTA_BYTES} bytes (got ${JSON.stringify(value)})`,
      'invalid-quota',
    )
  }
  return value
}

export interface MailboxRecord {
  address: string
  handle: string
  domain: string
  ownerUuid: string
  stalwartAccountId: string
  jmapAccountId: string | null
  /**
   * JMAP origin handed out by the provisioning service. Absent for the local
   * pilot (the configured server URL is the JMAP origin). Never a placeholder:
   * existing records without it keep resolving against the configured server.
   */
  jmapUrl?: string | null
  state: MailboxState
  createdAt: number
  updatedAt: number
  /** Description of the device credential (never the secret). */
  credentialLabel: string | null
}

export interface MailboxSecretStore {
  get(address: string): Promise<string | null>
  put(address: string, secret: string): Promise<void>
  delete(address: string): Promise<void>
}

export interface ProvisionInput {
  baseUrl: string
  domain: string
  ownerUuid: string
  handleCandidates: ReadonlyArray<string | null | undefined>
  fallbackHandle?: string
  deviceLabel: string
  admin: () => Promise<AdminCredentials>
  secrets: MailboxSecretStore
  existing?: MailboxRecord | null
  /** Mailbox storage limit in bytes; defaults to {@link DEFAULT_MAILBOX_QUOTA_BYTES}. */
  quotaBytes?: number
  fetch?: FetchLike
  now?: () => number
  log?: (message: string) => void
}

export class ProvisionError extends Error {
  constructor(
    message: string,
    readonly code: 'admin-unavailable' | 'no-domain' | 'handle-exhausted' | 'verify-failed' | 'unauthorized' | 'handle-taken' | 'server' | 'invalid-quota',
  ) {
    super(message)
    this.name = 'ProvisionError'
  }
}

async function verify(baseUrl: string, address: string, secret: string, fetchImpl?: FetchLike): Promise<string> {
  const client = new JmapClient({ baseUrl, username: address, secret }, { fetch: fetchImpl })
  const s = await client.session(true)
  if (s.username.toLowerCase() !== address.toLowerCase()) throw new ProvisionError('JMAP session answered for a different user', 'verify-failed')
  return client.accountId()
}

export async function provisionMailbox(input: ProvisionInput): Promise<MailboxRecord> {
  const now = input.now ?? Date.now
  const log = input.log ?? (() => {})
  const marker = ownerMarker(input.ownerUuid)
  // Validated up front so a bad quota never leaves a half-provisioned mailbox.
  const quotaBytes = resolveMailboxQuotaBytes(input.quotaBytes)

  // Fast path: we already hold a working device credential.
  if (input.existing && input.existing.ownerUuid === input.ownerUuid) {
    const secret = await input.secrets.get(input.existing.address)
    if (secret) {
      try {
        const jmapAccountId = await verify(input.baseUrl, input.existing.address, secret, input.fetch)
        return { ...input.existing, jmapAccountId, state: 'READY', updatedAt: now() }
      } catch (error) {
        if (!(error instanceof JmapError && error.code === 'auth')) throw error
        log('[mail] stored device credential was rejected; repairing')
      }
    }
  }

  let admin: StalwartAdmin
  try {
    admin = new StalwartAdmin(input.baseUrl, await input.admin(), { fetch: input.fetch })
  } catch (error) {
    throw new ProvisionError(`Mail server administrator credentials are unavailable: ${(error as Error).message}`, 'admin-unavailable')
  }
  const domainId = await admin.domainId(input.domain)
  if (!domainId) throw new ProvisionError(`Domain ${input.domain} is not configured on the mail server`, 'no-domain')

  const base = input.existing?.ownerUuid === input.ownerUuid ? input.existing.handle : pickHandle(input.handleCandidates, input.fallbackHandle ?? 'mark')
  let chosen: { handle: string; accountId: string; created: boolean } | null = null
  for (const handle of handleVariants(base)) {
    const found = await admin.findAccount(handle, domainId)
    if (!found) {
      const password = generateMailboxPassword()
      let accountId: string
      try {
        accountId = await admin.createAccount({ name: handle, domainId, description: marker, password, quotaBytes })
      } catch (error) {
        const raced = await admin.findAccount(handle, domainId).catch(() => null)
        if (!raced) throw error
        if (raced.description === marker) {
          chosen = { handle, accountId: raced.id, created: false }
          break
        }
        log(`[mail] ${handle}@${input.domain} was claimed by another owner; trying the next handle`)
        continue
      }
      chosen = { handle, accountId, created: true }
      // Mint the device credential while we still hold the password, then drop it.
      const address = `${handle}@${input.domain}`
      const app = await createAppPassword(input.baseUrl, address, password, input.deviceLabel, { fetch: input.fetch })
      await input.secrets.put(address, app.secret)
      break
    }
    if (found.description === marker) {
      chosen = { handle, accountId: found.id, created: false }
      break
    }
    log(`[mail] ${handle}@${input.domain} belongs to another owner; trying the next handle`)
  }
  if (!chosen) throw new ProvisionError('No free mailbox handle found', 'handle-exhausted')

  const address = `${chosen.handle}@${input.domain}`
  if (!chosen.created) {
    // Adopting our own account (e.g. keychain entry lost): rotate the
    // discarded password and mint a fresh device credential.
    const password = generateMailboxPassword()
    await admin.resetPassword(chosen.accountId, password)
    // Set (or refresh) the quota idempotently for a mailbox we adopted.
    await admin.setQuota(chosen.accountId, quotaBytes)
    const app = await createAppPassword(input.baseUrl, address, password, input.deviceLabel, { fetch: input.fetch })
    await input.secrets.put(address, app.secret)
  }

  const secret = await input.secrets.get(address)
  if (!secret) throw new ProvisionError('Device credential was not persisted', 'verify-failed')
  let jmapAccountId: string
  try {
    jmapAccountId = await verify(input.baseUrl, address, secret, input.fetch)
  } catch (error) {
    throw new ProvisionError(`Mailbox created but JMAP verification failed: ${(error as Error).message}`, 'verify-failed')
  }
  const t = now()
  return {
    address,
    handle: chosen.handle,
    domain: input.domain,
    ownerUuid: input.ownerUuid,
    stalwartAccountId: chosen.accountId,
    jmapAccountId,
    state: 'READY',
    createdAt: input.existing?.address === address ? input.existing.createdAt : t,
    updatedAt: t,
    credentialLabel: input.deviceLabel,
  }
}

export interface ServiceProvisionInput {
  /** Rox mail host serving `POST {serverUrl}/api/provision` + JMAP. */
  serverUrl: string
  /** Rox account id (owner marker for the mailbox record). */
  ownerUuid: string
  /** Rox account access token (Bearer); verified server-side against the broker. */
  accessToken: string
  deviceLabel: string
  secrets: MailboxSecretStore
  existing?: MailboxRecord | null
  fetch?: FetchLike
  now?: () => number
  log?: (message: string) => void
}

/**
 * Provision a production mailbox through the Rox mail service
 * (`POST {server}/api/provision`, `Authorization: Bearer <rox access token>`).
 * The service verifies the token with the Rox broker, picks the account handle
 * and returns the mailbox password once. Idempotent: a working stored
 * credential short-circuits the call, so the server is not asked to rotate the
 * password again on every launch.
 */
export async function provisionMailboxViaService(input: ServiceProvisionInput): Promise<MailboxRecord> {
  const now = input.now ?? Date.now
  const log = input.log ?? (() => {})
  const fetchImpl: FetchLike = input.fetch ?? ((url, init) => fetch(url, init))
  const server = normalizeBaseUrl(input.serverUrl)
  const existingBase = input.existing?.jmapUrl ? normalizeBaseUrl(input.existing.jmapUrl) : server

  // Fast path: a stored device credential already answers JMAP.
  if (input.existing && input.existing.ownerUuid === input.ownerUuid) {
    const secret = await input.secrets.get(input.existing.address)
    if (secret) {
      try {
        const jmapAccountId = await verify(existingBase, input.existing.address, secret, input.fetch)
        return { ...input.existing, jmapUrl: existingBase, jmapAccountId, state: 'READY', updatedAt: now() }
      } catch (error) {
        if (!(error instanceof JmapError && error.code === 'auth')) throw error
        log('[mail] stored device credential was rejected; re-provisioning')
      }
    }
  }

  let response: Response
  try {
    response = await fetchImpl(`${server}/api/provision`, {
      method: 'POST',
      headers: { authorization: `Bearer ${input.accessToken}`, accept: 'application/json' },
    })
  } catch (error) {
    throw new ProvisionError(`Mail provisioning service is unreachable: ${(error as Error).message}`, 'server')
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProvisionError('The Rox account token was rejected by the mail service', 'unauthorized')
  }
  if (response.status === 409) {
    throw new ProvisionError('The mailbox address is already owned by another Rox account', 'handle-taken')
  }
  const body = (await response.json().catch(() => null)) as
    | { address?: unknown; username?: unknown; password?: unknown; jmapUrl?: unknown; detail?: unknown }
    | null
  if (!response.ok || !body) {
    const detail = typeof body?.detail === 'string' && body.detail ? body.detail : `HTTP ${response.status}`
    throw new ProvisionError(`Mail provisioning failed: ${detail}`, 'server')
  }
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!address.includes('@') || !password) {
    throw new ProvisionError('The mail service returned an unexpected provisioning payload', 'server')
  }
  const jmapUrl = typeof body.jmapUrl === 'string' && body.jmapUrl.trim() ? normalizeBaseUrl(body.jmapUrl) : server
  const [handle, domain] = [address.slice(0, address.lastIndexOf('@')), address.slice(address.lastIndexOf('@') + 1)]
  await input.secrets.put(address, password)

  let jmapAccountId: string
  try {
    jmapAccountId = await verify(jmapUrl, address, password, input.fetch)
  } catch (error) {
    throw new ProvisionError(`Mailbox created but JMAP verification failed: ${(error as Error).message}`, 'verify-failed')
  }
  const t = now()
  return {
    address,
    handle,
    domain,
    ownerUuid: input.ownerUuid,
    // The remote service owns the Stalwart account; it is not addressed here.
    stalwartAccountId: '',
    jmapAccountId,
    jmapUrl,
    state: 'READY',
    createdAt: input.existing?.address === address ? input.existing.createdAt : t,
    updatedAt: t,
    credentialLabel: input.deviceLabel,
  }
}
