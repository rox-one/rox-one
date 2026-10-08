/**
 * W1-12 (#1509) — The automation command module.
 *
 * Binds, through the W1-03 wiring contract (`COMMAND_MODULES`, before the
 * W1-06 reference module so these win):
 * - the payload schemas of the two W1-12 command names
 *   (`task_lists.ensure_system_list`, `notify.send_invite_email`);
 * - the automation contract of the daily-note pair
 *   (`docs.ensure_daily_note`, `docs.append_daily_link`, TECH-SPEC §14.3):
 *   deterministic note id (`@rox/core/docs/daily`) and a daily-link block that
 *   is **updated in place** by `uuidv5(key + ':daily-link')` instead of being
 *   appended again on every re-run;
 * - the handlers of the two new commands.
 *
 * Swap-in for wave 2: TSK-1 / ONB replace these handlers by binding their own
 * in a module listed before the reference module.
 */

import { CommandRejection, type CommandRegistry } from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import { DAILY_VAULT_FOLDER, dailyNoteId } from '@rox/core/docs/daily'
import { systemListId } from '@rox/core/automation'
import { AUTOMATION_COMMAND_SCHEMAS, appendDailyLinkRequestSchema, ensureDailyNoteRequestSchema } from '@rox/shared/automation'
import { referenceHandler, type ReferenceOp, type ReferenceTx } from '../work/reference/engine'
import { addLink, authorizeBound, authorizeRef } from '../work/reference/ops'
import { referenceBackendFor } from '../work/reference/module'
import type { CommandModule } from '../commands/registry'

/** RU default names of the system lists; the UI renders a localised label from `systemKey`. */
export const SYSTEM_LIST_NAMES: Readonly<Record<string, string>> = { backlog: 'Бэклог' }

export { systemListId }

const ensureSystemList: ReferenceOp = async tx => {
  const ownerId = typeof tx.payload.ownerId === 'string' && tx.payload.ownerId ? tx.payload.ownerId : tx.actor
  const systemKey = String(tx.payload.systemKey)
  await authorizeBound(tx, { kind: 'person', id: ownerId }, 'write')
  const id = tx.createId('system-list')
  const current = await tx.get('task-list', id)
  if (current) {
    return { collection: 'task-list', id, revision: current.revision, ref: { kind: 'task-list', id }, changes: [], result: { existed: true, systemKey } }
  }
  const name = typeof tx.payload.name === 'string' && tx.payload.name ? tx.payload.name : (SYSTEM_LIST_NAMES[systemKey] ?? systemKey)
  const record = await tx.insert('task-list', id, {
    ownerType: 'user', ownerId, name, systemKey, sortKey: `system:${systemKey}`, statusSetEnabled: false,
  })
  return { collection: 'task-list', id, revision: record.revision, ref: { kind: 'task-list', id }, changes: ['systemKey'], result: { existed: false, systemKey } }
}

const sendInviteEmail: ReferenceOp = async tx => {
  const email = String(tx.payload.email)
  const principalId = typeof tx.payload.principalId === 'string' ? tx.payload.principalId : null
  if (principalId) await authorizeBound(tx, { kind: 'person', id: principalId }, 'write')
  const id = tx.createId('invitation-email')
  const existing = await tx.get('invitation', id)
  if (existing) {
    return { collection: 'invitation', id, revision: existing.revision, ref: { kind: 'invitation', id }, changes: [], result: { queued: true, existed: true } }
  }
  const record = await tx.insert('invitation', id, {
    email, state: 'queued', invitedBy: tx.actor,
    ...(principalId ? { principalId } : {}),
    ...(typeof tx.payload.role === 'string' ? { role: tx.payload.role } : {}),
    ...(tx.payload.message ? { message: tx.payload.message } : {}),
  })
  // The mailer (W1-09 / Stalwart) drains queued rows; the event records the intent.
  tx.emit('identity.invitation_sent', { email, invitationId: id, reference: true })
  return { collection: 'invitation', id, revision: record.revision, ref: { kind: 'invitation', id }, changes: ['state'], result: { queued: true, existed: false } }
}

function dailyNoteTarget(tx: ReferenceTx): { ownerId: string; date: string; id: string } {
  const ownerId = typeof tx.payload.ownerId === 'string' && tx.payload.ownerId ? tx.payload.ownerId : tx.actor
  const date = String(tx.payload.date)
  const id = typeof tx.payload.id === 'string' && tx.payload.id
    ? tx.payload.id
    : dailyNoteId(tx.ctx.workspaceId, ownerId, date)
  return { ownerId, date, id }
}

async function upsertDailyNote(tx: ReferenceTx, ownerId: string, date: string, id: string): Promise<{ id: string; revision: number; existed: boolean }> {
  const current = await tx.get('note', id)
  if (current && !current.data.deletedAt) return { id, revision: current.revision, existed: true }
  const record = await tx.upsert('note', id, {
    subtype: 'daily', dailyDate: date, title: date, ownerId, state: 'draft', localPath: `${DAILY_VAULT_FOLDER}/${date}.md`,
  })
  return { id, revision: record.revision, existed: false }
}

const ensureDailyNote: ReferenceOp = async tx => {
  const { ownerId, date, id } = dailyNoteTarget(tx)
  await authorizeBound(tx, { kind: 'person', id: ownerId }, 'write')
  const note = await upsertDailyNote(tx, ownerId, date, id)
  return {
    collection: 'note', id: note.id, revision: note.revision, ref: { kind: 'note', id: note.id },
    changes: ['dailyDate'], result: { existed: note.existed, localPath: `${DAILY_VAULT_FOLDER}/${date}.md` },
  }
}

const appendDailyLink: ReferenceOp = async tx => {
  const { ownerId, date, id: noteId } = dailyNoteTarget(tx)
  const link = tx.payload.link as EntityRef
  await authorizeRef(tx, link, 'read')
  await authorizeBound(tx, { kind: 'person', id: ownerId }, 'write')
  const note = await upsertDailyNote(tx, ownerId, date, noteId)
  const blockId = typeof tx.payload.blockId === 'string' && tx.payload.blockId ? tx.payload.blockId : tx.newId('daily-link')
  const data = {
    docKind: 'note', docId: note.id, kind: 'link', link,
    ...(tx.payload.label ? { label: tx.payload.label } : {}),
    ...(tx.payload.time ? { time: tx.payload.time } : {}),
  }
  const current = await tx.get('doc-block', blockId)
  const block = current && !current.data.deletedAt ? await tx.update('doc-block', current, data) : await tx.insert('doc-block', blockId, data)
  await addLink(tx, { kind: 'note', id: note.id }, link, 'mentions', { anchor: { blockId } })
  return {
    collection: 'doc-block', id: blockId, revision: block.revision, ref: { kind: 'note', id: note.id },
    changes: ['link'], result: { blockId, updated: Boolean(current), noteId: note.id },
  }
}

export const AUTOMATION_COMMAND_MODULE: CommandModule = {
  name: 'automation',
  bind(registry: CommandRegistry) {
    registry.bindSchema('task_lists.ensure_system_list', AUTOMATION_COMMAND_SCHEMAS['task_lists.ensure_system_list']!)
    registry.bindSchema('notify.send_invite_email', AUTOMATION_COMMAND_SCHEMAS['notify.send_invite_email']!)
    registry.bindSchema('docs.ensure_daily_note', ensureDailyNoteRequestSchema)
    registry.bindSchema('docs.append_daily_link', appendDailyLinkRequestSchema)

    const bind = (type: string, op: ReferenceOp, event?: string): void => {
      if (registry.handler(type)) return
      const definition = registry.get(type)
      if (!definition) throw new CommandRejection('INTERNAL', `unknown automation command ${type}`)
      registry.bind(type, referenceHandler(type, op, { now: () => new Date(), backendFor: referenceBackendFor, verb: definition.verb, ...(event ? { eventType: event } : {}) }))
    }
    bind('task_lists.ensure_system_list', ensureSystemList, 'task.task_list_added')
    bind('notify.send_invite_email', sendInviteEmail)
    bind('docs.ensure_daily_note', ensureDailyNote, 'docs.document_created')
    bind('docs.append_daily_link', appendDailyLink, 'docs.document_edited')
  },
}