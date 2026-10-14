import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { PersonalTask } from '@rox/core/tasks/personal'
import { TaskTimeline } from '../TaskTimeline'
import { epochOf, type SchedulePatch } from '../timeline-model'

useDomForFile()
afterEach(() => { resetDom() })

let restore: (() => void) | null = null
beforeAll(() => {
  const proto = HTMLElement.prototype
  const original = proto.getBoundingClientRect
  proto.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 400, width: 1000, height: 400, toJSON() { return this } } as DOMRect
  }
  restore = () => { proto.getBoundingClientRect = original }
})
afterAll(() => restore?.())

const today = '2026-02-10'
const mk = (id: string, patch: Partial<PersonalTask>): PersonalTask =>
  ({ id, title: id, notes: '', list: 'anytime', tags: [], priority: 'none', evening: false, links: [], order: 0, createdAt: 0, ...patch }) as PersonalTask
const tasks = [
  mk('a', { startAt: epochOf('2026-02-12'), dueAt: epochOf('2026-02-15'), projectId: 'p' }),
  mk('b', { dueAt: epochOf('2026-02-20') }),
  mk('c', {}),
]

async function mount(props: Partial<React.ComponentProps<typeof TaskTimeline>> = {}) {
  const calls: { id: string; patch: SchedulePatch }[] = []
  const zooms: string[] = []
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <TaskTimeline tasks={tasks} today={today} locale="en-US" selectedId={null} zoom="week" groupBy="none"
        onZoom={(z) => zooms.push(z)} onGroupBy={() => {}} onSelect={() => {}} onSchedule={(id, patch) => calls.push({ id, patch })}
        groupTitle={(g) => `group:${g.id}`} {...props} />,
    )
  })
  return { container, root, calls, zooms }
}

describe('TaskTimeline', () => {
  it('renders bars, the today line and the unscheduled tray', async () => {
    const { container, root } = await mount()
    expect(container.querySelector('[data-testid="timeline-bar-a"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="timeline-bar-b"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="timeline-bar-c"]')).toBeNull()
    expect(container.querySelector('[data-testid="timeline-tray-c"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="timeline-today"]')).not.toBeNull()
    // week zoom = 20px/day; bar a spans 4 days
    expect((container.querySelector('[data-testid="timeline-bar-a"]') as HTMLElement).style.width).toBe('80px')
    await act(async () => { root.unmount() })
  })

  it('reschedules from the keyboard and switches zoom', async () => {
    const { container, root, calls, zooms } = await mount()
    const bar = container.querySelector('[data-testid="timeline-bar-a"]') as HTMLElement
    await act(async () => { bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(calls).toEqual([{ id: 'a', patch: { startAt: epochOf('2026-02-13'), dueAt: epochOf('2026-02-16') } }])
    await act(async () => { (container.querySelector('[data-testid="timeline-zoom-month"]') as HTMLElement).click() })
    expect(zooms).toEqual(['month'])
    await act(async () => { root.unmount() })
  })

  it('shows group headers when grouping', async () => {
    const { container, root } = await mount({ groupBy: 'project' })
    expect(container.textContent).toContain('group:p')
    expect(container.textContent).toContain('group:null')
    await act(async () => { root.unmount() })
  })
})

describe('TaskTimeline keyboard', () => {
  it('Enter on a tray item schedules it today; Alt+→ moves the start edge; focus selects', async () => {
    const selected: string[] = []
    const { container, root, calls } = await mount({ onSelect: (id) => selected.push(id) })
    await act(async () => { (container.querySelector('[data-testid="timeline-tray-c"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(calls[0]).toEqual({ id: 'c', patch: { startAt: epochOf(today) } })
    const bar = container.querySelector('[data-testid="timeline-bar-a"]') as HTMLElement
    await act(async () => { bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })) })
    expect(calls[1]).toEqual({ id: 'a', patch: { startAt: epochOf('2026-02-13') } })
    await act(async () => { bar.focus() })
    expect(selected).toContain('a')
    expect(bar.getAttribute('aria-valuenow')).not.toBeNull()
    expect(bar.getAttribute('aria-valuemax')).not.toBeNull()
    await act(async () => { root.unmount() })
  })
})
