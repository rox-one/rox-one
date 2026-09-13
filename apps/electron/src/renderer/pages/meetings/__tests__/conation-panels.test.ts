import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const panels = readFileSync(join(__dirname, '../ConationPanels.tsx'), 'utf8')
const detail = readFileSync(join(__dirname, '../MeetingDetail.tsx'), 'utf8')

describe('meeting Conation native shells', () => {
  it('renders mail/crm/calendar/room shells without a fake dialer or iframe', () => {
    expect(panels).toContain('meeting-mail-panel')
    expect(panels).toContain('meeting-crm-panel')
    expect(panels).toContain('meeting-calendar-panel')
    expect(panels).toContain('meeting-room-panel')
    expect(panels).toContain('meeting-mail-send')
    expect(panels).toContain('disabled')
    expect(panels).toContain('meetings.calendar.noDialer')
    expect(panels.toLowerCase()).not.toContain('iframe')
    expect(panels).not.toContain('fakeDialer')
    expect(detail).toContain('ConationPanels')
    expect(detail).toContain('MailThreadList')
  })

  it('lists mail threads as native mail-thread entities', () => {
    expect(panels).toContain('data-kind="mail-thread"')
    expect(panels).toContain('meetings.threads.empty')
  })
})
