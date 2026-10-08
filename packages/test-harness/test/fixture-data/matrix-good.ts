/** W1-10 self-test fixture: well-formed permission matrix module. */
export function generatePermissionMatrix() {
  return [
    { actor: 'owner', action: 'read', ref: 'goal:g1', allowed: true },
    { actor: 'viewer', action: 'read', ref: 'goal:g1', allowed: true },
    { actor: 'viewer', action: 'write', ref: 'goal:g1', allowed: false },
  ]
}
