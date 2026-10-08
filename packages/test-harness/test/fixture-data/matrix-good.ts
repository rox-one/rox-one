/**
 * W1-10 self-test fixture: a COMPLETE permission matrix module in #1501's
 * frozen row shape `{ action, role, tags, championAbsent, hasChildren, kind,
 * effectiveRole, allowed, reason? }`, with #1501's
 * `PERMISSION_MATRIX_TAG_SCENARIOS` export (required since #1507 review 4).
 * The rules below are written out by hand from DATA-MODEL §8 (independently
 * of the gate's transcription): kinds goal + project + task + note × 12
 * actions × 6 roles + no access × 7 tag scenarios × hasChildren = 4704 rows
 * (the same grid #1501 emits).
 */
const ROLES = ['minimal', 'viewer', 'commenter', 'editor', 'manager', 'owner'] as const
type Role = (typeof ROLES)[number]
const MIN: Record<string, Role> = {
  view_title: 'minimal', view: 'viewer', comment: 'commenter', react: 'commenter', edit: 'editor',
  check_in: 'manager', acknowledge: 'manager', close: 'manager', delete: 'manager', manage_access: 'manager',
  create_child: 'editor', transfer: 'owner',
}
const TAG_ROLE: Record<string, Role> = { owner: 'owner', champion: 'manager', reviewer: 'editor', contributor: 'editor', assignee: 'editor' }

export const PERMISSION_MATRIX_TAG_SCENARIOS = [
  { tags: [], championAbsent: false },
  { tags: ['champion'], championAbsent: false },
  { tags: ['reviewer'], championAbsent: false },
  { tags: ['reviewer'], championAbsent: true },
  { tags: ['contributor'], championAbsent: false },
  { tags: ['assignee'], championAbsent: false },
  { tags: ['owner'], championAbsent: false },
]

const rank = (r: Role | null) => (r === null ? -1 : ROLES.indexOf(r))

export function generatePermissionMatrix() {
  const rows: Array<Record<string, unknown>> = []
  for (const kind of ['goal', 'project', 'task', 'note']) {
    for (const action of Object.keys(MIN)) {
      for (const role of [...ROLES, null]) {
        for (const { tags, championAbsent } of PERMISSION_MATRIX_TAG_SCENARIOS) {
          for (const hasChildren of [false, true]) {
            let effectiveRole: Role | null = role
            for (const t of tags) if (rank(TAG_ROLE[t]!) > rank(effectiveRole)) effectiveRole = TAG_ROLE[t]!
            let allowed = rank(effectiveRole) >= rank(MIN[action]!)
            let reason = effectiveRole === null ? 'no_access' : `role_below_${MIN[action]}`
            const tagged = (t: string) => (tags as string[]).includes(t)
            if ((action === 'check_in' || action === 'close') && tagged('champion')) allowed = true
            if (action === 'check_in' && tagged('reviewer') && championAbsent) allowed = true
            if (action === 'acknowledge' && tagged('reviewer')) allowed = true
            if (action === 'delete' && kind === 'goal' && hasChildren && allowed) { allowed = false; reason = 'goal_has_children' }
            rows.push({ action, role, tags: [...tags], championAbsent, hasChildren, kind, effectiveRole, allowed, ...(allowed ? {} : { reason }) })
          }
        }
      }
    }
  }
  return rows
}
