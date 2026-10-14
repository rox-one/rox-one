import { describe, expect, it, mock } from 'bun:test'
import { buildSkillsSidebarGroups, type SkillsSidebarInput } from '../skills-sidebar'
import type { LoadedSkill } from '../../../../shared/types'

const skill = (slug: string, name: string) => ({ slug, metadata: { name } }) as unknown as LoadedSkill
function input(o: Partial<SkillsSidebarInput>): SkillsSidebarInput {
  return { skills: [], syncing: false, playbooks: [], playbooksError: false, selectedSlug: null, t: (k) => k,
    onOpenSkill: mock(), onOpenPlaybooks: mock(), onOpenCatalog: mock(), onOpenMarketplace: mock(), ...o }
}
describe('buildSkillsSidebarGroups', () => {
  it('sorts my skills, marks active, wires marketplace', () => {
    const onOpenSkill = mock(); const onOpenMarketplace = mock()
    const skills = [skill('b', 'Beta'), skill('a', 'Alpha')]
    const g = buildSkillsSidebarGroups(input({ skills, selectedSlug: 'b', onOpenSkill, onOpenMarketplace }))
    expect(g.map((x) => x.id)).toEqual(['mine', 'playbooks', 'market'])
    expect(g[0]!.items.map((i) => i.label)).toEqual(['Alpha', 'Beta'])
    expect(g[0]!.items[1]!.active).toBe(true)
    g[0]!.items[0]!.onSelect(); expect(onOpenSkill).toHaveBeenCalledWith(skills[1])
    g[2]!.items[1]!.onSelect(); expect(onOpenMarketplace).toHaveBeenCalled()
  })
  it('loading while syncing, empty and error states', () => {
    expect(buildSkillsSidebarGroups(input({ syncing: true }))[0]!.state).toEqual({ kind: 'loading' })
    expect(buildSkillsSidebarGroups(input({}))[0]!.state?.kind).toBe('empty')
    expect(buildSkillsSidebarGroups(input({ playbooksError: true }))[1]!.state?.kind).toBe('error')
  })
})
