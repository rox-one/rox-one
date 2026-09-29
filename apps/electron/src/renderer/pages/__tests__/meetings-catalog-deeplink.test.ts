import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(__dirname, '../MeetingsPage.tsx'), 'utf8')
const selection = readFileSync(join(__dirname, '../meetings/selection.ts'), 'utf8')
const main = readFileSync(join(__dirname, '../../components/app-shell/MainContentPanel.tsx'), 'utf8')
const navHelpers = readFileSync(join(__dirname, '../../lib/nav-helpers.ts'), 'utf8')

describe('GG catalog deeplinks — meetings + wiring', () => {
  it('does not default selection to meetings[0]', () => {
    expect(page).not.toContain('meetings[0]?.id')
    expect(page).toContain('routeBound')
    expect(page).toContain('meetings.meetingNotFound')
    expect(page).toContain('loadMeetingSelection')
  })

  it('loads missing route ids via selection helper', () => {
    expect(selection).toContain('export async function loadMeetingSelection')
    expect(selection).toContain('getMeeting')
  })

  it('MainContentPanel passes route selectedIds', () => {
    expect(main).toContain('<TasksPage selectedId={navState.details?.taskId ?? null} />')
    expect(main).toContain('<MeetingsPage selectedId={navState.details?.meetingId ?? null} />')
  })

  it('isDetailNavState treats tasks/meetings details as detail', () => {
    expect(navHelpers).toMatch(/case 'tasks':\s*case 'meetings':\s*return navState\.details !== null/)
  })
})
