import { describe, expect, test } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { OPERATOR_SCOPES, type OperatorRoleCeiling } from '@rox/shared/orgs'
import {
  ALL_OPERATOR_SCOPES,
  classifyOperatorChannel,
  intersectOperatorScopeCeilings,
  isChannelWithinOperatorCeiling,
  normalizeOperatorRoleDefinition,
  operatorScopeSatisfied,
  resolveOperatorRoleCeiling,
} from '../operator-role-policy.ts'

const registry = {
  definitions: {
    owner: { scopes: [...OPERATOR_SCOPES] },
    editor: { scopes: ['operator.read', 'operator.write'] },
    viewer: { scopes: ['operator.read', 'operator.sessions.read'] },
    'sessions-editor': { scopes: ['operator.sessions.read', 'operator.sessions.write'] },
    blocked: { scopes: [] as string[] },
  } as Record<string, unknown>,
}

describe('operator scope implications', () => {
  const cases: Array<[string, readonly string[], boolean]> = [
    ['operator.read', ['operator.read'], true],
    ['operator.read', ['operator.write'], true],
    ['operator.read', ['operator.admin'], true],
    ['operator.sessions.read', ['operator.read'], true],
    ['operator.sessions.read', ['operator.sessions.write'], true],
    ['operator.sessions.write', ['operator.write'], true],
    ['operator.talk', ['operator.write'], true],
    ['operator.pairing', ['operator.write'], false],
    ['operator.admin', ['operator.read'], false],
    ['operator.read', ['operator.sessions.read'], false],
    ['account.read', ['operator.admin'], false],
  ]
  for (const [requested, granted, expected] of cases) {
    test(`${requested} against [${granted.join(',')}] => ${expected}`, () => {
      expect(operatorScopeSatisfied(requested, granted)).toBe(expected)
    })
  }

  test('administrator satisfies every declared scope', () => {
    for (const scope of OPERATOR_SCOPES) expect(operatorScopeSatisfied(scope, ['operator.admin'])).toBe(true)
  })
})

describe('intersect operator scope ceilings', () => {
  test('keeps only scopes shared by both ceilings', () => {
    expect(intersectOperatorScopeCeilings(['operator.read', 'operator.write'], ['operator.read']))
      .toEqual(['operator.read'])
  })
  test('empty intersection stays empty', () => {
    expect(intersectOperatorScopeCeilings(['operator.read'], [])).toEqual([])
    expect(intersectOperatorScopeCeilings([], ['operator.read'])).toEqual([])
  })
  test('identical ceilings are preserved', () => {
    expect([...intersectOperatorScopeCeilings(ALL_OPERATOR_SCOPES, ALL_OPERATOR_SCOPES)].sort())
      .toEqual([...OPERATOR_SCOPES].sort())
  })
})

describe('role definition validation', () => {
  test('accepts a well-formed definition', () => {
    const definition = normalizeOperatorRoleDefinition({ scopes: ['operator.read'], sessions: { others: 'view' }, agents: '*' })
    expect(definition).not.toBeNull()
    expect(definition?.scopes).toEqual(['operator.read'])
  })
  test('rejects unknown scopes, bad enums, and non-objects', () => {
    expect(normalizeOperatorRoleDefinition({ scopes: ['operator.superuser'] })).toBeNull()
    expect(normalizeOperatorRoleDefinition({ scopes: ['operator.read'], sessions: { others: 'root' } })).toBeNull()
    expect(normalizeOperatorRoleDefinition({ scopes: ['operator.read'], sandbox: 'always' })).toBeNull()
    expect(normalizeOperatorRoleDefinition({ scopes: ['operator.read'], agents: [1] })).toBeNull()
    expect(normalizeOperatorRoleDefinition({ scopes: 'operator.read' })).toBeNull()
    expect(normalizeOperatorRoleDefinition(null)).toBeNull()
  })
})

describe('resolve operator role ceiling', () => {
  test('unconfigured roles impose no boundary', () => {
    const ceiling = resolveOperatorRoleCeiling({ definitions: {} }, 'ghost')
    expect(ceiling.configured).toBe(false)
    expect([...ceiling.scopes]).toEqual([...OPERATOR_SCOPES])
  })
  test('known role resolves to its scopes', () => {
    const ceiling = resolveOperatorRoleCeiling(registry, 'viewer')
    expect(ceiling).toMatchObject({ configured: true, role: 'viewer' })
    expect([...ceiling.scopes].sort()).toEqual(['operator.read', 'operator.sessions.read'])
  })
  test('unknown role without a default is denied', () => {
    const ceiling = resolveOperatorRoleCeiling(registry, 'ghost')
    expect(ceiling.configured).toBe(true)
    expect(ceiling.scopes).toEqual([])
  })
  test('unknown role falls back to a valid default', () => {
    const ceiling = resolveOperatorRoleCeiling({ ...registry, default: 'viewer' }, 'ghost')
    expect(ceiling.role).toBe('viewer')
    expect(ceiling.scopes).toContain('operator.read')
  })
  test('missing role with a configured default resolves to the default', () => {
    const ceiling = resolveOperatorRoleCeiling({ ...registry, default: 'editor' }, null)
    expect(ceiling.role).toBe('editor')
  })
  test('missing role without a default is denied', () => {
    expect(resolveOperatorRoleCeiling(registry, null).scopes).toEqual([])
  })
  test('a malformed stored definition is denied, never widened', () => {
    const malformed = { definitions: { broken: { scopes: ['operator.root'] } as unknown } }
    const ceiling = resolveOperatorRoleCeiling(malformed, 'broken')
    expect(ceiling.configured).toBe(true)
    expect(ceiling.scopes).toEqual([])
  })
  test('defined empty ceiling is a deny-all', () => {
    expect(resolveOperatorRoleCeiling(registry, 'blocked').scopes).toEqual([])
  })
})

describe('channel classification', () => {
  test('LOCAL_ONLY channels are never remotely reachable', () => {
    const requirement = classifyOperatorChannel(RPC_CHANNELS.system.VERSIONS, 'read')
    expect(requirement.remote).toBe(false)
    expect(requirement.scope).toBeNull()
  })
  test('session channels map to session scopes', () => {
    expect(classifyOperatorChannel('sessions:get', 'read').scope).toBe('operator.sessions.read')
    expect(classifyOperatorChannel('sessions:create', 'write').scope).toBe('operator.sessions.write')
  })
  test('general channels map to general scopes', () => {
    expect(classifyOperatorChannel('notes:list', 'read').scope).toBe('operator.read')
    expect(classifyOperatorChannel('notes:save', 'write').scope).toBe('operator.write')
    expect(classifyOperatorChannel('notes:delete', 'delete').scope).toBe('operator.write')
  })
  test('unclassified actions are denied', () => {
    expect(classifyOperatorChannel('notes:save', undefined).scope).toBeNull()
    expect(classifyOperatorChannel('', 'read').remote).toBe(false)
  })
})

describe('role x method ceiling matrix', () => {
  type Row = { role: string | null; channel: string; action: string | undefined; allowed: boolean }
  const rows: Row[] = [
    { role: 'owner', channel: 'notes:save', action: 'write', allowed: true },
    { role: 'editor', channel: 'notes:save', action: 'write', allowed: true },
    { role: 'editor', channel: 'sessions:create', action: 'write', allowed: true },
    { role: 'viewer', channel: 'notes:save', action: 'write', allowed: false },
    { role: 'viewer', channel: 'notes:list', action: 'read', allowed: true },
    { role: 'viewer', channel: 'sessions:get', action: 'read', allowed: true },
    { role: 'viewer', channel: 'sessions:create', action: 'write', allowed: false },
    { role: 'sessions-editor', channel: 'sessions:create', action: 'write', allowed: true },
    { role: 'sessions-editor', channel: 'notes:save', action: 'write', allowed: false },
    { role: 'blocked', channel: 'notes:list', action: 'read', allowed: false },
    { role: 'ghost', channel: 'notes:list', action: 'read', allowed: false },
    { role: 'owner', channel: RPC_CHANNELS.system.VERSIONS, action: 'read', allowed: false },
    { role: 'owner', channel: 'notes:save', action: undefined, allowed: false },
  ]
  for (const { role, channel, action, allowed } of rows) {
    test(`${role} ${action ?? 'unclassified'} ${channel} => ${allowed}`, () => {
      const ceiling = resolveOperatorRoleCeiling(registry, role)
      expect(isChannelWithinOperatorCeiling(ceiling, channel, action)).toBe(allowed)
    })
  }

  test('a missing ceiling denies every channel', () => {
    expect(isChannelWithinOperatorCeiling(null, 'notes:list', 'read')).toBe(false)
    expect(isChannelWithinOperatorCeiling(undefined, 'notes:list', 'read')).toBe(false)
  })

  test('an unconfigured ceiling preserves full access', () => {
    const ceiling: OperatorRoleCeiling = resolveOperatorRoleCeiling({ definitions: {} }, null)
    expect(isChannelWithinOperatorCeiling(ceiling, 'notes:save', 'write')).toBe(true)
    expect(isChannelWithinOperatorCeiling(ceiling, RPC_CHANNELS.system.VERSIONS, 'read')).toBe(false)
  })

  test('all-scope owner role does not unlock a LOCAL_ONLY channel', () => {
    const owner = resolveOperatorRoleCeiling(registry, 'owner')
    expect(isChannelWithinOperatorCeiling(owner, RPC_CHANNELS.system.VERSIONS, 'read')).toBe(false)
  })
})