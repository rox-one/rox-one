/**
 * W1-04 (#1501) — local directory read model: never invents people,
 * manager chain, guests cannot browse.
 */

import { describe, expect, it } from 'bun:test'
import type { OrganizationWithMembers } from '@rox/shared/orgs'
import { buildLocalDirectory, MAX_MANAGER_CHAIN } from '../directory.ts'
import type { DirectoryPrincipal, DirectorySnapshot } from '../types.ts'

const person = (id: string, extra: Partial<DirectoryPrincipal> = {}): DirectoryPrincipal => ({
  principalId: id, kind: 'human', displayName: id.toUpperCase(), departmentIds: [], source: 'server', ...extra,
})

const snapshot: DirectorySnapshot = {
  workspaceId: 'ws',
  principals: [
    person('ceo'),
    person('vp', { managerId: 'ceo', departmentIds: ['eng'] }),
    person('dev', { managerId: 'vp', departmentIds: ['eng'], title: 'Engineer' }),
    person('gina', { kind: 'guest' }),
  ],
  departments: [{ departmentId: 'eng', name: 'Engineering' }],
}

const orgs: OrganizationWithMembers[] = [{
  id: 'o1', name: 'Org', slug: 'org', createdBy: 'ceo', createdAt: 0, pendingInvites: [],
  members: [
    { orgId: 'o1', userId: 'dev', role: 'member', displayLabel: 'Dev from orgs', joinedAt: 0 },
    { orgId: 'o1', userId: 'olga', role: 'admin', email: 'olga@example.com', joinedAt: 0 },
    { orgId: 'o1', userId: '  ', role: 'member', joinedAt: 0 },
  ],
}] as unknown as OrganizationWithMembers[]

describe('buildLocalDirectory', () => {
  it('merges server and orgs.json members without inventing anyone', () => {
    const dir = buildLocalDirectory({ workspaceId: 'ws', server: snapshot, orgs })
    expect(dir.members().map(p => p.principalId).sort()).toEqual(['ceo', 'dev', 'gina', 'olga', 'vp'])
    expect(dir.principal('dev')).toMatchObject({ source: 'server', displayName: 'DEV', title: 'Engineer' })
    expect(dir.principal('olga')).toMatchObject({ source: 'orgs', displayName: 'olga@example.com' })
    expect(dir.principal('nobody')).toBeNull()
  })

  it('with no sources the directory is empty', () => {
    expect(buildLocalDirectory({ workspaceId: 'ws' }).members()).toEqual([])
  })

  it('ignores a snapshot from another workspace', () => {
    expect(buildLocalDirectory({ workspaceId: 'other', server: snapshot }).members()).toEqual([])
  })

  it('walks the manager chain nearest first and lists reports', () => {
    const dir = buildLocalDirectory({ workspaceId: 'ws', server: snapshot })
    expect(dir.managerChain('dev').map(p => p.principalId)).toEqual(['vp', 'ceo'])
    expect(dir.managerChain('ceo')).toEqual([])
    expect(dir.directReports('vp').map(p => p.principalId)).toEqual(['dev'])
    expect(dir.departmentMembers('eng').map(p => p.principalId)).toEqual(['DEV', 'VP'].map(s => s.toLowerCase()))
    expect(dir.department('eng')?.name).toBe('Engineering')
  })

  it('manager chains are cycle-safe and bounded', () => {
    const cyclic: DirectorySnapshot = { workspaceId: 'ws', departments: [], principals: [person('a', { managerId: 'b' }), person('b', { managerId: 'a' })] }
    expect(buildLocalDirectory({ workspaceId: 'ws', server: cyclic }).managerChain('a').map(p => p.principalId)).toEqual(['b'])
    const long = Array.from({ length: 100 }, (_, i) => person(`p${i}`, { managerId: `p${i + 1}` }))
    expect(buildLocalDirectory({ workspaceId: 'ws', server: { workspaceId: 'ws', departments: [], principals: long } }).managerChain('p0')).toHaveLength(MAX_MANAGER_CHAIN)
  })

  it('guests cannot browse the directory', () => {
    const dir = buildLocalDirectory({ workspaceId: 'ws', server: snapshot })
    expect(dir.listForViewer({ principalId: 'gina' }).map(p => p.principalId)).toEqual(['gina'])
    expect(dir.listForViewer({ principalId: 'x', kind: 'guest' })).toEqual([])
    expect(dir.listForViewer({ principalId: 'dev' })).toHaveLength(4)
  })
})
