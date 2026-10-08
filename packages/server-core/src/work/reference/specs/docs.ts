/** W1-06 (#1503) — Reference ops: docs, drive, wiki (TECH-SPEC §4.2, §11, §12, §16, §18.2, §20). */

import { CommandRejection } from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import { deterministicId, isDeleted, type ReferenceOutcome, type ReferenceTx } from '../engine'
import { addLink, authorizeBound, authorizeId, authorizeOrigin, authorizeRef, boundRef, childCreate, childUpdate, create, omit, payloadFields, refString, storedAclRole, transition, update } from '../ops'
import type { RecordData } from '../types'
import type { ReferenceSpecMap } from './types'

const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000

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
  'docs.set_public_sharing': { op: transition('note', tx => ({ publicToken: tx.payload.enabled ? tx.newId('public') : null })), event: 'docs.document_public_sharing_changed' },
  'docs.update_permissions': {
    event: 'docs.permission_changed',
    op: async tx => {
      const note = await tx.requireTarget('note')
      for (const entry of tx.payload.entries as Array<{ principalId: string; role: string | null }>) await aclEntry(tx, { kind: 'note', id: note.id }, entry.principalId, entry.role)
      return { collection: 'note', id: note.id, revision: note.revision, changes: ['permissions'] }
    },
  },
  'docs.suggest_changes': childCreate('doc-suggestion', 'note', 'docId', payloadFields(), tx => ({ authorId: tx.actor, status: 'open' })),
  'docs.decide_suggestion': childUpdate('doc-suggestion', 'note', 'docId', 'suggestionId', tx => ({ status: tx.payload.decision, decidedBy: tx.actor, decidedAt: tx.now })),
  'docs.sync_suggestions': transition('note', tx => ({ suggestionsSyncedAt: tx.now, syncedSuggestionIds: tx.payload.suggestionIds })),
  'docs.record_view': async tx => {
    const note = await tx.requireTarget('note')
    const id = `${note.id}:${tx.actor}`
    const current = await tx.get('doc-view', id)
    const record = await tx.upsert('doc-view', id, { lastViewedAt: tx.now, viewCount: Number(current?.data.viewCount ?? 0) + 1 }, { docId: note.id, principalId: tx.actor, firstViewedAt: tx.now })
    return { collection: 'doc-view', id, revision: record.revision, ref: tx.rawTarget ?? null, changes: ['viewCount'] }
  },
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
  'docs.insert_task_block': block('task', 'taskRef'),
  'docs.insert_event_block': block('event', 'eventRef'),
  'docs.insert_meeting_block': block('meeting', 'callRef'),
  'docs.embed_view': block('view', 'viewRef'),
  'docs.create_from_messages': { op: noteFrom(tx => ({ kind: 'channel', id: tx.payload.chatId }), tx => ({ title: tx.payload.title ?? `channel:${tx.payload.chatId}`, sourceMessages: { chatId: tx.payload.chatId, seqs: tx.payload.seqs } })), event: 'docs.document_created' },
  'docs.append_block': block('markdown'),
  'docs.create_from_email': { op: noteFrom(tx => ({ kind: 'mail-thread', id: tx.payload.threadId }), tx => ({ title: tx.payload.title ?? `mail-thread:${tx.payload.threadId}` })), event: 'docs.document_created' },
}

const importAttachment = create('file', tx => ({ name: tx.payload.name ?? tx.payload.attachmentId, sourceRef: `${refString(tx.payload.source)}#${tx.payload.attachmentId}`, ...(tx.payload.folderId ? { folderId: tx.payload.folderId } : {}) }), { defaults: tx => ({ uploadedBy: tx.actor, currentVersion: 1 }) })
const openUpload = create('upload-session', payloadFields(), { defaults: tx => ({ status: 'open', expiresAt: new Date(Date.parse(tx.now) + UPLOAD_SESSION_TTL_MS).toISOString(), ownerPrincipalId: tx.actor }) })

export const DRIVE_REFERENCE_SPECS: ReferenceSpecMap = {
  'drive.create_folder': async tx => {
    if (tx.payload.parentId) await tx.require('folder', tx.payload.parentId)
    await authorizeFolderOwner(tx)
    return create('folder', payloadFields(), { defaults: tx => ({ ownerType: 'user', ownerId: tx.actor }), container: { kind: 'folder', field: 'parentId' } })(tx)
  },
  'drive.rename_folder': update('folder'),
  'drive.move_items': async tx => {
    const folder = await tx.require('folder', tx.payload.toFolderId)
    // Destination folder (the target when one is sent) and every moved item need `write`.
    await authorizeBound(tx, { kind: 'folder', id: folder.id }, 'write')
    for (const item of tx.payload.items as EntityRef[]) await authorizeRef(tx, item, 'write')
    for (const item of tx.payload.items as EntityRef[]) {
      await tx.upsert('folder-item', `${folder.id}:${refString(item)}`, { isShortcut: false, addedBy: tx.actor }, { folderId: folder.id, itemRef: refString(item) })
    }
    return { collection: 'folder', id: folder.id, revision: folder.revision, changes: ['items'] }
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
    const folder = await tx.require('folder', tx.payload.folderId)
    await authorizeBound(tx, { kind: 'folder', id: folder.id }, 'write')
    await authorizeRef(tx, tx.payload.item as EntityRef, 'read')
    const record = await tx.upsert('folder-item', `${folder.id}:${refString(tx.payload.item)}`, { isShortcut: true, addedBy: tx.actor }, { folderId: folder.id, itemRef: refString(tx.payload.item) })
    return { collection: 'folder-item', id: record.id, revision: record.revision, ref: { kind: 'folder', id: folder.id }, changes: ['shortcut'] }
  },
  'drive.provision': async tx => {
    const record = await tx.upsert('drive-quota', tx.actor, { state: 'active', ...(tx.payload.quotaBytes ? { quotaBytes: tx.payload.quotaBytes } : {}) }, { ownerPrincipalId: tx.actor, rootFolderId: tx.newId('root') })
    return { collection: 'drive-quota', id: record.id, revision: record.revision, ref: null, changes: ['state'] }
  },
  'drive.open_upload': async tx => {
    await authorizeId(tx, 'folder', tx.payload.folderId, 'write')
    return openUpload(tx)
  },
  'drive.complete_upload': async tx => {
    const session = await tx.require('upload-session', tx.payload.uploadSessionId)
    if (session.data.ownerPrincipalId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'upload session belongs to another user')
    if (session.data.status !== 'open') throw new CommandRejection('VALIDATION', `upload session is ${String(session.data.status)}`)
    if (typeof session.data.expiresAt === 'string' && Date.parse(session.data.expiresAt) <= Date.parse(tx.now)) throw new CommandRejection('VALIDATION', 'upload session expired')
    // The file lands in the session's folder: still writable now.
    await authorizeId(tx, 'folder', session.data.folderId, 'write')
    await tx.update('upload-session', session, { status: 'completed', sha256: tx.payload.sha256 })
    const id = tx.newId('file')
    const file = await tx.insert('file', id, { name: session.data.fileName, sizeBytes: session.data.sizeExpected, sha256: tx.payload.sha256, uploadedBy: tx.actor, currentVersion: 1, ...(session.data.folderId ? { folderId: session.data.folderId } : {}), ...(session.data.contentType ? { contentType: session.data.contentType } : {}) })
    return { collection: 'file', id, revision: file.revision, changes: ['sha256'], result: { uploadSessionId: session.id } }
  },
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
