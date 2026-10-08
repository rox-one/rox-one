/**
 * W1-10 self-test fixture: permission matrix module in #1501's frozen row
 * shape `{ action, role, tags, championAbsent, hasChildren, kind,
 * effectiveRole, allowed, reason? }`, hand-written from DATA-MODEL §8.
 */
const deny = (reason: string) => ({ allowed: false, reason })
const allow = { allowed: true }
const base = { championAbsent: false, hasChildren: false, kind: 'goal' }

export function generatePermissionMatrix() {
  return [
    { ...base, action: 'view_title', role: 'minimal', tags: [], effectiveRole: 'minimal', ...allow },
    { ...base, action: 'view', role: 'minimal', tags: [], effectiveRole: 'minimal', ...deny('role_below_viewer') },
    { ...base, action: 'view', role: null, tags: [], effectiveRole: null, ...deny('no_access') },
    { ...base, action: 'edit', role: 'viewer', tags: [], effectiveRole: 'viewer', ...deny('role_below_editor') },
    { ...base, action: 'comment', role: 'commenter', tags: [], effectiveRole: 'commenter', ...allow },
    { ...base, action: 'edit', role: 'viewer', tags: ['assignee'], effectiveRole: 'editor', ...allow },
    { ...base, action: 'check_in', role: 'viewer', tags: ['champion'], effectiveRole: 'manager', ...allow },
    { ...base, action: 'check_in', role: 'viewer', tags: ['reviewer'], effectiveRole: 'editor', ...deny('champion_present') },
    { ...base, action: 'check_in', role: 'viewer', tags: ['reviewer'], championAbsent: true, effectiveRole: 'editor', ...allow },
    { ...base, action: 'acknowledge', role: null, tags: ['reviewer'], effectiveRole: 'editor', ...allow },
    { ...base, action: 'transfer', role: 'manager', tags: [], effectiveRole: 'manager', ...deny('owner_only') },
    { ...base, action: 'transfer', role: 'owner', tags: [], effectiveRole: 'owner', ...allow },
    { ...base, action: 'delete', role: 'owner', tags: [], hasChildren: true, effectiveRole: 'owner', ...deny('goal_has_children') },
    { ...base, action: 'delete', role: 'owner', tags: [], kind: 'project', hasChildren: true, effectiveRole: 'owner', ...allow },
  ]
}
