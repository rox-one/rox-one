/** W1-06 (#1503) — Docs, Drive, Wiki: TECH-SPEC §4.2, §11, §12, §14.3, §16, §18.2, §20; DATA-MODEL §5.2, §5.15, §5.17. */
import { z } from 'zod'
import {
  cmd, createIdShape, emptyPayload, entity, idSchema, isoDateSchema, isoDateTimeSchema, longTextSchema, nameSchema, principalIdSchema,
  refSchema, richTextSchema, sortKeySchema, titleSchema, urlSchema, type CommandSchemaMap,
} from '../common'

export const docSubtypeSchema = z.enum(['doc', 'post', 'announcement', 'wiki-page', 'minutes', 'daily', 'template', 'check-in-body'])
export const docRoleSchema = z.enum(['viewer', 'commenter', 'editor', 'full_access'])
export const linkTypeSchema = z.enum(['airtable', 'dropbox', 'figma', 'google', 'google_doc', 'google_sheet', 'google_slides', 'notion', 'other'])

export const docSchema = entity({
  ownerId: idSchema, subtype: docSubtypeSchema, title: z.string().max(500), folderId: idSchema.optional(), wikiSpaceId: idSchema.optional(),
  parentRef: z.string().optional(), spaceId: idSchema.optional(), state: z.enum(['draft', 'scheduled', 'published']),
  scheduledAt: isoDateTimeSchema.optional(), publishedAt: isoDateTimeSchema.optional(), sourceNoteRef: z.string().optional(),
  markdownSnapshot: z.string().optional(), publicToken: z.string().optional(), pageWidth: z.enum(['standard', 'wide', 'full']).optional(),
})
export const folderSchema = entity({ parentId: idSchema.optional(), ownerType: z.enum(['user', 'space', 'goal', 'project', 'chat', 'workspace']), ownerId: idSchema.optional(), name: nameSchema })
export const driveLinkSchema = entity({ folderId: idSchema.optional(), url: urlSchema, linkType: linkTypeSchema, title: titleSchema, description: richTextSchema.optional(), authorId: idSchema.optional() })
export const wikiSpaceSchema = entity({ name: nameSchema, description: z.string().optional(), icon: z.string().optional(), spaceId: idSchema.optional(), homeDocId: idSchema.optional() })
export const fileSchema = entity({ folderId: idSchema.optional(), name: nameSchema, sizeBytes: z.number().int().nonnegative().optional(), contentType: z.string().optional(), sourceRef: z.string().optional() })

/** `rox_authority` frontmatter (DATA-MODEL §5.2). */
export const noteFrontmatterSchema = z.object({
  rox_id: z.string().min(1).max(256).optional(),
  rox_authority: z.enum(['local', 'workspace']).optional(),
  rox_doc_id: z.string().min(1).max(256).optional(),
  rox_subtype: docSubtypeSchema.optional(),
}).passthrough()

const blockShape = { docRef: refSchema, afterBlockId: idSchema.optional() }

export const DOCS_COMMAND_SCHEMAS: CommandSchemaMap = {
  'docs.create_document': cmd({
    ...createIdShape, title: z.string().max(500).default(''), subtype: docSubtypeSchema.optional(), folderId: idSchema.optional(),
    wikiSpaceId: idSchema.optional(), parentRef: refSchema.optional(), spaceId: idSchema.optional(), markdown: longTextSchema.optional(),
  }),
  'docs.move_note_to_shared': cmd({ ...createIdShape, noteId: idSchema, markdown: longTextSchema, folderId: idSchema.optional(), spaceId: idSchema.optional() }),
  'docs.move_back_to_private': emptyPayload,
  'docs.update_title': cmd({ title: z.string().max(500) }),
  'docs.publish_post': cmd({ parentRef: refSchema.optional() }),
  'docs.schedule_post': cmd({ scheduledAt: isoDateTimeSchema }),
  'docs.restore_version': cmd({ version: z.number().int().positive() }),
  'docs.set_public_sharing': cmd({ enabled: z.boolean() }),
  'docs.update_permissions': cmd({ entries: z.array(z.object({ principalId: principalIdSchema, role: docRoleSchema.nullable() }).strict()).min(1).max(500) }),
  'docs.suggest_changes': cmd({ ...createIdShape, kind: z.enum(['insert', 'delete', 'replace', 'format']), anchor: z.record(z.string(), z.unknown()), summary: z.string().min(1).max(2000) }),
  'docs.decide_suggestion': cmd({ suggestionId: idSchema, decision: z.enum(['accepted', 'rejected']) }),
  'docs.sync_suggestions': cmd({ suggestionIds: z.array(idSchema).max(500) }),
  'docs.record_view': emptyPayload,
  'docs.apply_patch': cmd({ noteId: idSchema, patch: z.string().min(1).max(200_000), baseRevision: z.string().max(128).optional() }),
  'docs.ensure_daily_note': cmd({ date: isoDateSchema }),
  'docs.append_daily_link': cmd({ date: isoDateSchema, link: refSchema, label: z.string().max(500).optional() }),
  'docs.create_meeting_notes': cmd({ ...createIdShape, eventRef: refSchema, title: titleSchema.optional() }),
  'docs.insert_task_block': cmd({ ...blockShape, taskRef: refSchema }),
  'docs.insert_event_block': cmd({ ...blockShape, eventRef: refSchema }),
  'docs.insert_meeting_block': cmd({ ...blockShape, callRef: refSchema }),
  'docs.embed_view': cmd({ ...blockShape, viewRef: refSchema }),
  'docs.create_from_messages': cmd({ ...createIdShape, chatId: idSchema, seqs: z.array(z.number().int().nonnegative()).min(1).max(500), title: titleSchema.optional() }),
  'docs.append_block': cmd({ ...blockShape, markdown: z.string().min(1).max(50_000) }),
  'docs.create_from_email': cmd({ ...createIdShape, threadId: idSchema, title: titleSchema.optional() }),
}

export const DRIVE_COMMAND_SCHEMAS: CommandSchemaMap = {
  'drive.create_folder': cmd({ ...createIdShape, name: nameSchema, parentId: idSchema.optional(), ownerType: z.enum(['user', 'space', 'goal', 'project', 'chat', 'workspace']).optional(), ownerId: idSchema.optional() }),
  'drive.rename_folder': cmd({ name: nameSchema }),
  'drive.move_items': cmd({ items: z.array(refSchema).min(1).max(500), toFolderId: idSchema }),
  'drive.add_link': cmd({ ...createIdShape, folderId: idSchema.optional(), url: urlSchema, title: titleSchema, linkType: linkTypeSchema.optional(), description: richTextSchema.optional() }),
  'drive.upload_file': cmd({ ...createIdShape, folderId: idSchema.optional(), name: nameSchema, sizeBytes: z.number().int().nonnegative().max(1024 ** 4), contentType: z.string().max(255).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  'drive.favorite': cmd({ item: refSchema, favorite: z.boolean(), sortKey: sortKeySchema.optional() }),
  'drive.add_shortcut': cmd({ item: refSchema, folderId: idSchema }),
  'drive.provision': cmd({ quotaBytes: z.number().int().positive().optional(), backfill: z.boolean().optional() }),
  'drive.open_upload': cmd({ ...createIdShape, folderId: idSchema.optional(), fileName: nameSchema, sizeExpected: z.number().int().nonnegative().max(1024 ** 4), contentType: z.string().max(255).optional() }),
  'drive.complete_upload': cmd({ uploadSessionId: idSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().max(256) }).strict()).max(10_000).optional() }),
  'drive.import_attachment': cmd({ ...createIdShape, source: refSchema, attachmentId: idSchema, folderId: idSchema.optional(), name: nameSchema.optional() }),
}

export const WIKI_COMMAND_SCHEMAS: CommandSchemaMap = {
  'wiki.create_space': cmd({ ...createIdShape, name: nameSchema, description: z.string().max(2000).optional(), icon: z.string().max(64).optional(), spaceId: idSchema.optional() }),
  'wiki.move_node': cmd({ node: refSchema, parent: refSchema.nullable(), sortKey: sortKeySchema }),
}

export const DOCS_ENTITY_SCHEMAS = {
  note: docSchema, folder: folderSchema, 'drive-link': driveLinkSchema, 'wiki-space': wikiSpaceSchema, file: fileSchema,
} as const
