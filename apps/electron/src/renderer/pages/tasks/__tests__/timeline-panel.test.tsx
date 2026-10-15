import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { PersonalTask } from '@rox/core/tasks/personal'
import { TimelinePanel } from '../TimelinePanel'

useDomForFile()
afterEach(() => { resetDom() })

const mk = (id: string, projectId?: string): PersonalTask => ({
  id, title: id, notes: '', list: 'upcoming', tags: [], priority: 'none', evening: false, links: [], order: 0, createdAt: 0,
  startAt: Date.now() + 86_400_000, projectId,
})

describe('TimelinePanel', () => {
  it('renders the shared timeline grouped by project with its own zoom state', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<TimelinePanel testId="panel" tasks={[mk('a', 'p1'), mk('b', 'p2')]} defaultGroupBy="project" groupTitle={(g) => `G:${g.id}`} onSchedule={() => {}} />)
    })
    expect(container.querySelector('[data-testid="panel"] [data-testid="tasks-timeline"]')).not.toBeNull()
    expect(container.textContent).toContain('G:p1')
    expect(container.textContent).toContain('G:p2')
    const month = container.querySelector('[data-testid="timeline-zoom-month"]') as HTMLElement
    await act(async () => { month.click() })
    expect(month.getAttribute('aria-checked')).toBe('true')
    await act(async () => { root.unmount() })
  })
})
