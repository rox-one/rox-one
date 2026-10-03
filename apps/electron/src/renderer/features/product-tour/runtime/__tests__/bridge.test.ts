import { expect, test } from 'bun:test'
import { publishTourSignal, subscribeTourSignals } from '../bridge'
import type { TourSignal } from '../../contracts'

const signal = { name: 'session.ready', binding: { workspaceId: 'owned-workspace', panelId: 'owned-panel', clientProfileId: 'profile', runToken: 'run' }, level: 'observed', origin: 'ui-observation', eventToken: 'event', at: 1 } as TourSignal

test('a failed learning observer cannot interrupt a canonical commit or other observers', () => {
  const received: TourSignal[] = []
  const offFailure = subscribeTourSignals(() => { throw new Error('presentation unavailable') })
  const offHealthy = subscribeTourSignals(value => { received.push(value) })
  let committedEffects = false
  try {
    publishTourSignal(signal)
    committedEffects = true
    expect(committedEffects).toBe(true)
    expect(received).toEqual([signal])
  } finally { offFailure(); offHealthy() }
})

test('released observers do not receive later committed observations', () => {
  const received: TourSignal[] = []
  const release = subscribeTourSignals(value => { received.push(value) })
  publishTourSignal(signal)
  release(); publishTourSignal(signal)
  expect(received).toEqual([signal])
})
