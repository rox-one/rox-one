import { describe, expect, it } from 'bun:test'

import {
  CAPABILITY_ORDER,
  IPC_CAPABILITIES,
  NODE_CAPABILITIES,
  advertisedPermissions,
  resolvedCaps,
} from './capabilities.ts'

describe('capability sets', () => {
  it('exposes the IPC permission set in canonical order', () => {
    expect(IPC_CAPABILITIES).toEqual([
      'notifications',
      'accessibility',
      'screenRecording',
      'microphone',
      'speechRecognition',
      'camera',
      'location',
    ])
  })

  it('exposes the node capability set and a de-duplicated canonical order', () => {
    expect(NODE_CAPABILITIES).toEqual([
      'canvas',
      'browser',
      'camera',
      'screen',
      'microphone',
      'location',
      'notifications',
      'clipboard',
    ])
    expect(CAPABILITY_ORDER).toEqual([...new Set([...IPC_CAPABILITIES, ...NODE_CAPABILITIES])])
  })
})

describe('resolvedCaps / advertisedPermissions', () => {
  it('drops unknown (unknown ≠ denied) and keeps definitive states', () => {
    const resolved = resolvedCaps({ camera: 'unknown', microphone: 'granted', accessibility: 'denied' })
    expect(resolved.granted).toEqual(['microphone'])
    expect(resolved.denied).toEqual(['accessibility'])
    expect(resolved.granted).not.toContain('camera')
    expect(resolved.denied).not.toContain('camera')
    expect(advertisedPermissions({ camera: 'unknown', microphone: 'granted' })).toEqual(['microphone'])
  })

  it('never advertises unsupported states', () => {
    const resolved = resolvedCaps({ screenRecording: 'unsupported', screen: 'unsupported' })
    expect(resolved).toEqual({ granted: [], denied: [] })
    expect(advertisedPermissions({ screenRecording: 'unsupported' })).toEqual([])
  })

  it('keeps denied denied and never advertises it', () => {
    const resolved = resolvedCaps({ accessibility: 'denied' })
    expect(resolved.granted).toEqual([])
    expect(resolved.denied).toEqual(['accessibility'])
    expect(advertisedPermissions({ accessibility: 'denied' })).toEqual([])
  })

  it('does not let a later grant falsely upgrade a denial', () => {
    const laterGrant = resolvedCaps([{ microphone: 'denied' }, { microphone: 'granted' }])
    expect(laterGrant.granted).toEqual([])
    expect(laterGrant.denied).toEqual(['microphone'])
    expect(advertisedPermissions([{ microphone: 'denied' }, { microphone: 'granted' }])).toEqual([])

    const earlierGrant = resolvedCaps([{ microphone: 'granted' }, { microphone: 'denied' }])
    expect(earlierGrant.denied).toEqual(['microphone'])
  })

  it('ignores a later unknown reading instead of demoting a grant', () => {
    const resolved = resolvedCaps([{ camera: 'granted' }, { camera: 'unknown' }])
    expect(resolved.granted).toEqual(['camera'])
  })

  it('returns a stable canonical order regardless of input order', () => {
    const resolved = resolvedCaps({
      location: 'granted',
      camera: 'granted',
      clipboard: 'granted',
      microphone: 'granted',
      canvas: 'granted',
      accessibility: 'granted',
    })
    expect(resolved.granted).toEqual([
      'accessibility',
      'microphone',
      'camera',
      'location',
      'canvas',
      'clipboard',
    ])
    expect(advertisedPermissions({ canvas: 'granted', accessibility: 'granted' })).toEqual([
      'accessibility',
      'canvas',
    ])
  })

  it('appends unmodelled keys after the modelled ones deterministically', () => {
    const resolved = resolvedCaps({ zeta: 'granted', accessibility: 'granted', alpha: 'granted' })
    expect(resolved.granted).toEqual(['accessibility', 'alpha', 'zeta'])
  })
})