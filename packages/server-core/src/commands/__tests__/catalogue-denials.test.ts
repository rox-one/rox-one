/**
 * W1-10 (#1507) negative-tests gate — the deny path of EVERY gated catalogue
 * command.
 *
 * The gate wants each gated command (bound handler, or `schemaBound`) to show
 * a negative outcome. The honest, uniform one is the executor's own ACL
 * stage: run the command with the payload/target the reference scenario uses
 * (so it clears decode, authority, capability and payload schema), under an
 * authorizer that denies, and require the FORBIDDEN receipt.
 *
 * Why this is not a formality:
 * - the pipeline order is decode → authority → capability → schema →
 *   AUTHORIZE → execute, so a FORBIDDEN here proves the command's definition
 *   reached its authorization stage with a valid payload — a command deleted
 *   from the catalogue answers UNKNOWN_COMMAND and fails its row;
 * - the `calls` assertion pins the verb the definition declares: exactly one
 *   `can()` call, with that verb and the request target, so removing,
 *   rerouting or mis-verbing the ACL check of a single command fails that row;
 * - dropping the authorize stage altogether turns every row into an applied
 *   receipt (or a handler failure) and fails all of them.
 *
 * Ids are literal in the `.each` table on purpose: the gate only recognises an
 * id in a title, an `.each` table or a negative assertion, never in a loop
 * variable.
 */

import { describe, expect, test } from 'bun:test'
import type { Authorizer } from '@rox/core/commands'
import { InMemoryCommandStore } from '../store'
import { createHarness } from '../../work/__tests__/reference-harness'
import { REFERENCE_SCENARIO, type ScenarioStep } from '../../work/__tests__/reference-scenario'

/** id → the payload/target the reference scenario executes it with. */
const STEP_BY_TYPE = new Map<string, ScenarioStep>(REFERENCE_SCENARIO.map(step => [step.type, step]))

interface CanCall {
  verb: string
  ref: unknown
}

/** Denies everything, recording what was asked. */
function denyAll(): { calls: CanCall[]; authorizer: Authorizer } {
  const calls: CanCall[] = []
  return {
    calls,
    authorizer: {
      can: async (_principal, verb, ref) => {
        calls.push({ verb, ref })
        return false
      },
    },
  }
}

describe('catalogue command denials', () => {
  test.each([
    ['links.remove', 'write'],
    ['entities.pin', 'write'],
    ['entities.unpin', 'write'],
    ['entities.reorder_pins', 'write'],
    ['comments.edit', 'write'],
    ['comments.delete', 'destroy'],
    ['comments.resolve', 'write'],
    ['comments.resolve_thread', 'write'],
    ['comments.reopen_thread', 'write'],
    ['comments.react', 'write'],
    ['comments.convert_to_task', 'write'],
    ['reactions.add', 'write'],
    ['reactions.remove', 'write'],
    ['subscriptions.set_notify_everyone', 'write'],
    ['im.create_chat', 'write'],
    ['im.update_chat', 'write'],
    ['im.disband_chat', 'destroy'],
    ['im.get_or_create_p2p', 'write'],
    ['im.update_member_state', 'write'],
    ['im.recall_message', 'destroy'],
    ['im.pin', 'write'],
    ['im.unpin', 'write'],
    ['im.set_top_notice', 'write'],
    ['im.update_announcement', 'write'],
    ['im.create_tab', 'write'],
    ['im.update_tab', 'write'],
    ['im.delete_tab', 'destroy'],
    ['im.mark_unread', 'write'],
    ['im.create_label', 'write'],
    ['im.label_chats', 'write'],
    ['im.create_space_chat', 'write'],
    ['im.create_entity_chat', 'write'],
    ['im.leave_chat', 'write'],
    ['im.set_visibility', 'share'],
    ['im.share_entity', 'write'],
    ['docs.create_document', 'write'],
    ['docs.move_note_to_shared', 'share'],
    ['docs.move_back_to_private', 'share'],
    ['docs.update_title', 'write'],
    ['docs.publish_post', 'publish'],
    ['docs.schedule_post', 'publish'],
    ['docs.restore_version', 'write'],
    ['docs.set_public_sharing', 'share'],
    ['docs.suggest_changes', 'write'],
    ['docs.decide_suggestion', 'write'],
    ['docs.sync_suggestions', 'write'],
    ['docs.record_view', 'read'],
    ['docs.ensure_daily_note', 'write'],
    ['docs.append_daily_link', 'write'],
    ['docs.create_meeting_notes', 'write'],
    ['docs.insert_event_block', 'write'],
    ['docs.insert_meeting_block', 'write'],
    ['docs.embed_view', 'write'],
    ['docs.create_from_messages', 'write'],
    ['docs.create_from_email', 'write'],
    ['drive.create_folder', 'write'],
    ['drive.rename_folder', 'write'],
    ['drive.add_link', 'write'],
    ['drive.upload_file', 'write'],
    ['drive.favorite', 'write'],
    ['drive.add_shortcut', 'write'],
    ['drive.provision', 'write'],
    ['drive.open_upload', 'write'],
    ['drive.complete_upload', 'write'],
    ['drive.import_attachment', 'write'],
    ['wiki.create_space', 'write'],
    ['wiki.move_node', 'write'],
    ['tasks.update', 'write'],
    ['tasks.update_status', 'write'],
    ['tasks.complete', 'write'],
    ['tasks.reopen', 'write'],
    ['tasks.cancel', 'write'],
    ['tasks.archive', 'write'],
    ['tasks.delete', 'destroy'],
    ['tasks.update_assignees', 'write'],
    ['tasks.set_user_state', 'write'],
    ['tasks.remove_from_list', 'write'],
    ['tasks.update_reminders', 'write'],
    ['task_lists.create', 'write'],
    ['task_lists.archive', 'write'],
    ['task_lists.delete', 'destroy'],
    ['task_sections.create', 'write'],
    ['task_sections.update', 'write'],
    ['task_sections.move', 'write'],
    ['task_sections.delete', 'destroy'],
    ['task_list_groups.create', 'write'],
    ['task_list_groups.update', 'write'],
    ['task_list_groups.delete', 'destroy'],
    ['task_statuses.update_set', 'write'],
    ['tasks.create_from_selection', 'write'],
    ['tasks.create_many_from_checklist', 'write'],
    ['tasks.create_from_message', 'write'],
    ['tasks.create_from_email', 'write'],
    ['calendar.update_event', 'write'],
    ['calendar.delete_event', 'destroy'],
    ['calendar.rsvp', 'write'],
    ['calendar.create_calendar', 'write'],
    ['calendar.subscribe', 'write'],
    ['calendar.book_room', 'write'],
    ['calendar.create_event_from_message', 'write'],
    ['calendar.create_time_block', 'write'],
    ['calendar.create_event_from_email', 'write'],
    ['vc.start_meeting', 'write'],
    ['vc.join', 'write'],
    ['vc.end', 'write'],
    ['vc.set_recording', 'write'],
    ['people.update_profile', 'write'],
    ['people.set_manager', 'write'],
    ['contacts.create_card', 'write'],
    ['contacts.update_card', 'write'],
    ['contacts.star', 'write'],
    ['contacts.add_touch', 'write'],
    ['goals.create', 'write'],
    ['goals.update_name', 'write'],
    ['goals.update_description', 'write'],
    ['goals.update_parent_goal', 'write'],
    ['goals.update_start_date', 'write'],
    ['goals.update_due_date', 'write'],
    ['goals.update_champion', 'write'],
    ['goals.update_reviewer', 'write'],
    ['goals.update_space', 'write'],
    ['goals.update_access_levels', 'share'],
    ['goals.create_target', 'write'],
    ['goals.update_target', 'write'],
    ['goals.update_target_value', 'write'],
    ['goals.update_target_index', 'write'],
    ['goals.delete_target', 'destroy'],
    ['goals.create_check', 'write'],
    ['goals.update_check', 'write'],
    ['goals.toggle_check', 'write'],
    ['goals.update_check_index', 'write'],
    ['goals.delete_check', 'destroy'],
    ['goals.close', 'write'],
    ['goals.reopen', 'write'],
    ['goals.delete', 'destroy'],
    ['goals.unalign', 'write'],
    ['goals.set_target_status_override', 'write'],
    ['okr.create_cycle', 'write'],
    ['okr.publish_cycle', 'publish'],
    ['okr.publish_objectives', 'publish'],
    ['goals.create_check_in', 'write'],
    ['goals.update_check_in', 'write'],
    ['goals.delete_check_in', 'destroy'],
    ['goals.acknowledge_check_in', 'write'],
    ['goals.record_check_in_summary', 'write'],
    ['checkins.draft_from_activity', 'read'],
    ['goals.link_work', 'write'],
    ['goals.unlink_work', 'write'],
    ['projects.create', 'write'],
    ['projects.update_name', 'write'],
    ['projects.update_description', 'write'],
    ['projects.update_parent_goal', 'write'],
    ['projects.update_champion', 'write'],
    ['projects.update_reviewer', 'write'],
    ['projects.add_contributor', 'share'],
    ['projects.update_contributor', 'share'],
    ['projects.remove_contributor', 'share'],
    ['projects.update_dates', 'write'],
    ['projects.pause', 'write'],
    ['projects.resume', 'write'],
    ['projects.close', 'write'],
    ['projects.move', 'write'],
    ['projects.delete', 'destroy'],
    ['projects.share', 'share'],
    ['projects.add_resource', 'write'],
    ['projects.remove_resource', 'write'],
    ['projects.update_task_statuses', 'write'],
    ['milestones.update', 'write'],
    ['milestones.complete', 'write'],
    ['milestones.reopen', 'write'],
    ['milestones.delete', 'destroy'],
    ['milestones.reorder', 'write'],
    ['projects.create_check_in', 'write'],
    ['projects.update_check_in', 'write'],
    ['projects.delete_check_in', 'destroy'],
    ['projects.acknowledge_check_in', 'write'],
    ['reviews.create', 'write'],
    ['reviews.acknowledge', 'write'],
    ['reviews.create_cycle_review', 'write'],
    ['spaces.create', 'write'],
    ['spaces.update', 'write'],
    ['spaces.update_tools', 'write'],
    ['spaces.update_general_access', 'share'],
    ['spaces.update_task_statuses', 'write'],
    ['spaces.join', 'write'],
    ['spaces.delete', 'destroy'],
    ['kpis.create', 'write'],
    ['kpis.update', 'write'],
    ['kpis.delete', 'destroy'],
    ['kpis.log_entry', 'write'],
    ['kpis.edit_entry', 'write'],
    ['kpis.delete_entry', 'destroy'],
    ['kpis.add_annotation', 'write'],
    ['kpis.edit_annotation', 'write'],
    ['kpis.delete_annotation', 'destroy'],
    ['notifications.mark_read', 'write'],
    ['notifications.mark_all_read', 'write'],
    ['notifications.update_prefs', 'write'],
    ['reminders.create', 'write'],
    ['reminders.cancel', 'write'],
    ['mail.create_task_from_thread', 'write'],
    ['project_templates.create_from_project', 'write'],
    ['exports.markdown', 'read'],
    ['commands.batch', 'write'],
    ['workspaces.create', 'write'],
    ['identity.activate_placeholder', 'write'],
    ['identity.merge_placeholder', 'write'],
    ['onboarding.seed_starter_content', 'write'],
    ['agents.pause', 'write'],
  ])('%s is denied for a principal without the required %s verb', async (type, verb) => {
    const step = STEP_BY_TYPE.get(type)
    expect(step, `no reference-scenario step for ${type}`).toBeDefined()
    const scenarioStep = step as ScenarioStep
    const { calls, authorizer } = denyAll()
    const harness = createHarness({
      local: new InMemoryCommandStore(),
      workspace: new InMemoryCommandStore(),
      authorizer,
    })
    const receipt = await harness.run(scenarioStep)
    expect(harness.registry.get(type), `${type} is not in the wired registry`).toBeDefined()
    expect(receipt).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toEqual([{ verb, ref: scenarioStep.target ?? null }])
  })
})
