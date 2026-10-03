import { chmodSync, lstatSync, realpathSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from '../utils/sqlite-runtime.ts';
import { decryptBytes, encryptBytes } from './crypto.ts';
import { isReplicaCategory, type ReplicaEnvelope, type ReplicaOperation, type ReplicaWriteInput } from './types.ts';
import type { NativeDataEntitySnapshot, NativeDataReceipt } from '../protocol/dto.ts';

export interface ReplicaSnapshotScope { accountId: string; workspaceId: string; permissionFence: string }

/** Opaque caller retry token; canonical operation IDs remain assigned by main custody. */
export interface ReplicaCreationAttempt {
  callerAttemptId: string;
  permissionFence: string;
  writePermissionFence: string;
}

export interface ReplicaServerAcknowledgement {
  operationId: string;
  serverSequence: number;
  revision: number;
}

export interface ReplicaOutboxPort {
  enqueue(operation: ReplicaOperation): void;
  enqueueCreation?(operation: ReplicaOperation, attempt: ReplicaCreationAttempt): ReplicaOperation;
  pending(accountId: string, workspaceId: string): ReplicaOperation[];
  acknowledge(accountId: string, workspaceId: string, operationId: string, acknowledgement: Omit<ReplicaServerAcknowledgement, 'operationId'>): boolean;
  acknowledgement(accountId: string, workspaceId: string, operationId: string): ReplicaServerAcknowledgement | null;
  close(): void;
}

const OUTBOX_SCHEMA = 1;
const MAX_CREATION_ATTEMPTS = 4096;
const MAX_CREATION_ATTEMPT_BYTES = 64 * 1024;

/** Durable, metadata-only local outbox. The caller supplies the existing device/account key; it is never stored here. */
export class SqliteReplicaOutbox implements ReplicaOutboxPort {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;
  private closed = false;

  constructor(options: { databasePath: string; key: Buffer }) {
    if (!Buffer.isBuffer(options.key) || options.key.length !== 32) throw new Error('replica outbox key must be 32 bytes');
    const databasePath = resolve(options.databasePath);
    const parent = dirname(databasePath);
    const parentStat = lstatSync(parent);
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory() || realpathSync(parent) !== parent) {
      throw new Error('replica outbox parent must be a canonical real directory');
    }
    try {
      const databaseStat = lstatSync(databasePath);
      if (databaseStat.isSymbolicLink() || !databaseStat.isFile()) throw new Error('replica outbox database must be a regular file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.db = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    this.key = Buffer.from(options.key);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;');
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0;
    if (version !== 0 && version !== OUTBOX_SCHEMA) {
      this.db.close();
      this.key.fill(0);
      throw new Error('unsupported replica outbox schema version');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS replica_outbox (
        local_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        envelope TEXT NOT NULL,
        UNIQUE(account_id, workspace_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS replica_acknowledgements (
        account_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        server_sequence INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        PRIMARY KEY(account_id, workspace_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS native_source_snapshots (
        account_id TEXT NOT NULL, workspace_id TEXT NOT NULL, permission_fence TEXT NOT NULL,
        native_id TEXT NOT NULL, envelope TEXT NOT NULL,
        PRIMARY KEY(account_id,workspace_id,permission_fence,native_id)
      );
      CREATE TABLE IF NOT EXISTS native_exact_receipts (
        account_id TEXT NOT NULL, workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, envelope TEXT NOT NULL,
        PRIMARY KEY(account_id,workspace_id,operation_id)
      );
      CREATE TABLE IF NOT EXISTS native_creation_attempts (
        account_id TEXT NOT NULL, workspace_id TEXT NOT NULL, attempt_digest TEXT NOT NULL,
        operation_id TEXT NOT NULL, envelope TEXT NOT NULL,
        PRIMARY KEY(account_id,workspace_id,attempt_digest)
      );
    `);
    if (version === 0) this.db.exec(`PRAGMA user_version=${OUTBOX_SCHEMA}`);
  }

  enqueue(operation: ReplicaOperation): void {
    this.assertOpen();
    validateReplicaOperation(operation);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.insertQueuedOperation(operation);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
  }

  /** Recover only this exact authored attempt, including after its queue entry was acknowledged. */
  creationAttempt(accountId: string, workspaceId: string, attempt: ReplicaCreationAttempt, input: ReplicaWriteInput): ReplicaOperation | null {
    this.assertOpen();
    validateCreationAttempt(attempt);
    const row = this.db.prepare('SELECT operation_id,envelope FROM native_creation_attempts WHERE account_id=? AND workspace_id=? AND attempt_digest=?')
      .get(accountId, workspaceId, this.attemptDigest(attempt.callerAttemptId)) as { operation_id: string; envelope: string } | undefined;
    if (!row) return null;
    const value = JSON.parse(decryptBytes(this.key, JSON.parse(row.envelope)).toString('utf8')) as { attempt: ReplicaCreationAttempt; operation: ReplicaOperation };
    validateReplicaOperation(value.operation);
    if (value.operation.accountId !== accountId || value.operation.workspaceId !== workspaceId || value.operation.id !== row.operation_id ||
        value.attempt.callerAttemptId !== attempt.callerAttemptId || value.attempt.permissionFence !== attempt.permissionFence ||
        value.attempt.writePermissionFence !== attempt.writePermissionFence || creationPayload(value.operation) !== creationPayload(input)) {
      throw new Error('native Notes creation attempt does not match its original scope or intent');
    }
    return value.operation;
  }

  /** The durable attempt mapping and first queued operation commit in the same transaction. */
  enqueueCreation(operation: ReplicaOperation, attempt: ReplicaCreationAttempt): ReplicaOperation {
    this.assertOpen();
    validateReplicaOperation(operation);
    validateCreationAttempt(attempt);
    if (operation.category !== 'notes' || operation.expectedRevision !== null || operation.changes.length !== 1 ||
        operation.changes[0]?.path !== `notes/${operation.nativeId}.md` || typeof operation.changes[0]?.content !== 'string') {
      throw new Error('native creation attempt requires a canonical Notes creation operation');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.creationAttempt(operation.accountId, operation.workspaceId, attempt, operation);
      if (existing) {
        this.db.exec('COMMIT');
        return existing;
      }
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM native_creation_attempts WHERE account_id=? AND workspace_id=?')
        .get(operation.accountId, operation.workspaceId) as { count: number };
      const serialized = JSON.stringify({ attempt, operation });
      // Never evict accepted unknown-result attempts: a full scope rejects new intent atomically.
      if (count.count >= MAX_CREATION_ATTEMPTS || Buffer.byteLength(serialized, 'utf8') > MAX_CREATION_ATTEMPT_BYTES) {
        throw new Error('native Notes creation attempt custody limit reached');
      }
      this.insertQueuedOperation(operation);
      const envelope = encryptBytes(this.key, Buffer.from(serialized, 'utf8'));
      this.db.prepare('INSERT INTO native_creation_attempts(account_id,workspace_id,attempt_digest,operation_id,envelope) VALUES(?,?,?,?,?)')
        .run(operation.accountId, operation.workspaceId, this.attemptDigest(attempt.callerAttemptId), operation.id, JSON.stringify(envelope));
      this.db.exec('COMMIT');
      return operation;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
  }

  pending(accountId: string, workspaceId: string): ReplicaOperation[] {
    this.assertOpen();
    const rows = this.db.prepare('SELECT account_id,workspace_id,operation_id,payload_digest,envelope FROM replica_outbox WHERE account_id=? AND workspace_id=? ORDER BY local_sequence')
      .all(accountId, workspaceId) as Array<{ account_id: string; workspace_id: string; operation_id: string; payload_digest: string; envelope: string }>;
    return rows.map((row) => {
      const operation = JSON.parse(decryptBytes(this.key, JSON.parse(row.envelope) as ReplicaEnvelope).toString('utf8')) as ReplicaOperation;
      if (operation.accountId !== row.account_id || operation.workspaceId !== row.workspace_id || operation.id !== row.operation_id || createHmac('sha256', this.key).update(JSON.stringify(operation)).digest('hex') !== row.payload_digest) {
        throw new Error('replica outbox integrity check failed');
      }
      return operation;
    });
  }

  /** Call only with a validated receipt returned after the durable native-journal commit. */
  acknowledge(accountId: string, workspaceId: string, operationId: string, acknowledgement: Omit<ReplicaServerAcknowledgement, 'operationId'>): boolean {
    this.assertOpen();
    if (!Number.isSafeInteger(acknowledgement.serverSequence) || acknowledgement.serverSequence < 1 || !Number.isSafeInteger(acknowledgement.revision) || acknowledgement.revision < 1) {
      throw new Error('invalid replica server acknowledgement');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const pending = this.db.prepare('SELECT 1 AS present FROM replica_outbox WHERE account_id=? AND workspace_id=? AND operation_id=?')
        .get(accountId, workspaceId, operationId);
      if (!pending) {
        const previous = this.acknowledgement(accountId, workspaceId, operationId);
        if (!previous) {
          this.db.exec('COMMIT');
          return false;
        }
        if (previous.serverSequence !== acknowledgement.serverSequence || previous.revision !== acknowledgement.revision) {
          throw new Error('replica acknowledgement changed for an accepted operation');
        }
        this.db.exec('COMMIT');
        return true;
      }
      this.db.prepare('INSERT INTO replica_acknowledgements(account_id,workspace_id,operation_id,server_sequence,revision) VALUES(?,?,?,?,?)')
        .run(accountId, workspaceId, operationId, acknowledgement.serverSequence, acknowledgement.revision);
      this.db.prepare('DELETE FROM replica_outbox WHERE account_id=? AND workspace_id=? AND operation_id=?')
        .run(accountId, workspaceId, operationId);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
  }

  acknowledgement(accountId: string, workspaceId: string, operationId: string): ReplicaServerAcknowledgement | null {
    this.assertOpen();
    const row = this.db.prepare('SELECT server_sequence,revision FROM replica_acknowledgements WHERE account_id=? AND workspace_id=? AND operation_id=?')
      .get(accountId, workspaceId, operationId) as { server_sequence: number; revision: number } | undefined;
    return row ? { operationId, serverSequence: row.server_sequence, revision: row.revision } : null;
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.key.fill(0);
    this.closed = true;
  }

  cacheSnapshot(scope: ReplicaSnapshotScope, snapshot: NativeDataEntitySnapshot): void {
    this.assertOpen();
    if (!scope.accountId || !scope.permissionFence || snapshot.workspaceId !== scope.workspaceId || snapshot.kind !== 'notes') {
      throw new Error('native snapshot scope mismatch');
    }
    const envelope = encryptBytes(this.key, Buffer.from(JSON.stringify({ scope, snapshot }), 'utf8'));
    this.db.prepare('INSERT OR REPLACE INTO native_source_snapshots(account_id,workspace_id,permission_fence,native_id,envelope) VALUES(?,?,?,?,?)')
      .run(scope.accountId, scope.workspaceId, scope.permissionFence, snapshot.nativeId, JSON.stringify(envelope));
  }

  readSnapshot(scope: ReplicaSnapshotScope, nativeId: string): NativeDataEntitySnapshot | null {
    this.assertOpen();
    const row = this.db.prepare('SELECT envelope FROM native_source_snapshots WHERE account_id=? AND workspace_id=? AND permission_fence=? AND native_id=?')
      .get(scope.accountId, scope.workspaceId, scope.permissionFence, nativeId) as { envelope: string } | undefined;
    if (!row) return null;
    const value = JSON.parse(decryptBytes(this.key, JSON.parse(row.envelope)).toString('utf8')) as { scope: ReplicaSnapshotScope; snapshot: NativeDataEntitySnapshot };
    if (value.scope.accountId !== scope.accountId || value.scope.workspaceId !== scope.workspaceId || value.scope.permissionFence !== scope.permissionFence ||
        value.snapshot.workspaceId !== scope.workspaceId || value.snapshot.nativeId !== nativeId || value.snapshot.kind !== 'notes') {
      throw new Error('native snapshot integrity check failed');
    }
    return value.snapshot;
  }

  invalidateSnapshots(scope: ReplicaSnapshotScope): void {
    this.assertOpen();
    this.db.prepare('DELETE FROM native_source_snapshots WHERE account_id=? AND workspace_id=? AND permission_fence=?')
      .run(scope.accountId, scope.workspaceId, scope.permissionFence);
  }

  cacheReceipt(accountId: string, receipt: NativeDataReceipt): void {
    this.assertOpen();
    const envelope = encryptBytes(this.key, Buffer.from(JSON.stringify({ accountId, receipt }), 'utf8'));
    this.db.prepare('INSERT OR REPLACE INTO native_exact_receipts(account_id,workspace_id,operation_id,envelope) VALUES(?,?,?,?)')
      .run(accountId, receipt.workspaceId, receipt.operationId, JSON.stringify(envelope));
  }

  readReceipt(accountId: string, workspaceId: string, operationId: string): NativeDataReceipt | null {
    this.assertOpen();
    const row = this.db.prepare('SELECT envelope FROM native_exact_receipts WHERE account_id=? AND workspace_id=? AND operation_id=?')
      .get(accountId, workspaceId, operationId) as { envelope: string } | undefined;
    if (!row) return null;
    const value = JSON.parse(decryptBytes(this.key, JSON.parse(row.envelope)).toString('utf8')) as { accountId: string; receipt: NativeDataReceipt };
    if (value.accountId !== accountId || value.receipt.workspaceId !== workspaceId || value.receipt.operationId !== operationId) throw new Error('native receipt integrity check failed');
    return value.receipt;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('replica outbox is closed');
  }

  private attemptDigest(callerAttemptId: string): string {
    return createHmac('sha256', this.key).update(callerAttemptId).digest('hex');
  }

  private insertQueuedOperation(operation: ReplicaOperation): void {
    const serialized = JSON.stringify(operation);
    const payloadDigest = createHmac('sha256', this.key).update(serialized).digest('hex');
    const existing = this.db.prepare('SELECT payload_digest FROM replica_outbox WHERE account_id=? AND workspace_id=? AND operation_id=?')
      .get(operation.accountId, operation.workspaceId, operation.id) as { payload_digest: string } | undefined;
    if (existing) {
      if (existing.payload_digest !== payloadDigest) throw new Error('replica operation id reused with different payload');
      return;
    }
    if (this.acknowledgement(operation.accountId, operation.workspaceId, operation.id)) throw new Error('replica operation has already been acknowledged');
    const envelope = JSON.stringify(encryptBytes(this.key, Buffer.from(serialized, 'utf8')));
    this.db.prepare('INSERT INTO replica_outbox(account_id,workspace_id,operation_id,payload_digest,envelope) VALUES(?,?,?,?,?)')
      .run(operation.accountId, operation.workspaceId, operation.id, payloadDigest, envelope);
  }
}

function validateCreationAttempt(attempt: ReplicaCreationAttempt): void {
  if (typeof attempt?.callerAttemptId !== 'string' || !attempt.callerAttemptId || attempt.callerAttemptId.length > 512 ||
      /[\u0000-\u001f]/.test(attempt.callerAttemptId) || !/^[a-f0-9]{64}$/.test(attempt.permissionFence) ||
      !/^[a-f0-9]{64}$/.test(attempt.writePermissionFence)) throw new Error('invalid native Notes creation attempt');
}

function creationPayload(input: ReplicaWriteInput): string {
  return JSON.stringify({ deviceId: input.deviceId, workspaceId: input.workspaceId, category: input.category,
    nativeId: input.nativeId, expectedRevision: input.expectedRevision, schemaVersion: input.schemaVersion,
    changes: input.changes.map(({ path, content }) => ({ path, content })) });
}

export function validateReplicaOperation(operation: ReplicaOperation): void {
  const identity = [operation?.id, operation?.accountId, operation?.workspaceId, operation?.deviceId, operation?.nativeId];
  const safeIdentity = identity.every((value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value));
  const validRevision = operation?.expectedRevision === null ||
    (Number.isSafeInteger(operation?.expectedRevision) && (operation.expectedRevision as number) >= 1);
  const paths = new Set<string>();
  const validChanges = Array.isArray(operation?.changes) && operation.changes.length > 0 && operation.changes.length <= 256 &&
    operation.changes.every((change) => {
      if (typeof change?.path !== 'string' || change.path.length > 4096 || change.path.startsWith('/') ||
          change.path.includes('\\') || change.path.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
          !change.path.startsWith(`${operation.category}/`) ||
          change.path.split('/').some((segment) => /^(credentials|cookies|passkeys)$/i.test(segment)) ||
          (change.content !== null && typeof change.content !== 'string') || paths.has(change.path)) return false;
      paths.add(change.path);
      return true;
    });
  if (!operation || !safeIdentity || !Number.isSafeInteger(operation.seq) || operation.seq < 0 ||
      !Number.isFinite(operation.ts) || !isReplicaCategory(operation.category) || !validRevision ||
      operation.schemaVersion !== 1 || !validChanges) {
    throw new Error('invalid replica operation');
  }
}
