/**
 * Encrypted account replica (Rox tracker issue 27).
 *
 * Allowed journal categories: notes, tasks, sessions, settings.
 * Credentials, cookies and passkeys never enter the replica.
 * DG-01 consent lives in `privacy/` — this replica never records legal or training purposes.
 */

export const REPLICA_CATEGORIES = ['notes', 'tasks', 'sessions', 'settings'] as const;
export type ReplicaCategory = (typeof REPLICA_CATEGORIES)[number];

export const EXCLUDED_REPLICA_CATEGORIES = ['credentials', 'cookies', 'passkeys'] as const;
export type ExcludedReplicaCategory = (typeof EXCLUDED_REPLICA_CATEGORIES)[number];

export type ReplicaCategoryState = 'included' | 'paused' | 'excluded';

export interface ReplicaCategoryControl {
  category: ReplicaCategory | ExcludedReplicaCategory;
  state: ReplicaCategoryState;
  replica: boolean;
  realtimeSync: boolean;
}

export interface ReplicaMembership {
  accountId: string;
  workspaceId: string;
}

export interface ReplicaDevice {
  id: string;
  accountId: string;
  enrolledAt: number;
  revokedAt?: number;
  wrappedAccountKey: string;
}

export interface ReplicaEnvelope {
  iv: string;
  tag: string;
  ciphertext: string;
}

export type ReplicaOpType = 'put' | 'delete';

export interface ReplicaOperation {
  id: string;
  seq: number;
  ts: number;
  deviceId: string;
  accountId: string;
  workspaceId: string;
  category: ReplicaCategory;
  type: ReplicaOpType;
  path: string;
  body?: string;
}

export interface ReplicaSnapshot {
  accountId: string;
  workspaceId: string;
  seq: number;
  createdAt: number;
  items: ReplicaOperation[];
}

export interface MarkdownConflict {
  path: string;
  local: string;
  remote: string;
}

export interface MergeResult {
  value: string;
  conflict?: MarkdownConflict;
}

export interface DeletionReceipt {
  id: string;
  accountId: string;
  workspaceId: string;
  status: 'queued' | 'completed';
  requestedAt: number;
  completedAt?: number;
}

export const REPLICA_STATUS_COPY = {
  queued: 'accountReplica.deletionQueued',
  completed: 'accountReplica.deletionComplete',
} as const;

export function isReplicaCategory(value: string): value is ReplicaCategory {
  return (REPLICA_CATEGORIES as readonly string[]).includes(value);
}

export function isExcludedReplicaCategory(value: string): value is ExcludedReplicaCategory {
  return (EXCLUDED_REPLICA_CATEGORIES as readonly string[]).includes(value);
}
