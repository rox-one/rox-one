import { describe, expect, it } from 'bun:test'
import {
  canToggleSkillOrSource,
  EXTENSION_CENTER_GROUPS,
  groupExtensionCenterRecords,
} from '../center-groups.ts'

describe('groupExtensionCenterRecords', () => {
  it('puts skills, sources, automations and marketplace on one grouped screen', () => {
    const groups = groupExtensionCenterRecords([
      { id: 'skill:workspace:review', category: 'skills' },
      { id: 'source:ws1:linear', category: 'sources' },
      { id: 'source:ws1:siyuan', category: 'knowledge' },
      { id: 'automation:ws1:session.created:0', category: 'automations' },
      { id: 'marketplace:demo-pack', category: 'skills' },
      { id: 'siyuan-plugin:foo', category: 'apps' },
    ])
    expect(EXTENSION_CENTER_GROUPS).toEqual(['skills', 'sources', 'automations', 'marketplace'])
    expect(groups.skills.map((item) => item.id)).toEqual(['skill:workspace:review'])
    expect(groups.sources.map((item) => item.id)).toEqual(['source:ws1:linear', 'source:ws1:siyuan'])
    expect(groups.automations.map((item) => item.id)).toEqual(['automation:ws1:session.created:0'])
    expect(groups.marketplace.map((item) => item.id)).toEqual([
      'marketplace:demo-pack',
      'siyuan-plugin:foo',
    ])
  })
})

describe('canToggleSkillOrSource', () => {
  it('allows enable/disable for skill and MCP source ids without migrating stores', () => {
    expect(canToggleSkillOrSource('skill:workspace:review')).toBe(true)
    expect(canToggleSkillOrSource('source:ws1:linear')).toBe(true)
    expect(canToggleSkillOrSource('marketplace:demo-pack')).toBe(false)
  })
})
