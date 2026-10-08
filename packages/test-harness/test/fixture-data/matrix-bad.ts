/**
 * W1-10 self-test fixture: a matrix in #1501's row shape that is
 * well-formed but WRONG — each row breaks one DATA-MODEL §8 invariant.
 */
const base = { championAbsent: false, hasChildren: false, kind: 'goal' }

/** Required export (#1507 review 4); the rows below are what is wrong. */
export const PERMISSION_MATRIX_TAG_SCENARIOS = [
  { tags: [], championAbsent: false },
  { tags: ['champion'], championAbsent: false },
  { tags: ['reviewer'], championAbsent: false },
  { tags: ['reviewer'], championAbsent: true },
]

export function generatePermissionMatrix() {
  return [
    // viewer edits (invariant: viewer / minimal never edit)
    { ...base, action: 'edit', role: 'viewer', tags: [], effectiveRole: 'viewer', allowed: true },
    // manager transfers (owner only)
    { ...base, action: 'transfer', role: 'manager', tags: [], effectiveRole: 'manager', allowed: true },
    // champion should raise to manager
    { ...base, action: 'view', role: 'viewer', tags: ['champion'], effectiveRole: 'viewer', allowed: true },
    // no access without a tag allows nothing
    { ...base, action: 'view_title', role: null, tags: [], effectiveRole: null, allowed: true },
    // duplicate of the first row
    { ...base, action: 'edit', role: 'viewer', tags: [], effectiveRole: 'viewer', allowed: true },
  ]
}
