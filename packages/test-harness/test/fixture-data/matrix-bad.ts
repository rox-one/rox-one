/** W1-10 self-test fixture: broken permission matrix module (duplicates). */
export function generatePermissionMatrix() {
  return [
    { actor: 'owner', action: 'read', ref: 'goal:g1', allowed: true },
    { actor: 'owner', action: 'read', ref: 'goal:g1', allowed: true },
  ]
}
