import type { NativeDataEntitySnapshot, NativeDataMutationInput, NativeDataReadEntityInput, NativeDataReceipt, NoteDocument } from '@craft-agent/shared/protocol/dto'
import { isNativeReplicaNetworkLoss, type NativeReplicaPublicApi } from '@craft-agent/shared/protocol/native-replica'

export interface NativeNotesApi {
  nativeReplica: NativeReplicaPublicApi
  nativeData: {
    readEntity(input: NativeDataReadEntityInput): Promise<NativeDataEntitySnapshot | null>
    mutate(input: NativeDataMutationInput): Promise<NativeDataReceipt>
  }
  getTransportConnectionState(): Promise<Parameters<typeof isNativeReplicaNetworkLoss>[0]>
}

/** Workspace-scoped durable Notes mutation transport. */
export function createNativeNotesSyncController(api: NativeNotesApi = (globalThis as unknown as { window: { electronAPI: NativeNotesApi } }).window.electronAPI) {
  let workspaceId: string | null = null
  let handle: string | null = null
  let starting: Promise<void> | null = null
  let flushing: Promise<NativeDataReceipt[]> | null = null
  let generation = 0
  let lifecycleRequest = 0

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

  const closeSession = async (): Promise<void> => {
    const opening = starting
    const closingHandle = handle
    generation++
    workspaceId = null
    handle = null
    starting = null
    if (opening) await opening.catch(() => {})
    if (closingHandle) await api.nativeReplica.close(closingHandle)
  }

  return {
    async start(nextWorkspaceId: string): Promise<void> {
      if (!nextWorkspaceId) throw new Error('A workspace is required for native Notes sync')
      if (workspaceId === nextWorkspaceId && (handle || starting)) {
        await starting
        return
      }
      const request = ++lifecycleRequest
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
      return api.nativeReplica.enqueue(session.handle, {
        nativeId: snapshot.nativeId,
        expectedRevision: snapshot.revision,
        schemaVersion: 1,
        changes: [{ path: snapshot.files[0].path, content }],
      })
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
          if (!acknowledged) throw new Error(`Native Notes operation ${operation.operationId} remains unacknowledged`)
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
      await closeSession()
    },
  }
}
