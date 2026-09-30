import type { NativeDataContext, NativeDataEntitySnapshot, NativeDataReceipt } from './dto.ts'
import type { ReplicaFileChange, ReplicaOperation } from '../account-replica/types.ts'

export const NATIVE_REPLICA_IPC = {
  OPEN: '__nativeReplica:open',
  ENQUEUE: '__nativeReplica:enqueue',
  PENDING: '__nativeReplica:pending',
  ACKNOWLEDGE: '__nativeReplica:acknowledge',
  CLOSE: '__nativeReplica:close',
  CACHE_SNAPSHOT: '__nativeReplica:cacheSnapshot',
  READ_SNAPSHOT: '__nativeReplica:readSnapshot',
} as const

export function isNativeReplicaNetworkLoss(state: { status: string; lastError?: { kind: string }; lastClose?: { code?: number } }): boolean {
  if (state.lastError?.kind === 'auth' || state.lastError?.kind === 'protocol') return false
  return ['reconnecting', 'disconnected', 'failed'].includes(state.status) &&
    (state.lastError?.kind === 'network' || state.lastError?.kind === 'timeout' || (!state.lastError && state.lastClose?.code === 1006))
}

/** Main IPC input received only from the preload-owned authenticated RPC wrapper. */
export interface NativeReplicaOpenIpcInput {
  context: NativeDataContext
}

export interface NativeReplicaSessionIpcInput {
  handle: string
  invalidateSnapshots?: boolean
}

export interface NativeReplicaCacheSnapshotIpcInput extends NativeReplicaSessionIpcInput {
  snapshot: NativeDataEntitySnapshot
}

export interface NativeReplicaReadSnapshotIpcInput extends NativeReplicaSessionIpcInput {
  nativeId: string
}

export interface NativeReplicaEnqueueIpcInput extends NativeReplicaSessionIpcInput {
  mutation: NativeReplicaMutation
}

export interface NativeReplicaAcknowledgeIpcInput extends NativeReplicaSessionIpcInput {
  receipt: NativeDataReceipt
}

/** A mutation to persist in the device-bound encrypted queue before an RPC attempt. */
export interface NativeReplicaMutation {
  nativeId: string
  expectedRevision: number | null
  schemaVersion: 1
  changes: ReplicaFileChange[]
}

/** Public mutation returned by enqueue with the stable id reused on all server retries. */
export interface NativeReplicaQueuedMutation extends NativeReplicaMutation {
  workspaceId: string
  kind: 'notes'
  operationId: string
}

export interface NativeReplicaPublicApi {
  open(workspaceId: string): Promise<string>
  enqueue(handle: string, mutation: NativeReplicaMutation): Promise<NativeReplicaQueuedMutation>
  pending(handle: string): Promise<NativeReplicaQueuedMutation[]>
  acknowledge(handle: string, receipt: NativeDataReceipt): Promise<boolean>
  close(handle: string): Promise<void>
  readSnapshot(handle: string, nativeId: string): Promise<NativeDataEntitySnapshot | null>
}

/** Narrow internal result to avoid exposing local account/device keys or identifiers to the renderer. */
export function queuedMutationFromOperation(operation: ReplicaOperation): NativeReplicaQueuedMutation {
  if (operation.category !== 'notes') throw new Error('only Notes operations can use the native replica transport')
  return {
    workspaceId: operation.workspaceId,
    kind: 'notes',
    operationId: operation.id,
    nativeId: operation.nativeId,
    expectedRevision: operation.expectedRevision,
    schemaVersion: 1,
    changes: operation.changes.map(({ path, content }) => ({ path, content })),
  }
}

/** A receipt is accepted only for the exact queued entity, account, and next revision. */
export async function acknowledgementFromReceipt(
  operation: ReplicaOperation,
  receipt: NativeDataReceipt,
  context: NativeDataContext,
): Promise<{ serverSequence: number; revision: number }> {
  const sha256 = async (value: string) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  const change = operation.changes[0]
  const expectedHash = change && operation.changes.length === 1
    ? await sha256(JSON.stringify(change.content === null ? [] : [[change.path, await sha256(change.content)]]))
    : null
  if (!context.issuer || !context.subject || !context.workspaceId || !context.permissionFence ||
      operation.category !== 'notes' ||
      receipt.issuer !== context.issuer || receipt.subject !== context.subject ||
      receipt.workspaceId !== context.workspaceId || operation.workspaceId !== context.workspaceId ||
      receipt.kind !== 'notes' || receipt.nativeId !== operation.nativeId || receipt.operationId !== operation.id ||
      !Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1 ||
      !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 ||
      !/^[a-f0-9]{64}$/.test(receipt.contentHash) ||
      expectedHash === null || receipt.contentHash !== expectedHash || receipt.deleted !== (change?.content === null) ||
      receipt.revision !== (operation.expectedRevision ?? 0) + 1) {
    throw new Error('native replica receipt does not match the queued mutation')
  }
  return { serverSequence: receipt.sequence, revision: receipt.revision }
}
