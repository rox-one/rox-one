import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoadmapMilestone } from '@rox/shared/projects/roadmap'
import { RoadmapTimeline } from '../ProjectTimeline'

const base = { description: '', stages: [], taskIds: [] }
const milestones: RoadmapMilestone[] = [
  { ...base, id: 'a', title: 'Alpha', status: 'active', startDate: '2026-01-05', dueDate: '2026-02-10' },
  { ...base, id: 'b', title: 'Beta', status: 'done', dueDate: '2026-03-01' },
  { ...base, id: 'c', title: 'Gamma', status: 'planned', startDate: '2026-02-20' },
  { ...base, id: 'd', title: 'Undated', status: 'planned' },
]

const FIXTURE = join(import.meta.dir, 'project-timeline.snapshot.html')

describe('RoadmapTimeline equivalence', () => {
  it('server markup matches the pre-extraction snapshot', () => {
    const html = renderToStaticMarkup(
      <RoadmapTimeline milestones={milestones} onChange={() => {}} onFocusMilestone={() => {}} locale="en-US" />,
    )
    if (!existsSync(FIXTURE) || process.env.UPDATE_TIMELINE_SNAPSHOT) writeFileSync(FIXTURE, html)
    expect(html).toBe(readFileSync(FIXTURE, 'utf8'))
  })
})
