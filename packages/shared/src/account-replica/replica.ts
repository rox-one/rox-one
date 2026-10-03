/**
 * Local replica view with an encrypted operation log and an explicitly supplied durable offline outbox.
 * Server authorization and durable acknowledgement remain the responsibility of the sync boundary.
 */
import { randomUUID } from 'node:crypto';
import {
  decryptBytes,
  encryptBytes,
  generateAccountKey,
  unwrapAccountKey,
  wrapAccountKey,
} from './crypto.ts';
import {
  EXCLUDED_REPLICA_CATEGORIES,
  REPLICA_CATEGORIES,
  isExcludedReplicaCategory,
  isReplicaCategory,
  type DeletionReceipt,
  type MarkdownConflict,
  type MergeResult,
  type ReplicaCategory,
  type ReplicaCategoryControl,
  type ReplicaDevice,
  type ReplicaEnvelope,
  type ReplicaOperation,
  type ReplicaSnapshot,
  type ReplicaWriteInput,
} from './types.ts';
import { validateReplicaOperation, type ReplicaOutboxPort, type ReplicaServerAcknowledgement } from './outbox.ts';

export class ReplicaTenancyError extends Error {
  constructor(message = 'workspace is not bound to this account') {
    super(message);
    this.name = 'ReplicaTenancyError';
  }
}

export class ReplicaCategoryError extends Error {
  constructor(message = 'category is excluded from the account replica') {
    super(message);
    this.name = 'ReplicaCategoryError';
  }
}

interface StoredOp {
  seq: number;
  envelope: ReplicaEnvelope;
}

const DEFAULT_CONTROLS: Record<ReplicaCategory, { replica: boolean; realtimeSync: boolean }> = {
  notes: { replica: true, realtimeSync: false },
  tasks: { replica: true, realtimeSync: false },
  sessions: { replica: true, realtimeSync: false },
  settings: { replica: true, realtimeSync: false },
};

export class AccountReplica {
  private readonly membership = new Map<string, Set<string>>();
  private readonly devices = new Map<string, ReplicaDevice>();
  private readonly wrapSalt: Buffer;
  private accountKey: Buffer;
  private recoveryWrap: ReplicaEnvelope;
  private seq = 0;
  private readonly ops: StoredOp[] = [];
  private readonly controls = { ...DEFAULT_CONTROLS };
  private deletion: DeletionReceipt | null = null;
  private destroyed = false;

  constructor(
    readonly accountId: string,
    recoverySecret: string,
    wrapSalt = Buffer.from(`rox-replica:${accountId}`),
    private readonly outbox?: ReplicaOutboxPort,
    restoredAccountKey?: Buffer,
  ) {
    if (restoredAccountKey && (!Buffer.isBuffer(restoredAccountKey) || restoredAccountKey.length !== 32)) {
      throw new Error('restored replica account key must be 32 bytes');
    }
    this.wrapSalt = Buffer.from(wrapSalt);
    this.accountKey = restoredAccountKey ? Buffer.from(restoredAccountKey) : generateAccountKey();
    this.recoveryWrap = wrapAccountKey(this.accountKey, recoverySecret, wrapSalt);
  }


  bindWorkspace(workspaceId: string, accountId = this.accountId): void {
    this.assertOpen();
    const members = this.membership.get(workspaceId) ?? new Set();
    members.add(accountId);
    this.membership.set(workspaceId, members);
  }

  assertMembership(accountId: string, workspaceId: string): void {
    this.assertOpen();
    if (!this.membership.get(workspaceId)?.has(accountId)) {
      throw new ReplicaTenancyError();
    }
  }

  enrollDevice(deviceId: string, deviceSecret: string): ReplicaDevice {
    this.assertOpen();
    const device: ReplicaDevice = {
      id: deviceId,
      accountId: this.accountId,
      enrolledAt: Date.now(),
      wrappedAccountKey: JSON.stringify(wrapAccountKey(this.accountKey, deviceSecret, this.wrapSalt)),
    };
    this.devices.set(deviceId, device);
    return device;
  }

  revokeDevice(deviceId: string): void {
    this.assertOpen();
    const device = this.devices.get(deviceId);
    if (!device) return;
    device.revokedAt = Date.now();
  }

  rotateAccountKey(recoverySecret: string, deviceSecrets: Record<string, string>): void {
    this.assertOpen();
    const next = generateAccountKey();
    this.accountKey.fill(0);
    this.accountKey = next;
    this.recoveryWrap = wrapAccountKey(next, recoverySecret, this.wrapSalt);
    for (const device of this.devices.values()) {
      if (device.revokedAt) continue;
      const secret = deviceSecrets[device.id];
      if (!secret) continue;
      device.wrappedAccountKey = JSON.stringify(wrapAccountKey(next, secret, this.wrapSalt));
    }
  }

  recoverAccountKey(recoverySecret: string): Buffer {
    this.assertOpen();
    return unwrapAccountKey(this.recoveryWrap, recoverySecret, this.wrapSalt);
  }

  openDevice(deviceId: string, deviceSecret: string): Buffer {
    this.assertOpen();
    const device = this.devices.get(deviceId);
    if (!device || device.revokedAt) {
      throw new Error('device is not enrolled');
    }
    return unwrapAccountKey(JSON.parse(device.wrappedAccountKey) as ReplicaEnvelope, deviceSecret, this.wrapSalt);
  }

  setCategoryControl(category: ReplicaCategory, replica: boolean, realtimeSync: boolean): void {
    this.assertOpen();
    this.controls[category] = { replica, realtimeSync: replica && realtimeSync };
  }

  categoryStates(): ReplicaCategoryControl[] {
    this.assertOpen();
    const allowed: ReplicaCategoryControl[] = REPLICA_CATEGORIES.map((category) => ({
      category,
      replica: this.controls[category].replica,
      realtimeSync: this.controls[category].realtimeSync,
      state: this.controls[category].replica ? 'included' : 'paused',
    }));
    const excluded: ReplicaCategoryControl[] = EXCLUDED_REPLICA_CATEGORIES.map((category) => ({
      category,
      replica: false,
      realtimeSync: false,
      state: 'excluded' as const,
    }));
    return [...allowed, ...excluded];
  }

  append(input: ReplicaWriteInput, key = this.accountKey): ReplicaOperation {
    if (isExcludedReplicaCategory(input.category) || !isReplicaCategory(input.category)) {
      throw new ReplicaCategoryError();
    }
    this.assertMembership(this.accountId, input.workspaceId);
    if (!this.controls[input.category].replica) {
      throw new ReplicaCategoryError(`category ${input.category} is paused`);
    }
    const device = this.devices.get(input.deviceId);
    if (!device || device.revokedAt || device.accountId !== this.accountId) throw new Error('device is not enrolled');
    const nextSequence = this.seq + 1;
    const op: ReplicaOperation = {
      ...input,
      id: randomUUID(),
      seq: nextSequence,
      ts: Date.now(),
      accountId: this.accountId,
    };
    validateReplicaOperation(op);
    this.seq = nextSequence;
    this.ops.push({ seq: op.seq, envelope: encryptBytes(key, Buffer.from(JSON.stringify(op), 'utf8')) });
    return op;
  }

  enqueueOffline(input: ReplicaWriteInput): ReplicaOperation {
    if (!this.outbox) throw new Error('durable replica outbox is required for offline writes');
    if (isExcludedReplicaCategory(input.category) || !isReplicaCategory(input.category)) {
      throw new ReplicaCategoryError();
    }
    this.assertMembership(this.accountId, input.workspaceId);
    if (!this.controls[input.category].replica) {
      throw new ReplicaCategoryError(`category ${input.category} is paused`);
    }
    const device = this.devices.get(input.deviceId);
    if (!device || device.revokedAt || device.accountId !== this.accountId) throw new Error('device is not enrolled');
    const op: ReplicaOperation = {
      ...input, accountId: this.accountId, id: randomUUID(), seq: 0, ts: Date.now(),
    };
    validateReplicaOperation(op);
    this.outbox.enqueue(op);
    return op;
  }

  pendingOffline(workspaceId: string): ReplicaOperation[] {
    if (!this.outbox) throw new Error('durable replica outbox is required for offline writes');
    this.assertMembership(this.accountId, workspaceId);
    return this.outbox.pending(this.accountId, workspaceId);
  }

  acknowledgeOffline(workspaceId: string, operationId: string, acknowledgement: Omit<ReplicaServerAcknowledgement, 'operationId'>): boolean {
    if (!this.outbox) throw new Error('durable replica outbox is required for offline writes');
    this.assertMembership(this.accountId, workspaceId);
    return this.outbox.acknowledge(this.accountId, workspaceId, operationId, acknowledgement);
  }

  snapshot(workspaceId: string, key = this.accountKey): ReplicaSnapshot {
    this.assertMembership(this.accountId, workspaceId);
    return {
      accountId: this.accountId,
      workspaceId,
      seq: this.seq,
      createdAt: Date.now(),
      items: this.decryptOps(key).filter((op) => op.workspaceId === workspaceId),
    };
  }

  incremental(workspaceId: string, sinceSeq: number, key = this.accountKey): ReplicaOperation[] {
    this.assertMembership(this.accountId, workspaceId);
    return this.decryptOps(key).filter((op) => op.workspaceId === workspaceId && op.seq > sinceSeq);
  }

  exportBundle(workspaceId: string, key = this.accountKey): ReplicaSnapshot {
    return this.snapshot(workspaceId, key);
  }

  requestDeletion(workspaceId: string): DeletionReceipt {
    this.assertMembership(this.accountId, workspaceId);
    this.deletion = {
      id: randomUUID(),
      accountId: this.accountId,
      workspaceId,
      status: 'queued',
      requestedAt: Date.now(),
    };
    return this.deletion;
  }

  completeDeletion(): DeletionReceipt {
    this.assertOpen();
    if (!this.deletion) throw new Error('no deletion requested');
    this.ops.length = 0;
    this.seq = 0;
    this.deletion = { ...this.deletion, status: 'completed', completedAt: Date.now() };
    return this.deletion;
  }

  deletionReceipt(): DeletionReceipt | null {
    this.assertOpen();
    return this.deletion;
  }

  materialize(workspaceId: string, key = this.accountKey): Map<string, string> {
    this.assertMembership(this.accountId, workspaceId);
    const docs = new Map<string, string>();
    for (const op of this.decryptOps(key).filter((row) => opWorkspace(row, workspaceId))) {
      for (const change of op.changes) {
        const docKey = `${op.category}:${change.path}`;
        if (change.content === null) docs.delete(docKey);
        else docs.set(docKey, change.content);
      }
    }
    return docs;
  }

  private decryptOps(key: Buffer): ReplicaOperation[] {
    this.assertOpen();
    return this.ops.map((stored) => JSON.parse(decryptBytes(key, stored.envelope).toString('utf8')) as ReplicaOperation);
  }

  /** End this in-memory custody session without deleting its durable outbox. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.accountKey.fill(0);
    this.wrapSalt.fill(0);
    this.recoveryWrap = { iv: '', tag: '', ciphertext: '' };
    this.membership.clear();
    this.devices.clear();
    this.ops.length = 0;
    this.seq = 0;
    this.deletion = null;
  }

  private assertOpen(): void {
    if (this.destroyed) throw new Error('account replica has been destroyed');
  }
}

function opWorkspace(op: ReplicaOperation, workspaceId: string): boolean {
  return op.workspaceId === workspaceId;
}

export function mergeLww(localTs: number, local: string, remoteTs: number, remote: string): MergeResult {
  if (local === remote) return { value: local };
  if (localTs !== remoteTs) return localTs > remoteTs ? { value: local } : { value: remote };
  return local < remote ? { value: local } : { value: remote };
}

export function mergeMarkdown(path: string, local: string, remote: string): MergeResult {
  if (local === remote) return { value: local };
  const conflict: MarkdownConflict = { path, local, remote };
  return {
    value: `<<<<<<< local\n${local}\n=======\n${remote}\n>>>>>>> remote\n`,
    conflict,
  };
}

export function defaultCategoryControls(): ReplicaCategoryControl[] {
  return [
    ...REPLICA_CATEGORIES.map((category) => ({
      category,
      replica: true,
      realtimeSync: false,
      state: 'included' as const,
    })),
    ...EXCLUDED_REPLICA_CATEGORIES.map((category) => ({
      category,
      replica: false,
      realtimeSync: false,
      state: 'excluded' as const,
    })),
  ];
}
