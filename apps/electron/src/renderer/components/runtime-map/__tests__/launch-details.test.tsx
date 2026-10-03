import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { buildRuntimeGraph, projectRuntimeEvents, known, type RuntimeLaunch } from '@rox/core/runtime-trace'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import { runtimeLaunchDetails } from '../launch-details'
import { timestampText } from '../measurements'
import { buildRuntimeContextGroups } from '../context-groups'
import { RuntimeInspector } from '../inspector/RuntimeInspector'

const planned = known(Date.parse('2026-10-03T21:00:00Z'), 'scheduler-observation')
const dispatched = { ...known(Date.parse('2026-10-03T21:00:02Z'), 'dispatch-estimate'), origin: 'estimated' as const }
const launch: Parameters<typeof runtimeLaunchDetails>[0] = { kind: 'scheduled', scheduleId: 'actual-schedule', occurrenceId: 'actual-occurrence', timezone: 'Europe/Berlin', scheduledAt: planned, dispatchedAt: dispatched }

describe('observed launch timing presentation', () => {
  it('keeps occurrence, timezone, explicit UTC and original measurement provenance', () => {
    const rows = runtimeLaunchDetails(launch)
    expect(rows.map(row => row.value)).toEqual(['actual-occurrence', 'Europe/Berlin', '2026-10-03T21:00:00.000Z', '≈2026-10-03T21:00:02.000Z'])
    expect(rows[2]!.measurement).toBe(planned)
    expect(rows[3]!.measurement).toBe(dispatched)
  })
  it('never substitutes a clock, zero or exact date for missing or invalid timestamps', () => {
    expect(runtimeLaunchDetails({ kind: 'scheduled' }).map(row => row.valueKey)).toEqual(Array(4).fill('runtimeMap.unknown'))
    expect(timestampText({ state: 'unknown', reason: 'not-emitted' })).toBeUndefined()
    expect(timestampText(known(NaN, 'invalid'))).toBeUndefined()
    expect(timestampText(known(9e20, 'invalid-date'))).toBeUndefined()
    expect(runtimeLaunchDetails({ kind: 'manual' }).map(row => row.id)).toEqual(['dispatched'])
  })
  it('keeps every Context timing row linked to the actual accepted event and agent', () => {
    const events = createRuntimeTraceFixture().map(event => event.kind === 'run.accepted' ? { ...event, payload: { ...event.payload, launch } } : event)
    const graph = buildRuntimeGraph(projectRuntimeEvents(events)), before = JSON.stringify(graph)
    const rows = buildRuntimeContextGroups(graph).groups.find(group => group.id === 'launch')!.rows
    expect(rows.map(row => row.titleKey)).toContain('runtimeMap.occurrence')
    expect(rows.find(row => row.titleKey === 'runtimeMap.plannedTime')!.measurement).toEqual(planned)
    expect(rows.find(row => row.titleKey === 'runtimeMap.dispatchTime')!.summary).toBe('≈2026-10-03T21:00:02.000Z')
    expect(rows.every(row => row.sourceEventId === 'fixture:1' && row.sourceAgentId === 'fixture-parent' && graph.nodes.includes(row.node))).toBe(true)
    expect(JSON.stringify(graph)).toBe(before)
  })
  it('renders launch identity, unknowns and known/estimated provenance in the real inspector', async () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(createRuntimeTraceFixture()))
    const node = graph.nodes.find(item => item.events.some(event => event.kind === 'run.accepted'))!
    const accepted = node.events.find(event => event.kind === 'run.accepted')!
    if (accepted.kind !== 'run.accepted') throw new Error('Expected accepted fixture event')
    const i18n = createInstance()
    await i18n.init({ lng: 'en', fallbackLng: 'en', initAsync: false, resources: { en: { translation: { runtimeMap: { unknown: 'No data', occurrence: 'Occurrence', timezone: 'Timezone', plannedTime: 'Planned time', dispatchTime: 'Dispatch time', measurementProvenance: 'Measurement provenance', measurementOrigin: { observed: 'Observed', derived: 'Derived', estimated: 'Estimated' } } } } } })
    const render = (value: RuntimeLaunch) => renderToStaticMarkup(<I18nextProvider i18n={i18n}><RuntimeInspector node={{ ...node, event: { ...accepted, payload: { ...accepted.payload, launch: value } } }} onClose={() => undefined} /></I18nextProvider>)
    const html = render(launch)
    for (const value of ['actual-occurrence', 'Europe/Berlin', '2026-10-03T21:00:00.000Z', '≈2026-10-03T21:00:02.000Z', 'Observed · scheduler-observation', 'Estimated · dispatch-estimate']) expect(html).toContain(value)
    const unknown = render({ kind: 'scheduled' })
    expect(unknown).toContain('<dt>Planned time</dt><dd>No data</dd>')
    expect(unknown).toContain('<dt>Dispatch time</dt><dd>No data</dd>')
    expect(unknown).not.toContain('1970-')
    expect(unknown).not.toContain('Measurement provenance')
  })
})
