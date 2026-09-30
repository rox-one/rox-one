import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  realpathSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from '@craft-agent/shared/utils/sqlite-runtime'
import type { NativePrincipal } from './native-authority.ts'
export type JournalAction = 'read' | 'write' | 'delete'
export type JournalChange = { path: string; content: string | null }
export type JournalMutation = {
  principal: NativePrincipal
  workspaceId: string
  nativeRoot: string
  kind: string
  nativeId: string
  operationId: string
  expectedRevision: number | null
  schemaVersion: number
  changes: JournalChange[]
}
export type JournalReceipt = {
  issuer: string
  workspaceId: string
  kind: string
  nativeId: string
  operationId: string
  subject: string
  sequence: number
  revision: number
  contentHash: string
  deleted: boolean
}
export type JournalEntitySnapshot = {
  workspaceId: string
  kind: string
  nativeId: string
  revision: number
  contentHash: string
  deleted: boolean
  files: Array<{ path: string; content: string }>
}
export type JournalChangePage = { changes: JournalReceipt[]; nextSequence: number; hasMore: boolean }
export type JournalConflict = {
  conflictId: string
  expectedRevision: number | null
  currentRevision: number | null
  currentHashes: Array<{ path: string; hash: string | null }>
  proposedHashes: Array<{ path: string; hash: string | null }>
}
export type JournalErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_SCHEMA'
  | 'CONFLICT'
  | 'PATH_OWNED'
  | 'OPERATION_ID_REUSED'
  | 'TOMBSTONED'
  | 'FOREIGN_CONTENT'
  | 'RECOVERY_REQUIRED'
  | 'PREPARED_ABORTED'
  | 'CLOSED'
  | 'IO_ERROR'

export class NativeJournalError extends Error {
  readonly code: JournalErrorCode
  readonly conflict?: JournalConflict
  constructor(code: JournalErrorCode, message: string, conflict?: JournalConflict) {
    super(message)
    this.name = 'NativeJournalError'
    this.code = code
    this.conflict = conflict
  }
}

type FileIntent = {
  path: string
  oldExists: boolean
  oldHash: string | null
  newHash: string | null
  oldStage: string | null
  newStage: string | null
}
type PermissionFenceRecord = { action: JournalAction; fence: string }
type Manifest = { key: string; root: string; principal: NativePrincipal; permissionFences: PermissionFenceRecord[]; changes: FileIntent[]; files: Array<{ path: string; hash: string }>; receipt: Omit<JournalReceipt, 'sequence'>; entityHash: string; deleted: boolean }
type Authorize = (principal: NativePrincipal, workspaceId: string, action: JournalAction, nativeRoot?: string) => boolean
type PermissionFence = (principal: NativePrincipal, workspaceId: string, action: JournalAction) => string | null
type AuthorizePreparedRecovery = (actor: NativePrincipal, workspaceId: string, action: JournalAction, expectedFence: string, nativeRoot?: string) => boolean

const JOURNAL_SCHEMA = 1
const MAX_RECEIPT_PAGE_SIZE = 100
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const identityKey = (issuer: string, workspace: string, kind: string, id: string) => JSON.stringify([issuer, workspace, kind, id])
const operationKey = (issuer: string, workspace: string, subject: string, operation: string) => JSON.stringify([issuer, workspace, subject, operation])
const safeName = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)

function syncDirectory(path: string): void {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    fsyncSync(fd)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
function durableWrite(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const fd = openSync(path, 'w', 0o600)
  try {
    writeFileSync(fd, bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  chmodSync(path, 0o600)
  syncDirectory(dirname(path))
}
function hashFile(path: string): string | null {
  try { return hash(readFileSync(path)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export class NativeJournal {
  private readonly db: DatabaseSync
  private readonly stateDir: string
  private readonly stagingDir: string
  private readonly authorizeFn: Authorize
  private readonly permissionFenceFn: PermissionFence
  private readonly authorizePreparedRecoveryFn: AuthorizePreparedRecovery
  private closed = false
  private recovering = false

  constructor(options: {
    stateDir: string
    authorize: Authorize
    permissionFence: PermissionFence
    authorizePreparedRecovery: AuthorizePreparedRecovery
  }) {
    this.stateDir = resolve(options.stateDir)
    this.stagingDir = join(this.stateDir, 'native-journal-staging')
    this.authorizeFn = options.authorize
    this.permissionFenceFn = options.permissionFence
    this.authorizePreparedRecoveryFn = options.authorizePreparedRecovery
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 })
    const stateStat = lstatSync(this.stateDir)
    if (stateStat.isSymbolicLink() || !stateStat.isDirectory() || realpathSync(this.stateDir) !== this.stateDir) throw new NativeJournalError('INVALID_INPUT', 'stateDir must be a canonical real directory')
    chmodSync(this.stateDir, 0o700)
    mkdirSync(this.stagingDir, { recursive: true, mode: 0o700 })
    const stagingStat = lstatSync(this.stagingDir)
    if (stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) throw new NativeJournalError('INVALID_INPUT', 'journal staging path must be a real directory')
    chmodSync(this.stagingDir, 0o700)
    const dbPath = join(this.stateDir, 'native-journal.sqlite')
    try {
      const dbStat = lstatSync(dbPath)
      if (dbStat.isSymbolicLink() || !dbStat.isFile()) throw new NativeJournalError('INVALID_INPUT', 'journal database must be a regular file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.db = new DatabaseSync(dbPath)
    chmodSync(dbPath, 0o600)
    const currentVersion = (this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0
    const hasUserTables = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' LIMIT 1").get())
    const entityColumns = this.db.prepare('PRAGMA table_info(entities)').all() as Array<{ name: string }>
    const fileColumns = this.db.prepare('PRAGMA table_info(entity_files)').all() as Array<{ name: string }>
    const hasRootColumns = entityColumns.some(({ name }) => name === 'native_root') && fileColumns.some(({ name }) => name === 'native_root')
    const hasEmptyRoots = hasRootColumns && (
      Boolean(this.db.prepare("SELECT 1 FROM entities WHERE native_root IS NULL OR native_root='' LIMIT 1").get()) ||
      Boolean(this.db.prepare("SELECT 1 FROM entity_files WHERE native_root IS NULL OR native_root='' LIMIT 1").get())
    )
    if (
      (currentVersion === 0 && hasUserTables) ||
      (currentVersion === JOURNAL_SCHEMA && (!hasRootColumns || hasEmptyRoots)) ||
      (currentVersion !== 0 && currentVersion !== JOURNAL_SCHEMA)
    ) {
      this.db.close()
      throw new NativeJournalError('UNSUPPORTED_SCHEMA', 'unsupported journal database schema')
    }
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        entity_key TEXT PRIMARY KEY, issuer TEXT NOT NULL, workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL, native_id TEXT NOT NULL, subject TEXT NOT NULL,
        native_root TEXT NOT NULL, revision INTEGER NOT NULL, content_hash TEXT NOT NULL, deleted INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entity_files (
        entity_key TEXT NOT NULL, native_root TEXT NOT NULL, path TEXT NOT NULL, file_hash TEXT,
        PRIMARY KEY(entity_key, path), FOREIGN KEY(entity_key) REFERENCES entities(entity_key)
      );
      CREATE TABLE IF NOT EXISTS receipts (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, issuer TEXT NOT NULL, workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL, native_id TEXT NOT NULL, operation_id TEXT NOT NULL, subject TEXT NOT NULL,
        revision INTEGER NOT NULL, content_hash TEXT NOT NULL, deleted INTEGER NOT NULL,
        op_key TEXT NOT NULL UNIQUE, payload_digest TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_roots (
        issuer TEXT NOT NULL, workspace_id TEXT NOT NULL, native_root TEXT NOT NULL,
        PRIMARY KEY(issuer, workspace_id, native_root), UNIQUE(issuer, native_root)
      );
      CREATE TABLE IF NOT EXISTS pending (
        op_key TEXT PRIMARY KEY, entity_key TEXT NOT NULL, payload_digest TEXT NOT NULL, manifest TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conflicts (
        conflict_id TEXT PRIMARY KEY, issuer TEXT NOT NULL, workspace_id TEXT NOT NULL, subject TEXT NOT NULL,
        kind TEXT NOT NULL, native_id TEXT NOT NULL, expected_revision INTEGER,
        current_revision INTEGER, current_hashes TEXT NOT NULL, proposed_hashes TEXT NOT NULL,
        versions_dir TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aborted_operations (
        op_key TEXT PRIMARY KEY, payload_digest TEXT NOT NULL, error_code TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_files (
        native_root TEXT NOT NULL, path TEXT NOT NULL, op_key TEXT NOT NULL, entity_key TEXT NOT NULL,
        PRIMARY KEY(native_root,path), FOREIGN KEY(op_key) REFERENCES pending(op_key)
      );
    `)
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS entity_files_root_path_owner ON entity_files(native_root,path) WHERE native_root<>''")
    if (currentVersion === 0) this.db.exec('PRAGMA user_version=1')
    this.recover()
  }

  mutate(input: JournalMutation): JournalReceipt {
    this.assertOpen()
    this.validate(input)
    const needsDelete = input.changes.some((change) => change.content === null)
    this.requireAuthorization(input.principal, input.workspaceId, 'read')
    this.requireAuthorization(input.principal, input.workspaceId, 'write')
    const root = this.validateRoot(input.nativeRoot)
    this.requireAuthorization(input.principal, input.workspaceId, 'read', root)
    this.requireAuthorization(input.principal, input.workspaceId, 'write', root)
    if (needsDelete) this.requireAuthorization(input.principal, input.workspaceId, 'delete', root)
    const foreignRoot = this.db.prepare('SELECT workspace_id FROM workspace_roots WHERE issuer=? AND native_root=?').get(input.principal.issuer, root) as { workspace_id: string } | undefined
    if (foreignRoot && foreignRoot.workspace_id !== input.workspaceId) throw new NativeJournalError('INVALID_INPUT', 'native root is already bound to a different workspace')
    const key = identityKey(input.principal.issuer, input.workspaceId, input.kind, input.nativeId)
    const opKey = operationKey(input.principal.issuer, input.workspaceId, input.principal.subject, input.operationId)
    const digest = this.digest(input, root)
    const previous = this.db.prepare('SELECT * FROM receipts WHERE op_key=?').get(opKey) as Record<string, unknown> | undefined
    if (previous) {
      if (previous.payload_digest !== digest) throw new NativeJournalError('OPERATION_ID_REUSED', 'operation id was already used with a different payload')
      return this.receiptFromRow(previous)
    }
    const aborted = this.db.prepare('SELECT payload_digest FROM aborted_operations WHERE op_key=?').get(opKey) as { payload_digest: string } | undefined
    if (aborted) {
      if (aborted.payload_digest !== digest) throw new NativeJournalError('OPERATION_ID_REUSED', 'operation id was already used with a different payload')
      throw new NativeJournalError('PREPARED_ABORTED', 'prepared operation was rolled back after its authorization fence changed')
    }
    const waiting = this.db.prepare('SELECT payload_digest FROM pending WHERE op_key=?').get(opKey)
    if (waiting) throw new NativeJournalError('RECOVERY_REQUIRED', 'operation is pending recovery')
    if (this.db.prepare('SELECT 1 AS yes FROM pending WHERE entity_key=?').get(key)) throw new NativeJournalError('RECOVERY_REQUIRED', 'native identity has a prepared operation')
    const permissionFences: PermissionFenceRecord[] = [
      { action: 'read', fence: this.captureFence(input.principal, input.workspaceId, 'read') },
      { action: 'write', fence: this.captureFence(input.principal, input.workspaceId, 'write') },
    ]
    if (needsDelete) permissionFences.push({ action: 'delete', fence: this.captureFence(input.principal, input.workspaceId, 'delete') })
    const entity = this.db.prepare('SELECT revision,content_hash,deleted,native_root FROM entities WHERE entity_key=?').get(key) as { revision: number; content_hash: string; deleted: number; native_root: string } | undefined
    if (entity?.deleted) throw new NativeJournalError('TOMBSTONED', 'deleted native identities cannot be recreated')
    if (entity && (!entity.native_root || entity.native_root !== root)) throw new NativeJournalError('INVALID_INPUT', 'native identity is permanently bound to its original root')
    this.assertPathsUnowned(root, key, input.changes.map(({ path }) => path))
    const actual = this.inspectCurrent(root, key, input.changes.map(({ path }) => path))
    if ((entity?.revision ?? null) !== input.expectedRevision || (entity && actual.contentHash !== entity.content_hash) || (!entity && actual.hashes.some(({ hash: fileHash }) => fileHash !== null))) {
      throw this.recordConflict(input, key, entity?.revision ?? null, actual.hashes)
    }
    if (!entity && input.expectedRevision !== null) throw new NativeJournalError('CONFLICT', 'CREATE requires expectedRevision:null')
    if (entity && input.expectedRevision === null) throw new NativeJournalError('CONFLICT', 'existing entity requires its current revision')
    const stageRoot = join(this.stagingDir, randomUUID())
    mkdirSync(stageRoot, { recursive: true, mode: 0o700 })
    chmodSync(stageRoot, 0o700)
    syncDirectory(this.stagingDir)
    const intents: FileIntent[] = []
    let preparedManifest: Manifest | undefined
    const changes = [...input.changes].sort((a, b) => a.path.localeCompare(b.path))
    try {
      for (let i = 0; i < changes.length; i++) {
        const change = changes[i]!
        const target = this.safeTarget(root, change.path, true)
        const oldBytes = existsSync(target) ? readFileSync(target) : null
        const newBytes = change.content === null ? null : Buffer.from(change.content, 'utf8')
        if (oldBytes === null && change.content === null) throw new NativeJournalError('INVALID_INPUT', 'cannot delete an absent file')
        const oldStage = oldBytes ? join(stageRoot, `old-${i}`) : null
        const newStage = newBytes ? join(stageRoot, `new-${i}`) : null
        if (oldBytes && oldStage) durableWrite(oldStage, oldBytes)
        if (newBytes && newStage) durableWrite(newStage, newBytes)
        intents.push({ path: change.path, oldExists: oldBytes !== null, oldHash: oldBytes ? hash(oldBytes) : null, newHash: newBytes ? hash(newBytes) : null, oldStage: oldStage ? relative(this.stateDir, oldStage) : null, newStage: newStage ? relative(this.stateDir, newStage) : null })
      }
      const newRevision = (entity?.revision ?? 0) + 1
      const nextHashes = new Map(actual.hashes.map(({ path, hash: fileHash }) => [path, fileHash]))
      for (const item of intents) {
        if (item.newHash === null) nextHashes.delete(item.path)
        else nextHashes.set(item.path, item.newHash)
      }
      const entityHash = hash(JSON.stringify([...nextHashes].sort(([left], [right]) => left.localeCompare(right))))
      const deleted = nextHashes.size === 0
      const files = [...nextHashes.entries()].flatMap(([path, fileHash]) => fileHash === null ? [] : [{ path, hash: fileHash }])
      const manifest: Manifest = {
        key, root, principal: input.principal, permissionFences, changes: intents, files,
        receipt: { issuer: input.principal.issuer, workspaceId: input.workspaceId, kind: input.kind, nativeId: input.nativeId, operationId: input.operationId, subject: input.principal.subject, revision: newRevision, contentHash: entityHash, deleted },
        entityHash, deleted,
      }
      preparedManifest = manifest
      this.db.exec('BEGIN IMMEDIATE')
      try {
        if (this.db.prepare('SELECT 1 AS yes FROM pending WHERE entity_key=?').get(key)) throw new NativeJournalError('RECOVERY_REQUIRED', 'native identity has a prepared operation')
        this.assertLiveFences(manifest)
        this.assertPathsUnowned(root, key, input.changes.map(({ path }) => path))
        const again = this.inspectCurrent(root, key, input.changes.map(({ path }) => path))
        if (again.contentHash !== actual.contentHash || JSON.stringify(again.hashes) !== JSON.stringify(actual.hashes)) {
          this.db.exec('ROLLBACK')
          throw this.recordConflict(input, key, entity?.revision ?? null, again.hashes)
        }
        this.db.prepare('INSERT INTO pending(op_key,entity_key,payload_digest,manifest) VALUES(?,?,?,?)').run(opKey, key, digest, JSON.stringify(manifest))
        const reserveFile = this.db.prepare('INSERT INTO pending_files(native_root,path,op_key,entity_key) VALUES(?,?,?,?)')
        for (const item of intents) reserveFile.run(root, item.path, opKey, key)
        this.db.exec('COMMIT')
      } catch (error) {
        try { this.db.exec('ROLLBACK') } catch { /* transaction already ended */ }
        throw error
      }
      this.applyManifest(manifest, false)
      this.assertLiveFences(manifest)
      this.verifyManifestApplied(manifest)
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.assertLiveFences(manifest)
        this.verifyManifestApplied(manifest)
        this.db.prepare('INSERT INTO workspace_roots(issuer,workspace_id,native_root) VALUES(?,?,?) ON CONFLICT(issuer,workspace_id,native_root) DO NOTHING').run(input.principal.issuer, input.workspaceId, root)
        this.db.prepare(`INSERT INTO entities(entity_key,issuer,workspace_id,kind,native_id,subject,native_root,revision,content_hash,deleted)
          VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_key) DO UPDATE SET subject=excluded.subject, revision=excluded.revision, content_hash=excluded.content_hash, deleted=excluded.deleted`)
          .run(key, input.principal.issuer, input.workspaceId, input.kind, input.nativeId, input.principal.subject, root, newRevision, entityHash, deleted ? 1 : 0)
        this.db.prepare('DELETE FROM entity_files WHERE entity_key=?').run(key)
        const addFile = this.db.prepare('INSERT INTO entity_files(entity_key,native_root,path,file_hash) VALUES(?,?,?,?)')
        for (const item of files) addFile.run(key, root, item.path, item.hash)
        const result = this.db.prepare(`INSERT INTO receipts(issuer,workspace_id,kind,native_id,operation_id,subject,revision,content_hash,deleted,op_key,payload_digest)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(input.principal.issuer, input.workspaceId, input.kind, input.nativeId, input.operationId, input.principal.subject, newRevision, entityHash, deleted ? 1 : 0, opKey, digest)
        this.db.prepare('DELETE FROM pending_files WHERE op_key=?').run(opKey)
        this.db.prepare('DELETE FROM pending WHERE op_key=?').run(opKey)
        this.assertLiveFences(manifest)
        this.verifyManifestApplied(manifest)
        this.db.exec('COMMIT')
        this.removeStaging(manifest)
        return { ...manifest.receipt, sequence: Number(result.lastInsertRowid) }
      } catch (error) {
        try { this.db.exec('ROLLBACK') } catch { /* transaction already ended */ }
        throw error
      }
    } catch (error) {
      const pendingRow = this.db.prepare('SELECT 1 AS yes FROM pending WHERE op_key=?').get(opKey)
      if (pendingRow && preparedManifest && error instanceof NativeJournalError && error.code === 'UNAUTHORIZED') {
        this.rollbackManifest(preparedManifest)
        this.recordAborted(opKey, digest)
        this.removeStaging(preparedManifest)
      } else if (!pendingRow) {
        rmSync(stageRoot, { recursive: true, force: true })
      }
      throw error
    }
  }

  readReceipt(principal: NativePrincipal, workspaceId: string, operationId: string): JournalReceipt | null {
    this.assertOpen()
    this.requireAuthorization(principal, workspaceId, 'read')
    const row = this.db.prepare('SELECT * FROM receipts WHERE issuer=? AND workspace_id=? AND operation_id=? AND subject=? ORDER BY sequence LIMIT 1')
      .get(principal.issuer, workspaceId, operationId, principal.subject) as Record<string, unknown> | undefined
    return row ? this.receiptFromRow(row) : null
  }

  pullReceipts(principal: NativePrincipal, workspaceId: string, afterSequence: number): JournalReceipt[] {
    this.assertOpen()
    this.requireAuthorization(principal, workspaceId, 'read')
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new NativeJournalError('INVALID_INPUT', 'afterSequence must be a non-negative integer')
    const rows = this.db.prepare('SELECT * FROM receipts WHERE issuer=? AND workspace_id=? AND sequence>? ORDER BY sequence')
      .all(principal.issuer, workspaceId, afterSequence) as Array<Record<string, unknown>>
    return rows.map((row) => this.receiptFromRow(row))
  }
  pullChanges(principal: NativePrincipal, workspaceId: string, afterSequence: number, limit = MAX_RECEIPT_PAGE_SIZE): JournalChangePage {
    this.assertOpen()
    this.requireAuthorization(principal, workspaceId, 'read')
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new NativeJournalError('INVALID_INPUT', 'afterSequence must be a non-negative integer')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECEIPT_PAGE_SIZE) throw new NativeJournalError('INVALID_INPUT', `limit must be an integer from 1 to ${MAX_RECEIPT_PAGE_SIZE}`)
    const rows = this.db.prepare(`SELECT sequence,issuer,workspace_id,kind,native_id,operation_id,subject,revision,content_hash,deleted
      FROM receipts WHERE issuer=? AND workspace_id=? AND sequence>? ORDER BY sequence LIMIT ?`)
      .all(principal.issuer, workspaceId, afterSequence, limit + 1) as Array<Record<string, unknown>>
    const hasMore = rows.length > limit
    const changes = rows.slice(0, limit).map((row) => this.receiptFromRow(row))
    return {
      changes,
      nextSequence: changes.length > 0 ? changes[changes.length - 1]!.sequence : afterSequence,
      hasMore,
    }
  }

  readEntity(principal: NativePrincipal, workspaceId: string, kind: string, nativeId: string): JournalEntitySnapshot | null {
    this.assertOpen()
    this.requireAuthorization(principal, workspaceId, 'read')
    const readFence = this.captureFence(principal, workspaceId, 'read')
    if (!safeName(workspaceId) || !safeName(kind) || typeof nativeId !== 'string' ||
      nativeId.length === 0 || nativeId.length > 512 || /[\u0000-\u001f\u007f]/.test(nativeId)) {
      throw new NativeJournalError('INVALID_INPUT', 'invalid workspace or entity identity')
    }
    const key = identityKey(principal.issuer, workspaceId, kind, nativeId)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (this.db.prepare('SELECT 1 FROM pending WHERE entity_key=?').get(key)) {
        throw new NativeJournalError('RECOVERY_REQUIRED', 'entity has a prepared mutation')
      }
      const entity = this.db.prepare(`SELECT revision,content_hash,deleted,native_root FROM entities
        WHERE entity_key=? AND issuer=? AND workspace_id=? AND kind=? AND native_id=?`)
        .get(key, principal.issuer, workspaceId, kind, nativeId) as
        | { revision: number; content_hash: string; deleted: number; native_root: string }
        | undefined
      if (!entity) {
        this.requireAuthorization(principal, workspaceId, 'read')
        if (this.permissionFenceFn(principal, workspaceId, 'read') !== readFence) {
          throw new NativeJournalError('UNAUTHORIZED', 'native journal authorization changed during entity read')
        }
        this.db.exec('COMMIT')
        return null
      }

      const root = entity.native_root
      this.requireAuthorization(principal, workspaceId, 'read', root)
      let canonicalRoot: string
      try {
        canonicalRoot = this.validateRoot(root)
      } catch {
        throw new NativeJournalError('RECOVERY_REQUIRED', 'canonical entity root is unavailable')
      }
      if (canonicalRoot !== root) throw new NativeJournalError('RECOVERY_REQUIRED', 'canonical entity root identity changed')

      const rows = this.db.prepare('SELECT native_root,path,file_hash FROM entity_files WHERE entity_key=?')
        .all(key) as Array<{ native_root: string; path: string; file_hash: string | null }>
      rows.sort((left, right) => left.path.localeCompare(right.path))
      if (rows.some(({ native_root }) => native_root !== root)) {
        throw new NativeJournalError('RECOVERY_REQUIRED', 'tracked file root does not match its entity root')
      }
      if (entity.deleted) {
        if (rows.length !== 0 || entity.content_hash !== hash(JSON.stringify([]))) {
          throw new NativeJournalError('RECOVERY_REQUIRED', 'tombstone metadata is inconsistent')
        }
        this.requireAuthorization(principal, workspaceId, 'read', root)
        if (this.permissionFenceFn(principal, workspaceId, 'read') !== readFence) {
          throw new NativeJournalError('UNAUTHORIZED', 'native journal authorization changed during entity read')
        }
        this.db.exec('COMMIT')
        return {
          workspaceId,
          kind,
          nativeId,
          revision: entity.revision,
          contentHash: entity.content_hash,
          deleted: true,
          files: [],
        }
      }

      const verifiedFiles: Array<{ path: string; content: string; fileHash: string }> = []
      for (const row of rows) {
        if (!row.file_hash) throw new NativeJournalError('RECOVERY_REQUIRED', 'tracked file hash is missing')
        let bytes: Buffer
        try {
          bytes = readFileSync(this.safeTarget(root, row.path, false))
        } catch {
          throw new NativeJournalError('FOREIGN_CONTENT', 'tracked native file is missing or unsafe')
        }
        const fileHash = hash(bytes)
        if (fileHash !== row.file_hash) throw new NativeJournalError('FOREIGN_CONTENT', 'tracked native file changed outside the journal')
        verifiedFiles.push({ path: row.path, content: bytes.toString('utf8'), fileHash })
      }
      const contentHash = hash(JSON.stringify(verifiedFiles.map(({ path, fileHash }) => [path, fileHash])))
      if (contentHash !== entity.content_hash) throw new NativeJournalError('RECOVERY_REQUIRED', 'entity hash does not match its tracked files')
      this.requireAuthorization(principal, workspaceId, 'read', root)
      if (this.permissionFenceFn(principal, workspaceId, 'read') !== readFence) {
        throw new NativeJournalError('UNAUTHORIZED', 'native journal authorization changed during entity read')
      }
      this.db.exec('COMMIT')
      return {
        workspaceId,
        kind,
        nativeId,
        revision: entity.revision,
        contentHash,
        deleted: false,
        files: verifiedFiles.map(({ path, content }) => ({ path, content })),
      }
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* transaction already ended */ }
      throw error
    }
  }

  recover(): void {
    this.assertOpen()
    if (this.recovering) return
    this.recovering = true
    try {
      const pending = this.db.prepare('SELECT op_key,payload_digest,manifest FROM pending ORDER BY rowid').all() as Array<{ op_key: string; payload_digest: string; manifest: string }>
      for (const row of pending) {
        const manifest = JSON.parse(row.manifest) as Manifest
        try {
          this.assertManifestRoot(manifest)
          this.assertPathsUnowned(manifest.root, manifest.key, manifest.changes.map(({ path }) => path))
          this.applyManifest(manifest, true)
          this.verifyManifestApplied(manifest)
        } catch (error) {
          if (!(error instanceof NativeJournalError) || error.code !== 'UNAUTHORIZED') throw error
          this.rollbackManifest(manifest)
          this.recordAborted(row.op_key, row.payload_digest)
          this.removeStaging(manifest)
          continue
        }
        this.db.exec('BEGIN IMMEDIATE')
        try {
          this.assertRecoveryFences(manifest)
          this.verifyManifestApplied(manifest)
          this.db.prepare(`INSERT OR IGNORE INTO receipts(issuer,workspace_id,kind,native_id,operation_id,subject,revision,content_hash,deleted,op_key,payload_digest)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(manifest.receipt.issuer, manifest.receipt.workspaceId, manifest.receipt.kind, manifest.receipt.nativeId, manifest.receipt.operationId, manifest.receipt.subject, manifest.receipt.revision, manifest.entityHash, manifest.deleted ? 1 : 0, row.op_key, row.payload_digest)
          this.db.prepare('INSERT INTO workspace_roots(issuer,workspace_id,native_root) VALUES(?,?,?) ON CONFLICT(issuer,workspace_id,native_root) DO NOTHING').run(manifest.receipt.issuer, manifest.receipt.workspaceId, manifest.root)
          this.db.prepare(`INSERT INTO entities(entity_key,issuer,workspace_id,kind,native_id,subject,native_root,revision,content_hash,deleted)
            VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_key) DO UPDATE SET subject=excluded.subject,revision=excluded.revision,content_hash=excluded.content_hash,deleted=excluded.deleted`)
            .run(manifest.key, manifest.receipt.issuer, manifest.receipt.workspaceId, manifest.receipt.kind, manifest.receipt.nativeId, manifest.receipt.subject, manifest.root, manifest.receipt.revision, manifest.entityHash, manifest.deleted ? 1 : 0)
          this.db.prepare('DELETE FROM entity_files WHERE entity_key=?').run(manifest.key)
          const addFile = this.db.prepare('INSERT INTO entity_files(entity_key,native_root,path,file_hash) VALUES(?,?,?,?)')
          for (const item of manifest.files) addFile.run(manifest.key, manifest.root, item.path, item.hash)
          this.db.prepare('DELETE FROM pending_files WHERE op_key=?').run(row.op_key)
          this.db.prepare('DELETE FROM pending WHERE op_key=?').run(row.op_key)
          this.assertRecoveryFences(manifest)
          this.verifyManifestApplied(manifest)
          this.db.exec('COMMIT')
          this.removeStaging(manifest)
        } catch (error) {
          try { this.db.exec('ROLLBACK') } catch { /* transaction already ended */ }
          if (error instanceof NativeJournalError && error.code === 'UNAUTHORIZED') {
            this.rollbackManifest(manifest)
            this.recordAborted(row.op_key, row.payload_digest)
            this.removeStaging(manifest)
            continue
          }
          throw error
        }
      }
      for (const name of readdirSync(this.stagingDir)) {
        const path = join(this.stagingDir, name)
        if (!name.startsWith('conflict-') && lstatSync(path).isDirectory() && !pending.some((row) => {
          try { return (JSON.parse(row.manifest) as Manifest).changes.some((change) => (change.oldStage && resolve(this.stateDir, change.oldStage).startsWith(path + sep)) || (change.newStage && resolve(this.stateDir, change.newStage).startsWith(path + sep))) } catch { return false }
        })) rmSync(path, { recursive: true, force: true })
      }
    } finally { this.recovering = false }
  }

  close(): void {
    if (this.closed) return
    this.db.close()
    this.closed = true
  }

  private validate(input: JournalMutation): void {
    if (input.schemaVersion !== JOURNAL_SCHEMA) throw new NativeJournalError('UNSUPPORTED_SCHEMA', 'unsupported native journal schema version')
    if (!input.principal || !safeName(input.principal.issuer) || !safeName(input.principal.subject) || !safeName(input.principal.credentialId) || !Number.isSafeInteger(input.principal.credentialVersion) || input.principal.credentialVersion < 1) throw new NativeJournalError('INVALID_INPUT', 'invalid authenticated principal')
    if (![input.workspaceId, input.kind].every(safeName) || ![input.nativeId, input.operationId].every((value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value))) throw new NativeJournalError('INVALID_INPUT', 'invalid workspace or entity identity')
    if (!Array.isArray(input.changes) || input.changes.length === 0 || input.changes.length > 256) throw new NativeJournalError('INVALID_INPUT', 'changes must contain 1 to 256 files')
    if (input.expectedRevision !== null && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)) throw new NativeJournalError('INVALID_INPUT', 'expectedRevision must be null or a positive revision')
    const seen = new Set<string>()
    for (const change of input.changes) {
      if (typeof change.path !== 'string' || !change.path || isAbsolute(change.path) || change.path.includes('\\') || change.path.split('/').some((part) => !part || part === '.' || part === '..') || change.path.includes('\0')) throw new NativeJournalError('INVALID_INPUT', 'unsafe relative file path')
      if (seen.has(change.path)) throw new NativeJournalError('INVALID_INPUT', 'duplicate file path in changes')
      seen.add(change.path)
      if (change.content !== null && typeof change.content !== 'string') throw new NativeJournalError('INVALID_INPUT', 'file content must be string or null')
    }
  }

  private digest(input: JournalMutation, canonicalRoot: string): string {
    return hash(JSON.stringify({ issuer: input.principal.issuer, subject: input.principal.subject, workspaceId: input.workspaceId, nativeRoot: canonicalRoot, kind: input.kind, nativeId: input.nativeId, operationId: input.operationId, expectedRevision: input.expectedRevision, schemaVersion: input.schemaVersion, changes: input.changes.map(({ path, content }) => [path, content === null ? null : hash(content)]) }))
  }

  private requireAuthorization(principal: NativePrincipal, workspaceId: string, action: JournalAction, nativeRoot?: string): void {
    if (!this.authorizeFn(principal, workspaceId, action, nativeRoot)) throw new NativeJournalError('UNAUTHORIZED', 'native journal access denied')
  }
  private captureFence(principal: NativePrincipal, workspaceId: string, action: JournalAction): string {
    const fence = this.permissionFenceFn(principal, workspaceId, action)
    if (!fence) throw new NativeJournalError('UNAUTHORIZED', 'native journal access denied')
    return fence
  }

  private assertLiveFences(manifest: Manifest): void {
    for (const item of manifest.permissionFences) {
      this.requireAuthorization(manifest.principal, manifest.receipt.workspaceId, item.action, manifest.root)
      if (this.permissionFenceFn(manifest.principal, manifest.receipt.workspaceId, item.action) !== item.fence) {
        throw new NativeJournalError('UNAUTHORIZED', 'native journal authorization changed during prepared mutation')
      }
    }
  }

  private assertRecoveryFences(manifest: Manifest): void {
    for (const item of manifest.permissionFences) {
      if (!this.authorizePreparedRecoveryFn(manifest.principal, manifest.receipt.workspaceId, item.action, item.fence, manifest.root)) {
        throw new NativeJournalError('UNAUTHORIZED', 'prepared operation authorization fence is no longer valid')
      }
    }
  }

  private validateRoot(nativeRoot: string): string {
    const requested = resolve(nativeRoot)
    let root: string
    try { root = realpathSync(requested) } catch { throw new NativeJournalError('INVALID_INPUT', 'native root does not exist') }
    const stat = lstatSync(root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new NativeJournalError('INVALID_INPUT', 'native root must be a real directory')
    return root
  }

  private safeTarget(root: string, relativePath: string, allowMissing: boolean): string {
    const target = resolve(root, relativePath)
    const rel = relative(root, target)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new NativeJournalError('INVALID_INPUT', 'path escapes native root')
    let cursor = root
    const parts = relativePath.split('/')
    for (let i = 0; i < parts.length; i++) {
      cursor = join(cursor, parts[i]!)
      try {
        const stat = lstatSync(cursor)
        if (stat.isSymbolicLink()) throw new NativeJournalError('INVALID_INPUT', 'symbolic links are not allowed in journal paths')
        if (i < parts.length - 1 && !stat.isDirectory()) throw new NativeJournalError('INVALID_INPUT', 'parent path is not a directory')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (!allowMissing) throw new NativeJournalError('INVALID_INPUT', 'journal path is missing')
      }
    }
    return target
  }

  private inspectCurrent(rootPath: string, key: string, extraPaths: string[] = []): { contentHash: string; hashes: Array<{ path: string; hash: string | null }> } {
    const root = this.validateRoot(rootPath)
    const rows = this.db.prepare('SELECT path FROM entity_files WHERE entity_key=? ORDER BY path').all(key) as Array<{ path: string }>
    const trackedPaths = rows.map(({ path }) => path)
    const paths = [...new Set([...trackedPaths, ...extraPaths])].sort()
    const hashes = paths.map((path) => ({ path, hash: hashFile(this.safeTarget(root, path, true)) }))
    const current = new Map(hashes.map(({ path, hash: fileHash }) => [path, fileHash]))
    const contentHash = hash(JSON.stringify(trackedPaths.map((path) => [path, current.get(path) ?? null])))
    return { contentHash, hashes }
  }

  private assertPathsUnowned(root: string, key: string, paths: string[]): void {
    const owner = this.db.prepare(`SELECT 1 AS yes FROM entity_files WHERE native_root=? AND path=? AND entity_key<>?
      UNION ALL SELECT 1 AS yes FROM pending_files WHERE native_root=? AND path=? AND entity_key<>? LIMIT 1`)
    for (const path of paths) {
      if (owner.get(root, path, key, root, path, key)) throw new NativeJournalError('PATH_OWNED', 'native file path is already owned by another entity')
    }
  }

  private recordConflict(input: JournalMutation, key: string, currentRevision: number | null, currentHashes: Array<{ path: string; hash: string | null }>): NativeJournalError {
    const id = randomUUID()
    const dir = join(this.stagingDir, `conflict-${id}`)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    syncDirectory(this.stagingDir)
    const proposedHashes: Array<{ path: string; hash: string | null }> = []
    try {
      for (let i = 0; i < input.changes.length; i++) {
        const change = input.changes[i]!
        const bytes = change.content === null ? null : Buffer.from(change.content, 'utf8')
        if (bytes) durableWrite(join(dir, `proposed-${i}`), bytes)
        proposedHashes.push({ path: change.path, hash: bytes ? hash(bytes) : null })
      }
      for (let i = 0; i < currentHashes.length; i++) {
        const item = currentHashes[i]!
        if (item.hash) {
          const file = this.safeTarget(resolve(input.nativeRoot), item.path, false)
          durableWrite(join(dir, `current-${i}`), readFileSync(file))
        }
      }
      syncDirectory(dir)
      this.db.prepare(`INSERT INTO conflicts(conflict_id,issuer,workspace_id,subject,kind,native_id,expected_revision,current_revision,current_hashes,proposed_hashes,versions_dir)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.principal.issuer, input.workspaceId, input.principal.subject, input.kind, input.nativeId, input.expectedRevision, currentRevision, JSON.stringify(currentHashes), JSON.stringify(proposedHashes), relative(this.stateDir, dir))
    } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
    return new NativeJournalError('CONFLICT', 'native content changed since the expected revision; both versions were preserved', { conflictId: id, expectedRevision: input.expectedRevision, currentRevision, currentHashes, proposedHashes })
  }

  private assertManifestRoot(manifest: Manifest): void {
    const entity = this.db.prepare('SELECT native_root FROM entities WHERE entity_key=?').get(manifest.key) as { native_root: string } | undefined
    if (entity && entity.native_root !== manifest.root) throw new NativeJournalError('RECOVERY_REQUIRED', 'prepared native identity root does not match its committed root')
  }

  private verifyManifestApplied(manifest: Manifest): void {
    const root = this.validateRoot(manifest.root)
    const expectedDigest = hash(JSON.stringify([...manifest.files].sort((left, right) => left.path.localeCompare(right.path)).map(({ path, hash: fileHash }) => [path, fileHash])))
    if (expectedDigest !== manifest.entityHash) throw new NativeJournalError('RECOVERY_REQUIRED', 'prepared entity hash does not match its file manifest')
    for (const item of manifest.files) {
      if (hashFile(this.safeTarget(root, item.path, true)) !== item.hash) throw new NativeJournalError('FOREIGN_CONTENT', 'native file differs from the prepared entity manifest')
    }
    for (const item of manifest.changes) {
      if (hashFile(this.safeTarget(root, item.path, true)) !== item.newHash) throw new NativeJournalError('FOREIGN_CONTENT', 'native file differs from the prepared operation')
    }
  }
  private verifyRecoverable(manifest: Manifest, recovering: boolean): void {
    const root = this.validateRoot(manifest.root)
    if (recovering) this.assertRecoveryFences(manifest)
    else this.assertLiveFences(manifest)
    const changed = new Map(manifest.changes.map((item) => [item.path, item]))
    for (const item of manifest.files) {
      const intent = changed.get(item.path)
      if (intent && intent.newHash !== item.hash) throw new NativeJournalError('RECOVERY_REQUIRED', 'prepared file manifest disagrees with its change intent')
      const actual = hashFile(this.safeTarget(root, item.path, true))
      if (!intent && actual !== item.hash) throw new NativeJournalError('FOREIGN_CONTENT', 'unchanged tracked native file differs from its committed hash')
    }
    for (const item of manifest.changes) {
      const target = this.safeTarget(root, item.path, true)
      const actual = hashFile(target)
      if (actual !== item.oldHash && actual !== item.newHash) throw new NativeJournalError('FOREIGN_CONTENT', 'recovery found content outside the prepared old/new versions')
      for (const [stageRel, expected, label] of [[item.newStage, item.newHash, 'new'], [item.oldStage, item.oldHash, 'old']] as const) {
        if (expected === null) continue
        if (!stageRel) throw new NativeJournalError('RECOVERY_REQUIRED', `prepared ${label} version is missing`)
        const staged = resolve(this.stateDir, stageRel)
        const stagePath = relative(this.stagingDir, staged)
        if (!stagePath || stagePath === '..' || stagePath.startsWith(`..${sep}`) || isAbsolute(stagePath)) throw new NativeJournalError('RECOVERY_REQUIRED', 'prepared bytes are outside private staging')
        const stat = lstatSync(staged)
        if (!stat.isFile() || stat.isSymbolicLink() || hashFile(staged) !== expected) throw new NativeJournalError('RECOVERY_REQUIRED', `prepared ${label} bytes are missing or invalid`)
      }
    }
  }

  private applyManifest(manifest: Manifest, recovering: boolean): void {
    this.verifyRecoverable(manifest, recovering)
    const root = this.validateRoot(manifest.root)
    for (let i = 0; i < manifest.changes.length; i++) {
      const item = manifest.changes[i]!
      const target = this.safeTarget(root, item.path, true)
      if (hashFile(target) === item.newHash) continue
      if (recovering) this.assertRecoveryFences(manifest)
      else this.assertLiveFences(manifest)
      if (item.newHash === null) {
        rmSync(target)
        syncDirectory(dirname(target))
      } else {
        const staged = resolve(this.stateDir, item.newStage!)
        this.ensureParentDirectories(root, item.path)
        this.safeTarget(root, item.path, true)
        const tmp = `${target}.journal-${randomUUID()}`
        durableWrite(tmp, readFileSync(staged))
        try {
          this.safeTarget(root, item.path, true)
          const latest = hashFile(target)
          if (latest === item.newHash) {
            rmSync(tmp)
            continue
          }
          if (latest !== item.oldHash) throw new NativeJournalError('FOREIGN_CONTENT', 'native file changed during replacement')
          if (recovering) this.assertRecoveryFences(manifest)
          else this.assertLiveFences(manifest)
          renameSync(tmp, target)
        } catch (error) {
          rmSync(tmp, { force: true })
          throw error
        }
        chmodSync(target, 0o600)
        syncDirectory(dirname(target))
      }
    }
  }

  private rollbackManifest(manifest: Manifest): void {
    const root = this.validateRoot(manifest.root)
    for (const item of manifest.changes) {
      const actual = hashFile(this.safeTarget(root, item.path, true))
      if (actual !== item.oldHash && actual !== item.newHash) throw new NativeJournalError('FOREIGN_CONTENT', 'cannot roll back prepared operation over foreign content')
      if (item.oldExists) {
        if (!item.oldStage) throw new NativeJournalError('RECOVERY_REQUIRED', 'prepared old version is missing')
        const oldStage = resolve(this.stateDir, item.oldStage)
        const stagePath = relative(this.stagingDir, oldStage)
        if (!stagePath || stagePath === '..' || stagePath.startsWith(`..${sep}`) || isAbsolute(stagePath)) throw new NativeJournalError('RECOVERY_REQUIRED', 'prepared old bytes are outside private staging')
        const stat = lstatSync(oldStage)
        if (!stat.isFile() || stat.isSymbolicLink() || hashFile(oldStage) !== item.oldHash) throw new NativeJournalError('RECOVERY_REQUIRED', 'prepared old version is missing or invalid')
      }
    }
    for (const item of manifest.changes) {
      const target = this.safeTarget(root, item.path, true)
      if (hashFile(target) === item.oldHash) continue
      if (item.oldExists) {
        const oldStage = resolve(this.stateDir, item.oldStage!)
        const tmp = `${target}.journal-rollback-${randomUUID()}`
        durableWrite(tmp, readFileSync(oldStage))
        renameSync(tmp, target)
        chmodSync(target, 0o600)
      } else if (existsSync(target)) rmSync(target)
      syncDirectory(dirname(target))
    }
  }

  private recordAborted(opKey: string, digest: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO aborted_operations(op_key,payload_digest,error_code) VALUES(?,?,?)').run(opKey, digest, 'PREPARED_ABORTED')
      this.db.prepare('DELETE FROM pending_files WHERE op_key=?').run(opKey)
      this.db.prepare('DELETE FROM pending WHERE op_key=?').run(opKey)
      this.db.exec('COMMIT')
    } catch (error) { try { this.db.exec('ROLLBACK') } catch { /* transaction already ended */ }; throw error }
  }

  private ensureParentDirectories(root: string, relativePath: string): void {
    let directory = root
    for (const part of relativePath.split('/').slice(0, -1)) {
      const child = join(directory, part)
      try {
        const stat = lstatSync(child)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new NativeJournalError('INVALID_INPUT', 'parent path is not a real directory')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        mkdirSync(child, { mode: 0o700 })
        syncDirectory(directory)
      }
      directory = child
    }
  }

  private removeStaging(manifest: Manifest): void {
    const stage = manifest.changes.find((item) => item.oldStage || item.newStage)
    if (!stage) return
    const path = resolve(this.stateDir, stage.oldStage ?? stage.newStage!)
    const parent = dirname(path)
    if (parent.startsWith(this.stagingDir + sep)) rmSync(parent, { recursive: true, force: true })
  }

  private receiptFromRow(row: Record<string, unknown>): JournalReceipt {
    return { issuer: String(row.issuer), workspaceId: String(row.workspace_id), kind: String(row.kind), nativeId: String(row.native_id), operationId: String(row.operation_id), subject: String(row.subject), sequence: Number(row.sequence), revision: Number(row.revision), contentHash: String(row.content_hash), deleted: Number(row.deleted) === 1 }
  }

  private assertOpen(): void {
    if (this.closed) throw new NativeJournalError('CLOSED', 'native journal is closed')
  }
}
