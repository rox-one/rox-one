/**
 * In-memory encrypted replica engine for notes/tasks/sessions/settings.
 * Server-side membership is required for every workspace-scoped op.
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
  type ReplicaOpType,
  type ReplicaSnapshot,
} from './types.ts';

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
  private readonly offline: ReplicaOperation[] = [];
  private readonly controls = { ...DEFAULT_CONTROLS };
  private deletion: DeletionReceipt | null = null;

  constructor(
    readonly accountId: string,
    recoverySecret: string,
    wrapSalt = Buffer.from(`rox-replica:${accountId}`),
  ) {
    this.wrapSalt = wrapSalt;
    this.accountKey = generateAccountKey();
    this.recoveryWrap = wrapAccountKey(this.accountKey, recoverySecret, wrapSalt);
  }

  bindWorkspace(workspaceId: string, accountId = this.accountId): void {
    const members = this.membership.get(workspaceId) ?? new Set();
    members.add(accountId);
    this.membership.set(workspaceId, members);
  }

  assertMembership(accountId: string, workspaceId: string): void {
    if (!this.membership.get(workspaceId)?.has(accountId)) {
      throw new ReplicaTenancyError();
    }
  }

  enrollDevice(deviceId: string, deviceSecret: string): ReplicaDevice {
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
    const device = this.devices.get(deviceId);
    if (!device) return;
    device.revokedAt = Date.now();
  }

  rotateAccountKey(recoverySecret: string, deviceSecrets: Record<string, string>): void {
    const next = generateAccountKey();
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
    return unwrapAccountKey(this.recoveryWrap, recoverySecret, this.wrapSalt);
  }

  openDevice(deviceId: string, deviceSecret: string): Buffer {
    const device = this.devices.get(deviceId);
    if (!device || device.revokedAt) {
      throw new Error('device is not enrolled');
    }
    return unwrapAccountKey(JSON.parse(device.wrappedAccountKey) as ReplicaEnvelope, deviceSecret, this.wrapSalt);
  }

  setCategoryControl(category: ReplicaCategory, replica: boolean, realtimeSync: boolean): void {
    this.controls[category] = { replica, realtimeSync: replica && realtimeSync };
  }

  categoryStates(): ReplicaCategoryControl[] {
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

  append(
    input: {
      deviceId: string;
      workspaceId: string;
      category: string;
      type: ReplicaOpType;
      path: string;
      body?: string;
    },
    key = this.accountKey,
  ): ReplicaOperation {
    if (isExcludedReplicaCategory(input.category) || !isReplicaCategory(input.category)) {
      throw new ReplicaCategoryError();
    }
    this.assertMembership(this.accountId, input.workspaceId);
    if (!this.controls[input.category].replica) {
      throw new ReplicaCategoryError(`category ${input.category} is paused`);
    }
    const device = this.devices.get(input.deviceId);
    if (!device || device.revokedAt) throw new Error('device is not enrolled');
    this.seq += 1;
    const op: ReplicaOperation = {
      id: randomUUID(),
      seq: this.seq,
      ts: Date.now(),
      deviceId: input.deviceId,
      accountId: this.accountId,
      workspaceId: input.workspaceId,
      category: input.category,
      type: input.type,
      path: input.path,
      body: input.body,
    };
    this.ops.push({ seq: op.seq, envelope: encryptBytes(key, Buffer.from(JSON.stringify(op), 'utf8')) });
    return op;
  }

  enqueueOffline(op: Omit<ReplicaOperation, 'id' | 'seq'>): void {
    this.offline.push({ ...op, id: randomUUID(), seq: 0 });
  }

  flushOffline(): ReplicaOperation[] {
    const flushed: ReplicaOperation[] = [];
    while (this.offline.length > 0) {
      const pending = this.offline.shift()!;
      flushed.push(
        this.append({
          deviceId: pending.deviceId,
          workspaceId: pending.workspaceId,
          category: pending.category,
          type: pending.type,
          path: pending.path,
          body: pending.body,
        }),
      );
    }
    return flushed;
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
    if (!this.deletion) throw new Error('no deletion requested');
    this.ops.length = 0;
    this.seq = 0;
    this.deletion = { ...this.deletion, status: 'completed', completedAt: Date.now() };
    return this.deletion;
  }

  deletionReceipt(): DeletionReceipt | null {
    return this.deletion;
  }

  materialize(workspaceId: string, key = this.accountKey): Map<string, string> {
    const docs = new Map<string, string>();
    for (const op of this.decryptOps(key).filter((row) => opWorkspace(row, workspaceId))) {
      const docKey = `${op.category}:${op.path}`;
      if (op.type === 'delete') docs.delete(docKey);
      else if (op.body !== undefined) docs.set(docKey, op.body);
    }
    return docs;
  }

  private decryptOps(key: Buffer): ReplicaOperation[] {
    return this.ops.map((stored) => JSON.parse(decryptBytes(key, stored.envelope).toString('utf8')) as ReplicaOperation);
  }
}

function opWorkspace(op: ReplicaOperation, workspaceId: string): boolean {
  return op.workspaceId === workspaceId;
}

export function mergeLww(localTs: number, local: string, remoteTs: number, remote: string): MergeResult {
  if (local === remote) return { value: local };
  return localTs >= remoteTs ? { value: local } : { value: remote };
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
