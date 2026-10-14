/**
 * RoadmapTimeline renders exactly as before the gantt-engine extraction.
 * The fixture was generated from the original component (base b3be1a0e) with a
 * stubbed 900px track and a fixed clock, so bar geometry, ticks and the today
 * line are all covered. Regenerate only deliberately: UPDATE_TIMELINE_SNAPSHOT=1.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterAll, afterEach, beforeAll, describe, expect, it, setSystemTime } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { RoadmapMilestone } from '@rox/shared/projects/roadmap'
import { RoadmapTimeline } from '../ProjectTimeline'

useDomForFile()
afterEach(() => { resetDom() })

const base = { description: '', stages: [], taskIds: [] }
const milestones: RoadmapMilestone[] = [
  { ...base, id: 'a', title: 'Alpha', status: 'active', startDate: '2026-01-05', dueDate: '2026-02-10' },
  { ...base, id: 'b', title: 'Beta', status: 'done', dueDate: '2026-03-01' },
  { ...base, id: 'c', title: 'Gamma', status: 'planned', startDate: '2026-02-20' },
  { ...base, id: 'd', title: 'Undated', status: 'planned' },
]

const FIXTURE = join(import.meta.dir, 'project-timeline.snapshot.html')
let restoreRect: (() => void) | null = null

beforeAll(() => {
  setSystemTime(new Date(2026, 1, 1, 12, 0, 0))
  const proto = HTMLElement.prototype
  const original = proto.getBoundingClientRect
  proto.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 20, width: 900, height: 20, toJSON() { return this } } as DOMRect
  }
  restoreRect = () => { proto.getBoundingClientRect = original }
})
afterAll(() => {
  setSystemTime()
  restoreRect?.()
})

describe('RoadmapTimeline equivalence', () => {
  it('measured DOM matches the pre-extraction fixture', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<RoadmapTimeline milestones={milestones} onChange={() => {}} onFocusMilestone={() => {}} locale="en-US" />)
    })
    const html = container.innerHTML
    await act(async () => { root.unmount() })
    expect(html).toContain('left:')
    if (process.env.UPDATE_TIMELINE_SNAPSHOT === '1') writeFileSync(FIXTURE, html)
    expect(html).toBe(readFileSync(FIXTURE, 'utf8'))
  })
})
