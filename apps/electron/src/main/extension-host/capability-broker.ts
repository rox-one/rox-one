/**
 * Capability broker (S-05).
 *
 * Main holds CredentialManager. Workers never receive raw secrets.
 * Main mints temporary scoped capability tokens; workers redeem them via
 * parentPort RPC so main can resolve secrets and perform egress.
 *
 * Preferred secrets.use form is credentialIdToAccount output, e.g.
 *   secrets.use:source_bearer::ws::src
 * Sources-adapter shorthand (mcp::ws::slug / api::ws::slug) is accepted
 * via heuristic remap to source_bearer / source_apikey.
 *
 * Production (requireUrlAllowlist): network.request / proxyFetch must have a
 * URL prefix allowlist. Revoke records persist under persistDir; audit is JSONL
 * without tokens or secrets.
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  accountToCredentialId,
  type CredentialId,
  type StoredCredential,
} from '@craft-agent/shared/credentials'

export const DEFAULT_CAPABILITY_TTL_MS = 15 * 60 * 1000
export const SECRETS_USE_PREFIX = 'secrets.use:'
export const NETWORK_REQUEST_PERMISSION = 'network.request'

const REVOKE_STORE_REL = join('extensions', 'capability-revoked.json')
const AUDIT_REL = join('logs', 'capability-broker.jsonl')
const REVOKE_STORE_VERSION = 1 as const
const MAX_REVOKED_RECORDS = 500
const DEFAULT_PERSIST_NAMESPACE = '_default'

const SECRETS_USE_KIND_ACCOUNT: Record<string, 'source_bearer' | 'source_apikey'> = {
  mcp: 'source_bearer',
  api: 'source_apikey',
}

export interface ScopedCapability {
  token: string
  extensionId: string
  /** e.g. secrets.use:source_bearer::ws::src OR network.request */
  permission: string
  /** for secrets.use:* — the account key after the prefix */
  credentialAccount?: string
  expiresAt: number
  mintedAt: number
  singleUse?: boolean
}

export type CapabilityPublicStatus = 'active' | 'revoked' | 'expired'

export interface CapabilityPublicRecord {
  tokenHash: string
  extensionId: string
  permission: string
  expiresAt: number
  mintedAt: number
  singleUse?: boolean
  revokedAt?: number
  status: CapabilityPublicStatus
}

export interface CapabilityPublicList {
  minted: CapabilityPublicRecord[]
  revoked: CapabilityPublicRecord[]
}

export type GetCredentialFn = (
  id: CredentialId,
) => Promise<StoredCredential | null>

export interface MintCapabilityInput {
  extensionId: string
  permission: string
  grantedPermissions: readonly string[]
  ttlMs?: number
  singleUse?: boolean
}

export interface ProxyFetchInput {
  token: string
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  getCredential: GetCredentialFn
  /** Injectable fetch for tests; defaults to globalThis.fetch. */
  fetchImpl?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>
  /** URL prefixes; required when requireUrlAllowlist is true. */
  allowedUrlPrefixes?: string[]
  /** Worker/caller extension identity — must match the minted token. */
  expectedExtensionId?: string
  /** Override constructor requireUrlAllowlist for this call. */
  requireUrlAllowlist?: boolean
}

export interface ProxyFetchResult {
  status: number
  body: string
  headers: Record<string, string>
}

export interface CapabilityBrokerOptions {
  now?: () => number
  /** Config dir for durable revoke JSON + audit JSONL. Omit → memory only. */
  persistDir?: string
  /**
   * Isolate revoke files per workspace. Default `_default`.
   * Unsafe characters are replaced so two hosts cannot collide on disk.
   */
  persistNamespace?: string
  /**
   * When true, proxyFetch requires a non-empty URL prefix allowlist.
   * Production managers turn this on; unit tests opt in explicitly.
   */
  requireUrlAllowlist?: boolean
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse secrets.use: suffix into a credential account key accepted by
 * accountToCredentialId. Tries the raw suffix first (preferred form =
 * credentialIdToAccount output), then mcp/api → source_bearer/source_apikey.
 */
export function parseSecretsUseAccount(permission: string): string | null {
  if (!permission.startsWith(SECRETS_USE_PREFIX)) return null
  const suffix = permission.slice(SECRETS_USE_PREFIX.length).trim()
  if (!suffix) return null
  if (accountToCredentialId(suffix)) return suffix

  const parts = suffix.split('::')
  if (parts.length !== 3) return null
  const [kind, workspaceId, sourceId] = parts
  if (!workspaceId || !sourceId) return null
  const mappedKind = SECRETS_USE_KIND_ACCOUNT[kind]
  if (!mappedKind) return null
  const account = `${mappedKind}::${workspaceId}::${sourceId}`
  return accountToCredentialId(account) ? account : null
}

export function hashCapabilityToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sanitizePersistNamespace(namespace?: string): string {
  const raw = trimString(namespace) || DEFAULT_PERSIST_NAMESPACE
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '_') || DEFAULT_PERSIST_NAMESPACE
}

function namespacedPersistPath(
  persistDir: string,
  namespace: string | undefined,
  defaultRel: string,
  namedRel: (ns: string) => string,
): string {
  const ns = sanitizePersistNamespace(namespace)
  return join(persistDir, ns === DEFAULT_PERSIST_NAMESPACE ? defaultRel : namedRel(ns))
}

export function capabilityRevokeStorePath(persistDir: string, namespace?: string): string {
  return namespacedPersistPath(
    persistDir,
    namespace,
    REVOKE_STORE_REL,
    (ns) => join('extensions', `capability-revoked.${ns}.json`),
  )
}

export function capabilityAuditPath(persistDir: string, namespace?: string): string {
  return namespacedPersistPath(
    persistDir,
    namespace,
    AUDIT_REL,
    (ns) => join('logs', `capability-broker.${ns}.jsonl`),
  )
}

/**
 * Origin-safe prefix match. `https://api.good.test/` matches paths on that
 * origin only — not `https://api.good.test.evil.com/`.
 */
export function urlMatchesAllowlistPrefix(url: string, prefix: string): boolean {
  const trimmed = trimString(prefix)
  if (!trimmed) return false
  try {
    const target = new URL(url)
    const allowed = new URL(trimmed)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
    if (target.origin !== allowed.origin) return false
    const allowedPath = allowed.pathname || '/'
    const targetPath = target.pathname || '/'
    if (allowedPath === '/' || targetPath === allowedPath) return true
    const dirPrefix = allowedPath.endsWith('/') ? allowedPath : `${allowedPath}/`
    return targetPath.startsWith(dirPrefix)
  } catch {
    return false
  }
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

function parseRevokedRecord(raw: unknown): CapabilityPublicRecord | null {
  if (!isObject(raw)) return null
  if (typeof raw.tokenHash !== 'string' || !raw.tokenHash.trim()) return null
  if (typeof raw.extensionId !== 'string' || !raw.extensionId.trim()) return null
  if (typeof raw.permission !== 'string' || !raw.permission.trim()) return null
  const record: CapabilityPublicRecord = {
    tokenHash: raw.tokenHash,
    extensionId: raw.extensionId.trim(),
    permission: raw.permission,
    expiresAt: asNumber(raw.expiresAt),
    mintedAt: asNumber(raw.mintedAt),
    status: 'revoked',
    revokedAt: asNumber(raw.revokedAt),
  }
  if (raw.singleUse === true) record.singleUse = true
  return record
}

function loadRevoked(persistDir: string, namespace?: string): CapabilityPublicRecord[] {
  const path = capabilityRevokeStorePath(persistDir, namespace)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isObject(raw) || !Array.isArray(raw.revoked)) return []
    const out: CapabilityPublicRecord[] = []
    const seen = new Set<string>()
    for (const item of raw.revoked) {
      const parsed = parseRevokedRecord(item)
      if (!parsed || seen.has(parsed.tokenHash)) continue
      seen.add(parsed.tokenHash)
      out.push(parsed)
    }
    return out
  } catch {
    return []
  }
}

function toPublic(
  cap: ScopedCapability,
  tokenHash: string,
  extra?: { status?: CapabilityPublicStatus; revokedAt?: number },
): CapabilityPublicRecord {
  const record: CapabilityPublicRecord = {
    tokenHash,
    extensionId: cap.extensionId,
    permission: cap.permission,
    expiresAt: cap.expiresAt,
    mintedAt: cap.mintedAt,
    status: extra?.status ?? 'active',
  }
  if (cap.singleUse === true) record.singleUse = true
  if (typeof extra?.revokedAt === 'number') record.revokedAt = extra.revokedAt
  return record
}

function auditSafeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return 'invalid-url'
  }
}

async function readCredentialValue(
  credentialAccount: string,
  getCredential: GetCredentialFn,
): Promise<string> {
  const id = accountToCredentialId(credentialAccount)
  if (!id) throw new Error('Invalid credential account on capability')
  const stored = await getCredential(id)
  if (!stored || typeof stored.value !== 'string' || stored.value.length === 0) {
    throw new Error('Credential not found')
  }
  return stored.value
}

export class CapabilityBroker {
  private readonly caps = new Map<string, ScopedCapability>()
  private readonly now: () => number
  private readonly persistDir?: string
  private readonly persistNamespace: string
  private readonly requireUrlAllowlist: boolean
  private revoked: CapabilityPublicRecord[] = []
  private readonly revokedHashes = new Set<string>()

  constructor(options: CapabilityBrokerOptions = {}) {
    this.now = options.now ?? Date.now
    this.persistDir = trimString(options.persistDir) || undefined
    this.persistNamespace = sanitizePersistNamespace(options.persistNamespace)
    this.requireUrlAllowlist = options.requireUrlAllowlist === true
    if (this.persistDir) {
      this.revoked = loadRevoked(this.persistDir, this.persistNamespace)
      for (const row of this.revoked) this.revokedHashes.add(row.tokenHash)
    }
  }

  mint(input: MintCapabilityInput): ScopedCapability {
    const extensionId = trimString(input.extensionId)
    if (!extensionId) throw new Error('extensionId is required')

    const permission = trimString(input.permission)
    if (!permission) throw new Error('permission is required')

    const granted = input.grantedPermissions ?? []
    if (!granted.includes(permission)) {
      throw new Error(`Permission not granted: ${permission}`)
    }

    let credentialAccount: string | undefined
    if (permission.startsWith(SECRETS_USE_PREFIX)) {
      const account = parseSecretsUseAccount(permission)
      if (!account) {
        throw new Error(
          `Invalid secrets.use form: ${permission} (preferred: secrets.use:<credentialIdToAccount>)`,
        )
      }
      credentialAccount = account
    }

    const ttlMs =
      typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs) && input.ttlMs > 0
        ? input.ttlMs
        : DEFAULT_CAPABILITY_TTL_MS

    const mintedAt = this.now()
    const cap: ScopedCapability = {
      token: randomBytes(32).toString('base64url'),
      extensionId,
      permission,
      credentialAccount,
      expiresAt: mintedAt + ttlMs,
      mintedAt,
    }
    if (input.singleUse === true) cap.singleUse = true
    this.caps.set(cap.token, cap)
    this.appendAudit({
      event: 'minted',
      tokenHash: hashCapabilityToken(cap.token),
      extensionId,
      permission,
      expiresAt: cap.expiresAt,
    })
    return cap
  }

  /** Peek live capability; expired / revoked → null and deleted. Never logs token. */
  peek(token: string): ScopedCapability | null {
    if (!token) return null
    const hash = hashCapabilityToken(token)
    if (this.revokedHashes.has(hash)) {
      this.caps.delete(token)
      return null
    }
    const cap = this.caps.get(token)
    if (!cap) return null
    if (this.now() >= cap.expiresAt) {
      this.caps.delete(token)
      return null
    }
    return cap
  }

  revoke(token: string): void {
    if (!token) return
    const cap = this.caps.get(token)
    this.caps.delete(token)
    if (!cap) return
    this.recordRevoke(cap, hashCapabilityToken(token))
  }

  revokeByTokenHash(tokenHash: string): boolean {
    const hash = trimString(tokenHash)
    if (!hash) return false
    for (const [token, cap] of this.caps) {
      if (hashCapabilityToken(token) === hash) {
        this.caps.delete(token)
        this.recordRevoke(cap, hash)
        return true
      }
    }
    return false
  }

  revokeExtension(extensionId: string): void {
    const id = trimString(extensionId)
    if (!id) return
    for (const [token, cap] of [...this.caps]) {
      if (cap.extensionId === id) {
        this.caps.delete(token)
        this.recordRevoke(cap, hashCapabilityToken(token))
      }
    }
  }

  /**
   * UI / RPC surface: minted + revoked rows with hashes only.
   * Never includes token, secret, or credential value.
   */
  listPublic(): CapabilityPublicList {
    const now = this.now()
    const minted: CapabilityPublicRecord[] = []
    for (const [token, cap] of this.caps) {
      const hash = hashCapabilityToken(token)
      if (this.revokedHashes.has(hash)) continue
      if (now >= cap.expiresAt) {
        this.caps.delete(token)
        continue
      }
      minted.push(toPublic(cap, hash, { status: 'active' }))
    }
    return {
      minted,
      revoked: this.revoked.map((row) => ({ ...row })),
    }
  }

  /**
   * Resolve secret value for a capability (main-only).
   * Does not return the secret to the worker — caller must keep it in main.
   */
  async resolveSecret(
    token: string,
    getCredential: GetCredentialFn,
  ): Promise<string> {
    const cap = this.peek(token)
    if (!cap) throw new Error('Invalid or expired capability token')
    if (!cap.credentialAccount) {
      throw new Error(`Capability is not secrets.use: ${cap.permission}`)
    }
    const value = await readCredentialValue(cap.credentialAccount, getCredential)
    this.consumeIfSingleUse(token, cap)
    return value
  }

  /**
   * Authenticated fetch: redeem secrets.use or network.request capability.
   * Attaches Authorization: Bearer <secret> when capability is secrets.use.
   */
  async proxyFetch(input: ProxyFetchInput): Promise<ProxyFetchResult> {
    const cap = this.peek(input.token)
    if (!cap) {
      this.denyProxy(
        'expired',
        'Invalid or expired capability token',
        { tokenHash: input.token ? hashCapabilityToken(input.token) : undefined },
      )
    }

    const tokenHash = hashCapabilityToken(input.token)
    const expectedExtensionId = trimString(input.expectedExtensionId)
    if (expectedExtensionId && cap.extensionId !== expectedExtensionId) {
      this.denyProxy('wrong_extension', 'Capability token extensionId mismatch', {
        tokenHash,
        extensionId: cap.extensionId,
        expectedExtensionId,
      })
    }

    const isSecrets = Boolean(cap.credentialAccount)
    const isNetwork = cap.permission === NETWORK_REQUEST_PERMISSION
    if (!isSecrets && !isNetwork) {
      throw new Error(`Capability cannot proxy fetch: ${cap.permission}`)
    }

    const url = input.url
    if (typeof url !== 'string' || !url) {
      throw new Error('url is required')
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      this.denyProxy('invalid_url', 'Invalid url', {
        tokenHash,
        extensionId: cap.extensionId,
      })
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http(s) URLs are allowed')
    }

    const requireAllowlist = input.requireUrlAllowlist ?? this.requireUrlAllowlist
    const prefixes = (input.allowedUrlPrefixes ?? []).filter(
      (p) => typeof p === 'string' && p.trim(),
    )
    if (requireAllowlist && prefixes.length === 0) {
      this.denyProxy('allowlist_required', 'URL allowlist required', {
        tokenHash,
        extensionId: cap.extensionId,
        url: auditSafeUrl(url),
      })
    }
    if (prefixes.length > 0 && !prefixes.some((p) => urlMatchesAllowlistPrefix(url, p))) {
      this.denyProxy('allowlist', 'URL not in allowlist', {
        tokenHash,
        extensionId: cap.extensionId,
        url: auditSafeUrl(url),
      })
    }

    const headers: Record<string, string> = { ...(input.headers ?? {}) }
    // Never let the worker override Authorization when we attach a secret.
    if (cap.credentialAccount) {
      const secret = await readCredentialValue(cap.credentialAccount, input.getCredential)
      headers.Authorization = `Bearer ${secret}`
    }

    const fetchImpl = input.fetchImpl ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') {
      throw new Error('fetch is not available')
    }

    const method = (input.method ?? 'GET').toUpperCase()
    const init: RequestInit = { method, headers }
    if (input.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      init.body = input.body
    }

    const res = await fetchImpl(url, init)
    const body = await res.text()
    const outHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      outHeaders[key] = value
    })

    this.consumeIfSingleUse(input.token, cap)
    this.appendAudit({
      event: 'proxy_ok',
      tokenHash,
      extensionId: cap.extensionId,
      permission: cap.permission,
      url: auditSafeUrl(url),
      status: res.status,
    })

    return {
      status: res.status,
      body,
      headers: outHeaders,
    }
  }

  /** Test / diagnostics: live token count (never exposes tokens). */
  size(): number {
    const now = this.now()
    for (const [token, cap] of this.caps) {
      if (now >= cap.expiresAt) this.caps.delete(token)
    }
    return this.caps.size
  }

  clear(): void {
    this.caps.clear()
  }

  private consumeIfSingleUse(token: string, cap: ScopedCapability): void {
    if (cap.singleUse) this.caps.delete(token)
  }

  private denyProxy(
    reason: string,
    message: string,
    extra: Record<string, unknown>,
  ): never {
    this.appendAudit({ event: 'proxy_denied', reason, ...extra })
    throw new Error(message)
  }

  private recordRevoke(cap: ScopedCapability, tokenHash: string): void {
    if (this.revokedHashes.has(tokenHash)) return
    const record = toPublic(cap, tokenHash, {
      status: 'revoked',
      revokedAt: this.now(),
    })
    this.revokedHashes.add(tokenHash)
    this.revoked.unshift(record)
    if (this.revoked.length > MAX_REVOKED_RECORDS) {
      const dropped = this.revoked.splice(MAX_REVOKED_RECORDS)
      for (const row of dropped) this.revokedHashes.delete(row.tokenHash)
    }
    this.persistRevoked()
    this.appendAudit({
      event: 'revoked',
      tokenHash,
      extensionId: cap.extensionId,
      permission: cap.permission,
    })
  }

  private persistRevoked(): void {
    if (!this.persistDir) return
    const payload = {
      version: REVOKE_STORE_VERSION,
      revoked: this.revoked,
    }
    atomicWrite(
      capabilityRevokeStorePath(this.persistDir, this.persistNamespace),
      `${JSON.stringify(payload, null, 2)}\n`,
    )
  }

  private appendAudit(payload: Record<string, unknown>): void {
    if (!this.persistDir) return
    try {
      const path = capabilityAuditPath(this.persistDir, this.persistNamespace)
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(
        path,
        `${JSON.stringify({ timestamp: new Date(this.now()).toISOString(), ...payload })}\n`,
        'utf8',
      )
    } catch {
      // Audit must never throw into mint/revoke/fetch.
    }
  }
}

let singleton: CapabilityBroker | null = null

export function getCapabilityBroker(): CapabilityBroker {
  if (!singleton) singleton = new CapabilityBroker()
  return singleton
}

/** Test helper — drop singleton. */
export function resetCapabilityBroker(): void {
  if (singleton) singleton.clear()
  singleton = null
}

/** Test helper — install a preconfigured broker as singleton. */
export function setCapabilityBrokerForTests(broker: CapabilityBroker | null): void {
  singleton = broker
}
