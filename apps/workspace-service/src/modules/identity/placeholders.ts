/**
 * W1-11 (#1508) — Identity lifecycle statements for the workspace authority
 * (`13-identity-lifecycle.sql` = file `513-identity-lifecycle.sql`,
 * DATA-MODEL §5.11).
 *
 * These are the SQL facts the wave-2 identity module (ONB) executes: the
 * placeholder row, its pending invitation, the activation that keeps the
 * `principal_id`, and the merge that re-points rows before deactivating the
 * placeholder. The reference handler path (`@rox/server-core/agents`) uses the
 * in-memory store; this file is the bridge to the real tables, and
 * `placeholders.test.ts` pins every referenced column to the migration that
 * declares it.
 *
 * Column notes that matter:
 * - `workspace` has no `slug` column (the slug is a workspace setting, not a
 *   row field); `general_chat_id` arrives with 513;
 * - `workspace_member.role` is constrained to `owner | member` by
 *   `01-domain-contract.sql`, so a creator is inserted as `owner` (the
 *   `admin` role of DATA-MODEL §5.11 arrives through invitations and ACL
 *   grants, as `@rox/core/identity` documents);
 * - assignments live in `work_item_member` (`role='assignee'`), not on
 *   `work_item`.
 *
 * Nothing here validates input: the payload schemas
 * (`@rox/shared/identity/schemas`) and the pure rules (`@rox/core/identity`)
 * already did.
 */

/** Quoted schema prefix (`"public".`) or nothing for the default search path. */
function prefixOf(schema: string | undefined): string {
  return schema ? `"${schema.replaceAll('"', '""')}".` : ''
}

/**
 * Create the workspace with its **General** chat in one transaction
 * (§15.1): the chat row carries `system_role='general'` and
 * `visibility='public'`, and `workspace.general_chat_id` points at it.
 */
export function createWorkspaceWithGeneralChat(schema?: string): string {
  const p = prefixOf(schema)
  return `
INSERT INTO ${p}workspace (workspace_id, owner_principal_id, name)
VALUES ($1, $2, $3);
INSERT INTO ${p}chat (chat_id, workspace_id, kind, visibility, system_role, name, posting_policy, invite_policy, created_by)
VALUES ($4, $1, 'group', 'public', 'general', $5, 'all', 'members', $2);
UPDATE ${p}workspace SET general_chat_id = $4 WHERE workspace_id = $1;
INSERT INTO ${p}chat_member (chat_id, principal_id, role, state) VALUES ($4, $2, 'owner', 'active');
INSERT INTO ${p}workspace_member (workspace_id, principal_id, role, status, joined_at)
VALUES ($1, $2, 'owner', 'active', clock_timestamp());`
}

/** The placeholder principal (§5.11 rule 1): status `placeholder`, email citext. */
export function insertPlaceholderPrincipal(schema?: string): string {
  const p = prefixOf(schema)
  return `
INSERT INTO ${p}principal (principal_id, kind, status, primary_email, invited_by)
VALUES ($1, 'human', 'placeholder', $2, $3)`
}

/** The invitation row; `token_hash` is sha256 of the single-use token (§15.2). */
export function insertInvitation(schema?: string): string {
  const p = prefixOf(schema)
  return `
INSERT INTO ${p}invitation (invitation_id, workspace_id, email, principal_id, invited_by, role, targets, token_hash,
    status, message, sent_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'pending', $9, clock_timestamp(), clock_timestamp() + interval '30 days')`
}

/** The General-chat membership a placeholder holds until activation. */
export function insertPendingChatMember(schema?: string): string {
  const p = prefixOf(schema)
  return `
INSERT INTO ${p}chat_member (chat_id, principal_id, role, state)
VALUES ($1, $2, 'member', 'pending_activation')`
}

/**
 * Activation (§5.11 rule 4): the auth subject is attached to the **same**
 * principal, the status flips, and the memberships become active. The id is
 * never rewritten, so every mention, assignment and link keeps working. The
 * auth subject itself is stored by `auth_subject_alias` (01-domain-contract).
 */
export function activatePlaceholder(schema?: string): string {
  const p = prefixOf(schema)
  return `
UPDATE ${p}principal
   SET status = 'active', activated_at = clock_timestamp()
 WHERE principal_id = $1 AND status = 'placeholder';
INSERT INTO ${p}auth_subject_alias (issuer, subject, principal_id) VALUES ($2, $3, $1);
UPDATE ${p}workspace_member SET status = 'active', joined_at = clock_timestamp()
 WHERE principal_id = $1 AND status = 'invited';
UPDATE ${p}chat_member SET state = 'active'
 WHERE principal_id = $1 AND state = 'pending_activation';
UPDATE ${p}invitation SET status = 'accepted', accepted_at = clock_timestamp()
 WHERE principal_id = $1 AND status = 'pending';`
}

/**
 * Merge (§5.11 rule 6): re-point the rows in the documented batch order, then
 * deactivate the placeholder with `merged_into`. Batched per table so a large
 * placeholder does not hold the transaction on one statement.
 */
export function mergePlaceholderStatements(schema?: string): readonly string[] {
  const p = prefixOf(schema)
  return [
    // chat_member first: a duplicate (chat, account) row is dropped, the rest moves.
    `UPDATE ${p}chat_member SET principal_id = $2 WHERE principal_id = $1 AND NOT EXISTS (
       SELECT 1 FROM ${p}chat_member other WHERE other.chat_id = ${p}chat_member.chat_id AND other.principal_id = $2)`,
    `DELETE FROM ${p}chat_member WHERE principal_id = $1`,
    `UPDATE ${p}workspace_member SET principal_id = $2 WHERE principal_id = $1 AND NOT EXISTS (
       SELECT 1 FROM ${p}workspace_member other WHERE other.workspace_id = ${p}workspace_member.workspace_id AND other.principal_id = $2)`,
    `DELETE FROM ${p}workspace_member WHERE principal_id = $1`,
    // Assignments are rows in work_item_member (`role='assignee'`).
    `UPDATE ${p}work_item_member SET principal_id = $2 WHERE principal_id = $1`,
    // Entity links store `person` refs as text ids.
    `UPDATE ${p}entity_link SET from_id = $2 WHERE from_kind = 'person' AND from_id = $1`,
    `UPDATE ${p}entity_link SET to_id = $2 WHERE to_kind = 'person' AND to_id = $1`,
    // Mentions are a uuid[] on the message row (512-im.sql).
    `UPDATE ${p}message SET mentions = array_replace(mentions, $1::uuid, $2::uuid) WHERE $1::uuid = ANY(mentions)`,
    // The placeholder is deactivated with `merged_into`; its email is freed.
    `UPDATE ${p}principal SET status = 'deactivated', merged_into = $2, primary_email = NULL WHERE principal_id = $1`,
  ]
}

/** The invitation's live-row invariant: one pending invite per (workspace, email). */
export const INVITATION_PENDING_UNIQUE = 'invitation_pending_uniq'

/** The General-chat invariant: one `system_role='general'` row per workspace. */
export const GENERAL_CHAT_UNIQUE = 'chat_general_uniq'

/** The DDL files these statements depend on. */
export const PLACEHOLDER_DDL_FILES = [
  '01-domain-contract.sql',
  '502-directory.sql',
  '508-social.sql',
  '512-im.sql',
  '513-identity-lifecycle.sql',
  '520-work-item.sql',
] as const