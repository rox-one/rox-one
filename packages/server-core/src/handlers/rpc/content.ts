import { access, lstat, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { RPC_CHANNELS, CodedError, type NoteDocument, type ErrorCode } from '@craft-agent/shared/protocol'
import { isImportProvenancedRelativePath } from '@craft-agent/shared/config'
import { decodeContentEntityRef } from '@craft-agent/core/docs'
import { parseRox2EntityId, type Rox2EntityRef } from '@craft-agent/core/rox2'
import type { RequestContext, RpcServer } from '../../transport/types.ts'
import { createDescriptorResolver, FileDescriptorStore, type ContentOwner, type ContentPolicy, type AdoptDescriptorCommand } from '../../docs/descriptor-resolver.ts'
import { MarkdownCommitStore, MarkdownChangedDeliveryError, markdownRevision, type MarkdownChangedEvent, type NativeMarkdownChange } from '../../docs/markdown-commit.ts'
import { createNativeBlockTreeService } from '../../docs/block-tree-service.ts'
import { decodeMarkdownCommitCommand, MarkdownCommitError } from '@craft-agent/core/docs'

export interface NativeContentPorts {
  /** Canonical workspace lookup. Null means no current native ownership. */
  notesRoot(workspaceId: string): string | null
  readNote(workspaceId: string, noteId: string, capturedRoot: string): Promise<NoteDocument>
  changed(workspaceId: string, noteId: string, reason: MarkdownChangedEvent['reason'] | 'descriptor', eventId?: string): Promise<void> | void
  /** Verifies that Electron-main still owns this workspace/window. */
  ownsWindow(context: RequestContext): boolean
}

export const CONTENT_HANDLED_CHANNELS = Object.values(RPC_CHANNELS.content)

/** Local device principal. A name entered in onboarding cannot replace it. */
export function localContentPrincipal(context: RequestContext, workspaceId: string, ports: NativeContentPorts): string {
  if (!context.clientId || context.webContentsId === null || context.workspaceId !== workspaceId || !ports.ownsWindow(context) || !ports.notesRoot(workspaceId)) {
    throw new CodedError('AUTH_FAILED', 'Document access denied')
  }
  return `local-uid:${process.getuid?.() ?? 'windows-user'}:${workspaceId}`
}

export function registerContentHandlers(server: RpcServer, ports: NativeContentPorts) {
  const sourceRecovery = new Map<string, Promise<void>>()
  const recoverDescriptorWriter = (root: string): Promise<void> => {
    const previous = sourceRecovery.get(root)
    if (previous) return previous
    const recovering = (async () => {
      const path = join(root, '.rox-docs', 'descriptors.json')
      // Empty/legacy vaults remain untouched. Recovery removes only a verified
      // stopped writer's lock; a live PID or unreadable lock fails closed.
      const locked = await access(`${path}.lock`).then(() => true, error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      })
      if (locked) await new FileDescriptorStore(path, { trustedRoot: root }).recoverInterruptedCommit()
    })()
    sourceRecovery.set(root, recovering)
    return recovering
  }
  async function services(context: RequestContext, workspaceId: string) {
    const actorPrincipalId = localContentPrincipal(context, workspaceId, ports)
    const configuredRoot = ports.notesRoot(workspaceId)
    if (!configuredRoot) throw new CodedError('AUTH_FAILED', 'Document access denied')
    const notesRoot = await realpath(configuredRoot)
    await recoverDescriptorWriter(notesRoot)
    const sourceStoreId = `native-notes:${workspaceId}:${createHash('sha256').update(notesRoot).digest('hex')}`
    const assertSource = async () => {
      localContentPrincipal(context, workspaceId, ports)
      if (ports.notesRoot(workspaceId) !== configuredRoot || await realpath(configuredRoot) !== notesRoot) {
        throw new CodedError('DOCUMENT_AUTHORITY_CHANGED', 'Document source binding changed')
      }
    }
    await assertSource()
    const policy: ContentPolicy = {
      async authorize({ context: trusted, ref, action }) {
        if (trusted.actorPrincipalId !== actorPrincipalId || ref.workspaceId !== workspaceId || ref.accountNamespace
          || ports.notesRoot(workspaceId) !== configuredRoot || !ports.ownsWindow(context)) return { allowed: false, policyRevision: 'native-v1' }
        try {
          const { id } = parseRox2EntityId(ref.entityId)
          if (id.includes('\\') || id.includes('\0') || id.split('/').some(part => !part || part === '.' || part === '..') || isImportProvenancedRelativePath(id) || id.startsWith('.rox-docs/')) return { allowed: false, policyRevision: 'native-v1' }
          const root = await realpath(notesRoot)
          const candidate = resolve(root, `${id}.md`)
          if (!candidate.startsWith(root + sep) || await realpath(candidate) !== candidate) return { allowed: false, policyRevision: 'native-v1' }
          await access(candidate, constants.R_OK)
          const canWrite = await access(candidate, constants.W_OK).then(() => true, () => false)
          return { allowed: action === 'read' || canWrite, canWrite, policyRevision: 'native-v1' }
        } catch { return { allowed: false, policyRevision: 'native-v1' } }
      },
    }
    const safeRead = async (noteId: string): Promise<NoteDocument> => {
      await assertSource()
      const ref = { workspaceId, entityId: `note:${noteId}` }
      const allowed = await policy.authorize({ context: { actorPrincipalId }, ref, action: 'read' })
      if (!allowed.allowed) throw new CodedError('AUTH_FAILED', 'Document access denied')
      const note = await ports.readNote(workspaceId, noteId, notesRoot)
      await assertSource()
      if (note.id !== noteId || await realpath(note.path) !== resolve(notesRoot, `${noteId}.md`)) {
        throw new CodedError('AUTH_FAILED', 'Document source readback mismatch')
      }
      return { ...note, revision: markdownRevision(note.content), sourceStoreId }
    }
    const owner: ContentOwner = {
      bindingFor(ref) {
        if (ref.workspaceId !== workspaceId || ref.accountNamespace) return null
        return { workspaceId, sourceStoreId, ownerPrincipalId: actorPrincipalId,
          authorityEpoch: 1, authority: 'markdown', contentKinds: ['document'], writable: true, offlineReadable: true }
      },
      async read(ref) {
        const { id } = parseRox2EntityId(ref.entityId)
        const note = await safeRead(id)
        return { ref, nativeId: note.id, title: note.title, content: note.content, revision: markdownRevision(note.content), freshness: 'live' }
      },
    }
    const resolver = createDescriptorResolver({
      store: new FileDescriptorStore(join(notesRoot, '.rox-docs', 'descriptors.json'), { trustedRoot: notesRoot }), owner, policy,
    })
    const store = new MarkdownCommitStore(notesRoot, {
      async authorizeNative(actor, command) {
        if (actor !== actorPrincipalId || command.workspaceId !== workspaceId) return false
        try {
          await assertSource()
          const id = command.noteId
          if (id.includes('\\') || id.includes('\0') || id.split('/').some(part => !part || part === '.' || part === '..') || isImportProvenancedRelativePath(id) || id === '.rox-docs' || id.startsWith('.rox-docs/')) return false
          const candidate = resolve(notesRoot, id + '.md')
          if (!candidate.startsWith(notesRoot + sep)) return false
          // Missing targets still require a real writable native parent. Every
          // existing parent is checked independently to reject symlink escapes.
          let parent = dirname(candidate)
          let writableParent: string | null = null
          while (parent.startsWith(notesRoot + sep) || parent === notesRoot) {
            try {
              const entry = await lstat(parent)
              if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(parent) !== parent) return false
              if (writableParent === null) writableParent = parent
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
            if (parent === notesRoot) break
            parent = dirname(parent)
          }
          if (!writableParent) return false
          await access(writableParent, constants.W_OK)
          try {
            const entry = await lstat(candidate)
            if (!entry.isFile() || entry.isSymbolicLink() || await realpath(candidate) !== candidate) return false
            await access(candidate, constants.W_OK)
            const resolved = await resolver.resolve({ actorPrincipalId }, { workspaceId, entityId: 'note:' + id })
            if (resolved.status !== 'ok' || !resolved.capabilities.write) return false
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          await assertSource()
          return true
        } catch { return false }
      },
      async changed(event) {
        await assertSource()
        await ports.changed(event.workspaceId, event.noteId, event.reason, event.eventId)
        await assertSource()
      },
      async authorize(actor, command) {
        if (actor !== actorPrincipalId || command.workspaceId !== workspaceId) return false
        const result = await resolver.resolve({ actorPrincipalId }, { workspaceId, entityId: `note:${command.noteId}` })
        return result.status === 'ok' && result.capabilities.write
      },
      authorityEpoch: async () => 1,
      requireSourceBinding: true,
      sourceStoreId: async () => { await assertSource(); return sourceStoreId },
    })
    const hasJournal = await access(join(notesRoot, '.rox-docs', 'commits')).then(() => true, error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    })
    // A read never stamps a legacy vault. Existing durable intents retry without
    // making a transient invalidator outage prevent safe content/receipt reads.
    if (hasJournal) {
      try { await store.drainChangedEvents() }
      catch (error) {
        if (!(error instanceof MarkdownChangedDeliveryError)) throw error
        if (error.cause instanceof CodedError || error.cause instanceof MarkdownCommitError) throw error.cause
      }
    }
    return { actorPrincipalId, resolver, store, sourceStoreId, safeRead, assertSource }
  }

  const decodeRef = (raw: unknown): Rox2EntityRef => {
    const decoded = decodeContentEntityRef(raw)
    if (decoded.status !== 'ok') throw new CodedError('INVALID_REF', 'Invalid document reference')
    return decoded.ref
  }
  for (const [channel, method] of [[RPC_CHANNELS.content.RESOLVE, 'resolve'], [RPC_CHANNELS.content.DESCRIBE, 'describe']] as const) {
    server.handle(channel, async (context, raw: unknown) => {
      const ref = decodeRef(raw)
      const { actorPrincipalId, resolver, assertSource } = await services(context, ref.workspaceId)
      const result = await resolver[method]({ actorPrincipalId }, ref)
      await assertSource()
      return result
    }, { access: 'localElectron' })
  }
  server.handle(RPC_CHANNELS.content.ADOPT_DESCRIPTOR, async (context, command: AdoptDescriptorCommand) => {
    const ref = decodeRef(command?.ref)
    const { actorPrincipalId, resolver, assertSource } = await services(context, ref.workspaceId)
    const result = await resolver.adoptDescriptor({ actorPrincipalId }, command)
    if (result.status === 'committed') await ports.changed(ref.workspaceId, parseRox2EntityId(ref.entityId).id, 'descriptor')
    await assertSource()
    return result
  }, { access: 'localElectron' })
  const commit = async (context: RequestContext, raw: unknown) => {
    let command
    let receipt
    let bound: Awaited<ReturnType<typeof services>>
    try {
      command = decodeMarkdownCommitCommand(raw)
      bound = await services(context, command.workspaceId)
      if (!command.sourceStoreId || command.sourceStoreId !== bound.sourceStoreId) {
        throw new MarkdownCommitError('unknownFormat', 'Document source binding changed; reload before saving')
      }
      receipt = await bound.store.commit(bound.actorPrincipalId, command)
    } catch (error) {
      if (error instanceof MarkdownChangedDeliveryError) {
        throw new CodedError('DOCUMENT_RESULT_UNAVAILABLE', 'Document is durable but invalidation is pending; preserve the draft and recover the receipt')
      }
      if (!(error instanceof MarkdownCommitError)) throw error
      const codes: Record<MarkdownCommitError['kind'], ErrorCode> = {
        validation: 'DOCUMENT_VALIDATION_FAILED', conflict: 'HASH_CONFLICT', denied: 'AUTH_FAILED',
        deleted: 'NOT_FOUND', rateLimited: 'DOCUMENT_BUSY', unknownFormat: 'DOCUMENT_AUTHORITY_CHANGED',
      }
      throw new CodedError(codes[error.kind], error.message)
    }
    try {
      const note = await bound.safeRead(command.noteId)
      if (note.revision !== receipt.revision) throw new Error('The source changed after this operation')
      await bound.assertSource()
      return { note, receipt }
    } catch {
      // The receipt is durable. A failed readback is not proof that no write occurred.
      throw new CodedError('DOCUMENT_RESULT_UNAVAILABLE', 'Document saved but its current result cannot be safely returned; preserve the draft and recover the receipt')
    }
  }
  server.handle(RPC_CHANNELS.content.COMMIT_MARKDOWN, commit, { access: 'localElectron' })
  for (const [channel, method] of [[RPC_CHANNELS.content.GET_BLOCK_TREE, 'getBlockTree'],
    [RPC_CHANNELS.content.PREVIEW_MARKER_MAPPING, 'previewMarkerMapping'],
    [RPC_CHANNELS.content.APPLY_MARKER_MAPPING, 'applyMarkerMapping']] as const) {
    server.handle(channel, async (context, raw: unknown) => {
      const request = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
      const preview = request?.preview && typeof request.preview === 'object'
        ? request.preview as Record<string, unknown> : null
      const ref = decodeRef(method === 'applyMarkerMapping' ? preview?.ref : request?.ref)
      const bound = await services(context, ref.workspaceId)
      const blocks = createNativeBlockTreeService({
        resolve: target => bound.resolver.resolve({ actorPrincipalId: bound.actorPrincipalId }, target),
        commit: command => commit(context, command), assertSource: bound.assertSource,
      })
      try { return await blocks[method](raw) }
      catch (error) {
        if (!(error instanceof MarkdownCommitError)) throw error
        const codes: Record<MarkdownCommitError['kind'], ErrorCode> = {
          validation: 'DOCUMENT_VALIDATION_FAILED', conflict: 'HASH_CONFLICT', denied: 'AUTH_FAILED',
          deleted: 'NOT_FOUND', rateLimited: 'DOCUMENT_BUSY', unknownFormat: 'DOCUMENT_AUTHORITY_CHANGED',
        }
        throw new CodedError(codes[error.kind], error.message)
      }
    }, { access: 'localElectron' })
  }
  server.handle(RPC_CHANNELS.content.GET_COMMIT_RECEIPT, async (context, workspaceId: string, noteId: string, operationId: string, expectedSourceStoreId: string) => {
    const { actorPrincipalId, store, sourceStoreId, assertSource } = await services(context, workspaceId)
    if (expectedSourceStoreId !== sourceStoreId) throw new CodedError('DOCUMENT_AUTHORITY_CHANGED', 'Document source binding changed')
    const receipt = await store.getReceipt(actorPrincipalId, workspaceId, noteId, operationId)
    await assertSource()
    return receipt
  }, { access: 'localElectron' })
  return {
    commit,
    readNote: async (context: RequestContext, workspaceId: string, noteId: string) => (await services(context, workspaceId)).safeRead(noteId),
    assertScope: (context: RequestContext, workspaceId: string) => localContentPrincipal(context, workspaceId, ports),
    async writeNative(context: RequestContext, workspaceId: string, reason: MarkdownChangedEvent['reason'], changes: NativeMarkdownChange[]) {
      const bound = await services(context, workspaceId)
      try {
        const receipt = await bound.store.writeNative(bound.actorPrincipalId, { workspaceId, reason, changes,
          operationId: randomUUID(), authorityEpoch: 1, sourceStoreId: bound.sourceStoreId })
        await bound.assertSource()
        return receipt
      } catch (error) {
        if (error instanceof MarkdownChangedDeliveryError) {
          throw new CodedError('DOCUMENT_RESULT_UNAVAILABLE', 'Document change is durable but invalidation is pending; recover before retrying')
        }
        if (!(error instanceof MarkdownCommitError)) throw error
        const codes: Record<MarkdownCommitError['kind'], ErrorCode> = {
          validation: 'DOCUMENT_VALIDATION_FAILED', conflict: 'HASH_CONFLICT', denied: 'AUTH_FAILED',
          deleted: 'NOT_FOUND', rateLimited: 'DOCUMENT_BUSY', unknownFormat: 'DOCUMENT_AUTHORITY_CHANGED',
        }
        throw new CodedError(codes[error.kind], error.message)
      }
    },
    async folderSnapshot(context: RequestContext, workspaceId: string, folder: string) {
      const bound = await services(context, workspaceId)
      if (isImportProvenancedRelativePath(folder)) throw new CodedError('AUTH_FAILED', 'Document access denied')
      const snapshot = await bound.store.folderSnapshot(folder)
      await bound.assertSource()
      return snapshot
    },
  }
}
