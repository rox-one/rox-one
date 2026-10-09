import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { observeChip, rollingSummaryView } from '../../../lib/meetings/observe.ts'

const detail = readFileSync(join(__dirname, '../LocalMeetingDetail.tsx'), 'utf8')
const viewModel = readFileSync(join(__dirname, '../../../lib/meetings/observe.ts'), 'utf8')

describe('meeting observe UI (d2.6)', () => {
  it('renders a provenance chip per transcript line', () => {
    expect(detail).toContain('data-testid="meeting-transcript-provenance"')
    expect(detail).toContain('data-provenance={chip.labelKey}')
    expect(detail).toContain('observeChip')
    expect(viewModel).toContain('meetings.local.provenance.ownEcho')
    expect(viewModel).toContain('meetings.local.provenance.speaker')
    expect(viewModel).toContain('meetings.local.provenance.mic')
  })

  it('renders a rolling-summary block with its generator label', () => {
    expect(detail).toContain('data-testid="meeting-rolling-summary"')
    expect(detail).toContain('meetings.local.summary.rolling')
    expect(detail).toContain('meetings.local.summary.updatedAt')
    expect(viewModel).toContain('meetings.local.summary.model')
    expect(viewModel).toContain('meetings.local.summary.heuristic')
  })

  it('maps a line to the right chip without fabricating ownEcho', () => {
    expect(observeChip({ ownEcho: true, provenance: { observer: 'browser-caption', self: 'self', speaker: 'Ассистент' } })).toEqual({
      labelKey: 'meetings.local.provenance.ownEcho',
      ownEcho: true,
      speaker: 'Ассистент',
      present: true,
    })
    expect(observeChip({ speakerId: 'Иван', provenance: { observer: 'asr-stream', self: 'other', speaker: 'Иван' } }).labelKey)
      .toBe('meetings.local.provenance.speaker')
    expect(observeChip({ provenance: { observer: 'asr-stream', self: 'unknown' } }).labelKey)
      .toBe('meetings.local.provenance.mic')
    expect(observeChip({ provenance: { observer: 'browser-caption', self: 'unknown' } }).labelKey)
      .toBe('meetings.local.provenance.system')
    expect(observeChip({}).present).toBe(false)
  })

  it('builds the rolling summary block and marks it stale after a revision bump', () => {
    const view = rollingSummaryView({ text: 'Решили выпустить релиз', updatedAt: 1234, generator: 'heuristic' }, 3, 2)
    expect(view).toEqual({
      text: 'Решили выпустить релиз',
      updatedAt: 1234,
      generatorKey: 'meetings.local.summary.heuristic',
      stale: true,
    })
    expect(rollingSummaryView({ text: 'x', updatedAt: 1, generator: 'model' }, 2, 2)?.generatorKey)
      .toBe('meetings.local.summary.model')
    expect(rollingSummaryView(null)).toBeNull()
    expect(rollingSummaryView({ text: '   ', updatedAt: 1 })).toBeNull()
  })
})