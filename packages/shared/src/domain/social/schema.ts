/** W1-06 (#1503) — Comments, reactions, subscriptions: TECH-SPEC §4.13, §12; DATA-MODEL §5.12. */
import { z } from 'zod'
import { cmd, createIdShape, emojiSchema, emptyPayload, entity, idSchema, principalListSchema, refSchema, richTextSchema, type CommandSchemaMap } from '../common'

export const commentSchema = entity({
  parentRef: z.string(), threadId: idSchema.optional(), authorId: idSchema.optional(), content: richTextSchema, anchor: z.record(z.string(), z.unknown()).optional(),
  resolvedAt: z.string().optional(), editedAt: z.string().optional(),
})
export const reactionSchema = entity({ subjectRef: z.string(), principalId: idSchema, emoji: emojiSchema })

export const SOCIAL_COMMAND_SCHEMAS: CommandSchemaMap = {
  'comments.create': cmd({ ...createIdShape, parent: refSchema.optional(), threadId: idSchema.optional(), content: richTextSchema, anchor: z.record(z.string(), z.unknown()).optional(), mentions: principalListSchema.optional() }),
  'comments.edit': cmd({ content: richTextSchema }),
  'comments.delete': emptyPayload,
  'comments.react': cmd({ emoji: emojiSchema, on: z.boolean().default(true) }),
  'comments.resolve': emptyPayload,
  'comments.resolve_thread': cmd({ threadId: idSchema }),
  'comments.reopen_thread': cmd({ threadId: idSchema }),
  'comments.convert_to_task': cmd({ ...createIdShape, title: z.string().trim().min(1).max(500).optional(), listId: idSchema.optional(), assigneeIds: principalListSchema.optional() }),
  'reactions.add': cmd({ emoji: emojiSchema }),
  'reactions.remove': cmd({ emoji: emojiSchema }),
  'subscriptions.subscribe': cmd({ principalIds: principalListSchema.optional() }),
  'subscriptions.unsubscribe': cmd({ principalIds: principalListSchema.optional() }),
  'subscriptions.set_notify_everyone': cmd({ enabled: z.boolean() }),
}

export const SOCIAL_ENTITY_SCHEMAS = { comment: commentSchema, reaction: reactionSchema } as const
