import { describe, expect, it } from 'bun:test'
import {
  groupExtensionPermissions,
  permissionGroupFor,
} from '../permissions.ts'
import type { ExtensionPermission } from '../types.ts'

describe('groupExtensionPermissions', () => {
  it('groups permissions by domain with high-risk tokens kept visible', () => {
    const permissions: ExtensionPermission[] = [
      'knowledge.read',
      'knowledge.write',
      'browser.open',
      'shell.execute',
      'ui.command',
      'secrets.use:vault-1',
      'network.request',
    ]
    const groups = groupExtensionPermissions(permissions)
    expect(groups.map((g) => g.group)).toEqual([
      'knowledge',
      'browser',
      'network',
      'shell',
      'ui',
      'secrets',
    ])
    expect(groups.find((g) => g.group === 'knowledge')?.permissions).toEqual([
      'knowledge.read',
      'knowledge.write',
    ])
    expect(permissionGroupFor('browser.automate')).toBe('browser')
    expect(permissionGroupFor('secrets.use:x')).toBe('secrets')
  })
})
