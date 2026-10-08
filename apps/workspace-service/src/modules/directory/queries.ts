/**
 * W1-04 (#1501) — SQL for the directory read model (DATA-MODEL §5.9).
 *
 * Tables from W1-05 (#1502): `principal` (kind 502, status/primary_email 513),
 * `workspace_member` (status 513), `user_profile`, `department`,
 * `department_member` (502). Read-only; never invents people.
 */

export const MAX_MANAGER_CHAIN = 32
export const MAX_DIRECTORY_PAGE = 500

const PRINCIPAL_COLUMNS = (p: string) => `
  pr.principal_id::text AS principal_id, pr.kind, pr.status, m.role AS member_role, m.status AS member_status,
  up.display_name, up.given_name, up.family_name, up.username::text AS username, up.avatar_url, up.title,
  up.manager_id::text AS manager_id, up.time_zone, up.locale,
  COALESCE((SELECT array_agg(dm.department_id::text ORDER BY dm.department_id) FROM ${p}department_member dm
    JOIN ${p}department d ON d.department_id = dm.department_id
    WHERE dm.principal_id = pr.principal_id AND d.workspace_id = m.workspace_id AND d.deleted_at IS NULL), ARRAY[]::text[]) AS department_ids`

const MEMBER_FROM = (p: string) => `
  FROM ${p}workspace_member m
  JOIN ${p}principal pr ON pr.principal_id = m.principal_id AND pr.deleted_at IS NULL
  LEFT JOIN ${p}user_profile up ON up.principal_id = pr.principal_id AND up.deleted_at IS NULL
    AND (up.workspace_id IS NULL OR up.workspace_id = m.workspace_id)`

/** `$1` workspace, `$2` limit, `$3` after principal id ('' = start). Active members only. */
export const sqlMembers = (p: string) => `
  SELECT ${PRINCIPAL_COLUMNS(p)} ${MEMBER_FROM(p)}
  WHERE m.workspace_id = $1::uuid AND m.deleted_at IS NULL AND m.status = 'active'
    AND ($3 = '' OR pr.principal_id::text > $3)
  ORDER BY pr.principal_id::text LIMIT $2`

/** `$1` workspace, `$2` principal. Any membership status (callers filter). */
export const sqlPrincipal = (p: string) => `
  SELECT ${PRINCIPAL_COLUMNS(p)} ${MEMBER_FROM(p)}
  WHERE m.workspace_id = $1::uuid AND m.principal_id = $2::uuid AND m.deleted_at IS NULL`

export const sqlDepartments = (p: string) => `
  SELECT d.department_id::text AS department_id, d.parent_id::text AS parent_id, d.name,
    (SELECT dm.principal_id::text FROM ${p}department_member dm WHERE dm.department_id = d.department_id AND dm.role = 'head'
      ORDER BY dm.principal_id LIMIT 1) AS head_id
  FROM ${p}department d WHERE d.workspace_id = $1::uuid AND d.deleted_at IS NULL
  ORDER BY d.name, d.department_id`

/** `$1` workspace, `$2` department. Active members only. */
export const sqlDepartmentMembers = (p: string) => `
  SELECT dm.principal_id::text AS principal_id FROM ${p}department_member dm
  JOIN ${p}department d ON d.department_id = dm.department_id AND d.workspace_id = $1::uuid AND d.deleted_at IS NULL
  JOIN ${p}workspace_member m ON m.workspace_id = d.workspace_id AND m.principal_id = dm.principal_id
    AND m.deleted_at IS NULL AND m.status = 'active'
  WHERE dm.department_id = $2::uuid ORDER BY 1`

/**
 * Manager chain via a recursive CTE: bounded depth and a visited-path cycle
 * guard, so a cyclic `manager_id` graph terminates. `$1` workspace,
 * `$2` principal, `$3` max depth. Excludes the principal itself.
 */
export const sqlManagerChain = (p: string) => `
  WITH RECURSIVE chain(principal_id, depth, path) AS (
    SELECT up.manager_id, 1, ARRAY[up.principal_id, up.manager_id]
    FROM ${p}user_profile up
    WHERE up.principal_id = $2::uuid AND up.manager_id IS NOT NULL AND up.manager_id <> up.principal_id AND up.deleted_at IS NULL
      AND (up.workspace_id IS NULL OR up.workspace_id = $1::uuid)
    UNION ALL
    SELECT up.manager_id, c.depth + 1, c.path || up.manager_id
    FROM chain c JOIN ${p}user_profile up ON up.principal_id = c.principal_id AND up.deleted_at IS NULL
      AND (up.workspace_id IS NULL OR up.workspace_id = $1::uuid)
    WHERE up.manager_id IS NOT NULL AND NOT (up.manager_id = ANY(c.path)) AND c.depth < $3
  )
  SELECT c.principal_id::text AS principal_id, c.depth FROM chain c
  JOIN ${p}workspace_member m ON m.workspace_id = $1::uuid AND m.principal_id = c.principal_id AND m.deleted_at IS NULL
  ORDER BY c.depth`

/** `$1` workspace, `$2` manager. Active members only. */
export const sqlDirectReports = (p: string) => `
  SELECT up.principal_id::text AS principal_id FROM ${p}user_profile up
  JOIN ${p}workspace_member m ON m.workspace_id = $1::uuid AND m.principal_id = up.principal_id
    AND m.deleted_at IS NULL AND m.status = 'active'
  WHERE up.manager_id = $2::uuid AND up.deleted_at IS NULL AND (up.workspace_id IS NULL OR up.workspace_id = $1::uuid)
  ORDER BY 1`
