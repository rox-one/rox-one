import { chmodSync, mkdirSync, realpathSync } from 'node:fs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { AccountReplica, SqliteReplicaOutbox } from '@craft-agent/shared/account-replica'
import type { NativeDataContext, NativeDataReceipt } from '@craft-agent/shared/protocol/dto'
import {
  acknowledgementFromReceipt,
  NATIVE_REPLICA_IPC,
  queuedMutationFromOperation,
  type NativeReplicaAcknowledgeIpcInput,
  type NativeReplicaEnqueueIpcInput,
  type NativeReplicaEnqueueCreateIpcInput,
  type NativeReplicaOpenIpcInput,
  type NativeReplicaSessionIpcInput,
  type NativeReplicaCacheSnapshotIpcInput,
  type NativeReplicaReadSnapshotIpcInput,
} from '@craft-agent/shared/protocol/native-replica'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'

export { NATIVE_REPLICA_IPC }


export interface NativeReplicaCredentialStore {
  get(id: CredentialId): Promise<StoredCredential | null>
  set(id: CredentialId, credential: StoredCredential): Promise<void>
}

export interface NativeReplicaIpcDependencies {
  configDir: string
  credentials: NativeReplicaCredentialStore
  /** WindowManager returns a workspace only for managed app-host BrowserWindows. */
  getWorkspaceForWindow(webContentsId: number): string | null
  /** Production desktop entry validates the current owner and main frame. */
  getWorkspaceForRenderer?(event: IpcMainInvokeEvent): string | null
  /** Rejects stale custody after A→B→A or a renderer reload/replacement. */
  getWorkspaceGenerationForWindow?(webContentsId: number): number | null
}

interface KeyMaterial {
  version: 1
  accountHash: string
  accountKey: string
  outboxKey: string
  recoverySecret: string
  deviceId: string
  deviceSecret: string
}

interface ReplicaSession {
  ownerWebContentsId: number
  ownerWebContents: WebContents
  bindingGeneration: number | null
  context: NativeDataContext
  accountHash: string
  deviceId: string
  replica: AccountReplica
  outbox: SqliteReplicaOutbox
  detach?: () => void
}

/** Installs sender-bound IPC for secure local queue custody. Server identity is obtained by preload RPC. */
export function registerNativeReplicaIpc(
  ipc: IpcMain,
  dependencies: NativeReplicaIpcDependencies,
): () => void {
  const sessions = new Map<string, ReplicaSession>()
  const keyMaterialLoads = new Map<string, Promise<KeyMaterial>>()
  let disposed = false
  const root = resolve(dependencies.configDir, 'account-replica')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  if (realpathSync(root) !== root) throw new Error('native replica directory must be a canonical real directory')

  const boundWorkspace = (event: IpcMainInvokeEvent): string | null => dependencies.getWorkspaceForRenderer
    ? dependencies.getWorkspaceForRenderer(event) : dependencies.getWorkspaceForWindow(event.sender.id)
  const bindingGeneration = (id: number) => dependencies.getWorkspaceGenerationForWindow?.(id) ?? null
  const assertWindow = (event: IpcMainInvokeEvent, context: NativeDataContext): void => {
    if (event.sender.isDestroyed() || !isNativeDataContext(context) || boundWorkspace(event) !== context.workspaceId) {
      throw new Error('native replica IPC requires its authenticated managed workspace window')
    }
  }

  const closeSession = (handle: string, session: ReplicaSession) => {
    sessions.delete(handle)
    session.detach?.()
    session.outbox.close()
    session.replica.destroy()
  }

  const requireSession = (event: IpcMainInvokeEvent, input: NativeReplicaSessionIpcInput): ReplicaSession => {
    const workspaceId = boundWorkspace(event)
    if (!workspaceId) throw new Error('native replica IPC requires a managed app-host window')
    const session = sessions.get(input?.handle)
    if (!session || session.ownerWebContentsId !== event.sender.id || session.ownerWebContents !== event.sender) {
      throw new Error('native replica session is not owned by this window')
    }
    if (workspaceId !== session.context.workspaceId || bindingGeneration(event.sender.id) !== session.bindingGeneration) {
      closeSession(input.handle, session)
      throw new Error('native replica workspace changed; session was closed')
    }
    assertWindow(event, session.context)
    return session
  }

  ipc.handle(NATIVE_REPLICA_IPC.OPEN, async (event, input: NativeReplicaOpenIpcInput): Promise<string> => {
    if (disposed) throw new Error('native replica IPC has been disposed')
    const context = input?.context
    assertWindow(event, context)
    const openingGeneration = bindingGeneration(event.sender.id)
    const accountHash = createHash('sha256').update(JSON.stringify([context.issuer, context.subject])).digest('hex')
    const credentialId: CredentialId = {
      type: 'account_replica_key',
      workspaceId: context.workspaceId,
      name: accountHash,
    }
    const keyMaterialKey = `${context.workspaceId}\0${accountHash}`
    let keyMaterialLoad = keyMaterialLoads.get(keyMaterialKey)
    if (!keyMaterialLoad) {
      keyMaterialLoad = loadOrCreateKeyMaterial(dependencies.credentials, credentialId, accountHash)
      keyMaterialLoads.set(keyMaterialKey, keyMaterialLoad)
    }
    let material: KeyMaterial
    try {
      material = await keyMaterialLoad
    } finally {
      if (keyMaterialLoads.get(keyMaterialKey) === keyMaterialLoad) keyMaterialLoads.delete(keyMaterialKey)
    }
    // Secure storage may yield while the renderer is destroyed or changes workspace.
    if (disposed) throw new Error('native replica IPC was disposed while opening')
    if (event.sender.isDestroyed()) throw new Error('native replica window was destroyed while opening')
    assertWindow(event, context)
    if (bindingGeneration(event.sender.id) !== openingGeneration) throw new Error('native replica window binding changed while opening')
    const accountId = accountHash
    const accountKey = decodeKey(material.accountKey, 'account')
    const outboxKey = decodeKey(material.outboxKey, 'outbox')
    const workspaceHash = createHash('sha256').update(context.workspaceId).digest('hex')
    const databaseDir = join(root, workspaceHash)
    mkdirSync(databaseDir, { recursive: true, mode: 0o700 })
    chmodSync(databaseDir, 0o700)
    const canonicalDatabaseDir = realpathSync(databaseDir)
    if (canonicalDatabaseDir !== databaseDir) {
      accountKey.fill(0)
      outboxKey.fill(0)
      throw new Error('native replica workspace directory must be canonical')
    }
    const databasePath = join(canonicalDatabaseDir, `${accountHash}.sqlite`)
    let outbox: SqliteReplicaOutbox | undefined
    let replica: AccountReplica
    try {
      outbox = new SqliteReplicaOutbox({ databasePath, key: outboxKey })
      replica = new AccountReplica(accountId, material.recoverySecret, undefined, outbox, accountKey)
    } catch (error) {
      outbox?.close()
      throw error
    } finally {
      outboxKey.fill(0)
      accountKey.fill(0)
    }
    replica.bindWorkspace(context.workspaceId)
    replica.enrollDevice(material.deviceId, material.deviceSecret)
    const handle = randomUUID()
    const session: ReplicaSession = { ownerWebContentsId: event.sender.id, ownerWebContents: event.sender, bindingGeneration: openingGeneration,
      context: { ...context }, accountHash, deviceId: material.deviceId, replica, outbox }
    sessions.set(handle, session)
    const cleanupSession = () => {
      const session = sessions.get(handle)
      if (!session || session.ownerWebContentsId !== event.sender.id) return
      closeSession(handle, session)
    }
    event.sender.once('destroyed', cleanupSession)
    event.sender.once('render-process-gone', cleanupSession)
    session.detach = () => {
      event.sender.removeListener('destroyed', cleanupSession)
      event.sender.removeListener('render-process-gone', cleanupSession)
    }
    return handle
  })

  // Not exported on electronAPI: only preload can supply the authenticated canonical plan.
  ipc.handle(NATIVE_REPLICA_IPC.ENQUEUE_CREATE, (event, input: NativeReplicaEnqueueCreateIpcInput) => {
    const session = requireSession(event, input)
    const plan = input.plan
    const mutation = plan?.mutation
    const change = mutation?.changes?.[0]
    if (!plan || !isNativeDataContext(plan.context) || !/^[a-f0-9]{64}$/.test(plan.writePermissionFence) ||
        Object.keys(session.context).some(key => session.context[key as keyof NativeDataContext] !== plan.context[key as keyof NativeDataContext]) ||
        !mutation || mutation.expectedRevision !== null || mutation.schemaVersion !== 1 ||
        typeof mutation.nativeId !== 'string' || !mutation.nativeId || mutation.nativeId.length > 512 ||
        mutation.nativeId.split('/').some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part)) ||
        mutation.changes.length !== 1 || change?.path !== `notes/${mutation.nativeId}.md` || typeof change.content !== 'string') {
      throw new Error('native Notes creation requires its current canonical server plan')
    }
    const scope = { accountId: session.accountHash, workspaceId: session.context.workspaceId, permissionFence: session.context.permissionFence }
    const write = { ...mutation, deviceId: session.deviceId, workspaceId: session.context.workspaceId, category: 'notes' as const }
    const attempt = input.callerAttemptId === undefined ? undefined : {
      callerAttemptId: input.callerAttemptId, permissionFence: session.context.permissionFence, writePermissionFence: plan.writePermissionFence,
    }
    if (attempt) {
      const existing = session.outbox.creationAttempt(scope.accountId, scope.workspaceId, attempt, write)
      if (existing) return queuedMutationFromOperation(existing)
    }
    if (session.outbox.readSnapshot(scope, mutation.nativeId) || session.replica.pendingOffline(session.context.workspaceId).some(operation =>
        operation.nativeId === mutation.nativeId || operation.changes.some(item => item.path === change.path))) {
      throw new Error('native Notes creation conflicts with an existing source or pending operation')
    }
    return queuedMutationFromOperation(session.replica.enqueueOffline(write, attempt))
  })

  ipc.handle(NATIVE_REPLICA_IPC.ENQUEUE, (event, input: NativeReplicaEnqueueIpcInput) => {
    const session = requireSession(event, input)
    const source = session.outbox.readSnapshot({ accountId: session.accountHash, workspaceId: session.context.workspaceId, permissionFence: session.context.permissionFence }, input.mutation?.nativeId)
    if (!source || source.deleted || source.files.length !== 1 || input.mutation.changes.length !== 1 ||
        input.mutation.changes[0]?.path !== source.files[0]?.path || input.mutation.expectedRevision !== source.revision) {
      throw new Error('native Notes enqueue requires its cached authoritative source snapshot')
    }
    const preceding = session.replica.pendingOffline(session.context.workspaceId)
      .filter(operation => operation.nativeId === input.mutation.nativeId)
    const tail = preceding.at(-1)
    if (tail && (tail.changes.length !== 1 || tail.changes[0]?.path !== source.files[0]?.path || tail.changes[0]?.content === null || tail.expectedRevision === null)) {
      throw new Error('native Notes pending path or tombstone conflicts with this source')
    }
    const operation = session.replica.enqueueOffline({
      ...input.mutation,
      expectedRevision: tail ? tail.expectedRevision! + 1 : input.mutation.expectedRevision,
      deviceId: session.deviceId,
      workspaceId: session.context.workspaceId,
      category: 'notes',
    })
    return queuedMutationFromOperation(operation)
  })

  ipc.handle(NATIVE_REPLICA_IPC.PENDING, (event, input: NativeReplicaSessionIpcInput) => {
    const session = requireSession(event, input)
    return session.replica.pendingOffline(session.context.workspaceId).map(queuedMutationFromOperation)
  })

  const snapshotScope = (session: ReplicaSession) => ({ accountId: session.accountHash, workspaceId: session.context.workspaceId, permissionFence: session.context.permissionFence })
  ipc.handle(NATIVE_REPLICA_IPC.CACHE_SNAPSHOT, (event, input: NativeReplicaCacheSnapshotIpcInput) => {
    const session = requireSession(event, input)
    const snapshot = input.snapshot
    if (!snapshot || snapshot.workspaceId !== session.context.workspaceId || snapshot.kind !== 'notes' ||
        !snapshot.nativeId || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 || snapshot.deleted ||
        snapshot.files.length !== 1 || !snapshot.files[0]?.path.startsWith('notes/') || typeof snapshot.files[0].content !== 'string') {
      throw new Error('native Notes cache requires one canonical source snapshot')
    }
    session.outbox.cacheSnapshot(snapshotScope(session), snapshot)
  })
  ipc.handle(NATIVE_REPLICA_IPC.READ_SNAPSHOT, (event, input: NativeReplicaReadSnapshotIpcInput) => {
    const session = requireSession(event, input)
    return session.outbox.readSnapshot(snapshotScope(session), input.nativeId)
  })

  ipc.handle(NATIVE_REPLICA_IPC.ACKNOWLEDGE, async (event, input: NativeReplicaAcknowledgeIpcInput) => {
    const session = requireSession(event, input)
    const receipt = input.receipt as NativeDataReceipt
    const operation = session.replica.pendingOffline(session.context.workspaceId)
      .find((pending) => pending.id === receipt?.operationId)
    if (!operation) {
      const prior = session.outbox.acknowledgement(session.accountHash, session.context.workspaceId, receipt?.operationId ?? '')
      const exact = session.outbox.readReceipt(session.accountHash, session.context.workspaceId, receipt?.operationId ?? '')
      if (!prior || !isReceiptForContext(receipt, session.context) ||
          prior.serverSequence !== receipt.sequence || prior.revision !== receipt.revision || !exact ||
          Object.keys(exact).some(key => exact[key as keyof NativeDataReceipt] !== receipt[key as keyof NativeDataReceipt]) ||
          Object.keys(receipt).length !== Object.keys(exact).length) return false
      return true
    }
    const acknowledgement = await acknowledgementFromReceipt(operation, receipt, session.context)
    if (requireSession(event, input) !== session) throw new Error('native replica session changed during acknowledgement')
    session.outbox.cacheReceipt(session.accountHash, receipt)
    const acknowledged = session.replica.acknowledgeOffline(session.context.workspaceId, operation.id, acknowledgement)
    if (acknowledged) {
      const scope = snapshotScope(session)
      const source = session.outbox.readSnapshot(scope, operation.nativeId)
      if (source && source.revision < receipt.revision) {
        const change = operation.changes[0]!
        session.outbox.cacheSnapshot(scope, { ...source, revision: receipt.revision, contentHash: receipt.contentHash,
          deleted: receipt.deleted, files: change.content === null ? [] : [{ path: change.path, content: change.content }] })
      }
    }
    return acknowledged
  })

  ipc.handle(NATIVE_REPLICA_IPC.CLOSE, (event, input: NativeReplicaSessionIpcInput) => {
    const session = requireSession(event, input)
    if (input.invalidateSnapshots) session.outbox.invalidateSnapshots(snapshotScope(session))
    closeSession(input.handle, session)
  })


  return () => {
    disposed = true
    for (const [handle, session] of sessions) closeSession(handle, session)
    for (const channel of Object.values(NATIVE_REPLICA_IPC)) ipc.removeHandler(channel)
  }
}

async function loadOrCreateKeyMaterial(
  credentials: NativeReplicaCredentialStore,
  credentialId: CredentialId,
  accountHash: string,
): Promise<KeyMaterial> {
  const existing = await credentials.get(credentialId)
  if (existing) {
    let material: unknown
    try { material = JSON.parse(existing.value) } catch { throw new Error('stored native replica key material is invalid') }
    if (!isKeyMaterial(material) || material.accountHash !== accountHash) {
      throw new Error('stored native replica key material failed validation')
    }
    decodeKey(material.accountKey, 'account').fill(0)
    decodeKey(material.outboxKey, 'outbox').fill(0)
    return material
  }
  const material: KeyMaterial = {
    version: 1,
    accountHash,
    accountKey: randomBytes(32).toString('base64'),
    outboxKey: randomBytes(32).toString('base64'),
    recoverySecret: randomBytes(32).toString('base64url'),
    deviceId: randomUUID(),
    deviceSecret: randomBytes(32).toString('base64url'),
  }
  try {
    await credentials.set(credentialId, { value: JSON.stringify(material), source: 'native' })
  } catch (error) {
    throw new Error('secure native replica key storage is unavailable; no plaintext fallback was used', { cause: error })
  }
  return material
}

function isNativeDataContext(value: unknown): value is NativeDataContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const context = value as Partial<NativeDataContext>
  const keys = Object.keys(context)
  return keys.length === 4 && keys.every((key) => ['issuer', 'subject', 'workspaceId', 'permissionFence'].includes(key)) &&
    typeof context.issuer === 'string' && context.issuer.length > 0 && context.issuer.length <= 512 &&
    typeof context.subject === 'string' && context.subject.length > 0 && context.subject.length <= 512 &&
    typeof context.workspaceId === 'string' && context.workspaceId.length > 0 && context.workspaceId.length <= 512 &&
    typeof context.permissionFence === 'string' && context.permissionFence.length > 0 && context.permissionFence.length <= 512
}


function isReceiptForContext(receipt: NativeDataReceipt, context: NativeDataContext): boolean {
  return Boolean(receipt && receipt.issuer === context.issuer && receipt.subject === context.subject &&
    receipt.workspaceId === context.workspaceId && receipt.kind === 'notes' &&
    Number.isSafeInteger(receipt.sequence) && receipt.sequence > 0 &&
    Number.isSafeInteger(receipt.revision) && receipt.revision > 0 && /^[a-f0-9]{64}$/.test(receipt.contentHash))
}

function isKeyMaterial(value: unknown): value is KeyMaterial {
  const material = value as Partial<KeyMaterial> | null | undefined
  return Boolean(material && material.version === 1 && material.accountHash &&
    typeof material.accountKey === 'string' && typeof material.outboxKey === 'string' &&
    typeof material.recoverySecret === 'string' && typeof material.deviceId === 'string' &&
    typeof material.deviceSecret === 'string')
}

function decodeKey(encoded: string, name: string): Buffer {
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    key.fill(0)
    throw new Error(`stored native replica ${name} key is invalid`)
  }
  return key
}
