/**
 * W1-04 (#1501) — SQL for the ACL fact source.
 *
 * Table / column names come from the W1-05 (#1502) DDL: `502-directory.sql`
 * (principal.kind, department_member), `503-acl.sql` (acl_entry,
 * resource_policy), `509`–`525` (resource tables) and `513` (principal.status,
 * workspace_member.status). Every query is parameterised; the schema prefix is
 * validated by the repository constructor.
 *
 * Each resource loader returns normalised columns so one mapper builds the
 * `AclResourceNode`:
 *   id, workspace_id, deleted, parent_refs (text[] of `kind:id`), space_id,
 *   owner_id, champion_id, reviewer_id, contributor_ids (text[]),
 *   assignee_ids (text[]), has_children, secret, implicit_workspace_role,
 *   link_token
 * `implicit_workspace_role` encodes table-level visibility that predates
 * `acl_entry` (project.visibility = 'members', public chats, company spaces,
 * company goals, workspace-shared task lists) as a synthetic
 * `workspace` subject entry; `secret` encodes "only invited" visibility
 * (private projects / chats / task lists, personal goals, or
 * `resource_policy.policy->>'privacy' = 'invited'`).
 */

import type { EntityKind } from '../../../../../packages/core/src/entities/kinds.ts'

/**
 * `acl_entry.resource_type` / `resource_policy.resource_type` values a kind may
 * be stored under. The #1502 CHECK lists both `note` and the legacy `doc`.
 */
export function aclStoredResourceTypes(type: string): string[] {
  return type === 'note' ? ['note', 'doc'] : [type]
}

export const sqlPolicyEpoch = (p: string) => `
  SELECT policy_epoch::text AS policy_epoch FROM ${p}workspace WHERE workspace_id = $1::uuid AND deleted_at IS NULL`

export const sqlMembership = (p: string) => `
  SELECT m.role, m.status
  FROM ${p}workspace_member m JOIN ${p}principal pr ON pr.principal_id = m.principal_id
  WHERE m.workspace_id = $1::uuid AND m.principal_id = $2::uuid AND m.deleted_at IS NULL AND pr.deleted_at IS NULL`

export const sqlPrincipal = (p: string) => `
  SELECT pr.kind, pr.status FROM ${p}principal pr WHERE pr.principal_id = $1::uuid AND pr.deleted_at IS NULL`

export const sqlEntries = (p: string) => `
  SELECT subject_type, subject_id, role FROM ${p}acl_entry
  WHERE workspace_id = $1::uuid AND resource_type = ANY(string_to_array($2, ',')) AND resource_id = $3
  ORDER BY subject_type, subject_id`

export const sqlPolicy = (p: string) => `
  SELECT default_subject, default_role, policy FROM ${p}resource_policy
  WHERE workspace_id = $1::uuid AND resource_type = ANY(string_to_array($2, ',')) AND resource_id = $3
  ORDER BY array_position(string_to_array($2, ','), resource_type) LIMIT 1`

export const sqlDepartments = (p: string) => `
  SELECT dm.department_id::text AS id FROM ${p}department_member dm
  JOIN ${p}department d ON d.department_id = dm.department_id
  WHERE d.workspace_id = $1::uuid AND dm.principal_id = $2::uuid AND d.deleted_at IS NULL
  ORDER BY 1`

export const sqlChannels = (p: string) => `
  SELECT cm.chat_id::text AS id FROM ${p}chat_member cm
  JOIN ${p}chat c ON c.chat_id = cm.chat_id
  WHERE c.workspace_id = $1::uuid AND cm.principal_id = $2::uuid AND cm.state = 'active' AND c.deleted_at IS NULL
  ORDER BY 1`

/** Synthetic chat-member grants on a channel (owner → manager, admin → editor, member → commenter). */
export const sqlChatMembers = (p: string) => `
  SELECT cm.principal_id::text AS principal_id, cm.role FROM ${p}chat_member cm
  WHERE cm.chat_id = $1::uuid AND cm.state = 'active'
  ORDER BY 1`

/**
 * Space members = active members of the space's chat (DATA-MODEL §5.7,
 * `space.chat_id`, ADR-U07). Mapped to principal entries on the space so
 * `isSpaceMember` and inheritance see them.
 */
export const sqlSpaceMembers = (p: string) => `
  SELECT cm.principal_id::text AS principal_id, cm.role FROM ${p}chat_member cm
  JOIN ${p}space s ON s.chat_id = cm.chat_id
  WHERE s.space_id = $1::uuid AND cm.state = 'active'
  ORDER BY 1`

const policySecret = (p: string, type: string, idExpr: string) =>
  `EXISTS (SELECT 1 FROM ${p}resource_policy rp WHERE rp.resource_type IN (${aclStoredResourceTypes(type).map(t => `'${t}'`).join(', ')}) AND rp.resource_id = ${idExpr}::text AND rp.policy->>'privacy' = 'invited')`

const NONE = `NULL::text`
const EMPTY = `ARRAY[]::text[]`

/** Resource loaders by entity kind. `$1` = resource id (uuid). */
export const RESOURCE_LOADERS: Partial<Record<EntityKind, (p: string) => string>> = {
  space: p => `
    SELECT s.space_id::text AS id, s.workspace_id::text AS workspace_id, (s.deleted_at IS NOT NULL) AS deleted,
      ${EMPTY} AS parent_refs, s.space_id::text AS space_id, ${NONE} AS owner_id, ${NONE} AS champion_id, ${NONE} AS reviewer_id,
      ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      ${policySecret(p, 'space', 's.space_id')} AS secret,
      CASE WHEN s.default_access = 'company_edit' THEN 'editor' WHEN s.default_access = 'company_comment' THEN 'commenter'
           WHEN s.default_access = 'company_view' OR s.is_company_space THEN 'viewer' ELSE NULL END AS implicit_workspace_role,
      ${NONE} AS link_token
    FROM ${p}space s WHERE s.space_id = $1::uuid`,
  goal: p => `
    SELECT g.goal_id::text AS id, g.workspace_id::text AS workspace_id, (g.deleted_at IS NOT NULL) AS deleted,
      array_remove(ARRAY[
        CASE WHEN g.parent_goal_id IS NOT NULL THEN 'goal:' || g.parent_goal_id::text END,
        CASE WHEN g.scope = 'space' AND g.space_id IS NOT NULL THEN 'space:' || g.space_id::text END
      ], NULL) AS parent_refs,
      g.space_id::text AS space_id, g.creator_id::text AS owner_id, g.champion_id::text AS champion_id, g.reviewer_id::text AS reviewer_id,
      ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids,
      (EXISTS (SELECT 1 FROM ${p}goal c WHERE c.parent_goal_id = g.goal_id AND c.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM ${p}project pj WHERE pj.parent_goal_id = g.goal_id AND pj.deleted_at IS NULL)) AS has_children,
      (g.scope = 'personal' OR ${policySecret(p, 'goal', 'g.goal_id')}) AS secret,
      CASE WHEN g.scope = 'company' THEN 'viewer' ELSE NULL END AS implicit_workspace_role,
      ${NONE} AS link_token
    FROM ${p}goal g WHERE g.goal_id = $1::uuid`,
  'goal-target': p => `
    SELECT t.goal_target_id::text AS id, g.workspace_id::text AS workspace_id, (t.deleted_at IS NOT NULL OR g.deleted_at IS NOT NULL) AS deleted,
      ARRAY['goal:' || g.goal_id::text] AS parent_refs, g.space_id::text AS space_id, t.owner_id::text AS owner_id,
      ${NONE} AS champion_id, ${NONE} AS reviewer_id, ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      false AS secret, ${NONE} AS implicit_workspace_role, ${NONE} AS link_token
    FROM ${p}goal_target t JOIN ${p}goal g ON g.goal_id = t.goal_id WHERE t.goal_target_id = $1::uuid`,
  'goal-check': p => `
    SELECT k.goal_check_id::text AS id, g.workspace_id::text AS workspace_id, (k.deleted_at IS NOT NULL OR g.deleted_at IS NOT NULL) AS deleted,
      ARRAY['goal:' || g.goal_id::text] AS parent_refs, g.space_id::text AS space_id, ${NONE} AS owner_id,
      ${NONE} AS champion_id, ${NONE} AS reviewer_id, ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      false AS secret, ${NONE} AS implicit_workspace_role, ${NONE} AS link_token
    FROM ${p}goal_check k JOIN ${p}goal g ON g.goal_id = k.goal_id WHERE k.goal_check_id = $1::uuid`,
  project: p => `
    SELECT pj.project_id::text AS id, pj.workspace_id::text AS workspace_id, (pj.deleted_at IS NOT NULL) AS deleted,
      array_remove(ARRAY[
        CASE WHEN pj.parent_goal_id IS NOT NULL THEN 'goal:' || pj.parent_goal_id::text END,
        CASE WHEN pj.space_id IS NOT NULL THEN 'space:' || pj.space_id::text END
      ], NULL) AS parent_refs,
      pj.space_id::text AS space_id, pj.owner_principal_id::text AS owner_id,
      COALESCE(pj.champion_id::text, (SELECT pm.principal_id::text FROM ${p}project_member pm
        WHERE pm.project_id = pj.project_id AND pm.workspace_id = pj.workspace_id AND pm.role = 'champion' ORDER BY 1 LIMIT 1)) AS champion_id,
      COALESCE(pj.reviewer_id::text, (SELECT pm.principal_id::text FROM ${p}project_member pm
        WHERE pm.project_id = pj.project_id AND pm.workspace_id = pj.workspace_id AND pm.role = 'reviewer' ORDER BY 1 LIMIT 1)) AS reviewer_id,
      COALESCE((SELECT array_agg(pm.principal_id::text ORDER BY pm.principal_id) FROM ${p}project_member pm
        WHERE pm.project_id = pj.project_id AND pm.workspace_id = pj.workspace_id AND pm.role = 'contributor'), ${EMPTY}) AS contributor_ids,
      ${EMPTY} AS assignee_ids, false AS has_children,
      (pj.visibility = 'private' OR ${policySecret(p, 'project', 'pj.project_id')}) AS secret,
      CASE WHEN pj.visibility = 'members' THEN 'viewer' ELSE NULL END AS implicit_workspace_role,
      ${NONE} AS link_token
    FROM ${p}project pj WHERE pj.project_id = $1::uuid`,
  milestone: p => `
    SELECT m.milestone_id::text AS id, m.workspace_id::text AS workspace_id, (m.deleted_at IS NOT NULL) AS deleted,
      ARRAY['project:' || m.project_id::text] AS parent_refs, ${NONE} AS space_id, ${NONE} AS owner_id,
      ${NONE} AS champion_id, ${NONE} AS reviewer_id, ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      false AS secret, ${NONE} AS implicit_workspace_role, ${NONE} AS link_token
    FROM ${p}milestone m WHERE m.milestone_id = $1::uuid`,
  task: p => `
    SELECT w.work_item_id::text AS id, w.workspace_id::text AS workspace_id, (w.deleted_at IS NOT NULL) AS deleted,
      array_remove(ARRAY[
        CASE WHEN w.parent_id IS NOT NULL THEN 'task:' || w.parent_id::text END,
        CASE WHEN w.project_id IS NOT NULL THEN 'project:' || w.project_id::text END,
        CASE WHEN w.milestone_id IS NOT NULL THEN 'milestone:' || w.milestone_id::text END,
        CASE WHEN w.space_id IS NOT NULL AND w.project_id IS NULL THEN 'space:' || w.space_id::text END
      ], NULL) || COALESCE((SELECT array_agg('task-list:' || til.task_list_id::text ORDER BY til.task_list_id)
        FROM ${p}task_in_list til WHERE til.work_item_id = w.work_item_id), ${EMPTY}) AS parent_refs,
      w.space_id::text AS space_id, w.owner_principal_id::text AS owner_id, ${NONE} AS champion_id, ${NONE} AS reviewer_id,
      ${EMPTY} AS contributor_ids,
      COALESCE((SELECT array_agg(wm.principal_id::text ORDER BY wm.principal_id) FROM ${p}work_item_member wm
        WHERE wm.work_item_id = w.work_item_id AND wm.role = 'assignee'), ${EMPTY}) AS assignee_ids,
      false AS has_children, ${policySecret(p, 'task', 'w.work_item_id')} AS secret,
      ${NONE} AS implicit_workspace_role, ${NONE} AS link_token
    FROM ${p}work_item w WHERE w.work_item_id = $1::uuid`,
  'task-list': p => `
    SELECT l.task_list_id::text AS id, l.workspace_id::text AS workspace_id, (l.deleted_at IS NOT NULL) AS deleted,
      CASE WHEN l.owner_type IN ('project', 'space') THEN ARRAY[l.owner_type || ':' || l.owner_id::text]
           WHEN l.owner_type = 'chat' THEN ARRAY['channel:' || l.owner_id::text] ELSE ${EMPTY} END AS parent_refs,
      CASE WHEN l.owner_type = 'space' THEN l.owner_id::text END AS space_id,
      CASE WHEN l.owner_type = 'user' THEN l.owner_id::text END AS owner_id,
      ${NONE} AS champion_id, ${NONE} AS reviewer_id, ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      (l.share_mode = 'private' OR ${policySecret(p, 'task-list', 'l.task_list_id')}) AS secret,
      CASE WHEN l.share_mode = 'workspace' THEN 'viewer' ELSE NULL END AS implicit_workspace_role,
      ${NONE} AS link_token
    FROM ${p}task_list l WHERE l.task_list_id = $1::uuid`,
  note: p => `
    SELECT d.doc_id::text AS id, d.workspace_id::text AS workspace_id, (d.deleted_at IS NOT NULL) AS deleted,
      array_remove(ARRAY[
        CASE WHEN d.folder_id IS NOT NULL THEN 'folder:' || d.folder_id::text END,
        CASE WHEN d.wiki_space_id IS NOT NULL THEN 'wiki-space:' || d.wiki_space_id::text END,
        CASE WHEN d.space_id IS NOT NULL AND d.folder_id IS NULL THEN 'space:' || d.space_id::text END
      ], NULL) AS parent_refs,
      d.space_id::text AS space_id, d.owner_id::text AS owner_id, ${NONE} AS champion_id, ${NONE} AS reviewer_id,
      ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      ${policySecret(p, 'note', 'd.doc_id')} AS secret, ${NONE} AS implicit_workspace_role, d.public_token AS link_token
    FROM ${p}doc d WHERE d.doc_id = $1::uuid`,
  folder: p => `
    SELECT f.folder_id::text AS id, f.workspace_id::text AS workspace_id, (f.deleted_at IS NOT NULL) AS deleted,
      array_remove(ARRAY[
        CASE WHEN f.parent_id IS NOT NULL THEN 'folder:' || f.parent_id::text END,
        CASE WHEN f.owner_type IN ('space', 'goal', 'project') AND f.owner_id IS NOT NULL THEN f.owner_type || ':' || f.owner_id::text END,
        CASE WHEN f.owner_type = 'chat' AND f.owner_id IS NOT NULL THEN 'channel:' || f.owner_id::text END
      ], NULL) AS parent_refs,
      CASE WHEN f.owner_type = 'space' THEN f.owner_id::text END AS space_id,
      CASE WHEN f.owner_type = 'user' THEN f.owner_id::text END AS owner_id,
      ${NONE} AS champion_id, ${NONE} AS reviewer_id, ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      ${policySecret(p, 'folder', 'f.folder_id')} AS secret,
      CASE WHEN f.owner_type = 'workspace' THEN 'viewer' ELSE NULL END AS implicit_workspace_role, ${NONE} AS link_token
    FROM ${p}folder f WHERE f.folder_id = $1::uuid`,
  channel: p => `
    SELECT c.chat_id::text AS id, c.workspace_id::text AS workspace_id, (c.deleted_at IS NOT NULL) AS deleted,
      CASE WHEN c.space_id IS NOT NULL THEN ARRAY['space:' || c.space_id::text] ELSE ${EMPTY} END AS parent_refs,
      c.space_id::text AS space_id, c.created_by::text AS owner_id, ${NONE} AS champion_id, ${NONE} AS reviewer_id,
      ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      (c.visibility = 'private' OR ${policySecret(p, 'channel', 'c.chat_id')}) AS secret,
      CASE WHEN c.visibility = 'public' THEN 'viewer' ELSE NULL END AS implicit_workspace_role, ${NONE} AS link_token
    FROM ${p}chat c WHERE c.chat_id = $1::uuid`,
  calendar: p => `
    SELECT k.calendar_id::text AS id, k.workspace_id::text AS workspace_id, (k.deleted_at IS NOT NULL) AS deleted,
      CASE WHEN k.owner_type = 'space' AND k.owner_id IS NOT NULL THEN ARRAY['space:' || k.owner_id::text]
           WHEN k.owner_type = 'channel' AND k.owner_id IS NOT NULL THEN ARRAY['channel:' || k.owner_id::text] ELSE ${EMPTY} END AS parent_refs,
      CASE WHEN k.owner_type = 'space' THEN k.owner_id::text END AS space_id,
      CASE WHEN k.owner_type = 'principal' THEN k.owner_id::text END AS owner_id,
      ${NONE} AS champion_id, ${NONE} AS reviewer_id, ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      ${policySecret(p, 'calendar', 'k.calendar_id')} AS secret,
      CASE WHEN k.owner_type = 'workspace' THEN 'viewer' ELSE NULL END AS implicit_workspace_role, ${NONE} AS link_token
    FROM ${p}calendar k WHERE k.calendar_id = $1::uuid`,
  kpi: p => `
    SELECT k.kpi_id::text AS id, k.workspace_id::text AS workspace_id, (k.deleted_at IS NOT NULL) AS deleted,
      ARRAY['space:' || k.space_id::text] AS parent_refs, k.space_id::text AS space_id, ${NONE} AS owner_id,
      k.champion_id::text AS champion_id, ${NONE} AS reviewer_id, ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      ${policySecret(p, 'kpi', 'k.kpi_id')} AS secret, ${NONE} AS implicit_workspace_role, ${NONE} AS link_token
    FROM ${p}kpi k WHERE k.kpi_id = $1::uuid`,
  'okr-cycle': p => `
    SELECT o.okr_cycle_id::text AS id, o.workspace_id::text AS workspace_id, (o.deleted_at IS NOT NULL) AS deleted,
      ${EMPTY} AS parent_refs, ${NONE} AS space_id, ${NONE} AS owner_id, ${NONE} AS champion_id, ${NONE} AS reviewer_id,
      ${EMPTY} AS contributor_ids, ${EMPTY} AS assignee_ids, false AS has_children,
      ${policySecret(p, 'okr-cycle', 'o.okr_cycle_id')} AS secret, 'viewer' AS implicit_workspace_role, ${NONE} AS link_token
    FROM ${p}okr_cycle o WHERE o.okr_cycle_id = $1::uuid`,
}
