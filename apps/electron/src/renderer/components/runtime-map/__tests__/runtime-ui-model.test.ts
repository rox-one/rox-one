import { describe, expect, it } from 'bun:test'
import { contextFill, measurementText, runtimeNodeDuration, safeDisplayText } from '../measurements'
import { clampChatRatio, inspectCamera, receiveCameraEvents, resumeCamera, splitStorageKey } from '../layout/viewport-policy'

describe('honest runtime measurements and inert content', () => {
  it('never turns a missing token/time measurement into zero', () => {
    expect(measurementText({ state: 'unknown', reason: 'not-emitted' })).toBeUndefined()
    expect(measurementText({ state: 'known', value: 12, origin: 'estimated', source: 'fixture' })).toBe('≈12')
  })
  it('shows the observed executor duration when event clocks cannot be compared', () => {
    const observed = { state: 'known' as const, value: 47, origin: 'observed' as const, source: 'bash-executor' }
    expect(runtimeNodeDuration({ durationMs: { state: 'unknown', reason: 'unsupported' }, terminal: { command: 'pwd', durationMs: observed } })).toBe(observed)
    expect(runtimeNodeDuration({ durationMs: observed })).toBe(observed)
  })
  it('context occupancy uses the particular input and model window', () => {
    expect(contextFill({ state: 'known', value: 500, origin: 'observed', source: 'provider' }, { state: 'known', value: 1000, origin: 'observed', source: 'model' })).toMatchObject({ state: 'known', value: 50, origin: 'derived' })
    expect(contextFill({ state: 'unknown', reason: 'partial' }, { state: 'known', value: 1000, origin: 'observed', source: 'model' }).state).toBe('unknown')
  })
  it('removes active terminal controls and obvious credentials from every viewer/copy', () => {
    const text = safeDisplayText('\u001b[31mapi_key=private-token\u001b[0m\n<script>alert(1)</script>')
    expect(text).not.toContain('private-token')
    expect(text).not.toContain('\u001b')
    // HTML is still ordinary text: React renders it without interpreting tags.
    expect(text).toContain('<script>')
  })
  it('also redacts quoted JSON credential keys and authorization scheme values', () => {
    const text = safeDisplayText('{"api_key":"private-json-secret","Authorization":"Basic cHJpdmF0ZQ=="}')
    expect(text).not.toContain('private-json-secret')
    expect(text).not.toContain('cHJpdmF0ZQ==')
  })
})

describe('map attention and independent split scope', () => {
  it('manual inspection stops follow until explicit resume', () => {
    const initial = { mode: 'following' as const, pending: 0, lastSeenSeq: 3 }
    const updated = receiveCameraEvents(inspectCamera(initial), 8)
    expect(updated.mode).toBe('inspecting')
    expect(updated.pending).toBe(5)
    expect(resumeCamera(updated)).toEqual({ mode: 'following', pending: 0, lastSeenSeq: 8 })
    expect(receiveCameraEvents(updated, 8)).toBe(updated)
  })
  it('keeps both 360px sides and never transfers widths between panels', () => {
    expect(clampChatRatio(0.1, 1000)).toBe(0.36)
    expect(clampChatRatio(0.9, 1000)).toBe(0.64)
    expect(splitStorageKey('w:s:p1')).not.toBe(splitStorageKey('w:s:p2'))
    expect(clampChatRatio(NaN, 1000)).toBe(0.42)
  })
})
