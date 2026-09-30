import type { SQL, TransactionSQL } from 'bun'
import { lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { AuthenticatedActor } from '../../../../packages/shared/src/workspace-domain/identity/contracts'
import { AuthenticationError, type LiveWorkspaceMembershipPort, type PersistedAuthSession, type VerifiedIdentityRepository } from './verified-actor'
import { hashLocalAccountPassword, type LocalCredentialAccount, type LocalIssuerPersistence } from './local-issuer'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const validText = (value: unknown, limit = 2048): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit
const prefixFor = (schema: string): string => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid authentication database schema')
  return `"${schema}".`
}
type SessionRow = {
  issuer: string; subject: string; principal_id: string; session_id: string; device_id: string
  expires_at: Date | string; revoked_at: Date | string | null
}
const sessionFrom = (row: SessionRow | undefined): PersistedAuthSession | null => row ? Object.freeze({
  issuer: row.issuer, subject: row.subject, principalId: row.principal_id, sessionId: row.session_id,
  deviceId: row.device_id, expiresAt: new Date(row.expires_at).getTime(),
  revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at).getTime(),
}) : null

/** Read-only secret loader. Never exposes the configured URL in error text or logs. */
export async function loadProtectedWorkspaceDatabaseUrl(path: string): Promise<string> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error()
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const current = await file.stat()
      if (current.ino !== info.ino || current.dev !== info.dev) throw new Error()
      const configuration: unknown = JSON.parse(await file.readFile('utf8'))
      if (!configuration || typeof configuration !== 'object' || !('ROX_WORKSPACE_DATABASE_URL' in configuration) ||
        typeof configuration.ROX_WORKSPACE_DATABASE_URL !== 'string') throw new Error()
      const url = new URL(configuration.ROX_WORKSPACE_DATABASE_URL)
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error()
      return configuration.ROX_WORKSPACE_DATABASE_URL
    } finally { await file.close() }
  } catch { throw new Error('Protected workspace PostgreSQL configuration unavailable') }
}

export class LocalIdentityAdminError extends Error {
  constructor(readonly code: 'INVALID_ACCOUNT' | 'ACCOUNT_ALREADY_EXISTS' | 'ACCOUNT_NOT_FOUND') {
    super(code)
    this.name = 'LocalIdentityAdminError'
  }
}

/** Server-only ports; caller injects the existing authority's Bun.SQL pool. */
export class PostgresIdentityAuth implements LocalIssuerPersistence, VerifiedIdentityRepository, LiveWorkspaceMembershipPort {
  private readonly prefix: string
  private readonly issuer: string
  constructor(private readonly database: SQL, issuer: string, readonly schema = 'public') {
    if (!validText(issuer)) throw new Error('Configured issuer required')
    this.issuer = issuer
    this.prefix = prefixFor(schema)
  }

  /** Administration must own this port; credentials/principal IDs are never request Actor input. */
  async provisionAccount(login: string, password: string): Promise<Readonly<{ subject: string; principalId: string }>> {
    if (!validText(login, 320) || login !== login.trim()) throw new LocalIdentityAdminError('INVALID_ACCOUNT')
    let passwordHash: string
    try { passwordHash = await hashLocalAccountPassword(password) } catch { throw new LocalIdentityAdminError('INVALID_ACCOUNT') }
    const subject = crypto.randomUUID()
    const principalId = crypto.randomUUID()
    return this.database.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['rox.auth.account', this.schema, this.issuer, login])}, 0))`
      const existing = await tx.unsafe<{ subject: string }[]>(`SELECT subject FROM ${this.prefix}bootstrap_auth_credential WHERE issuer = $1 AND login = $2`, [this.issuer, login])
      if (existing.length) throw new LocalIdentityAdminError('ACCOUNT_ALREADY_EXISTS')
      await tx.unsafe(`INSERT INTO ${this.prefix}principal (principal_id) VALUES ($1)`, [principalId])
      await tx.unsafe(`INSERT INTO ${this.prefix}auth_subject_alias (issuer, subject, principal_id) VALUES ($1,$2,$3)`, [this.issuer, subject, principalId])
      await tx.unsafe(`INSERT INTO ${this.prefix}bootstrap_auth_credential (issuer,subject,principal_id,login,password_hash) VALUES ($1,$2,$3,$4,$5)`, [this.issuer, subject, principalId, login, passwordHash])
      return Object.freeze({ subject, principalId })
    })
  }

  async findAccount(login: string): Promise<LocalCredentialAccount | null> {
    if (!validText(login, 320)) return null
    const [row] = await this.database.unsafe<{ subject: string; password_hash: string; disabled_at: Date | null }[]>(`
      SELECT c.subject, c.password_hash, c.disabled_at FROM ${this.prefix}bootstrap_auth_credential c
      JOIN ${this.prefix}auth_subject_alias a USING (issuer,subject,principal_id)
      JOIN ${this.prefix}principal p USING (principal_id)
      WHERE c.issuer = $1 AND c.login = $2 AND p.deleted_at IS NULL`, [this.issuer, login])
    return row ? Object.freeze({ subject: row.subject, passwordHash: row.password_hash, disabled: row.disabled_at !== null }) : null
  }

  async createSession(input: Parameters<LocalIssuerPersistence['createSession']>[0]): Promise<boolean> {
    if (input.issuer !== this.issuer || !validText(input.subject) || !UUID.test(input.sessionId) || !UUID.test(input.tokenId) ||
      !UUID.test(input.deviceId) || !Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now() || input.expiresAt > Date.now() + 900000) return false
    return this.database.begin(async tx => {
      // Disable and issuance serialize on this exact account row before touching sessions.
      const [account] = await tx.unsafe<{ principal_id: string; disabled_at: Date | null }[]>(`
        SELECT principal_id, disabled_at FROM ${this.prefix}bootstrap_auth_credential
        WHERE issuer = $1 AND subject = $2 FOR UPDATE`, [this.issuer, input.subject])
      if (!account || account.disabled_at !== null) return false
      const [alias] = await tx.unsafe<{ principal_id: string }[]>(`
        SELECT a.principal_id FROM ${this.prefix}auth_subject_alias a JOIN ${this.prefix}principal p USING (principal_id)
        WHERE a.issuer = $1 AND a.subject = $2 AND a.principal_id = $3 AND p.deleted_at IS NULL FOR SHARE OF a,p`, [this.issuer, input.subject, account.principal_id])
      if (!alias) return false
      await tx.unsafe(`INSERT INTO ${this.prefix}bootstrap_auth_session
        (session_id,token_id,issuer,subject,principal_id,device_id,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.sessionId, input.tokenId, this.issuer, input.subject, alias.principal_id, input.deviceId, new Date(input.expiresAt)])
      return true
    })
  }

  async resolvePrincipal(issuer: string, subject: string): Promise<string | null> {
    if (issuer !== this.issuer || !validText(subject)) return null
    const [row] = await this.database.unsafe<{ principal_id: string }[]>(`
      SELECT a.principal_id FROM ${this.prefix}auth_subject_alias a JOIN ${this.prefix}principal p USING (principal_id)
      LEFT JOIN ${this.prefix}bootstrap_auth_credential c USING (issuer,subject,principal_id)
      WHERE a.issuer = $1 AND a.subject = $2 AND p.deleted_at IS NULL AND c.disabled_at IS NULL`, [issuer, subject])
    return row?.principal_id ?? null
  }

  async resolveSession(input: Parameters<VerifiedIdentityRepository['resolveSession']>[0]): Promise<PersistedAuthSession | null> {
    if (input.issuer !== this.issuer || !validText(input.subject) || !UUID.test(input.principalId) ||
      typeof input.verifiedSessionId !== 'string' || !UUID.test(input.verifiedSessionId) ||
      typeof input.verifiedTokenId !== 'string' || !UUID.test(input.verifiedTokenId) || !Number.isFinite(input.tokenExpiresAt) || input.tokenExpiresAt <= Date.now()) return null
    const [row] = await this.database.unsafe<SessionRow[]>(`${this.sessionSelect()}
      AND s.subject = $3 AND s.principal_id = $4 AND s.token_id = $5`, [this.issuer, input.verifiedSessionId, input.subject, input.principalId, input.verifiedTokenId])
    return sessionFrom(row)
  }

  private sessionSelect(): string {
    return `SELECT s.* FROM ${this.prefix}bootstrap_auth_session s
      JOIN ${this.prefix}auth_subject_alias a USING (issuer,subject,principal_id)
      JOIN ${this.prefix}principal p USING (principal_id)
      LEFT JOIN ${this.prefix}bootstrap_auth_credential c USING (issuer,subject,principal_id)
      WHERE s.issuer = $1 AND s.session_id = $2 AND s.revoked_at IS NULL
        AND s.expires_at > clock_timestamp() AND p.deleted_at IS NULL AND c.disabled_at IS NULL`
  }

  async findSession(issuer: string, sessionId: string): Promise<PersistedAuthSession | null> {
    if (issuer !== this.issuer || !UUID.test(sessionId)) return null
    const [row] = await this.database.unsafe<SessionRow[]>(this.sessionSelect(), [issuer, sessionId])
    return sessionFrom(row)
  }

  async listActiveWorkspaceIds(principalId: string): Promise<readonly string[]> {
    if (!UUID.test(principalId)) return []
    const rows = await this.database.unsafe<{ workspace_id: string }[]>(`
      SELECT m.workspace_id FROM ${this.prefix}workspace_member m JOIN ${this.prefix}workspace w USING (workspace_id)
      JOIN ${this.prefix}principal p ON p.principal_id = m.principal_id
      WHERE m.principal_id = $1 AND m.deleted_at IS NULL AND w.deleted_at IS NULL AND p.deleted_at IS NULL
      ORDER BY m.workspace_id`, [principalId])
    return Object.freeze(rows.map(row => row.workspace_id))
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    if (!UUID.test(sessionId)) return false
    const rows = await this.database.unsafe<{ session_id: string }[]>(`
      UPDATE ${this.prefix}bootstrap_auth_session SET revoked_at = COALESCE(revoked_at,clock_timestamp())
      WHERE issuer = $1 AND session_id = $2 RETURNING session_id`, [this.issuer, sessionId])
    return rows.length === 1
  }

  async disableAccount(subject: string): Promise<void> {
    if (!validText(subject)) throw new LocalIdentityAdminError('INVALID_ACCOUNT')
    await this.database.begin(async tx => {
      const [account] = await tx.unsafe<{ subject: string }[]>(`
        SELECT subject FROM ${this.prefix}bootstrap_auth_credential WHERE issuer = $1 AND subject = $2 FOR UPDATE`, [this.issuer, subject])
      if (!account) throw new LocalIdentityAdminError('ACCOUNT_NOT_FOUND')
      await tx.unsafe(`UPDATE ${this.prefix}bootstrap_auth_credential SET disabled_at = COALESCE(disabled_at,clock_timestamp()), updated_at = clock_timestamp()
        WHERE issuer = $1 AND subject = $2`, [this.issuer, subject])
      await tx.unsafe(`UPDATE ${this.prefix}bootstrap_auth_session SET revoked_at = COALESCE(revoked_at,clock_timestamp()) WHERE issuer = $1 AND subject = $2`, [this.issuer, subject])
    })
  }
}

/** Hold account/session locks until the caller's Project transaction commits. */
export async function lockPostgresActorSession(tx: TransactionSQL, schema: string, actor: AuthenticatedActor): Promise<void> {
  const prefix = prefixFor(schema)
  if (!UUID.test(actor.principalId) || !UUID.test(actor.sessionId) || !UUID.test(actor.deviceId) ||
    !Number.isFinite(actor.expiresAt) || actor.expiresAt <= Date.now()) throw new AuthenticationError()
  // Account first, session second: same order as disable/issuance, avoiding revoke deadlocks.
  await tx.unsafe(`SELECT c.subject FROM ${prefix}bootstrap_auth_credential c
    JOIN ${prefix}bootstrap_auth_session s USING (issuer,subject,principal_id)
    WHERE s.session_id = $1 FOR SHARE OF c`, [actor.sessionId])
  const [session] = await tx.unsafe<{ session_id: string }[]>(`
    SELECT s.session_id FROM ${prefix}bootstrap_auth_session s
    JOIN ${prefix}auth_subject_alias a USING (issuer,subject,principal_id)
    JOIN ${prefix}principal p USING (principal_id)
    LEFT JOIN ${prefix}bootstrap_auth_credential c USING (issuer,subject,principal_id)
    WHERE s.session_id = $1 AND s.principal_id = $2 AND s.device_id = $3 AND s.revoked_at IS NULL
      AND s.expires_at > clock_timestamp() AND p.deleted_at IS NULL AND c.disabled_at IS NULL
    FOR SHARE OF s,a,p`, [actor.sessionId, actor.principalId, actor.deviceId])
  if (!session) throw new AuthenticationError()
}
