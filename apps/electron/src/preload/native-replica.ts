import type { RpcClient } from '@rox/server-core/transport'
import { RPC_CHANNELS, type NativeDataContext, type NativeDataEntitySnapshot, type NativeDataMutationInput, type NativeDataReadEntityInput, type NativeDataReceipt, type NoteCreateOptions, type NoteDocument } from '@rox/shared/protocol'
import { NATIVE_REPLICA_IPC, isNativeReplicaNetworkLoss, type NativeReplicaCreatePlan, type NativeReplicaQueuedMutation, type NativeReplicaPublicApi } from '@rox/shared/protocol/native-replica'
import type { TransportConnectionState } from '../transport/client'

export interface NativeReplicaBridgeDependencies {
  client: Pick<RpcClient, 'invoke'> & { getConnectionState(): TransportConnectionState; onConnectionStateChanged(listener: (state: TransportConnectionState) => void): () => void }
  invokeIpc(channel: string, input: unknown): Promise<any>
}

/** Preload owns authoritative source caching. Renderer callers cannot populate a snapshot. */
export function createNativeReplicaBridge({ client, invokeIpc }: NativeReplicaBridgeDependencies) {
  const contexts = new Map<string, NativeDataContext>()
  const serverReceipts = new Map<string, NativeDataReceipt>()
  let receiptGeneration = 0
  let disposed = false
  const receiptKey = (receipt: Pick<NativeDataReceipt, 'issuer' | 'subject' | 'workspaceId' | 'operationId'>) => JSON.stringify([receipt.issuer, receipt.subject, receipt.workspaceId, receipt.operationId])
  const getContext = (workspaceId: string): Promise<NativeDataContext> => client.invoke(RPC_CHANNELS.nativeData.GET_CONTEXT, { workspaceId })
  const forgetReceipts = (previous: NativeDataContext | undefined) => {
    receiptGeneration++
    if (previous) {
      for (const [key, receipt] of serverReceipts) {
        if (receipt.issuer === previous.issuer && receipt.subject === previous.subject && receipt.workspaceId === previous.workspaceId) serverReceipts.delete(key)
      }
    }
  }
  const invalidate = async (handle: string) => {
    const previous = contexts.get(handle)
    contexts.delete(handle)
    forgetReceipts(previous)
    await invokeIpc(NATIVE_REPLICA_IPC.CLOSE, { handle, invalidateSnapshots: true }).catch(() => {})
  }
  const sameContext = (a: NativeDataContext, b: NativeDataContext) => a.issuer === b.issuer && a.subject === b.subject && a.workspaceId === b.workspaceId && a.permissionFence === b.permissionFence
  const refresh = async (handle: string, allowOffline = false) => {
    const previous = contexts.get(handle)
    if (!previous) throw new Error('native replica session is not open')
    if (allowOffline && isNativeReplicaNetworkLoss(client.getConnectionState())) return
    try {
      const current = await getContext(previous.workspaceId)
      if (!sameContext(current, previous)) throw new Error('native replica permission context changed; reopen the replica')
    } catch (error) {
      if (isNativeReplicaNetworkLoss(client.getConnectionState()) && contexts.get(handle) === previous) {
        if (allowOffline) return
        throw error
      }
      await invalidate(handle)
      throw error
    }
  }
  const unsubscribe = client.onConnectionStateChanged(state => {
    if (state.lastError?.kind === 'auth' || state.lastError?.kind === 'protocol') {
      for (const handle of contexts.keys()) void invalidate(handle)
    }
  })
  const nativeReplica: NativeReplicaPublicApi = {
    open: async workspaceId => {
      if (disposed) throw new Error('native replica bridge has been disposed')
      const openingGeneration = receiptGeneration
      const assertOpening = () => {
        if (disposed || receiptGeneration !== openingGeneration) throw new Error('native replica context changed while opening')
      }
      const context = await getContext(workspaceId)
      assertOpening()
      if (context.workspaceId !== workspaceId) throw new Error('native replica context workspace mismatch')
      const handle = await invokeIpc(NATIVE_REPLICA_IPC.OPEN, { context })
      try {
        assertOpening()
        const current = await getContext(workspaceId)
        assertOpening()
        if (!sameContext(current, context)) throw new Error('native replica permission context changed while opening')
      } catch (error) {
        await invokeIpc(NATIVE_REPLICA_IPC.CLOSE, { handle, invalidateSnapshots: true }).catch(() => {})
        throw error
      }
      contexts.set(handle, context)
      return handle
    },
    enqueue: async (handle, mutation) => {
      await refresh(handle, true)
      return invokeIpc(NATIVE_REPLICA_IPC.ENQUEUE, { handle, mutation })
    },
    pending: async handle => {
      // Submission/replay requires online reauthorization, including after a network outage.
      await refresh(handle)
      return invokeIpc(NATIVE_REPLICA_IPC.PENDING, { handle })
    },
    acknowledge: async (handle, receipt) => {
      await refresh(handle)
      const context = contexts.get(handle)
      const trusted = receipt && serverReceipts.get(receiptKey(receipt))
      if (!context || !trusted || trusted.issuer !== context.issuer || trusted.subject !== context.subject || trusted.workspaceId !== context.workspaceId ||
          Object.keys(trusted).length !== Object.keys(receipt).length || Object.keys(trusted).some(key => trusted[key as keyof NativeDataReceipt] !== receipt[key as keyof NativeDataReceipt])) {
        throw new Error('native replica acknowledgement requires its observed server mutation receipt')
      }
      return invokeIpc(NATIVE_REPLICA_IPC.ACKNOWLEDGE, { handle, receipt: trusted })
    },
    readSnapshot: async (handle, nativeId) => {
      await refresh(handle, true)
      return invokeIpc(NATIVE_REPLICA_IPC.READ_SNAPSHOT, { handle, nativeId })
    },
    close: async handle => {
      const previous = contexts.get(handle)
      contexts.delete(handle)
      forgetReceipts(previous)
      if (!previous) return
      await invokeIpc(NATIVE_REPLICA_IPC.CLOSE, { handle })
    },
  }
  const readEntity = async (input: NativeDataReadEntityInput): Promise<NativeDataEntitySnapshot | null> => {
    const snapshot = await client.invoke(RPC_CHANNELS.nativeData.READ_ENTITY, input) as NativeDataEntitySnapshot | null
    if (snapshot && !snapshot.deleted && snapshot.kind === 'notes' && snapshot.files.length === 1) {
      for (const [handle, context] of contexts) {
        if (context.workspaceId === input.workspaceId) {
          await refresh(handle)
          await invokeIpc(NATIVE_REPLICA_IPC.CACHE_SNAPSHOT, { handle, snapshot })
        }
      }
    }
    return snapshot
  }
  const readNote = async (workspaceId: string, noteId: string): Promise<NoteDocument> => {
    const note = await client.invoke(RPC_CHANNELS.notes.READ, workspaceId, noteId) as NoteDocument
    if (note.nativeId && note.nativeRevision !== undefined) {
      await readEntity({ workspaceId, kind: 'notes', nativeId: note.nativeId })
    }
    return note
  }
  const mutate = async (input: NativeDataMutationInput): Promise<NativeDataReceipt> => {
    const generation = receiptGeneration
    const candidates = [...contexts.entries()].filter(([, context]) => context.workspaceId === input.workspaceId)
    const receipt = await client.invoke(RPC_CHANNELS.nativeData.MUTATE, input) as NativeDataReceipt
    if (!receipt || receipt.workspaceId !== input.workspaceId || receipt.nativeId !== input.nativeId || receipt.kind !== input.kind || receipt.operationId !== input.operationId) {
      throw new Error('native data mutation returned a mismatched server receipt')
    }
    if (!disposed && receiptGeneration === generation && candidates.some(([handle, context]) =>
        contexts.get(handle) === context && context.issuer === receipt.issuer && context.subject === receipt.subject)) {
      serverReceipts.set(receiptKey(receipt), structuredClone(receipt))
      // Keep only a bounded recent exact replay cache; durable custody lives in SQLite.
      while (serverReceipts.size > 128) serverReceipts.delete(serverReceipts.keys().next().value!)
    }
    return receipt
  }
  const createNote = async (workspaceId: string, title: string, folder?: string, operation?: NoteCreateOptions): Promise<NoteDocument> => {
    if (disposed) throw new Error('native replica bridge has been disposed')
    const generation = receiptGeneration
    const assertCreation = () => {
      if (disposed || generation !== receiptGeneration) throw new Error('native Notes creation context changed while planning or submitting')
    }
    const plan = await client.invoke(RPC_CHANNELS.notes.PREPARE_CREATE, workspaceId, title, folder) as NativeReplicaCreatePlan | null
    assertCreation()
    if (plan === null) return client.invoke(RPC_CHANNELS.notes.CREATE, workspaceId, title, folder, operation)
    if (!plan?.context || plan.context.workspaceId !== workspaceId) throw new Error('native Notes creation returned a mismatched context')
    if (operation && (typeof operation.operationId !== 'string' || !operation.operationId || operation.operationId.length > 512 ||
        /[\u0000-\u001f]/.test(operation.operationId) || operation.expectedRevision !== null || operation.schemaVersion !== 1 ||
        (operation.recoverCreation !== undefined && operation.recoverCreation !== true))) {
      throw new Error('native Notes creation requires a valid creation attempt')
    }
    const callerAttemptId = operation?.recoverCreation === true ? operation.operationId : undefined
    const verifyCreationPlan = async () => {
      assertCreation()
      const currentPlan = await client.invoke(RPC_CHANNELS.notes.PREPARE_CREATE, workspaceId, title, folder) as NativeReplicaCreatePlan | null
      assertCreation()
      if (!currentPlan || !sameContext(currentPlan.context, plan.context) || currentPlan.writePermissionFence !== plan.writePermissionFence ||
          JSON.stringify(currentPlan.mutation) !== JSON.stringify(plan.mutation)) throw new Error('native Notes creation authority changed before enqueue or recovery')
    }
    const existing = [...contexts.entries()].find(([, context]) => sameContext(context, plan.context))
    const owned = !existing
    const handle = existing?.[0] ?? await nativeReplica.open(workspaceId)
    try {
      assertCreation()
      await refresh(handle)
      assertCreation()
      await verifyCreationPlan()
      const context = contexts.get(handle)
      if (!context || !sameContext(context, plan.context)) throw new Error('native Notes creation context changed before enqueue')
      const queued = await invokeIpc(NATIVE_REPLICA_IPC.ENQUEUE_CREATE, { handle, plan, callerAttemptId }) as NativeReplicaQueuedMutation
      assertCreation()
      // Only the main-assigned stable operation can be submitted, including after a crash/replay.
      await refresh(handle)
      assertCreation()
      await verifyCreationPlan()
      const receipt = await mutate(queued)
      assertCreation()
      await verifyCreationPlan()
      if (!await nativeReplica.acknowledge(handle, receipt)) throw new Error('native Notes creation remains unacknowledged')
      assertCreation()
      await verifyCreationPlan()
      const note = await readNote(workspaceId, queued.nativeId)
      assertCreation()
      await refresh(handle)
      assertCreation()
      await verifyCreationPlan()
      return note
    } finally {
      if (owned) await nativeReplica.close(handle).catch(() => {})
    }
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    receiptGeneration++
    serverReceipts.clear()
    for (const handle of [...contexts.keys()]) void nativeReplica.close(handle).catch(() => {})
  }
  return { nativeReplica, readEntity, readNote, createNote, mutate, dispose }
}
