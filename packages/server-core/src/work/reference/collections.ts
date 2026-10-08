/**
 * W1-06 (#1503) — Reference collections: one per stored record type.
 *
 * `kind` is the W1-01 entity kind used for refs and for checking the command
 * target; `table` is the W1-05 table the Postgres backend writes (collections
 * without a single-uuid-key table are stored as event snapshots instead).
 */

import type { EntityKind } from '@rox/core/entities'

export interface CollectionSpec {
  readonly kind?: EntityKind
  /** Extra kinds accepted as a command target for this collection. */
  readonly targetKinds?: readonly EntityKind[]
  readonly table?: string
  /** Field → column overrides (default: camelCase → snake_case). */
  readonly columns?: Readonly<Record<string, string>>
  /** Fields holding an `EntityRef`, stored in a text `*_ref` column as `kind:id#fragment`. */
  readonly refFields?: readonly string[]
  /** Local backend: directory under `{workspaceRoot}/work/` (default: the collection name). */
  readonly localDir?: string
}

export const REFERENCE_COLLECTIONS = {
  // Tasks (WorkItem v3)
  task: { kind: 'task', table: 'work_item', columns: { notes: 'notes_md', origin: 'origin_ref' }, refFields: ['origin'] },
  'task-list': { kind: 'task-list', table: 'task_list', localDir: 'task-lists' },
  'task-section': { kind: 'task-section', table: 'task_section', localDir: 'task-sections' },
  'task-list-group': { kind: 'task-list-group', table: 'task_list_group', localDir: 'task-list-groups' },
  'task-status-set': { localDir: 'task-status-sets' },
  'task-list-entry': { localDir: 'task-list-entries' },
  'task-user-state': { localDir: 'task-user-states' },
  'task-dependency': { localDir: 'task-dependencies' },
  // Goals, OKR, check-ins, reviews
  goal: { kind: 'goal', table: 'goal', localDir: 'goals' },
  'goal-target': { kind: 'goal-target', table: 'goal_target', localDir: 'goal-targets' },
  'goal-check': { kind: 'goal-check', table: 'goal_check', localDir: 'goal-checks' },
  'okr-cycle': { kind: 'okr-cycle', table: 'okr_cycle', localDir: 'cycles' },
  'check-in': { kind: 'check-in', table: 'check_in', localDir: 'check-ins' },
  review: { kind: 'review', table: 'review', localDir: 'reviews' },
  // Projects
  project: { kind: 'project', localDir: 'projects' },
  'project-member': { localDir: 'project-members' },
  'project-resource': { localDir: 'project-resources' },
  // milestone.project_id references the W1-05 `project` table, which reference `project` records do not fill → snapshots.
  milestone: { kind: 'milestone', localDir: 'milestones' },
  // Spaces, KPIs
  space: { kind: 'space', table: 'space', localDir: 'spaces' },
  'space-member': { localDir: 'space-members' },
  kpi: { kind: 'kpi', table: 'kpi', localDir: 'kpis' },
  'kpi-entry': { kind: 'kpi-entry', table: 'kpi_entry', localDir: 'kpi-entries' },
  'kpi-annotation': { table: 'kpi_annotation', localDir: 'kpi-annotations' },
  // Docs, drive, wiki
  note: { kind: 'note', table: 'doc', localDir: 'docs' },
  'doc-suggestion': { localDir: 'doc-suggestions' },
  'doc-view': { localDir: 'doc-views' },
  'doc-block': { localDir: 'doc-blocks' },
  folder: { kind: 'folder', table: 'folder', localDir: 'folders' },
  'folder-item': { localDir: 'folder-items' },
  'drive-link': { kind: 'drive-link', table: 'drive_link', localDir: 'drive-links' },
  'drive-favorite': { localDir: 'drive-favorites' },
  'drive-quota': { localDir: 'drives' },
  'upload-session': { localDir: 'upload-sessions' },
  file: { kind: 'file', table: 'file_object', columns: { id: 'file_id' }, localDir: 'files' },
  'wiki-space': { kind: 'wiki-space', table: 'wiki_space', localDir: 'wiki-spaces' },
  'wiki-node': { localDir: 'wiki-nodes' },
  // Messenger
  channel: { kind: 'channel', table: 'chat', localDir: 'chats' },
  'channel-message': { kind: 'channel-message', localDir: 'messages' },
  'channel-sequence': { localDir: 'chat-sequences' },
  'channel-member': { localDir: 'chat-members' },
  'channel-tab': { localDir: 'chat-tabs' },
  'channel-label': { localDir: 'chat-labels' },
  'channel-notice': { localDir: 'chat-notices' },
  'channel-pin': { localDir: 'chat-pins' },
  // Calendar, meetings
  calendar: { kind: 'calendar', table: 'calendar', localDir: 'calendars' },
  'calendar-event': { kind: 'calendar-event', table: 'calendar_event', columns: { id: 'event_id', startAt: 'starts_at', endAt: 'ends_at', organizerId: 'organiser_id' }, localDir: 'events' },
  'calendar-subscription': { localDir: 'calendar-subscriptions' },
  'event-rsvp': { localDir: 'event-rsvps' },
  'room-booking': { localDir: 'room-bookings' },
  // meeting_room has no host / recording columns (host-only commands need them) → snapshots.
  call: { kind: 'call', localDir: 'calls' },
  'call-participant': { localDir: 'call-participants' },
  // People, contacts
  person: { kind: 'person', localDir: 'people' },
  'contact-card': { targetKinds: ['person', 'crm-company'], table: 'contact_card', localDir: 'contacts' },
  invitation: { kind: 'invitation', localDir: 'invitations' },
  // Social
  comment: { kind: 'comment', table: 'comment', localDir: 'comments' },
  reaction: { localDir: 'reactions' },
  subscription: { localDir: 'subscriptions' },
  'subscription-policy': { localDir: 'subscription-policies' },
  // Notify
  notification: { table: 'notification', localDir: 'notifications' },
  'notification-pref': { localDir: 'notification-prefs' },
  reminder: { kind: 'reminder', localDir: 'reminders' },
  // ACL
  'acl-entry': { table: 'acl_entry', columns: { id: 'acl_id' }, localDir: 'acl-entries' },
  'acl-link': { localDir: 'acl-links' },
  'access-request': { localDir: 'access-requests' },
  // Entities
  'entity-link': { table: 'entity_link', columns: { id: 'link_id' }, localDir: 'links' },
  'entity-pin': { localDir: 'entity-pins' },
  'entity-drop': { localDir: 'entity-drops' },
  // Identity, agents, workplace
  workspace: { localDir: 'workspaces' },
  placeholder: { targetKinds: ['person'], localDir: 'placeholders' },
  'onboarding-seed': { localDir: 'onboarding' },
  agent: { localDir: 'agents' },
  'agent-invocation': { localDir: 'agent-invocations' },
  'agent-approval': { localDir: 'agent-approvals' },
  'project-template': { kind: 'project-template', table: 'project_template', localDir: 'project-templates' },
  export: { localDir: 'exports' },
  'form-hook': { targetKinds: ['form'], localDir: 'form-hooks' },
  'mail-share': { targetKinds: ['mail-thread'], localDir: 'mail-shares' },
  'command-batch': { localDir: 'command-batches' },
} as const satisfies Record<string, CollectionSpec>

export type CollectionName = keyof typeof REFERENCE_COLLECTIONS

export function collectionSpec(name: string): CollectionSpec {
  const spec = (REFERENCE_COLLECTIONS as Record<string, CollectionSpec>)[name]
  if (!spec) throw new Error(`Unknown reference collection: ${name}`)
  return spec
}

/** Entity kind of a collection's refs (collections without one use their name). */
export function refKind(name: string): EntityKind {
  return (collectionSpec(name).kind ?? name) as EntityKind
}

/** Kinds accepted as the envelope target for a command on this collection. */
export function acceptedTargetKinds(name: string): readonly string[] {
  const spec = collectionSpec(name)
  return [...(spec.kind ? [spec.kind] : []), ...(spec.targetKinds ?? [])]
}
