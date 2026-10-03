import type { NativeDataEntitySnapshot, NativeDataMutationInput, NativeDataReadEntityInput, NativeDataReceipt, NoteDocument } from '@rox/shared/protocol/dto'
import { isNativeReplicaNetworkLoss, type NativeReplicaPublicApi } from '@rox/shared/protocol/native-replica'

export interface NativeNotesApi {
  nativeReplica: NativeReplicaPublicApi
  nativeData: {
    readEntity(input: NativeDataReadEntityInput): Promise<NativeDataEntitySnapshot | null>
    mutate(input: NativeDataMutationInput): Promise<NativeDataReceipt>
  }
  getTransportConnectionState(): Promise<Parameters<typeof isNativeReplicaNetworkLoss>[0]>
}

// Notes panels may replace their controller while retaining the same preload API.
// Close custody belongs to that API, not to a component/controller instance.
const replicaClosings = new WeakMap<NativeReplicaPublicApi, Promise<void>>()

/** Workspace-scoped durable Notes mutation transport. */
export function createNativeNotesSyncController(api: NativeNotesApi = (globalThis as unknown as { window: { electronAPI: NativeNotesApi } }).window.electronAPI) {
  let workspaceId: string | null = null
  let handle: string | null = null
  let starting: Promise<void> | null = null
  let stopping: Promise<void> | null = null
  let flushing: Promise<NativeDataReceipt[]> | null = null
  let generation = 0
  let lifecycleRequest = 0
  // A draft may follow only receipts from operations queued by this controller.
  // Fresh reads from another writer must never silently rebase the opened draft.
  const draftProgress = new Map<string, { openedRevision: number; acknowledgedRevision: number; operations: Set<string> }>()

  const assertSession = (session: { workspaceId: string; handle: string; generation: number }) => {
    if (session.generation !== generation || session.workspaceId !== workspaceId || session.handle !== handle) {
      throw new Error('Native Notes workspace changed during synchronization')
    }
  }

  const requireSession = async (): Promise<{ workspaceId: string; handle: string; generation: number }> => {
    const start = starting
    if (start) await start
    if (!workspaceId || !handle) throw new Error('Native Notes sync is not open for a workspace')
    return { workspaceId, handle, generation }
  }

  const closeSession = (): Promise<void> => {
    const opening = starting
    const closingHandle = handle
    generation++
    draftProgress.clear()
    workspaceId = null
    handle = null
    starting = null
    const previousClosing = replicaClosings.get(api.nativeReplica)
    const closing = (async () => {
      if (previousClosing) await previousClosing.catch(() => {})
      if (opening) await opening.catch(() => {})
      if (closingHandle) await api.nativeReplica.close(closingHandle)
    })()
    replicaClosings.set(api.nativeReplica, closing)
    const settled = () => { if (replicaClosings.get(api.nativeReplica) === closing) replicaClosings.delete(api.nativeReplica) }
    void closing.then(settled, settled)
    return closing
  }

  return {
    async start(nextWorkspaceId: string): Promise<void> {
      if (!nextWorkspaceId) throw new Error('A workspace is required for native Notes sync')
      const request = ++lifecycleRequest
      // Wait for obsolete open/close work even when a remount constructed a new
      // controller. Native handle custody must settle before replacing it.
      const closing = replicaClosings.get(api.nativeReplica) ?? stopping
      if (closing) await closing
      if (request !== lifecycleRequest) return
      if (workspaceId === nextWorkspaceId && (handle || starting)) {
        await starting
        return
      }
      if (workspaceId || handle || starting) await closeSession()
      if (request !== lifecycleRequest) return
      workspaceId = nextWorkspaceId
      const openingGeneration = ++generation
      const opening = (async () => {
        const opened = await api.nativeReplica.open(nextWorkspaceId)
        if (generation !== openingGeneration || workspaceId !== nextWorkspaceId) {
          await api.nativeReplica.close(opened)
          return
        }
        handle = opened
      })()
      starting = opening
      try {
        await opening
      } catch (error) {
        if (generation === openingGeneration) workspaceId = null
        throw error
      } finally {
        if (starting === opening) starting = null
      }
    },

    async queueSave(note: NoteDocument, content: string) {
      const session = await requireSession()
      const state = await api.getTransportConnectionState()
      assertSession(session)
      const offline = isNativeReplicaNetworkLoss(state)
      const nativeId = note.nativeId ?? note.id
      const snapshot = offline
        ? await api.nativeReplica.readSnapshot(session.handle, nativeId)
        : await api.nativeData.readEntity({ workspaceId: session.workspaceId, kind: 'notes', nativeId })
      assertSession(session)
      if (!snapshot || snapshot.deleted || snapshot.workspaceId !== session.workspaceId ||
          snapshot.kind !== 'notes' || !snapshot.nativeId || !Number.isSafeInteger(snapshot.revision) ||
          snapshot.revision < 0 || snapshot.files.length !== 1 || !snapshot.files[0]?.path) {
        throw new Error('Native Notes entity does not have one canonical file snapshot')
      }
      if (snapshot.nativeId !== nativeId) {
        throw Object.assign(new Error('Native Notes canonical identity changed before enqueue'), { code: 'DOCUMENT_AUTHORITY_CHANGED' })
      }
      if (!Number.isSafeInteger(note.nativeRevision) || note.nativeRevision! < 0) {
        throw Object.assign(new Error('Native Notes requires the opened revision before enqueue'), { code: 'DOCUMENT_VALIDATION_FAILED' })
      }
      const progress = draftProgress.get(nativeId)
      const followsOwnReceipt = progress && progress.openedRevision === note.nativeRevision &&
        progress.acknowledgedRevision === snapshot.revision
      if (snapshot.revision !== note.nativeRevision && !followsOwnReceipt) {
        throw Object.assign(new Error('Native Notes canonical revision changed; preserve and reload the opened draft'), { code: 'HASH_CONFLICT' })
      }
      const queued = await api.nativeReplica.enqueue(session.handle, {
        nativeId: snapshot.nativeId,
        expectedRevision: snapshot.revision,
        schemaVersion: 1,
        changes: [{ path: snapshot.files[0].path, content }],
      })
      assertSession(session)
      const current = progress && progress.openedRevision === note.nativeRevision ? progress : {
        openedRevision: note.nativeRevision!, acknowledgedRevision: snapshot.revision, operations: new Set<string>(),
      }
      current.operations.add(queued.operationId)
      draftProgress.set(nativeId, current)
      return queued
    },

    async flush(): Promise<NativeDataReceipt[]> {
      if (flushing) return flushing.then(() => this.flush())
      flushing = (async () => {
        const session = await requireSession()
        const pending = await api.nativeReplica.pending(session.handle)
        assertSession(session)
        const receipts: NativeDataReceipt[] = []
        for (const operation of pending) {
          assertSession(session)
          if (operation.workspaceId !== session.workspaceId || operation.kind !== 'notes') {
            throw new Error('Native Notes queue contains an operation for another workspace or kind')
          }
          const receipt = await api.nativeData.mutate({
            workspaceId: operation.workspaceId,
            kind: operation.kind,
            nativeId: operation.nativeId,
            operationId: operation.operationId,
            expectedRevision: operation.expectedRevision,
            schemaVersion: operation.schemaVersion,
            changes: operation.changes,
          })
          assertSession(session)
          const acknowledged = await api.nativeReplica.acknowledge(session.handle, receipt)
          assertSession(session)
          if (!acknowledged) throw new Error(`Native Notes operation ${operation.operationId} remains unacknowledged`)
          const progress = draftProgress.get(operation.nativeId)
          if (progress?.operations.has(operation.operationId) &&
              receipt.workspaceId === operation.workspaceId && receipt.kind === operation.kind &&
              receipt.nativeId === operation.nativeId && receipt.operationId === operation.operationId &&
              Number.isSafeInteger(receipt.revision) && receipt.revision === (operation.expectedRevision ?? 0) + 1 &&
              progress.acknowledgedRevision === operation.expectedRevision) {
            progress.acknowledgedRevision = receipt.revision
            progress.operations.delete(operation.operationId)
          }
          receipts.push(receipt)
        }
        return receipts
      })()
      try {
        return await flushing
      } finally {
        flushing = null
      }
    },

    async stop(): Promise<void> {
      lifecycleRequest++
      const prior = stopping
      const closing = closeSession()
      const settled = prior ? Promise.all([prior, closing]).then(() => {}) : closing
      stopping = settled
      try { await settled } finally { if (stopping === settled) stopping = null }
    },
  }
}
