/** W1-06 (#1503) — Messenger (`im.*`): TECH-SPEC §4.1, §12, §15.1, §20; DATA-MODEL §5.3. */
import { z } from 'zod'
import { cmd, colorSchema, createIdShape, emptyPayload, entity, idSchema, nameSchema, principalListSchema, refSchema, richTextSchema, sortKeySchema, type CommandSchemaMap } from '../common'

export const chatKindSchema = z.enum(['p2p', 'group', 'topic', 'space', 'entity', 'bot'])
export const chatVisibilitySchema = z.enum(['private', 'public'])
const messageContentSchema = z.object({
  doc: richTextSchema,
  mentions: z.array(refSchema).max(200).optional(),
  unfurls: z.array(z.object({ ref: refSchema }).strict()).max(20).optional(),
}).strict()

export const chatSchema = entity({
  kind: chatKindSchema, visibility: chatVisibilitySchema, name: z.string().max(200).optional(), description: z.string().max(2000).optional(),
  spaceId: idSchema.optional(), subjectRef: z.string().optional(), createdBy: idSchema.optional(),
  postingPolicy: z.enum(['all', 'admins']).optional(), invitePolicy: z.enum(['members', 'admins']).optional(),
})
export const messageSchema = entity({ chatId: idSchema, seq: z.number().int().nonnegative(), senderId: idSchema.optional(), content: messageContentSchema, replyTo: idSchema.optional(), editedAt: z.string().optional() })

const chatCreateShape = {
  ...createIdShape, kind: chatKindSchema.default('group'), visibility: chatVisibilitySchema.default('private'), name: z.string().trim().max(200).optional(),
  description: z.string().max(2000).optional(), memberIds: principalListSchema.optional(),
}

export const MESSENGER_COMMAND_SCHEMAS: CommandSchemaMap = {
  'im.create_chat': cmd(chatCreateShape),
  'im.update_chat': cmd({ name: z.string().trim().max(200).optional(), description: z.string().max(2000).nullable().optional() }).refine(v => Object.keys(v).length > 0, { message: 'empty update' }),
  'im.disband_chat': emptyPayload,
  'im.get_or_create_p2p': cmd({ ...createIdShape, peerId: idSchema }),
  'im.add_members': cmd({ memberIds: principalListSchema.min(1) }),
  'im.remove_members': cmd({ memberIds: principalListSchema.min(1) }),
  'im.update_member_state': cmd({
    muted: z.boolean().optional(), flagged: z.boolean().optional(), pinned: z.boolean().optional(), done: z.boolean().optional(),
    alias: z.string().max(200).nullable().optional(), headerButtons: z.array(z.string().max(64)).max(20).optional(), openPanel: z.string().max(64).nullable().optional(),
  }),
  'im.update_policy': cmd({ postingPolicy: z.enum(['all', 'admins']).optional(), invitePolicy: z.enum(['members', 'admins']).optional() }),
  'im.send_message': cmd({ ...createIdShape, content: messageContentSchema, replyTo: idSchema.optional() }),
  'im.edit_message': cmd({ messageId: idSchema, content: messageContentSchema }),
  'im.recall_message': cmd({ messageId: idSchema }),
  'im.forward_messages': cmd({ messageIds: z.array(idSchema).min(1).max(100), toChatId: idSchema }),
  'im.pin': cmd({ messageId: idSchema }),
  'im.unpin': cmd({ messageId: idSchema }),
  'im.set_top_notice': cmd({ content: richTextSchema.nullable() }),
  'im.update_announcement': cmd({ docId: idSchema.nullable() }),
  'im.create_tab': cmd({ ...createIdShape, kind: z.enum(['doc', 'link', 'entity', 'files', 'pins']), title: z.string().max(200).optional(), ref: refSchema.optional(), sortKey: sortKeySchema.optional() }),
  'im.update_tab': cmd({ tabId: idSchema, title: z.string().max(200).optional(), sortKey: sortKeySchema.optional() }),
  'im.delete_tab': cmd({ tabId: idSchema }),
  'im.mark_read': cmd({ seq: z.number().int().nonnegative() }),
  'im.mark_unread': cmd({ seq: z.number().int().nonnegative() }),
  'im.create_label': cmd({ ...createIdShape, name: nameSchema, color: colorSchema.optional() }),
  'im.label_chats': cmd({ labelId: idSchema, messageIds: z.array(idSchema).max(500) }),
  'im.create_space_chat': cmd({ ...createIdShape, spaceId: idSchema, name: nameSchema, memberIds: principalListSchema.optional() }),
  'im.create_entity_chat': cmd({ ...createIdShape, subject: refSchema, name: z.string().trim().max(200).optional(), memberIds: principalListSchema.optional() }),
  'im.join_chat': emptyPayload,
  'im.leave_chat': emptyPayload,
  'im.set_visibility': cmd({ visibility: chatVisibilitySchema }),
  'im.share_entity': cmd({ entity: refSchema, comment: z.string().max(5000).optional() }),
}

export const MESSENGER_ENTITY_SCHEMAS = { channel: chatSchema, 'channel-message': messageSchema } as const
