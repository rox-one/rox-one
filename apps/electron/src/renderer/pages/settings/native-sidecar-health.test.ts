import { describe, expect, it } from 'bun:test'
import { nativeSidecarHealthView } from './native-sidecar-health.ts'

describe('nativeSidecarHealthView', () => {
  it('treats a missing check as off', () => {
    expect(nativeSidecarHealthView([])).toEqual({ tone: 'off', detail: 'disabled' })
  })

  it('treats disabled as off', () => {
    expect(
      nativeSidecarHealthView([{ name: 'native_sidecar', status: 'pass', message: 'disabled' }]),
    ).toEqual({ tone: 'off', detail: 'disabled' })
  })

  it('treats a failed check as down', () => {
    expect(
      nativeSidecarHealthView([
        { name: 'native_sidecar', status: 'fail', message: 'enabled but not connected' },
      ]),
    ).toEqual({ tone: 'fail', detail: 'enabled but not connected' })
  })

  it('treats a live sidecar as ok', () => {
    const view = nativeSidecarHealthView([
      { name: 'memory', status: 'pass', message: 'Heap: 0.2 GB' },
      {
        name: 'native_sidecar',
        status: 'pass',
        message: 'live channels=8 indexPrimary=true journalPrimary=false',
      },
    ])
    expect(view.tone).toBe('ok')
    expect(view.detail).toContain('indexPrimary=true')
  })
})
