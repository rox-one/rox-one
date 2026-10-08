/** W1-06 (#1503) — Reference ops: messenger `im.*` (TECH-SPEC §4.1, §12, §15.1, §20). */

import { CommandRejection } from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import { deterministicId, isDeleted, LAST_COMMAND_FIELD, type ReferenceOutcome, type ReferenceTx } from '../engine'
import { assoc, authorizeId, authorizeRef, childCreate, childDelete, childUpdate, omit, payloadFields, refString, requireChild, softDelete, unassoc, update } from '../ops'
import type { RecordData, StoredRecord } from '../types'
import type { ReferenceSpecMap } from './types'

const ADMIN_ROLES = new Set(['owner', 'admin'])

async function addMembers(tx: ReferenceTx, chatId: string, principalIds: Iterable<string>, role = 'member'): Promise<void> {
  for (const principalId of new Set(principalIds)) {
    const id = `${chatId}:${principalId}`
    const current = await tx.get('channel-member', id)
    await tx.upsert('channel-member', id, { state: 'active', ...(current ? {} : { role, joinedAt: tx.now }) }, { chatId, principalId })
  }
}

async function createChat(tx: ReferenceTx, id: string, data: RecordData, memberIds: readonly string[] = []): Promise<StoredRecord> {
  const record = await tx.insert('channel', id, { postingPolicy: 'all', invitePolicy: 'members', ...data })
  await addMembers(tx, id, [tx.actor], 'owner')
  await addMembers(tx, id, memberIds.filter(member => member !== tx.actor))
  return record
}

function memberRole(member: StoredRecord | null): string | undefined {
  return member && !isDeleted(member) && member.data.state !== 'left' ? String(member.data.role ?? 'member') : undefined
}

/**
 * Append a message to a chat (next `seq`). Posting needs active membership of
 * the chat and its posting policy (`admins` → owner / admin only).
 */
export async function appendMessage(tx: ReferenceTx, chat: StoredRecord, content: unknown, extra: RecordData = {}, salt = 'message'): Promise<StoredRecord> {
  const role = memberRole(await tx.get('channel-member', `${chat.id}:${tx.actor}`))
  if (role === undefined) throw new CommandRejection('FORBIDDEN', 'only members can post in this chat')
  if (chat.data.postingPolicy === 'admins' && !ADMIN_ROLES.has(role)) throw new CommandRejection('FORBIDDEN', 'only admins can post in this chat')
  const id = salt === 'message' ? tx.createId() : tx.newId(salt)
  // Retry with a lost receipt: the message is already there — don't burn another `seq`.
  const existing = await tx.get('channel-message', id)
  if (existing && existing.data[LAST_COMMAND_FIELD] === tx.ctx.envelope.commandId) return existing
  await tx.assertAbsent('channel-message', id)
  const sequence = await tx.get('channel-sequence', chat.id)
  const seq = Number(sequence?.data.lastSeq ?? 0) + 1
  await tx.upsert('channel-sequence', chat.id, { lastSeq: seq }, { chatId: chat.id })
  return tx.insert('channel-message', id, { chatId: chat.id, seq, senderId: tx.actor, content, ...extra })
}

/** Load a message of the target chat; only its sender may change it. */
async function ownMessage(tx: ReferenceTx): Promise<StoredRecord> {
  const { child } = await requireChild(tx, 'channel-message', 'channel', 'chatId', 'messageId')
  if (child.data.senderId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'only the sender can change a message')
  return child
}

const chatOutcome = (record: StoredRecord, changes: string[], result?: Record<string, unknown>): ReferenceOutcome => ({ collection: 'channel', id: record.id, revision: record.revision, changes, ...(result ? { result } : {}) })
const self = (tx: ReferenceTx) => tx.actor

export const MESSENGER_REFERENCE_SPECS: ReferenceSpecMap = {
  'im.create_chat': async tx => {
    const record = await createChat(tx, tx.createId(), omit(tx.payload, ['id', 'memberIds']), tx.payload.memberIds ?? [])
    return chatOutcome(record, ['kind', 'name', 'visibility'])
  },
  'im.update_chat': { op: update('channel'), event: 'im.chat.updated_v1' },
  'im.disband_chat': { op: softDelete('channel'), event: 'im.chat.disbanded_v1' },
  'im.get_or_create_p2p': async tx => {
    if (tx.payload.peerId === tx.actor) throw new CommandRejection('VALIDATION', 'peer must be another principal')
    const id = deterministicId(tx.ctx.workspaceId, 'p2p', ...[tx.actor, tx.payload.peerId].sort())
    const existing = await tx.get('channel', id)
    if (existing && !isDeleted(existing)) return chatOutcome(existing, [], { existed: true })
    const record = await createChat(tx, id, { kind: 'p2p', visibility: 'private' }, [tx.payload.peerId])
    return chatOutcome(record, ['kind'], { existed: false })
  },
  'im.add_members': {
    event: 'im.chat.member.user.added_v1',
    op: async tx => {
      const chat = await tx.requireTarget('channel')
      const role = memberRole(await tx.get('channel-member', `${chat.id}:${tx.actor}`))
      if (chat.data.invitePolicy === 'admins' && !ADMIN_ROLES.has(role ?? '')) throw new CommandRejection('FORBIDDEN', 'only admins can add members')
      await addMembers(tx, chat.id, tx.payload.memberIds)
      return chatOutcome(chat, ['members'])
    },
  },
  'im.remove_members': {
    event: 'im.chat.member.user.deleted_v1',
    op: async tx => {
      const chat = await tx.requireTarget('channel')
      for (const principalId of tx.payload.memberIds as string[]) {
        const member = await tx.get('channel-member', `${chat.id}:${principalId}`)
        if (member && !isDeleted(member)) await tx.update('channel-member', member, { state: 'left', deletedAt: tx.now })
      }
      return chatOutcome(chat, ['members'])
    },
  },
  'im.update_member_state': assoc('channel-member', 'channel', self, payloadFields(), 'chatId'),
  'im.update_policy': update('channel'),
  'im.send_message': {
    event: 'im.message.receive_v1',
    op: async tx => {
      const chat = await tx.requireTarget('channel')
      const message = await appendMessage(tx, chat, tx.payload.content, tx.payload.replyTo ? { replyTo: tx.payload.replyTo } : {})
      return { collection: 'channel-message', id: message.id, revision: message.revision, changes: ['content'], result: { seq: message.data.seq } }
    },
  },
  'im.edit_message': async tx => {
    const message = await ownMessage(tx)
    const record = await tx.update('channel-message', message, { content: tx.payload.content, editedAt: tx.now })
    return { collection: 'channel-message', id: message.id, revision: record.revision, changes: ['content'] }
  },
  'im.recall_message': async tx => {
    const message = await ownMessage(tx)
    const record = await tx.softDelete('channel-message', message)
    return { collection: 'channel-message', id: message.id, revision: record.revision, changes: ['deletedAt'] }
  },
  'im.forward_messages': async tx => {
    const source = await tx.requireTarget('channel')
    const destination = await tx.require('channel', tx.payload.toChatId)
    // The destination is posted into: authorized at `write`, membership + posting policy in appendMessage.
    await authorizeRef(tx, { kind: 'channel', id: destination.id }, 'write')
    const originals: StoredRecord[] = []
    for (const messageId of tx.payload.messageIds as string[]) {
      const original = await tx.require('channel-message', messageId)
      if (original.data.chatId !== source.id) throw new CommandRejection('NOT_FOUND', `${messageId} is not in this chat`)
      originals.push(original)
    }
    const forwarded: string[] = []
    for (const [index, original] of originals.entries()) {
      const copy = await appendMessage(tx, destination, original.data.content, { forwardedFrom: { chatId: source.id, messageId: original.id } }, `forward-${index}`)
      forwarded.push(copy.id)
    }
    return { collection: 'channel', id: destination.id, revision: destination.revision, changes: ['messages'], result: { forwarded } }
  },
  'im.pin': async tx => {
    const { owner, child } = await requireChild(tx, 'channel-message', 'channel', 'chatId', 'messageId')
    const record = await tx.upsert('channel-pin', `${owner.id}:${child.id}`, { pinnedBy: tx.actor }, { chatId: owner.id, messageId: child.id })
    return { collection: 'channel-pin', id: record.id, revision: record.revision, ref: tx.rawTarget ?? null, changes: ['pinned'] }
  },
  'im.unpin': unassoc('channel-pin', 'channel', tx => tx.payload.messageId),
  'im.set_top_notice': async tx => {
    const chat = await tx.requireTarget('channel')
    const record = await tx.upsert('channel-notice', chat.id, { content: tx.payload.content, updatedBy: tx.actor }, { chatId: chat.id })
    return { collection: 'channel-notice', id: chat.id, revision: record.revision, ref: tx.rawTarget ?? null, changes: ['content'] }
  },
  'im.update_announcement': async tx => {
    await authorizeId(tx, 'note', tx.payload.docId, 'read')
    return update('channel', t => ({ announcementDocId: t.payload.docId }))(tx)
  },
  'im.create_tab': async tx => {
    if (tx.payload.ref) await authorizeRef(tx, tx.payload.ref as EntityRef, 'read')
    return childCreate('channel-tab', 'channel', 'chatId', t => ({ ...omit(t.payload, ['id', 'ref']), ...(t.payload.ref ? { ref: refString(t.payload.ref) } : {}) }))(tx)
  },
  'im.update_tab': childUpdate('channel-tab', 'channel', 'chatId', 'tabId'),
  'im.delete_tab': childDelete('channel-tab', 'channel', 'chatId', 'tabId'),
  'im.mark_read': { op: assoc('channel-member', 'channel', self, tx => ({ lastReadSeq: tx.payload.seq }), 'chatId'), event: 'im.message.message_read_v1' },
  'im.mark_unread': assoc('channel-member', 'channel', self, tx => ({ lastReadSeq: Math.max(0, tx.payload.seq - 1) }), 'chatId'),
  'im.create_label': childCreate('channel-label', 'channel', 'chatId'),
  'im.label_chats': childUpdate('channel-label', 'channel', 'chatId', 'labelId', tx => ({ messageIds: tx.payload.messageIds })),
  'im.create_space_chat': async tx => {
    await tx.require('space', tx.payload.spaceId)
    await authorizeId(tx, 'space', tx.payload.spaceId, 'write')
    const record = await createChat(tx, tx.createId(), { kind: 'space', visibility: 'private', name: tx.payload.name, spaceId: tx.payload.spaceId }, tx.payload.memberIds ?? [])
    return chatOutcome(record, ['kind', 'name', 'spaceId'])
  },
  'im.create_entity_chat': async tx => {
    const subject = tx.payload.subject as EntityRef
    await authorizeRef(tx, subject, 'read')
    const record = await createChat(tx, tx.createId(), { kind: 'entity', visibility: 'private', subjectRef: refString(subject), ...(tx.payload.name ? { name: tx.payload.name } : {}) }, tx.payload.memberIds ?? [])
    return chatOutcome(record, ['kind', 'subjectRef'])
  },
  'im.join_chat': {
    event: 'im.chat.member.user.added_v1',
    op: async tx => {
      const chat = await tx.requireTarget('channel')
      if (chat.data.visibility !== 'public') throw new CommandRejection('FORBIDDEN', 'only public chats can be joined')
      await addMembers(tx, chat.id, [tx.actor])
      return chatOutcome(chat, ['members'])
    },
  },
  'im.leave_chat': { op: unassoc('channel-member', 'channel', self), event: 'im.chat.member.user.deleted_v1' },
  'im.set_visibility': update('channel'),
  'im.share_entity': async tx => {
    const chat = await tx.requireTarget('channel')
    await authorizeRef(tx, tx.payload.entity as EntityRef, 'read')
    const message = await appendMessage(tx, chat, { doc: tx.payload.comment ?? '', unfurls: [{ ref: tx.payload.entity }] })
    return { collection: 'channel-message', id: message.id, revision: message.revision, changes: ['content'], result: { seq: message.data.seq } }
  },
}
