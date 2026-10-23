/**
 * P8.3 — Tasks mid-band: fluid list width 720–960; status secondary CQ.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const mode = readFileSync(
  join(import.meta.dirname, '../../components/mode-screen/ResponsiveModeScreen.tsx'),
  'utf8',
)
const css = readFileSync(join(import.meta.dirname, '../../index.css'), 'utf8')
const tasks = readFileSync(join(import.meta.dirname, '../../pages/TasksPage.tsx'), 'utf8')

describe('P8.3 Tasks mid-band', () => {
  it('shrinks list pane between 720 and 960', () => {
    expect(mode).toMatch(/midBand/)
    expect(mode).toMatch(/panelWidth < 960/)
    expect(mode).toMatch(/w-\[min\(22rem,38%\)\]/)
  })

  it('marks status secondary for CQ hide under 720', () => {
    expect(tasks).toMatch(/data-tasks-status-secondary/)
    expect(css).toMatch(/data-tasks-status-secondary/)
    expect(css).toMatch(/@container panel \(max-width: 719px\)/)
  })
})
