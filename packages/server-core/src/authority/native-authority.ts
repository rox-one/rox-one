import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const NATIVE_AUTHORITY_ACTIONS = ['read', 'write', 'delete', 'subscribe', 'manage'] as const
export type NativeAuthorityAction = (typeof NATIVE_AUTHORITY_ACTIONS)[number]

export interface NativePrincipal {
  readonly issuer: string
  readonly subject: string
  readonly credentialId: string
  readonly credentialVersion: number
}


export interface NativeIssuedCredential {
  readonly credential: string
  readonly principal: NativePrincipal
  readonly expiresAt: number
}

export interface NativeWorkspace {
  readonly id: string
  readonly nativeRoot: string
  readonly entityRoots: readonly string[]
}

export interface NativeAuthorityInvalidation {
  readonly subject: string
  readonly credentialId?: string
  readonly workspaceId?: string
  readonly reason: 'credential-revoked' | 'credential-rotated' | 'grant-revoked' | 'grant-changed'
}

export interface NativeAuthorityOptions {
  stateDir: string
}

export function isCredentialToken(token: unknown): boolean {
  return typeof token === 'string' && (token.startsWith('na_') || token.startsWith('ne_'))
}

const CREDENTIAL_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000
const MAX_TRACKED_ATTEMPTS = 2048
const MAX_FAILURES_PER_WINDOW = 100
const FAILURE_WINDOW_MS = 60_000
const MAX_AUDIT_ROWS = 10_000
const HEX_DIGEST_LENGTH = 32

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}
function fenceDigest(principal: NativePrincipal, workspaceId: string, action: NativeAuthorityAction, grantVersion: number): string {
  return createHash('sha256').update(JSON.stringify([
    'native-authority-prepared-fence-v1',
    principal.issuer,
    principal.subject,
    principal.credentialId,
    principal.credentialVersion,
    workspaceId,
    action,
    grantVersion,
  ])).digest('hex')
}


function validLabel(value: string): string {
  const label = value.trim()
  if (!label || label.length > 120 || /[\u0000-\u001f\u007f]/.test(label)) throw new Error('invalid label')
  return label
}

function validId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error('invalid identifier')
  return value
}

function isAction(value: unknown): value is NativeAuthorityAction {
  return typeof value === 'string' && (NATIVE_AUTHORITY_ACTIONS as readonly string[]).includes(value)
}

function pathsOverlap(first: string, second: string): boolean {
  const firstToSecond = relative(first, second)
  const secondToFirst = relative(second, first)
  const isContained = (path: string) => path === '' ||
    (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  return isContained(firstToSecond) || isContained(secondToFirst)
}

function requireOsOwner(path: string): void {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
  if (uid === undefined || statSync(path).uid !== uid) throw new Error('maintenance requires the state directory OS owner')
}

export class NativeAuthority {
  readonly #stateDir: string
  readonly #db: DatabaseSync
  readonly #issuerId: string
  readonly #listeners = new Set<(event: NativeAuthorityInvalidation) => void>()
  #closed = false

  #verifiedPrincipals = new WeakSet<object>()
  readonly #attempts = new Map<string, { windowStarted: number; failures: number }>()
  constructor({ stateDir }: NativeAuthorityOptions) {
    if (!stateDir) throw new Error('stateDir is required')
    const supplied = resolve(stateDir)
    try {
      const before = lstatSync(supplied)
      if (before.isSymbolicLink() || !before.isDirectory()) throw new Error('stateDir must be a real directory')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      mkdirSync(supplied, { recursive: true, mode: 0o700 })
    }
    requireOsOwner(supplied)
    chmodSync(supplied, 0o700)
    this.#stateDir = realpathSync(supplied)
    requireOsOwner(this.#stateDir)
    const databasePath = join(this.#stateDir, 'authority.sqlite')
    try {
      const databaseFile = openSync(databasePath, 'wx', 0o600)
      closeSync(databaseFile)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existingDatabase = lstatSync(databasePath)
      if (existingDatabase.isSymbolicLink() || !existingDatabase.isFile() || existingDatabase.uid !== process.getuid?.() || existingDatabase.nlink !== 1) {
        throw new Error('authority database must be an OS-owner private regular file')
      }
    }
    chmodSync(databasePath, 0o600)
    this.#db = new DatabaseSync(databasePath)
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS authority_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subjects (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
        created_at INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS self_profiles (
        issuer TEXT NOT NULL, subject_id TEXT NOT NULL REFERENCES subjects(id),
        name TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(issuer,subject_id)
      );
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subjects(id), digest BLOB NOT NULL,
        version INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
        device_label TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS credentials_subject ON credentials(subject_id);
      CREATE TABLE IF NOT EXISTS enrollments (
        digest BLOB PRIMARY KEY, label TEXT NOT NULL, expires_at INTEGER NOT NULL,
        used_at INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY, native_root TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_roots (
        root TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        device TEXT NOT NULL, inode TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS grants (
        subject_id TEXT NOT NULL REFERENCES subjects(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        action TEXT NOT NULL CHECK(action IN ('read','write','delete','subscribe','manage')),
        version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(subject_id,workspace_id,action)
      );
      CREATE TABLE IF NOT EXISTS grant_versions (
        subject_id TEXT NOT NULL REFERENCES subjects(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        action TEXT NOT NULL CHECK(action IN ('read','write','delete','subscribe','manage')),
        version INTEGER NOT NULL, PRIMARY KEY(subject_id,workspace_id,action)
      );
      INSERT OR IGNORE INTO grant_versions(subject_id,workspace_id,action,version)
        SELECT subject_id,workspace_id,action,version FROM grants;
      CREATE TABLE IF NOT EXISTS audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, event TEXT NOT NULL,
        subject_id TEXT, credential_id TEXT, workspace_id TEXT, detail TEXT NOT NULL DEFAULT '{}'
      );
    `)
    const generatedIssuer = randomUUID()
    this.#db.prepare("INSERT OR IGNORE INTO authority_meta(key,value) VALUES('issuer_id',?)").run(generatedIssuer)
    const storedIssuer = this.#db.prepare("SELECT value FROM authority_meta WHERE key='issuer_id'").get() as { value: string } | undefined
    if (!storedIssuer) throw new Error('authority issuer initialization failed')
    this.#issuerId = storedIssuer.value
    this.#db.exec('PRAGMA wal_checkpoint(PASSIVE)')
    this.#secureDatabaseFiles()
  }

  get issuerId(): string {
    this.#assertOpen()
    return this.#issuerId
  }

  bootstrapLocalAdministrator(label: string): NativeIssuedCredential {
    this.#assertOpen()
    requireOsOwner(this.#stateDir)
    if (!process.stdin.isTTY) throw new Error('administrator bootstrap requires an interactive host-local maintenance terminal')
    const labelValue = validLabel(label)
    this.#db.exec('BEGIN IMMEDIATE')
    let admin: NativeIssuedCredential
    try {
      if (this.#db.prepare("SELECT 1 FROM subjects WHERE role='admin' LIMIT 1").get()) throw new Error('administrator bootstrap has already been completed')
      admin = this.#createSubjectAndCredential(labelValue, 'admin', 'local-maintenance')
      this.#audit('administrator.bootstrap', admin.principal.subject, admin.principal.credentialId)
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    return admin
  }
  recoverLocalAdministrator(deviceLabel: string): NativeIssuedCredential {
    this.#assertOpen()
    requireOsOwner(this.#stateDir)
    if (!process.stdin.isTTY) throw new Error('administrator recovery requires an interactive host-local maintenance terminal')
    const label = validLabel(deviceLabel)
    const admin = this.#db.prepare("SELECT id FROM subjects WHERE role='admin' ORDER BY created_at LIMIT 1").get() as
      { id: string } | undefined
    if (!admin) throw new Error('administrator recovery requires an existing administrator subject')
    this.#db.exec('BEGIN IMMEDIATE')
    let previous: Array<{ id: string }>
    let issued: NativeIssuedCredential
    try {
      previous = this.#db.prepare('SELECT id FROM credentials WHERE subject_id=? AND revoked=0').all(admin.id) as Array<{ id: string }>
      this.#db.prepare('UPDATE credentials SET revoked=1,version=version+1 WHERE subject_id=? AND revoked=0').run(admin.id)
      issued = this.#createCredential(admin.id, label, 1)
      this.#audit('administrator.recover', admin.id, issued.principal.credentialId)
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    for (const credential of previous) {
      this.#notify({ subject: admin.id, credentialId: credential.id, reason: 'credential-revoked' })
    }
    return issued
  }


  issueEnrollment(adminCredential: string, label: string, expiresAt: number): string {
    this.#assertOpen()
    const admin = this.#requireAdmin(adminCredential)
    const deviceLabel = validLabel(label)
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 24 * 60 * 60 * 1000) {
      throw new Error('enrollment expiry must be within the next 24 hours')
    }
    const ticket = `ne_${randomBytes(32).toString('base64url')}`
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      this.#db.prepare('INSERT INTO enrollments(digest,label,expires_at,created_at) VALUES(?,?,?,?)')
        .run(digest(ticket), deviceLabel, expiresAt, Date.now())
      this.#audit('enrollment.issue', admin.subject_id, admin.id)
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    return ticket
  }

  redeemEnrollment(ticket: string, deviceLabel: string): NativeIssuedCredential | null {
    this.#assertOpen()
    const provided = typeof ticket === 'string' ? ticket : ''
    if (!this.#allowAttempt(provided)) return null
    const ticketDigest = digest(provided)
    const row = this.#db.prepare('SELECT digest,label,expires_at,used_at FROM enrollments WHERE digest=?').get(ticketDigest) as
      | { digest: Uint8Array; label: string; expires_at: number; used_at: number | null }
      | undefined
    const storedDigest = row ? Buffer.from(row.digest) : Buffer.alloc(HEX_DIGEST_LENGTH)
    const digestMatches = timingSafeEqual(storedDigest, ticketDigest)
    if (!row || !digestMatches || row.used_at !== null || row.expires_at <= Date.now()) {
      this.#failedAttempt(provided)
      this.#audit('enrollment.reject', null, null)
      return null
    }
    const device = validLabel(deviceLabel)
    const now = Date.now()
    this.#db.exec('BEGIN IMMEDIATE')
    let issued: NativeIssuedCredential
    try {
      const result = this.#db.prepare('UPDATE enrollments SET used_at=? WHERE digest=? AND used_at IS NULL AND expires_at>?')
        .run(now, ticketDigest, now)
      if (Number(result.changes) !== 1) {
        this.#db.exec('ROLLBACK')
        return null
      }
      issued = this.#createSubjectAndCredential(row.label, 'member', device)
      this.#audit('enrollment.redeem', issued.principal.subject, issued.principal.credentialId)
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    this.#resetAttempt(provided)
    return issued
  }

  authenticate(credential: string): NativePrincipal | null {
    this.#assertOpen()
    const provided = typeof credential === 'string' ? credential : ''
    if (!this.#allowAttempt(provided)) return null
    const row = this.#db.prepare(`
      SELECT c.id,c.digest,c.version,c.expires_at,c.revoked,s.id AS subject,s.disabled
      FROM credentials c JOIN subjects s ON s.id=c.subject_id WHERE c.id=?
    `).get(this.#credentialSelector(provided)) as
      | { id: string; digest: Uint8Array; version: number; expires_at: number; revoked: number; subject: string; disabled: number }
      | undefined
    const suppliedDigest = digest(provided)
    const storedDigest = row ? Buffer.from(row.digest) : Buffer.alloc(HEX_DIGEST_LENGTH)
    const digestMatches = timingSafeEqual(storedDigest, suppliedDigest)
    if (!row || !digestMatches || row.revoked !== 0 || row.disabled !== 0 || row.expires_at <= Date.now()) {
      this.#failedAttempt(provided)
      this.#audit('credential.reject', row?.subject ?? null, row?.id ?? null)
      return null
    }
    this.#resetAttempt(provided)
    const principal = Object.freeze({ issuer: this.#issuerId, subject: row.subject, credentialId: row.id, credentialVersion: row.version })
    this.#verifiedPrincipals.add(principal)
    return principal
  }

  registerWorkspace(adminCredential: string, workspaceId: string, nativeRoot: string, entityRoots: readonly string[] = []): NativeWorkspace {
    this.#assertOpen()
    const admin = this.#requireAdmin(adminCredential)
    const id = validId(workspaceId)
    if (!Array.isArray(entityRoots)) throw new Error('entityRoots must be an array')
    const roots = [nativeRoot, ...entityRoots].map((path) => this.#canonicalRoot(path))
    if (new Set(roots.map((root) => root.path)).size !== roots.length) throw new Error('workspace roots must be distinct canonical directories')
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      if (this.#db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(id)) throw new Error('workspace identifier already registered')
      const existingRoots = this.#db.prepare('SELECT root FROM workspace_roots').all() as Array<{ root: string }>
      if (roots.some((candidate) => existingRoots.some((existing) => pathsOverlap(candidate.path, existing.root)))) {
        throw new Error('workspace roots must not overlap roots registered to another workspace')
      }
      this.#db.prepare('INSERT INTO workspaces(id,native_root,created_at) VALUES(?,?,?)').run(id, roots[0].path, Date.now())
      for (const root of roots) {
        this.#db.prepare('INSERT INTO workspace_roots(root,workspace_id,device,inode) VALUES(?,?,?,?)')
          .run(root.path, id, root.device, root.inode)
      }
      this.#audit('workspace.register', admin.subject_id, admin.id, id, { rootCount: roots.length })
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    return Object.freeze({ id, nativeRoot: roots[0].path, entityRoots: Object.freeze(roots.slice(1).map((root) => root.path)) })
  }

  hasRegisteredWorkspaces(): boolean {
    this.#assertOpen()
    return !!this.#db.prepare('SELECT EXISTS(SELECT 1 FROM workspaces) AS registered').get()?.registered
  }

  isRegisteredWorkspace(workspaceId: string): boolean {
    this.#assertOpen()
    if (typeof workspaceId !== 'string') return false
    let id: string
    try {
      id = validId(workspaceId)
    } catch {
      return false
    }
    return !!this.#db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(id)
  }

  resolveWorkspace(workspaceId: string): NativeWorkspace | null {
    this.#assertOpen()
    if (typeof workspaceId !== 'string') return null
    let id: string
    try {
      id = validId(workspaceId)
    } catch {
      return null
    }
    const workspace = this.#db.prepare('SELECT native_root FROM workspaces WHERE id=?').get(id) as { native_root: string } | undefined
    if (!workspace) return null
    const roots = this.#db.prepare('SELECT root,device,inode FROM workspace_roots WHERE workspace_id=? ORDER BY root').all(id) as
      Array<{ root: string; device: string; inode: string }>
    const primary = roots.find((root) => root.root === workspace.native_root)
    if (!primary || !this.#workspaceRootsAreValid(id)) return null
    return Object.freeze({
      id,
      nativeRoot: primary.root,
      entityRoots: Object.freeze(roots.filter((root) => root.root !== primary.root).map((root) => root.root)),
    })
  }

  grantWorkspace(adminCredential: string, subject: string, workspaceId: string, actions: readonly NativeAuthorityAction[]): void {
    this.#assertOpen()
    const admin = this.#requireAdmin(adminCredential)
    const target = validId(subject)
    const workspace = validId(workspaceId)
    if (!this.#db.prepare('SELECT 1 FROM subjects WHERE id=? AND disabled=0').get(target)) throw new Error('unknown subject')
    if (!this.#db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspace)) throw new Error('unknown workspace')
    if (!Array.isArray(actions) || actions.length === 0 || actions.some((action) => !isAction(action))) throw new Error('invalid actions')
    const unique = [...new Set(actions)]
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      for (const action of unique) {
        this.#db.prepare('INSERT OR IGNORE INTO grant_versions(subject_id,workspace_id,action,version) VALUES(?,?,?,0)')
          .run(target, workspace, action)
        this.#db.prepare('UPDATE grant_versions SET version=version+1 WHERE subject_id=? AND workspace_id=? AND action=?')
          .run(target, workspace, action)
        const grantVersion = this.#db.prepare('SELECT version FROM grant_versions WHERE subject_id=? AND workspace_id=? AND action=?')
          .get(target, workspace, action) as { version: number }
        this.#db.prepare(`INSERT INTO grants(subject_id,workspace_id,action,version) VALUES(?,?,?,?)
          ON CONFLICT(subject_id,workspace_id,action) DO UPDATE SET version=excluded.version`)
          .run(target, workspace, action, grantVersion.version)
      }
      this.#audit('grant.change', target, null, workspace, { by: admin.subject_id, actions: unique })
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    this.#notify({ subject: target, workspaceId: workspace, reason: 'grant-changed' })
  }

  authorize(principal: NativePrincipal, workspaceId: string, action: NativeAuthorityAction, nativeRoot?: string): boolean {
    this.#assertOpen()
    if (!principal || !this.#verifiedPrincipals.has(principal)) return false
    return this.#currentAuthorization(principal, workspaceId, action) !== null &&
      (nativeRoot === undefined || this.#rootBelongsToWorkspace(workspaceId, nativeRoot))
  }

  /** Private self metadata is selected solely by a currently authenticated principal. */
  getSelfProfile(principal: NativePrincipal, workspaceId: string): { name?: string } {
    if (!this.authorize(principal, workspaceId, 'read')) throw new Error('Native self profile denied');
    const row = this.#db.prepare('SELECT name FROM self_profiles WHERE issuer=? AND subject_id=?')
      .get(principal.issuer, principal.subject) as { name: string | null } | undefined;
    return row?.name ? { name: row.name } : {};
  }

  updateSelfProfile(principal: NativePrincipal, workspaceId: string, updates: { name?: unknown }): { name?: string } {
    if (!this.authorize(principal, workspaceId, 'read')) throw new Error('Native self profile denied');
    if (!updates || typeof updates !== 'object' || typeof updates.name !== 'string') throw new Error('Native profile name is required');
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(updates.name)) throw new Error('Invalid native profile name');
    const name = updates.name.normalize('NFC').trim().replace(/\s+/gu, ' ');
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) throw new Error('Invalid native profile name');
    this.#db.prepare(`INSERT INTO self_profiles(issuer,subject_id,name,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(issuer,subject_id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`)
      .run(principal.issuer, principal.subject, name, Date.now());
    this.#audit('profile.self-update', principal.subject, principal.credentialId, workspaceId);
    return { name };
  }

  permissionFence(principal: NativePrincipal, workspaceId: string, action: NativeAuthorityAction): string | null {
    this.#assertOpen()
    if (!principal || !this.#verifiedPrincipals.has(principal)) return null
    const current = this.#currentAuthorization(principal, workspaceId, action)
    return current ? fenceDigest(principal, workspaceId, action, current.grantVersion) : null
  }

  /** Only validate an already-authorized prepared journal intent; never use this at a transport boundary. */
  authorizePreparedRecovery(
    actorMetadata: NativePrincipal,
    workspaceId: string,
    action: NativeAuthorityAction,
    expectedFence: string,
    nativeRoot?: string,
  ): boolean {
    this.#assertOpen()
    if (!/^[a-f0-9]{64}$/.test(expectedFence)) return false
    const current = this.#currentAuthorization(actorMetadata, workspaceId, action)
    if (!current) return false
    const actualFence = fenceDigest(actorMetadata, workspaceId, action, current.grantVersion)
    const matches = timingSafeEqual(Buffer.from(expectedFence, 'hex'), Buffer.from(actualFence, 'hex'))
    return matches && (nativeRoot === undefined || this.#rootBelongsToWorkspace(workspaceId, nativeRoot))
  }

  #currentAuthorization(
    principal: NativePrincipal,
    workspaceId: string,
    action: NativeAuthorityAction,
  ): { grantVersion: number } | null {
    if (!principal || typeof principal !== 'object' || principal.issuer !== this.#issuerId || !isAction(action) ||
      typeof principal.subject !== 'string' || typeof principal.credentialId !== 'string' ||
      !Number.isSafeInteger(principal.credentialVersion)) return null
    const row = this.#db.prepare(`
      SELECT c.version,c.expires_at,c.revoked,s.disabled,g.version AS grant_version,gv.version AS current_grant_version
      FROM credentials c
      JOIN subjects s ON s.id=c.subject_id
      JOIN grants g ON g.subject_id=c.subject_id AND g.workspace_id=? AND g.action=?
      JOIN grant_versions gv ON gv.subject_id=g.subject_id AND gv.workspace_id=g.workspace_id AND gv.action=g.action
      WHERE c.id=? AND c.subject_id=?
    `).get(workspaceId, action, principal.credentialId, principal.subject) as
      | { version: number; expires_at: number; revoked: number; disabled: number; grant_version: number; current_grant_version: number }
      | undefined
    if (!row || row.version !== principal.credentialVersion || row.revoked !== 0 || row.disabled !== 0 ||
      row.expires_at <= Date.now() || row.grant_version !== row.current_grant_version ||
      !this.#workspaceRootsAreValid(workspaceId)) return null
    return { grantVersion: row.current_grant_version }
  }

  revokeCredential(adminCredential: string, credentialId: string): void {
    this.#assertOpen()
    const admin = this.#requireAdmin(adminCredential)
    const id = validId(credentialId)
    const row = this.#db.prepare('SELECT subject_id FROM credentials WHERE id=? AND revoked=0').get(id) as { subject_id: string } | undefined
    if (!row) return
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const updated = this.#db.prepare('UPDATE credentials SET revoked=1,version=version+1 WHERE id=? AND revoked=0').run(id)
      if (Number(updated.changes) !== 1) {
        this.#db.exec('ROLLBACK')
        return
      }
      this.#audit('credential.revoke', row.subject_id, id, undefined, { by: admin.subject_id })
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    this.#notify({ subject: row.subject_id, credentialId: id, reason: 'credential-revoked' })
  }

  revokeWorkspaceGrant(adminCredential: string, subject: string, workspaceId: string): void {
    this.#assertOpen()
    const admin = this.#requireAdmin(adminCredential)
    const target = validId(subject)
    const workspace = validId(workspaceId)
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const actions = this.#db.prepare('SELECT action FROM grants WHERE subject_id=? AND workspace_id=?').all(target, workspace) as
        Array<{ action: NativeAuthorityAction }>
      for (const { action } of actions) {
        this.#db.prepare('UPDATE grant_versions SET version=version+1 WHERE subject_id=? AND workspace_id=? AND action=?')
          .run(target, workspace, action)
      }
      this.#db.prepare('DELETE FROM grants WHERE subject_id=? AND workspace_id=?').run(target, workspace)
      this.#audit('grant.revoke', target, null, workspace, { by: admin.subject_id })
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    this.#notify({ subject: target, workspaceId: workspace, reason: 'grant-revoked' })
  }

  rotateCredential(credential: string): NativeIssuedCredential {
    this.#assertOpen()
    const row = this.#verifiedCredential(credential)
    if (!row) throw new Error('credential is invalid, expired, or revoked')
    this.#db.exec('BEGIN IMMEDIATE')
    let issued: NativeIssuedCredential
    try {
      const revoked = this.#db.prepare('UPDATE credentials SET revoked=1,version=version+1 WHERE id=? AND revoked=0').run(row.id)
      if (Number(revoked.changes) !== 1) throw new Error('credential was concurrently revoked')
      issued = this.#createCredential(row.subject_id, row.device_label, row.version + 1)
      this.#audit('credential.rotate', row.subject_id, row.id)
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    this.#notify({ subject: row.subject_id, credentialId: row.id, reason: 'credential-rotated' })
    return issued
  }

  onInvalidation(listener: (event: NativeAuthorityInvalidation) => void): () => void {
    this.#assertOpen()
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#listeners.clear()
    this.#db.close()
  }

  #requireAdmin(credential: string): { id: string; subject_id: string; role: string } {
    const row = this.#verifiedCredential(credential)
    if (!row || row.role !== 'admin') throw new Error('administrator credential required')
    return row
  }

  #verifiedCredential(credential: string): { id: string; subject_id: string; role: string; version: number; device_label: string } | null {
    const provided = typeof credential === 'string' ? credential : ''
    if (!this.#allowAttempt(provided)) return null
    const row = this.#db.prepare(`SELECT c.id,c.subject_id,c.digest,c.version,c.expires_at,c.revoked,c.device_label,s.role,s.disabled
      FROM credentials c JOIN subjects s ON s.id=c.subject_id WHERE c.id=?`).get(this.#credentialSelector(provided)) as
      | { id: string; subject_id: string; digest: Uint8Array; version: number; expires_at: number; revoked: number; device_label: string; role: string; disabled: number }
      | undefined
    const candidate = digest(provided)
    const stored = row ? Buffer.from(row.digest) : Buffer.alloc(HEX_DIGEST_LENGTH)
    const digestMatches = timingSafeEqual(stored, candidate)
    if (!row || !digestMatches || row.revoked || row.disabled || row.expires_at <= Date.now()) {
      this.#failedAttempt(provided)
      this.#audit('credential.reject', row?.subject_id ?? null, row?.id ?? null)
      return null
    }
    this.#resetAttempt(provided)
    return row
  }

  #credentialSelector(credential: string): string {
    const match = /^na_([0-9a-f-]{36})\.[A-Za-z0-9_-]{43}$/.exec(credential)
    return match?.[1] ?? ''
  }

  #createSubjectAndCredential(label: string, role: 'admin' | 'member', deviceLabel: string): NativeIssuedCredential {
    const subject = randomUUID()
    this.#db.prepare('INSERT INTO subjects(id,label,role,created_at) VALUES(?,?,?,?)').run(subject, label, role, Date.now())
    return this.#createCredential(subject, deviceLabel, 1)
  }

  #createCredential(subject: string, deviceLabel: string, version: number): NativeIssuedCredential {
    const id = randomUUID()
    const credential = `na_${id}.${randomBytes(32).toString('base64url')}`
    const expiresAt = Date.now() + CREDENTIAL_LIFETIME_MS
    this.#db.prepare('INSERT INTO credentials(id,subject_id,digest,version,expires_at,device_label,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, subject, digest(credential), version, expiresAt, deviceLabel, Date.now())
    this.#secureDatabaseFiles()
    return Object.freeze({
      credential,
      principal: Object.freeze({ issuer: this.#issuerId, subject, credentialId: id, credentialVersion: version }),
      expiresAt,
    })
  }

  #canonicalRoot(path: string): { path: string; device: string; inode: string } {
    const canonical = realpathSync(resolve(path))
    const info = statSync(canonical)
    if (!info.isDirectory()) throw new Error('workspace roots must be directories')
    return { path: canonical, device: String(info.dev), inode: String(info.ino) }
  }

  #rootIdentityMatches(root: { root: string; device: string; inode: string }): boolean {
    try {
      const canonical = realpathSync(root.root)
      const info = statSync(canonical)
      return canonical === root.root && info.isDirectory() && String(info.dev) === root.device && String(info.ino) === root.inode
    } catch {
      return false
    }
  }
  #workspaceRootsAreValid(workspaceId: string): boolean {
    const workspace = this.#db.prepare('SELECT native_root FROM workspaces WHERE id=?').get(workspaceId) as { native_root: string } | undefined
    if (!workspace) return false
    const roots = this.#db.prepare('SELECT root,device,inode FROM workspace_roots WHERE workspace_id=?').all(workspaceId) as
      Array<{ root: string; device: string; inode: string }>
    return roots.length > 0 && roots.some((root) => root.root === workspace.native_root) &&
      roots.every((root) => this.#rootIdentityMatches(root))
  }

  #rootBelongsToWorkspace(workspaceId: string, nativeRoot: string): boolean {
    try {
      const requestedPath = resolve(nativeRoot)
      const root = this.#canonicalRoot(nativeRoot)
      if (requestedPath !== root.path) return false
      const registered = this.#db.prepare('SELECT root,device,inode FROM workspace_roots WHERE workspace_id=? AND root=?')
        .get(workspaceId, root.path) as { root: string; device: string; inode: string } | undefined
      return !!registered && registered.device === root.device && registered.inode === root.inode && this.#rootIdentityMatches(registered)
    } catch {
      return false
    }
  }

  #attemptKey(value: string): string {
    return digest(value).toString('hex')
  }

  #allowAttempt(value: string): boolean {
    const key = this.#attemptKey(value)
    const now = Date.now()
    const entry = this.#attempts.get(key)
    if (!entry || now - entry.windowStarted >= FAILURE_WINDOW_MS) return true
    return entry.failures < MAX_FAILURES_PER_WINDOW
  }

  #failedAttempt(value: string): void {
    const now = Date.now()
    const key = this.#attemptKey(value)
    let entry = this.#attempts.get(key)
    if (!entry || now - entry.windowStarted >= FAILURE_WINDOW_MS) {
      for (const [trackedKey, tracked] of this.#attempts) {
        if (now - tracked.windowStarted >= FAILURE_WINDOW_MS) this.#attempts.delete(trackedKey)
      }
      if (this.#attempts.size >= MAX_TRACKED_ATTEMPTS) {
        const oldest = this.#attempts.keys().next().value as string | undefined
        if (oldest !== undefined) this.#attempts.delete(oldest)
      }
      entry = { windowStarted: now, failures: 0 }
    }
    entry.failures++
    this.#attempts.set(key, entry)
  }

  #resetAttempt(value: string): void {
    this.#attempts.delete(this.#attemptKey(value))
  }

  #audit(event: string, subject: string | null, credentialId: string | null, workspaceId?: string, detail: object = {}): void {
    this.#db.prepare('INSERT INTO audit(at,event,subject_id,credential_id,workspace_id,detail) VALUES(?,?,?,?,?,?)')
      .run(Date.now(), event, subject, credentialId, workspaceId ?? null, JSON.stringify(detail))
    this.#db.prepare('DELETE FROM audit WHERE sequence <= (SELECT MAX(sequence)-? FROM audit)').run(MAX_AUDIT_ROWS)
    this.#secureDatabaseFiles()
  }

  #notify(event: NativeAuthorityInvalidation): void {
    const frozen = Object.freeze({ ...event })
    for (const listener of this.#listeners) {
      try { listener(frozen) } catch { /* A consumer failure cannot undo a durable revocation. */ }
    }
  }

  #secureDatabaseFiles(): void {
    for (const name of ['authority.sqlite', 'authority.sqlite-wal', 'authority.sqlite-shm']) {
      try { chmodSync(join(this.#stateDir, name), 0o600) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('authority is closed')
  }
}
