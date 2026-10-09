/**
 * `POST /api/provision` — provision a JMAP mailbox for the Rox account that
 * owns the presented access token.
 *
 * The token is verified against the Rox broker (`/api/me/account`); the
 * account's handle picks the address and Stalwart's management API
 * (`@rox/shared/mail` → StalwartAdmin) does the idempotent provisioning.
 * A server-side caller may instead present the shared service token
 * (`MAIL_PROVISION_SERVICE_TOKEN`, compared in constant time) and name the
 * owner in the body (`ownerUuid`, optional `handle`/`email`).
 * An optional `{"quotaBytes": <int>}` body overrides the per-mailbox storage
 * quota (default `MAIL_DEFAULT_QUOTA_BYTES`, 1 GiB). The mailbox password is
 * handed to the caller once and never stored here.
 */
import { timingSafeEqual } from 'node:crypto'
import { generateMailboxPassword, JmapError, MAX_MAILBOX_QUOTA_BYTES, MIN_MAILBOX_QUOTA_BYTES, ownerMarker, pickHandle, StalwartAdmin } from '@rox/shared/mail'
import type { Config } from './config.ts'

export interface ProvisionResult {
  status: 200 | 400 | 401 | 409 | 502
  body: Record<string, unknown>
}

export interface ProvisionDeps {
  config: Config
  /** Test seam: replaces the broker and Stalwart calls. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}

interface BrokerAccount {
  ownerUuid: string
  handle: string | null
  email: string | null
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match ? match[1]! : null
}

/** Constant-time comparison of the presented token with the configured service token. */
function isServiceToken(config: Config, token: string): boolean {
  const expected = config.provisionServiceToken
  if (!expected) return false
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Validate an optional `quotaBytes` field: `null` when absent, `'invalid'` when out of range. */
function requestedQuota(body: Record<string, unknown> | null): number | null | 'invalid' {
  const value = body?.quotaBytes
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_MAILBOX_QUOTA_BYTES || value > MAX_MAILBOX_QUOTA_BYTES) return 'invalid'
  return value
}

async function verifyToken(config: Config, token: string, fetchImpl: (input: string, init?: RequestInit) => Promise<Response>): Promise<BrokerAccount | null> {
  let response: Response
  try {
    response = await fetchImpl(`${config.brokerUrl}/api/me/account`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(config.brokerTimeoutMs),
    })
  } catch {
    throw new JmapError('Rox broker is unreachable', 'network')
  }
  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) throw new JmapError(`Rox broker answered HTTP ${response.status}`, 'http', response.status)
  const data = (await response.json().catch(() => null)) as { user?: { id?: unknown; handle?: unknown; email?: unknown } } | null
  const id = data?.user?.id
  if (typeof id !== 'string' || id.length === 0) throw new JmapError('Rox broker returned an unexpected account payload', 'protocol')
  return {
    ownerUuid: id,
    handle: typeof data?.user?.handle === 'string' ? data.user.handle : null,
    email: typeof data?.user?.email === 'string' ? data.user.email : null,
  }
}

export async function handleProvision(request: Request, deps: ProvisionDeps): Promise<ProvisionResult> {
  const { config } = deps
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init))
  const token = bearerToken(request)
  if (!token) return { status: 401, body: { error: 'missing_token' } }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const requested = requestedQuota(body)
  if (requested === 'invalid') {
    return {
      status: 400,
      body: { error: 'invalid_quota', detail: `quotaBytes must be an integer between ${MIN_MAILBOX_QUOTA_BYTES} and ${MAX_MAILBOX_QUOTA_BYTES}` },
    }
  }
  const quotaBytes = requested ?? config.mailDefaultQuotaBytes

  let account: BrokerAccount | null
  if (isServiceToken(config, token)) {
    // Server-side caller (site drain worker): the owner is named in the body.
    const ownerUuid = typeof body?.ownerUuid === 'string' ? body.ownerUuid.trim() : ''
    if (!ownerUuid) {
      return { status: 400, body: { error: 'missing_owner', detail: 'ownerUuid is required when authenticating with the provisioning service token' } }
    }
    account = {
      ownerUuid,
      handle: typeof body?.handle === 'string' ? body.handle : null,
      email: typeof body?.email === 'string' ? body.email : null,
    }
  } else {
    try {
      account = await verifyToken(config, token, fetchImpl)
    } catch (error) {
      return { status: 502, body: { error: 'broker_unavailable', detail: error instanceof JmapError ? error.message : 'token verification failed' } }
    }
    if (!account) return { status: 401, body: { error: 'invalid_token' } }
  }

  const emailLocalPart = typeof account.email === 'string' && account.email.includes('@') ? account.email.split('@')[0]! : null
  const handle = pickHandle([account.handle, emailLocalPart], 'mark')
  const marker = ownerMarker(account.ownerUuid)

  try {
    const admin = new StalwartAdmin(config.stalwartAdminUrl, { username: config.stalwartAdminUser, secret: config.stalwartAdminPassword }, { fetch: fetchImpl })
    const domainId = await admin.domainId(config.mailDomain)
    if (!domainId) {
      return { status: 502, body: { error: 'domain_missing', detail: `Domain ${config.mailDomain} is not configured on the mail server` } }
    }
    const existing = await admin.findAccount(handle, domainId)
    if (existing && existing.description !== marker) {
      return { status: 409, body: { error: 'handle_taken', detail: `${handle}@${config.mailDomain} is owned by another account` } }
    }

    const password = generateMailboxPassword()
    let accountId: string
    if (existing) {
      accountId = existing.id
      await admin.resetPassword(accountId, password)
      await admin.setQuota(accountId, quotaBytes)
    } else {
      try {
        accountId = await admin.createAccount({ name: handle, domainId, description: marker, password, quotaBytes })
      } catch (error) {
        // Lost a race: re-read and decide whether the winner was us.
        const raced = await admin.findAccount(handle, domainId).catch(() => null)
        if (!raced) throw error
        if (raced.description !== marker) {
          return { status: 409, body: { error: 'handle_taken', detail: `${handle}@${config.mailDomain} is owned by another account` } }
        }
        accountId = raced.id
        await admin.resetPassword(accountId, password)
        await admin.setQuota(accountId, quotaBytes)
      }
    }

    const address = `${handle}@${config.mailDomain}`
    return { status: 200, body: { address, username: address, password, jmapUrl: config.jmapUrl, quotaBytes } }
  } catch (error) {
    const detail = error instanceof JmapError ? error.message : 'mail server provisioning failed'
    return { status: 502, body: { error: 'provision_failed', detail } }
  }
}