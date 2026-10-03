import type { NativeDataContext, NativeDataEntitySnapshot, NativeDataMutationInput, NativeDataPullChangesInput, NativeDataPullChangesOutput, NativeDataReadEntityInput, NativeDataReceipt } from '@craft-agent/shared/protocol'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { CollaborationMutation, CollaborationSyncService } from '../../collaboration/sync-service.ts'
import type { NativeAuthority, NativePrincipal } from '../../authority/native-authority.ts'
import type { JournalEntitySnapshot, JournalReceipt, NativeJournal } from '../../authority/native-journal.ts'
import type { HandlerDeps } from '../handler-deps.ts'

function nativeDataDependencies(deps: HandlerDeps): NativeDataRpcDependencies {
  const native = deps.nativeData
  if (!native) throw new Error('native data RPC requires native authority and journal')
  return native
}

function projectReceipt(receipt: JournalReceipt): NativeDataReceipt {
  return {
    issuer: receipt.issuer,
    subject: receipt.subject,
    workspaceId: receipt.workspaceId,
    kind: receipt.kind,
    nativeId: receipt.nativeId,
    operationId: receipt.operationId,
    sequence: receipt.sequence,
    revision: receipt.revision,
    contentHash: receipt.contentHash,
    deleted: receipt.deleted,
  }
}

function projectEntity(entity: JournalEntitySnapshot | null): NativeDataEntitySnapshot | null {
  if (!entity) return null
  return {
    workspaceId: entity.workspaceId,
    kind: entity.kind,
    nativeId: entity.nativeId,
    revision: entity.revision,
    contentHash: entity.contentHash,
    deleted: entity.deleted,
    files: entity.files.map(file => ({ path: file.path, content: file.content })),
  }
}

function requireWorkspace(ctx: { workspaceId: string | null; principal?: NativePrincipal }, workspaceId: unknown): {
  principal: NativePrincipal
  workspaceId: string
} {
  if (!ctx.principal || !ctx.workspaceId || typeof workspaceId !== 'string' || ctx.workspaceId !== workspaceId) {
    throw new Error('native data workspace does not match authenticated client')
  }
  return { principal: ctx.principal, workspaceId }
}

function validateIdentity(kind: unknown, nativeId: unknown): asserts kind is 'notes' {
  if (kind !== 'notes' || typeof nativeId !== 'string' || !nativeId.trim() || nativeId.length > 512) {
    throw new Error('invalid replica entity identity')
  }
}

export function registerNativeDataHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { authority, sync } = nativeDataDependencies(deps)
  server.handle(RPC_CHANNELS.nativeData.GET_CONTEXT, (ctx, input: { workspaceId: string }): NativeDataContext => {
    const { principal, workspaceId } = requireWorkspace(ctx, input?.workspaceId)
    const permissionFence = authority.permissionFence(principal, workspaceId, 'read')
    if (!permissionFence || !authority.authorize(principal, workspaceId, 'read')) {
      throw new Error('native data read is unauthorized')
    }
    const workspace = authority.resolveWorkspace(workspaceId)
    if (!workspace?.nativeRoot) throw new Error('native data workspace is not registered')
    if (authority.permissionFence(principal, workspaceId, 'read') !== permissionFence ||
      !authority.authorize(principal, workspaceId, 'read')) {
      throw new Error('native data access changed while resolving context')
    }
    return { issuer: principal.issuer, subject: principal.subject, workspaceId, permissionFence }
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.nativeData.READ_ENTITY, (ctx, input: NativeDataReadEntityInput): NativeDataEntitySnapshot | null => {
    const { principal, workspaceId } = requireWorkspace(ctx, input?.workspaceId)
    validateIdentity(input?.kind, input?.nativeId)
    const permissionFence = authority.permissionFence(principal, workspaceId, 'read')
    if (!permissionFence) throw new Error('native data read is unauthorized')
    const entity = sync.readEntity(principal, workspaceId, input.kind, input.nativeId)
    if (authority.permissionFence(principal, workspaceId, 'read') !== permissionFence ||
      !authority.authorize(principal, workspaceId, 'read')) {
      throw new Error('native data access changed while reading entity')
    }
    return projectEntity(entity)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.nativeData.MUTATE, (ctx, input: NativeDataMutationInput): NativeDataReceipt => {
    const { principal, workspaceId } = requireWorkspace(ctx, input?.workspaceId)
    validateIdentity(input?.kind, input?.nativeId)
    const mutation: CollaborationMutation = {
      kind: input.kind,
      nativeId: input.nativeId,
      operationId: input.operationId,
      expectedRevision: input.expectedRevision,
      schemaVersion: input.schemaVersion,
      changes: input.changes,
    }
    return projectReceipt(sync.commit(principal, workspaceId, mutation))
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.nativeData.PULL_CHANGES, (ctx, input: NativeDataPullChangesInput): NativeDataPullChangesOutput => {
    const { principal, workspaceId } = requireWorkspace(ctx, input?.workspaceId)
    const page = sync.pull(principal, workspaceId, input.afterSequence, input.limit)
    if (authority.permissionFence(principal, workspaceId, 'read') !== page.permissionFence ||
      !authority.authorize(principal, workspaceId, 'read')) {
      throw new Error('native data access changed while pulling changes')
    }
    return {
      changes: page.changes.map(projectReceipt),
      nextSequence: page.nextSequence,
      hasMore: page.hasMore,
      entities: page.entities.map(entity => projectEntity(entity)!),
      permissionFence: page.permissionFence,
    }
  }, { nativeAction: 'read' })
}
export interface NativeDataRpcDependencies {
  authority: NativeAuthority
  journal: NativeJournal
  sync: CollaborationSyncService
}
