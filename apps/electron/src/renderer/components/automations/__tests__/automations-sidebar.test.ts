import { describe, expect, it, mock } from 'bun:test'
import { buildAutomationsSidebarGroups, SCHEDULE_TEMPLATES, type AutomationsSidebarInput } from '../automations-sidebar'
import type { AutomationListItem } from '../types'

const item = (o: Partial<AutomationListItem>): AutomationListItem => ({ id: 'a', event: 'SchedulerTick', matcherIndex: 0, name: 'A', summary: '', enabled: true, actions: [], ...o } as AutomationListItem)
function input(o: Partial<AutomationsSidebarInput>): AutomationsSidebarInput {
  return { automations: [], selectedId: null, creatingTemplate: null, t: (k) => k, relative: (at) => `t${at}`, onOpen: mock(), onCreateFromTemplate: mock(), onCreate: mock(), ...o }
}

describe('buildAutomationsSidebarGroups', () => {
  it('templates, typed groups and recent runs are wired', () => {
    const onOpen = mock(); const onCreateFromTemplate = mock()
    const automations = [
      item({ id: 's', name: 'Sched', lastExecutedAt: 10, lastRunOk: true }),
      item({ id: 'e', event: 'LabelAdd', name: 'Ev', enabled: false, lastExecutedAt: 20, lastRunOk: false }),
      item({ id: 'g', event: 'SessionEnd', name: 'Ag' }),
    ]
    const g = buildAutomationsSidebarGroups(input({ automations, selectedId: 'e', onOpen, onCreateFromTemplate }))
    expect(g.map((x) => x.id)).toEqual(['templates', 'scheduled', 'event', 'agent', 'recent'])
    g[0]!.items[1]!.onSelect()
    expect(onCreateFromTemplate).toHaveBeenCalledWith(SCHEDULE_TEMPLATES[1])
    expect(g[2]!.items[0]!.active).toBe(true)
    expect(g[2]!.items[0]!.secondary).toBe('screenSidebar.automations.off')
    expect(g[4]!.items.map((i) => i.id)).toEqual(['run-e', 'run-s'])
    g[4]!.items[0]!.onSelect()
    expect(onOpen).toHaveBeenCalledWith('e')
  })
  it('templates have valid 5-field crons', () => {
    for (const tpl of SCHEDULE_TEMPLATES) expect(tpl.cron.split(' ')).toHaveLength(5)
  })
  it('empty state offers creation', () => {
    const onCreate = mock()
    const g = buildAutomationsSidebarGroups(input({ onCreate }))
    const st = g.at(-1)!.state
    if (st?.kind === 'empty') st.action?.onSelect()
    expect(onCreate).toHaveBeenCalled()
  })
})
