/**
 * W1-03 (#1500) — Domain events (TECH-SPEC §3.5, DATA-MODEL §9.1, §12).
 *
 * `domain_event.type` is `<module>.<action>` (Operately activity names kept
 * verbatim under module prefixes; Lark webhook names kept for bots). A
 * `DomainEvent` is the projection of exactly one `domain_event` row (W1-05
 * `05-events.sql`): written inside the command transaction, published to the
 * realtime gateway after commit (transactional outbox).
 *
 * The catalogue below is append-only (W1-12 #1509 extends it); the writer
 * validates the grammar, and `isKnownDomainEventType` reports catalogue
 * membership for contract tests.
 */

import type { EntityRef } from '../entities/refs.ts'

export type DomainEventType = `${string}.${string}`

/** `<module>.<action>` plus Lark dotted names (`im.message.receive_v1`). */
export const DOMAIN_EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/

export function isDomainEventType(value: unknown): value is DomainEventType {
  return typeof value === 'string' && value.length <= 160 && DOMAIN_EVENT_TYPE_PATTERN.test(value)
}

export interface DomainEvent<P = unknown> {
  eventId: string
  /** Store order: `domain_event.sequence` on the server, the local log order in server-core. */
  sequence?: number
  workspaceId: string
  type: DomainEventType
  actorId?: string
  subject?: EntityRef
  aggregateRevision: number
  policyEpoch?: number
  /** The command that caused the event (`commandId`). */
  causationId?: string
  correlationId?: string
  payload: P
  createdAt: string
}

/** What a command handler returns; the executor stamps ids, actor, causation and revision. */
export interface DomainEventDraft<P = unknown> {
  type: DomainEventType
  /** Defaults to the handler's `ref`, then the envelope `target`. */
  subject?: EntityRef
  payload?: P
}

function moduleTypes<M extends string, A extends string>(module: M, actions: readonly A[]): `${M}.${A}`[] {
  return actions.map(action => `${module}.${action}` as `${M}.${A}`)
}

/** DATA-MODEL §9.1 types that are enumerated in the spec, plus `system.pinged` (W1-03 exit criterion). */
export const DOMAIN_EVENT_TYPES = [
  // W1-03
  'system.pinged',
  ...moduleTypes('goals', [
    'goal_created', 'goal_check_in', 'goal_check_in_acknowledgement', 'goal_check_in_commented', 'goal_check_in_edit',
    'goal_closing', 'goal_reopening', 'goal_reparent', 'goal_target_adding', 'goal_target_updating', 'goal_target_deleting',
    'goal_check_adding', 'goal_check_toggled', 'goal_check_removing', 'goal_champion_updating', 'goal_reviewer_updating',
    'goal_space_updating', 'goal_due_date_updating', 'goal_start_date_updating', 'goal_timeframe_editing',
    'goal_name_updating', 'goal_description_changed', 'goal_editing', 'goal_discussion_creation', 'goal_discussion_editing',
    'goal_retrospective_acknowledged', 'goal_archived', 'okr_cycle_published', 'goal_aligned',
  ]),
  ...moduleTypes('projects', [
    'project_created', 'project_check_in_submitted', 'project_check_in_acknowledged', 'project_check_in_commented',
    'project_check_in_edit', 'project_pausing', 'project_resuming', 'project_closed', 'project_moved', 'project_renamed',
    'project_contributor_addition', 'project_contributor_edited', 'project_contributor_removed',
    'project_milestone_creation', 'project_milestone_updating', 'project_milestone_commented',
    'project_goal_connection', 'project_goal_disconnection', 'project_timeline_edited', 'project_permissions_edited',
  ]),
  ...moduleTypes('task', [
    'task_adding', 'task_status_change', 'task_assignee_assignment', 'task_closing', 'task_reopening',
    'task_priority_change', 'task_size_change', 'task_due_date_updating', 'task_milestone_updating', 'task_moving',
    'task_name_updating', 'task_description_change', 'task_deleting', 'space_task_commented', 'project_task_commented',
    'task_shared', 'task_list_added', 'task_follower_added',
  ]),
  ...moduleTypes('spaces', [
    'space_added', 'space_joining', 'space_members_added', 'space_member_removed', 'space_permissions_edited',
    'space_members_permissions_edited', 'group_edited', 'discussion_posting', 'discussion_editing',
    'discussion_comment_submitted', 'message_archiving',
  ]),
  ...moduleTypes('docs', [
    'document_created', 'document_edited', 'document_deleted', 'document_commented', 'document_version_restored',
    'document_public_sharing_changed', 'note_shared', 'permission_changed',
  ]),
  ...moduleTypes('kpis', [
    'kpi_created', 'kpi_edited', 'kpi_deleted', 'kpi_entry_logged', 'kpi_entry_edited', 'kpi_entry_deleted',
    'kpi_entry_commented', 'kpi_annotation_added', 'kpi_annotation_edited', 'kpi_annotation_deleted',
  ]),
  ...moduleTypes('people', ['member_added', 'invitations_sent']),
  'im.message.receive_v1', 'im.message.reaction.created_v1', 'im.message.reaction.deleted_v1',
  'im.message.message_read_v1', 'im.chat.member.user.added_v1', 'im.chat.member.user.deleted_v1',
  'im.chat.member.bot.added_v1', 'im.chat.updated_v1', 'im.chat.disbanded_v1', 'card.action.trigger',
  'calendar.calendar.event.changed_v4', 'vc.meeting.all_meeting_ended_v1', 'calendar.rsvp_changed',
  ...moduleTypes('entities', ['link_added', 'link_removed', 'comment_added', 'mentioned_people', 'reaction_added']),
  ...moduleTypes('identity', [
    'account_created', 'placeholder_created', 'placeholder_activated', 'placeholder_merged',
    'invitation_sent', 'invitation_accepted', 'invitation_revoked', 'invitation_expired',
  ]),
  ...moduleTypes('agents', [
    'agent_provisioned', 'agent_action_executed', 'approval_requested', 'approval_decided',
    'standing_approval_created', 'standing_approval_revoked', 'agent_rate_limited', 'agent_paused',
  ]),
  ...moduleTypes('automation', ['rule_execution_started', 'rule_execution_succeeded', 'rule_execution_failed', 'rule_toggled']),
  ...moduleTypes('drive', [
    'drive_provisioned', 'file_uploaded', 'file_version_added', 'file_trashed', 'file_restored', 'file_purged',
    'quota_threshold_crossed',
  ]),
  ...moduleTypes('collab', [
    'suggestion_created', 'suggestion_accepted', 'suggestion_rejected', 'comment_thread_resolved',
    'comment_thread_reopened', 'doc_viewed', 'calendar_shared',
  ]),
] as const satisfies readonly DomainEventType[]

const KNOWN = new Set<string>(DOMAIN_EVENT_TYPES)

export function isKnownDomainEventType(value: string): boolean {
  return KNOWN.has(value)
}
