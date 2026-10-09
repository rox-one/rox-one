/** W1-06 (#1503) — Reference ops: docs, drive, wiki (TECH-SPEC §4.2, §11, §12, §16, §18.2, §20). */

import { CommandRejection } from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import { deterministicId, isDeleted, type ReferenceOutcome, type ReferenceTx } from '../engine'
import { addLink, assertNotOwner, authorizeBound, authorizeId, authorizeOrigin, authorizeRef, boundRef, collectionOfKind, create, omit, payloadFields, refString, storedAclRole, transition, update } from '../ops'
import type { RecordData, StoredRecord } from '../types'
import type { ReferenceSpecMap } from './types'

const PUBLIC_TOKEN_BYTES = 16

/**
 * A public-link token is 128 bits from the platform CSPRNG (W1-06 review 4):
 * deterministic ids (`tx.newId` / `tx.createId`) are guessable, so a token
 * must never be derived from them or from the command id.
 */
function publicToken(): string {
  const bytes = new Uint8Array(PUBLIC_TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

const noteDefaults = (tx: ReferenceTx): RecordData => ({ ownerId: tx.actor, subtype: 'doc', state: 'draft', title: '' })

/** A doc derived from `origin` (only referenced: `read`; a target of its kind must be it). */
function noteFrom(origin: (tx: ReferenceTx) => EntityRef, fields: (tx: ReferenceTx) => RecordData) {
  return async (tx: ReferenceTx): Promise<ReferenceOutcome> => {
    await authorizeOrigin(tx, origin(tx))
    await authorizeId(tx, 'folder', tx.payload.folderId, 'write')
    await authorizeId(tx, 'space', tx.payload.spaceId, 'write')
    const id = tx.createId()
    const data = { ...noteDefaults(tx), ...fields(tx) }
    const record = await tx.insert('note', id, data)
    await addLink(tx, { kind: 'note', id }, origin(tx), 'derived-from', { role: 'origin' })
    return { collection: 'note', id, revision: record.revision, changes: Object.keys(data).sort() }
  }
}

/**
 * A block inserted into a doc (the editor applies it; the row is the reference
 * record). The doc is the authorized target; an embedded entity is only
 * referenced (`read`).
 */
function block(kind: string, refKey?: string) {
  return async (tx: ReferenceTx): Promise<ReferenceOutcome> => {
    const docRef = boundRef(tx, tx.payload.docRef as EntityRef, { requireTarget: true })
    if (refKey) await authorizeRef(tx, tx.payload[refKey] as EntityRef, 'read')
    const id = tx.newId('block')
    const data = { docKind: docRef.kind, docId: docRef.id, kind, ...omit(tx.payload, ['docRef']) }
    const record = await tx.insert('doc-block', id, data)
    if (refKey) await addLink(tx, docRef, tx.payload[refKey], 'embeds', { anchor: { blockId: id } })
    return { collection: 'doc-block', id, revision: record.revision, ref: docRef, changes: [kind] }
  }
}

async function ensureDaily(tx: ReferenceTx): Promise<{ id: string; revision: number }> {
  const id = deterministicId(tx.ctx.workspaceId, 'daily', tx.actor, tx.payload.date)
  const existing = await tx.get('note', id)
  if (existing && !isDeleted(existing)) return existing
  const record = await tx.upsert('note', id, { subtype: 'daily', dailyDate: tx.payload.date, title: tx.payload.date, ownerId: tx.actor, state: 'draft' })
  return record
}

async function aclEntry(tx: ReferenceTx, resource: EntityRef, principalId: string, role: string | null): Promise<void> {
  const id = deterministicId(tx.ctx.workspaceId, 'acl', refString(resource), 'principal', principalId)
  const current = await tx.get('acl-entry', id)
  await assertNotOwner(tx, resource, principalId, current)
  if (role === null) {
    if (current && !isDeleted(current)) await tx.softDelete('acl-entry', current)
    return
  }
  await tx.upsert('acl-entry', id, { role: storedAclRole(role), grantedBy: tx.actor }, { resourceType: resource.kind, resourceId: resource.id, subjectType: 'principal', subjectId: principalId })
}

const publishPost = transition('note', tx => ({ state: 'published', publishedAt: tx.now, subtype: 'post', ...(tx.payload.parentRef ? { parentRef: refString(tx.payload.parentRef) } : {}) }))
const createDocument = create('note', tx => ({ ...omit(tx.payload, ['id', 'markdown', 'parentRef']), ...(tx.payload.markdown !== undefined ? { markdownSnapshot: tx.payload.markdown } : {}), ...(tx.payload.parentRef ? { parentRef: refString(tx.payload.parentRef) } : {}) }), { defaults: noteDefaults, container: { kind: 'folder', field: 'folderId' } })

/** Containers a new doc is written into (`write`; the folder may be the target). */
async function authorizeDocContainers(tx: ReferenceTx): Promise<void> {
  await authorizeId(tx, 'wiki-space', tx.payload.wikiSpaceId, 'write')
  await authorizeId(tx, 'space', tx.payload.spaceId, 'write')
  if (tx.payload.parentRef) await authorizeRef(tx, tx.payload.parentRef as EntityRef, 'write')
}

/** Owner of a folder: a personal folder is the actor's own, any other owner needs `write`. */
/** Whether `folderId` is (inside) one of `ancestors` (walks `parentId`, bounded). */
async function isInside(tx: ReferenceTx, folderId: string, ancestors: ReadonlySet<string>): Promise<boolean> {
  let current: string | null = folderId
  for (let depth = 0; current && depth < 256; depth += 1) {
    if (ancestors.has(current)) return true
    const parent: unknown = (await tx.get('folder', current))?.data.parentId
    current = typeof parent === 'string' && parent ? parent : null
  }
  return false
}

async function authorizeFolderOwner(tx: ReferenceTx): Promise<void> {
  const { ownerType, ownerId } = tx.payload
  if (ownerId === undefined) return
  if (ownerType === undefined || ownerType === 'user') {
    if (ownerId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'a personal folder belongs to its creator')
    return
  }
  if (ownerType === 'workspace') {
    if (ownerId !== tx.ctx.workspaceId) throw new CommandRejection('FORBIDDEN', 'a workspace folder belongs to this workspace')
    return
  }
  await authorizeRef(tx, { kind: ownerType === 'chat' ? 'channel' : ownerType, id: ownerId } as EntityRef, 'write')
}

export const DOCS_REFERENCE_SPECS: ReferenceSpecMap = {
  'docs.create_document': {
    event: 'docs.document_created',
    op: async tx => { await authorizeDocContainers(tx); return createDocument(tx) },
  },
  'docs.move_note_to_shared': {
    event: 'docs.note_shared',
    op: noteFrom(tx => ({ kind: 'note', id: tx.payload.noteId }), tx => ({ sourceNoteRef: `note:${tx.payload.noteId}`, markdownSnapshot: tx.payload.markdown, state: 'published', publishedAt: tx.now, migratedFromLocalAt: tx.now, ...(tx.payload.folderId ? { folderId: tx.payload.folderId } : {}), ...(tx.payload.spaceId ? { spaceId: tx.payload.spaceId } : {}) })),
  },
  'docs.move_back_to_private': transition('note', tx => ({ state: 'draft', movedBackAt: tx.now })),
  'docs.update_title': { op: update('note'), event: 'docs.document_edited' },
  'docs.publish_post': async tx => {
    if (tx.payload.parentRef) await authorizeRef(tx, tx.payload.parentRef as EntityRef, 'write')
    return publishPost(tx)
  },
  'docs.schedule_post': transition('note', tx => ({ state: 'scheduled', scheduledAt: tx.payload.scheduledAt })),
  'docs.restore_version': { op: transition('note', tx => ({ restoredFromVersion: tx.payload.version, snapshotAt: tx.now })), event: 'docs.document_version_restored' },
  'docs.set_public_sharing': {
    // Enabling mints one random token per document; re-running the command (a
    // retried command id, or a second enable) keeps the existing token.
    op: transition('note', (tx, current) => ({ publicToken: tx.payload.enabled ? ((current?.data.publicToken as string | undefined) ?? publicToken()) : null })),
    event: 'docs.document_public_sharing_changed',
  },
  'docs.update_permissions': {
    event: 'docs.permission_changed',
    op: async tx => {
      const note = await tx.requireTarget('note')
      for (const entry of tx.payload.entries as Array<{ principalId: string; role: string | null }>) await aclEntry(tx, { kind: 'note', id: note.id }, entry.principalId, entry.role)
      return { collection: 'note', id: note.id, revision: note.revision, changes: ['permissions'] }
    },
  },
  // W1-14 (#1511): `docs.suggest_changes`, `docs.sync_suggestions`,
  // `docs.decide_suggestion` and `docs.record_view` are handled by the collab
  // module (@rox/server-core/collab).
  'docs.apply_patch': async tx => {
    // The patched doc is the authorized target.
    boundRef(tx, { kind: 'note', id: tx.payload.noteId }, { requireTarget: true })
    const id = tx.newId('patch')
    const record = await tx.insert('doc-block', id, { docKind: 'note', docId: tx.payload.noteId, kind: 'patch', patch: tx.payload.patch, ...(tx.payload.baseRevision ? { baseRevision: tx.payload.baseRevision } : {}) })
    return { collection: 'doc-block', id, revision: record.revision, ref: { kind: 'note', id: tx.payload.noteId }, changes: ['patch'] }
  },
  'docs.ensure_daily_note': async tx => {
    const note = await ensureDaily(tx)
    return { collection: 'note', id: note.id, revision: note.revision, changes: ['dailyDate'] }
  },
  'docs.append_daily_link': async tx => {
    // The linked entity is only referenced.
    await authorizeRef(tx, tx.payload.link as EntityRef, 'read')
    const note = await ensureDaily(tx)
    const id = tx.newId('daily-link')
    await tx.insert('doc-block', id, { docKind: 'note', docId: note.id, kind: 'link', link: tx.payload.link, ...(tx.payload.label ? { label: tx.payload.label } : {}) })
    await addLink(tx, { kind: 'note', id: note.id }, tx.payload.link, 'mentions', { anchor: { blockId: id } })
    return { collection: 'note', id: note.id, revision: note.revision, changes: ['blocks'] }
  },
  'docs.create_meeting_notes': { op: noteFrom(tx => tx.payload.eventRef, tx => ({ subtype: 'minutes', title: tx.payload.title ?? refString(tx.payload.eventRef) })), event: 'docs.document_created' },
  // W1-14 (#1511): the §12 cross-surface commands (insert_*_block, embed_view,
  // create_from_messages) are handled by @rox/server-core/xsc.
  'docs.append_block': block('markdown'),
  'docs.create_from_email': { op: noteFrom(tx => ({ kind: 'mail-thread', id: tx.payload.threadId }), tx => ({ title: tx.payload.title ?? `mail-thread:${tx.payload.threadId}` })), event: 'docs.document_created' },
}

const importAttachment = create('file', tx => ({ name: tx.payload.name ?? tx.payload.attachmentId, sourceRef: `${refString(tx.payload.source)}#${tx.payload.attachmentId}`, ...(tx.payload.folderId ? { folderId: tx.payload.folderId } : {}) }), { defaults: tx => ({ uploadedBy: tx.actor, currentVersion: 1 }) })

export const DRIVE_REFERENCE_SPECS: ReferenceSpecMap = {
  'drive.create_folder': async tx => {
    // The parent folder is written into: authorized (bound to a folder target) before it is loaded.
    await authorizeId(tx, 'folder', tx.payload.parentId, 'write', { bound: true })
    if (tx.payload.parentId) await tx.require('folder', tx.payload.parentId)
    await authorizeFolderOwner(tx)
    return create('folder', payloadFields(), { defaults: tx => ({ ownerType: 'user', ownerId: tx.actor }), container: { kind: 'folder', field: 'parentId' } })(tx)
  },
  'drive.rename_folder': update('folder'),
  /**
   * A move: the item leaves its current folder (placement row detached, the
   * item's `folderId` / a folder's `parentId` updated) and lands in the
   * destination. Destination (bound to a folder target), every item and every
   * source folder (moved FROM) need `write`, all checked before the first write.
   */
  'drive.move_items': async tx => {
    await authorizeBound(tx, { kind: 'folder', id: tx.payload.toFolderId }, 'write')
    const folder = await tx.require('folder', tx.payload.toFolderId)
    const moves: Array<{ item: EntityRef; record: StoredRecord | null; collection: string | undefined; field: string; from: string | null }> = []
    for (const item of tx.payload.items as EntityRef[]) {
      await authorizeRef(tx, item, 'write')
      if (item.kind === 'folder' && item.id === folder.id) throw new CommandRejection('VALIDATION', 'a folder cannot be moved into itself')
      const collection = collectionOfKind(item.kind)
      const record = collection ? await tx.get(collection, item.id) : null
      const field = item.kind === 'folder' ? 'parentId' : 'folderId'
      const from = record && typeof record.data[field] === 'string' && record.data[field] ? String(record.data[field]) : null
      if (from && from !== folder.id) await authorizeRef(tx, { kind: 'folder', id: from } as EntityRef, 'write')
      moves.push({ item, record, collection, field, from })
    }
    if (moves.some(move => move.item.kind === 'folder') && await isInside(tx, folder.id, new Set(moves.filter(move => move.item.kind === 'folder').map(move => move.item.id)))) {
      throw new CommandRejection('VALIDATION', 'a folder cannot be moved into its own subfolder')
    }
    for (const { item, record, collection, field, from } of moves) {
      if (from && from !== folder.id) {
        const placement = await tx.get('folder-item', `${from}:${refString(item)}`)
        if (placement && !isDeleted(placement) && !placement.data.isShortcut) await tx.softDelete('folder-item', placement)
      }
      if (record && collection && !isDeleted(record) && record.data[field] !== folder.id) await tx.update(collection, record, { [field]: folder.id })
      await tx.upsert('folder-item', `${folder.id}:${refString(item)}`, { isShortcut: false, addedBy: tx.actor }, { folderId: folder.id, itemRef: refString(item) })
    }
    return { collection: 'folder', id: folder.id, revision: folder.revision, changes: ['items'], result: { moved: moves.map(move => refString(move.item)) } }
  },
  'drive.add_link': create('drive-link', payloadFields(), { defaults: tx => ({ linkType: 'other', authorId: tx.actor }), container: { kind: 'folder', field: 'folderId' } }),
  'drive.upload_file': create('file', payloadFields(), { defaults: tx => ({ uploadedBy: tx.actor, currentVersion: 1 }), container: { kind: 'folder', field: 'folderId' } }),
  'drive.favorite': async tx => {
    // A favorite only references the item; a target of its kind must be it.
    await authorizeBound(tx, tx.payload.item as EntityRef, 'read')
    const id = `${tx.actor}:${refString(tx.payload.item)}`
    if (!tx.payload.favorite) {
      const current = await tx.get('drive-favorite', id)
      if (!current || isDeleted(current)) throw new CommandRejection('NOT_FOUND', 'not a favorite')
      const record = await tx.softDelete('drive-favorite', current)
      return { collection: 'drive-favorite', id, revision: record.revision, ref: tx.payload.item, changes: ['favorite'] }
    }
    const record = await tx.upsert('drive-favorite', id, { ...(tx.payload.sortKey ? { sortKey: tx.payload.sortKey } : {}) }, { principalId: tx.actor, itemRef: refString(tx.payload.item) })
    return { collection: 'drive-favorite', id, revision: record.revision, ref: tx.payload.item, changes: ['favorite'] }
  },
  'drive.add_shortcut': async tx => {
    await authorizeBound(tx, { kind: 'folder', id: tx.payload.folderId }, 'write')
    const folder = await tx.require('folder', tx.payload.folderId)
    await authorizeRef(tx, tx.payload.item as EntityRef, 'read')
    const record = await tx.upsert('folder-item', `${folder.id}:${refString(tx.payload.item)}`, { isShortcut: true, addedBy: tx.actor }, { folderId: folder.id, itemRef: refString(tx.payload.item) })
    return { collection: 'folder-item', id: record.id, revision: record.revision, ref: { kind: 'folder', id: folder.id }, changes: ['shortcut'] }
  },
  // W1-14 (#1511): drive.provision / drive.open_upload / drive.complete_upload
  // (the quota-bearing upload protocol of §16) are handled by
  // @rox/server-core/drive.
  'drive.import_attachment': async tx => {
    await authorizeRef(tx, tx.payload.source as EntityRef, 'read')
    await authorizeId(tx, 'folder', tx.payload.folderId, 'write')
    return importAttachment(tx)
  },
}

export const WIKI_REFERENCE_SPECS: ReferenceSpecMap = {
  'wiki.create_space': async tx => {
    await authorizeId(tx, 'space', tx.payload.spaceId, 'write')
    return create('wiki-space')(tx)
  },
  'wiki.move_node': async tx => {
    const space = await tx.requireTarget('wiki-space')
    // The moved node and its new parent are written (placement).
    await authorizeRef(tx, tx.payload.node as EntityRef, 'write')
    if (tx.payload.parent) await authorizeRef(tx, tx.payload.parent as EntityRef, 'write')
    const key = `${space.id}:${refString(tx.payload.node)}`
    const record = await tx.upsert('wiki-node', key, { parentRef: tx.payload.parent ? refString(tx.payload.parent) : null, sortKey: tx.payload.sortKey }, { wikiSpaceId: space.id, nodeRef: refString(tx.payload.node) })
    return { collection: 'wiki-node', id: key, revision: record.revision, ref: tx.rawTarget ?? null, changes: ['parentRef', 'sortKey'] }
  },
}
