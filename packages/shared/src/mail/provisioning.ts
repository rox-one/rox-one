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
 */
import { JmapClient, JmapError, type FetchLike } from './jmap-client'
import { StalwartAdmin, createAppPassword, generateMailboxPassword, ownerMarker, type AdminCredentials } from './stalwart-admin'
import { handleVariants, pickHandle } from './handle'

export type MailboxState = 'PENDING' | 'PROVISIONING' | 'PROVISIONED' | 'READY' | 'NEEDS_REPAIR'

export interface MailboxRecord {
  address: string
  handle: string
  domain: string
  ownerUuid: string
  stalwartAccountId: string
  jmapAccountId: string | null
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
  fetch?: FetchLike
  now?: () => number
  log?: (message: string) => void
}

export class ProvisionError extends Error {
  constructor(message: string, readonly code: 'admin-unavailable' | 'no-domain' | 'handle-exhausted' | 'verify-failed' | 'server') {
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
      const accountId = await admin.createAccount({ name: handle, domainId, description: marker, password, locale: 'ru' })
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
