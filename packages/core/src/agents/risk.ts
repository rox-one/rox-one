/**
 * W1-11 (#1508) — Risk classes and agent scopes (TECH-SPEC §13.2 step 5,
 * DATA-MODEL §5.14).
 *
 * The risk class is **computed by the command definition from the payload**,
 * never declared by the agent: `riskClass(payload, ctx)` is a required field
 * of every `CommandDefinition`, and the catalogue builder attaches it from
 * here (`./catalogue/entry.ts`). The CI gate
 * `packages/core/src/agents/__tests__/risk-gate.test.ts` fails if any
 * catalogue entry ends up without one.
 *
 * This file holds the classification *data* — the explicit per-command table,
 * the structural rules derived from the ACL verb, the per-module defaults —
 * plus the scope list (`<module>:<verb>`, mirrors the command registry) used
 * by grants, rate limits and standing approvals.
 *
 * `@rox/core` stays dependency-free: nothing here imports zod or `@rox/shared`.
 */

import type { CommandRiskContext, RiskClass } from '../commands/registry.ts'

export type { RiskClass }

/** DATA-MODEL §5.14: routine → auto by default; consequential / privileged → ask. */
export const RISK_CLASSES = ['routine', 'consequential', 'privileged'] as const

/** Type guard preserving narrowing of a wire value. */
export function isRiskClass(value: unknown): value is RiskClass {
  return typeof value === 'string' && (RISK_CLASSES as readonly string[]).includes(value)
}

/** Higher wins when two classifications must be combined (e.g. `commands.batch`). */
export const RISK_CLASS_RANK: Record<RiskClass, number> = {
  routine: 0,
  consequential: 1,
  privileged: 2,
}

/**
 * The stricter of two classes. Used where several commands collapse into one
 * decision: a batch takes the maximum of its members, and a workspace floor
 * can only ever make a decision stricter.
 */
export function maxRiskClass(a: RiskClass, b: RiskClass): RiskClass {
  return RISK_CLASS_RANK[a] >= RISK_CLASS_RANK[b] ? a : b
}

/**
 * Conservative class for a command nothing else classifies. Never `routine`:
 * an unclassified command must be approval-gated, not silent.
 */
export const CONSERVATIVE_RISK_CLASS: RiskClass = 'consequential'

/** A classifier is either a fixed class or a payload-dependent function. */
export type RiskClassifier<P = unknown> = (payload: P, ctx: CommandRiskContext) => RiskClass

export type RiskSpec = RiskClass | RiskClassifier

/** DATA-MODEL §5.14 scope list (`<module>:<verb>`), mirrored from the command registry. */
export const AGENT_SCOPES = [
  'tasks:create',
  'tasks:update',
  'tasks:assign_others',
  'docs:create',
  'docs:update',
  'docs:share',
  'drive:write',
  'calendar:create',
  'calendar:invite_others',
  'vc:start',
  'im:send_owner_dm',
  'im:send_chat',
  'im:create_group',
  'people:invite',
  'goals:draft_check_in',
  'goals:publish_check_in',
  '*:delete',
] as const

export type AgentScope = (typeof AGENT_SCOPES)[number]

export function isAgentScope(value: unknown): value is AgentScope {
  return typeof value === 'string' && (AGENT_SCOPES as readonly string[]).includes(value)
}

/** The owner's own DM with the agent: private, so it gets its own scope. */
export const OWNER_DM_SCOPE: AgentScope = 'im:send_owner_dm'
/** Wildcard scope covering every `verb === 'destroy'` command. */
export const DELETE_SCOPE: AgentScope = '*:delete'

/**
 * Command type → scope. Commands absent from this map are not agent-reachable:
 * `agents.invoke` never offers them as tools and `evaluatePolicy` denies them
 * at step 3. A `destroy` verb resolves to `*:delete` before the lookup, so an
 * ordinary write scope can never hand out deletions.
 */
export const COMMAND_SCOPES: Readonly<Record<string, AgentScope>> = {
  'tasks.create': 'tasks:create',
  'tasks.create_from_message': 'tasks:create',
  'tasks.create_from_selection': 'tasks:create',
  'tasks.create_many_from_checklist': 'tasks:create',
  'tasks.update': 'tasks:update',
  'tasks.update_status': 'tasks:update',
  'tasks.complete': 'tasks:update',
  'tasks.reopen': 'tasks:update',
  'tasks.move': 'tasks:update',
  'tasks.update_assignees': 'tasks:assign_others',
  'docs.create_document': 'docs:create',
  'docs.create_meeting_notes': 'docs:create',
  'docs.ensure_daily_note': 'docs:create',
  'docs.update_title': 'docs:update',
  'docs.append_block': 'docs:update',
  'docs.suggest_changes': 'docs:update',
  'docs.set_public_sharing': 'docs:share',
  'docs.update_permissions': 'docs:share',
  'drive.upload_file': 'drive:write',
  'drive.create_folder': 'drive:write',
  'drive.move_items': 'drive:write',
  'calendar.create_event': 'calendar:create',
  'calendar.update_event': 'calendar:create',
  'calendar.create_time_block': 'calendar:create',
  'vc.start_meeting': 'vc:start',
  'im.send_message': 'im:send_chat',
  'im.create_chat': 'im:create_group',
  // TECH-SPEC §15.1 names the agent risk class of the private → public switch
  // (privileged, §13.3: never standing), so the command must be reachable; it
  // is chat administration, which is what `im:create_group` grants.
  'im.set_visibility': 'im:create_group',
  'people.invite': 'people:invite',
  'goals.create_check_in': 'goals:draft_check_in',
  'goals.acknowledge_check_in': 'goals:publish_check_in',
}

export interface ScopeResolutionContext {
  /** The target chat is the agent's owner DM → the private `im:send_owner_dm` scope. */
  ownerDm?: boolean
  /** The command's ACL verb; `destroy` resolves to `*:delete`. */
  verb?: string
}

/**
 * The scope a command requires. `null` = not agent-reachable.
 */
export function scopeForCommand(type: string, ctx: ScopeResolutionContext = {}): AgentScope | null {
  if (ctx.verb === 'destroy') return DELETE_SCOPE
  if (type === 'im.send_message' && ctx.ownerDm) return OWNER_DM_SCOPE
  return COMMAND_SCOPES[type] ?? null
}

/**
 * Per-module default (DATA-MODEL §5.14). A module whose commands are private
 * to the owner is `routine`; a module that reaches other people is
 * `consequential`. Destructive and membership-changing commands are lifted to
 * `privileged` by the structural rules below or by an explicit entry.
 */
export const MODULE_RISK_DEFAULT: Readonly<Record<string, RiskClass>> = {
  system: 'routine',
  entities: 'routine',
  notify: 'routine',
  // W1-14 §11.1: presence signals are owned by the caller and notify nobody,
  // which is exactly what `COLLAB_COMMAND_RISK` already resolves them to.
  // W1-14 presence: heartbeat/join/leave only publish the owner's own status.
  presence: 'routine',
  tasks: 'consequential',
  docs: 'consequential',
  // W1-12 §14: the rule engine executes on the owner's behalf and R4 mails
  // external invitees (`notify.send_invite_email`), so the module default is
  // conservative (it equals the fallback these commands resolved to before).
  // W1-12 rule dispatch: `notify.send_invite_email` reaches other people.
  automation: 'consequential',
  drive: 'consequential',
  wiki: 'consequential',
  calendar: 'consequential',
  meetings: 'consequential',
  im: 'consequential',
  social: 'consequential',
  contacts: 'consequential',
  goals: 'consequential',
  projects: 'consequential',
  spaces: 'consequential',
  kpis: 'consequential',
  mail: 'consequential',
  templates: 'consequential',
  core: 'consequential',
  acl: 'privileged',
  identity: 'privileged',
  agents: 'privileged',
}

/**
 * Explicit per-command classification, taken from DATA-MODEL §5.14's table.
 * Every entry is a deliberate decision; anything absent falls back to the
 * verb/payload rules and then to the module default.
 *
 * `routine`       — private to the owner, reversible, nobody else notified;
 * `consequential` — visible to / notifying other people, or hard to undo;
 * `privileged`    — destructive, or changes membership / security.
 */
export const COMMAND_RISK: Readonly<Record<string, RiskSpec>> = {
  // ── private to the owner ────────────────────────────────────────────────
  'system.ping': 'routine',
  'links.add': 'routine',
  'links.remove': 'routine',
  'notifications.mark_read': 'routine',
  'notifications.mark_all_read': 'routine',
  'notifications.update_prefs': 'routine',
  'reminders.create': 'routine',
  'reminders.cancel': 'routine',
  'exports.markdown': 'routine',
  'subscriptions.subscribe': 'routine',
  'subscriptions.unsubscribe': 'routine',
  'subscriptions.set_notify_everyone': 'routine',
  'contacts.create_card': 'routine',
  'contacts.update_card': 'routine',
  'contacts.merge_cards': 'routine',
  'contacts.star': 'routine',
  'contacts.add_touch': 'routine',
  'im.mark_read': 'routine',
  'im.mark_unread': 'routine',
  'im.create_label': 'routine',
  'im.label_chats': 'routine',
  'im.join_chat': 'routine',
  'im.leave_chat': 'routine',
  'im.browse_public_chats': 'routine',
  'tasks.set_user_state': 'routine',
  'docs.record_view': 'routine',
  'people.update_profile': 'routine',
  'agents.provision_personal_agent': 'routine',
  'agents.invoke': 'routine',

  // ── messenger: a message is private only in the owner's own DM ──────────
  'im.send_message': (payload, ctx) => {
    // A workspace chat is the only place another person can see the message.
    if (ctx.target?.kind === 'channel') return 'consequential'
    if (payload !== null && typeof payload === 'object' && 'ownerDm' in payload && payload.ownerDm === true) return 'routine'
    return 'consequential'
  },
  'im.edit_message': 'consequential',
  'im.forward_messages': 'consequential',
  'im.get_or_create_p2p': 'consequential',
  'im.update_chat': 'consequential',
  'im.update_member_state': 'consequential',
  'im.pin': 'consequential',
  'im.unpin': 'consequential',
  'im.create_tab': 'consequential',
  'im.update_tab': 'consequential',
  'im.create_space_chat': 'consequential',
  'im.create_entity_chat': 'consequential',
  'im.share_entity': 'consequential',
  // Creating a chat with other people is consequential; a chat with only the
  // owner (or nobody yet) is private to them.
  'im.create_chat': (payload) => {
    if (payload !== null && typeof payload === 'object' && 'members' in payload && Array.isArray(payload.members) && payload.members.length > 0) {
      return 'consequential'
    }
    return 'routine'
  },
  // D-v2-2: switching private → public exposes the whole history to every
  // joiner, so it is privileged; public → private keeps the current members.
  'im.set_visibility': (payload) => {
    if (payload !== null && typeof payload === 'object' && 'visibility' in payload && payload.visibility === 'public') return 'privileged'
    return 'consequential'
  },
  'im.add_members': 'consequential',
  'im.remove_members': 'privileged',
  'im.update_policy': 'privileged',
  'im.set_top_notice': 'privileged',
  'im.update_announcement': 'privileged',
  'im.delete_tab': 'privileged',
  'im.disband_chat': 'privileged',

  // ── docs ────────────────────────────────────────────────────────────────
  'docs.create_document': 'routine',
  'docs.update_title': 'routine',
  'docs.restore_version': 'routine',
  'docs.append_block': 'routine',
  'docs.insert_task_block': 'routine',
  'docs.insert_event_block': 'routine',
  'docs.insert_meeting_block': 'routine',
  'docs.embed_view': 'routine',
  'docs.ensure_daily_note': 'routine',
  'docs.append_daily_link': 'routine',
  'docs.create_meeting_notes': 'routine',
  'docs.create_from_messages': 'routine',
  'docs.create_from_email': 'routine',
  'docs.suggest_changes': 'consequential',
  'docs.decide_suggestion': 'consequential',
  'docs.sync_suggestions': 'routine',
  'docs.publish_post': 'consequential',
  'docs.schedule_post': 'consequential',
  'docs.move_note_to_shared': 'privileged',
  'docs.move_back_to_private': 'privileged',
  'docs.set_public_sharing': 'privileged',
  'docs.update_permissions': 'privileged',
  // §18.2: a patch to the owner's own local note is private; the approval card
  // is required by the agent-panel contract, not by the risk class.
  'docs.apply_patch': 'routine',

  // ── drive ───────────────────────────────────────────────────────────────
  'drive.provision': 'routine',
  'drive.create_folder': 'routine',
  'drive.rename_folder': 'routine',
  'drive.move_items': 'routine',
  'drive.favorite': 'routine',
  'drive.add_shortcut': 'routine',
  'drive.upload_file': 'routine',
  'drive.open_upload': 'routine',
  'drive.complete_upload': 'routine',
  'drive.import_attachment': 'routine',
  'drive.add_link': 'consequential',

  // ── wiki ────────────────────────────────────────────────────────────────
  'wiki.create_space': 'consequential',
  'wiki.move_node': 'routine',

  // ── tasks ───────────────────────────────────────────────────────────────
  'tasks.create': 'routine',
  'tasks.create_from_selection': 'routine',
  'tasks.create_many_from_checklist': 'routine',
  'tasks.update': 'routine',
  'tasks.update_status': 'routine',
  'tasks.complete': 'routine',
  'tasks.reopen': 'routine',
  'tasks.cancel': 'routine',
  'tasks.archive': 'routine',
  'tasks.duplicate': 'routine',
  'tasks.move': 'routine',
  'tasks.add_to_list': 'routine',
  'tasks.remove_from_list': 'routine',
  'tasks.add_dependency': 'routine',
  'tasks.update_reminders': 'routine',
  'task_lists.create': 'routine',
  'task_lists.update': 'routine',
  'task_lists.archive': 'routine',
  'task_sections.create': 'routine',
  'task_sections.update': 'routine',
  'task_sections.move': 'routine',
  'task_statuses.update_set': 'consequential',
  'tasks.update_assignees': 'consequential',
  'tasks.create_from_message': 'consequential',
  'tasks.create_from_email': 'consequential',
  'tasks.share': 'consequential',

  // ── calendar / meetings ─────────────────────────────────────────────────
  'calendar.create_event': (payload) => {
    if (payload !== null && typeof payload === 'object' && 'attendees' in payload && Array.isArray(payload.attendees) && payload.attendees.length > 0) {
      return 'consequential'
    }
    return 'routine'
  },
  'calendar.update_event': (payload) => {
    if (payload !== null && typeof payload === 'object' && 'attendees' in payload && Array.isArray(payload.attendees) && payload.attendees.length > 0) {
      return 'consequential'
    }
    return 'routine'
  },
  'calendar.create_time_block': 'routine',
  'calendar.create_calendar': 'routine',
  'calendar.subscribe': 'routine',
  'calendar.book_room': 'consequential',
  'calendar.rsvp': 'consequential',
  'calendar.create_event_from_message': 'consequential',
  'calendar.create_event_from_email': 'consequential',
  'vc.start_meeting': 'consequential',
  'vc.join': 'consequential',
  'vc.end': 'consequential',
  'vc.set_recording': 'consequential',
  'meetings.publish_outcomes': 'consequential',

  // ── people and identity ─────────────────────────────────────────────────
  'people.invite': 'privileged',
  'people.set_manager': 'privileged',
  'people.convert_to_guest': 'privileged',
  'people.add_workspace_member': 'privileged',
  'workspaces.create': 'privileged',
  'identity.ensure_placeholder': 'privileged',
  'identity.activate_placeholder': 'privileged',
  'identity.merge_placeholder': 'privileged',
  'onboarding.seed_starter_content': 'routine',

  // ── goals / projects / spaces / kpis ────────────────────────────────────
  'goals.create': 'routine',
  'goals.update_name': 'routine',
  'goals.update_description': 'routine',
  'goals.update_parent_goal': 'routine',
  'goals.update_start_date': 'routine',
  'goals.update_due_date': 'routine',
  'goals.create_target': 'routine',
  'goals.update_target': 'routine',
  'goals.update_target_value': 'routine',
  'goals.update_target_index': 'routine',
  'goals.create_check': 'routine',
  'goals.update_check': 'routine',
  'goals.toggle_check': 'routine',
  'goals.update_check_index': 'routine',
  'goals.set_target_status_override': 'routine',
  'goals.create_check_in': 'routine',
  'goals.update_check_in': 'routine',
  'goals.close': 'consequential',
  'goals.reopen': 'consequential',
  'goals.align': 'consequential',
  'goals.unalign': 'consequential',
  'goals.update_champion': 'consequential',
  'goals.update_reviewer': 'consequential',
  'goals.update_space': 'consequential',
  'goals.acknowledge_check_in': 'consequential',
  'goals.record_check_in_summary': 'consequential',
  'goals.link_work': 'consequential',
  'goals.unlink_work': 'consequential',
  'goals.update_access_levels': 'privileged',
  'okr.create_cycle': 'consequential',
  'okr.publish_cycle': 'consequential',
  'okr.publish_objectives': 'consequential',
  'okr.import_from_cycle': 'consequential',
  'projects.create': 'routine',
  'projects.update_name': 'routine',
  'projects.update_description': 'routine',
  'projects.update_parent_goal': 'routine',
  'projects.update_dates': 'routine',
  'projects.move': 'routine',
  'projects.add_resource': 'routine',
  'projects.remove_resource': 'routine',
  'projects.update_task_statuses': 'consequential',
  'projects.pause': 'consequential',
  'projects.resume': 'consequential',
  'projects.close': 'consequential',
  'projects.update_champion': 'consequential',
  'projects.update_reviewer': 'consequential',
  'projects.create_check_in': 'routine',
  'projects.update_check_in': 'routine',
  'projects.acknowledge_check_in': 'consequential',
  'reviews.create': 'consequential',
  'reviews.acknowledge': 'routine',
  'reviews.create_cycle_review': 'consequential',
  'milestones.create': 'routine',
  'milestones.update': 'routine',
  'milestones.reorder': 'routine',
  'milestones.complete': 'consequential',
  'milestones.reopen': 'consequential',
  'projects.add_contributor': 'privileged',
  'projects.update_contributor': 'privileged',
  'projects.remove_contributor': 'privileged',
  'projects.share': 'privileged',
  'spaces.update': 'consequential',
  'spaces.update_tools': 'consequential',
  'spaces.update_task_statuses': 'consequential',
  'spaces.join': 'routine',
  'spaces.leave': 'routine',
  'spaces.create': 'privileged',
  'spaces.add_members': 'privileged',
  'spaces.remove_member': 'privileged',
  'spaces.update_members_permissions': 'privileged',
  'spaces.update_general_access': 'privileged',
  'kpis.create': 'routine',
  'kpis.update': 'routine',
  'kpis.log_entry': 'routine',
  'kpis.edit_entry': 'routine',
  'kpis.add_annotation': 'routine',
  'kpis.edit_annotation': 'routine',

  // ── agents (W1-11 own commands) ─────────────────────────────────────────
  'agents.pause': 'privileged',
  'agents.decide_approval': 'privileged',

  // ── social / acl / mail / templates / forms ─────────────────────────────
  'comments.create': 'consequential',
  'comments.edit': 'routine',
  'comments.resolve': 'routine',
  'comments.resolve_thread': 'routine',
  'comments.reopen_thread': 'routine',
  'comments.react': 'routine',
  'comments.convert_to_task': 'consequential',
  'reactions.add': 'routine',
  'reactions.remove': 'routine',
  'acl.grant': 'privileged',
  'acl.revoke': 'privileged',
  'acl.set_link': 'privileged',
  'acl.request_access': 'routine',
  'acl.decide_request': 'privileged',
  'acl.transfer_ownership': 'privileged',
  'mail.share_to_chat': 'consequential',
  'mail.create_task_from_thread': 'routine',
  'project_templates.create_from_project': 'routine',
  'project_templates.create_project': 'routine',
  'forms.configure_on_submit': 'privileged',
}

/** Commands the table classifies explicitly (the audit surface of this file). */
export const EXPLICITLY_CLASSIFIED_COMMANDS: readonly string[] = Object.keys(COMMAND_RISK).sort()

/**
 * Resolve the classifier for a catalogue entry.
 *
 * Ladder (first match wins):
 *   1. the explicit per-command entry in `COMMAND_RISK`;
 *   2. a `read` verb — a query notifies nobody and changes nothing;
 *   3. a `destroy` verb — DATA-MODEL §5.14: deleting anything shared is privileged;
 *   4. the per-module default;
 *   5. `CONSERVATIVE_RISK_CLASS` (never `routine`).
 *
 * `moduleCatalogue` calls this at catalogue-build time so a definition always
 * carries a classifier; `unclassifiedCommandTypes()` backs the CI gate.
 */
export function riskClassFor(type: string, module: string, verb: string): RiskClassifier {
  const explicit = COMMAND_RISK[type]
  if (explicit !== undefined) return typeof explicit === 'function' ? (explicit as RiskClassifier) : () => explicit
  if (verb === 'read') return () => 'routine'
  if (verb === 'destroy') return () => 'privileged'
  const byModule = MODULE_RISK_DEFAULT[module]
  if (byModule) return () => byModule
  return () => CONSERVATIVE_RISK_CLASS
}

/**
 * Catalogue entries that resolve only through a fallback (no explicit entry).
 * The gate test reports them; they are not an error, but the list must stay
 * explainable: everything on it is covered by a structural rule or by its
 * module default.
 */
export function unclassifiedCommandTypes(entries: readonly { type: string }[]): string[] {
  return entries.filter(entry => COMMAND_RISK[entry.type] === undefined).map(entry => entry.type).sort()
}

/** True when the type has an explicit entry in the table (gate detail). */
export function isExplicitlyClassified(type: string): boolean {
  return Object.hasOwn(COMMAND_RISK, type)
}