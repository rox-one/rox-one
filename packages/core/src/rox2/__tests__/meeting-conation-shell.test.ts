import { describe, expect, test } from 'bun:test'
import { isClaimableLive } from '../platform-contract.ts'
import {
  MEETING_CONATION_SHELLS,
  assertMeetingConationShellNotLive,
  gateMeetingConationShell,
  meetingConationShellResult,
} from '../meeting-conation-shell.ts'

describe('meeting Conation shells fail-closed (Mail/CRM/calendar/room)', () => {
  test('queued shells reject both canonical verified states without claiming live', () => {
    for (const verification of ['receipt_verified', 'readback_verified'] as const) {
      const result = { executionMode: 'live' as const, lifecycle: 'queued' as const, verification, ok: false }
      expect(isClaimableLive(result)).toBe(false)
      expect(() => assertMeetingConationShellNotLive(result)).toThrow('queued meeting Conation shell must not report verified')
    }
    expect(() => assertMeetingConationShellNotLive({ executionMode: 'live', lifecycle: 'queued', verification: 'unverified', ok: false })).not.toThrow()
  })

  test('isClaimableLive is false for native, fixture, and Conation on every shell', () => {
    for (const shell of MEETING_CONATION_SHELLS) {
      expect(isClaimableLive(meetingConationShellResult({ source: 'native', shell }))).toBe(false)
      expect(isClaimableLive(meetingConationShellResult({ source: 'fixture', shell }))).toBe(false)
      expect(isClaimableLive(meetingConationShellResult({ source: 'conation', shell }))).toBe(false)
    }
  })

  test('queued shells never report verified or ok success', () => {
    for (const shell of MEETING_CONATION_SHELLS) {
      const result = meetingConationShellResult({ source: 'conation', shell })
      expect(result.lifecycle).toBe('queued')
      expect(result.verification).toBe('unverified')
      expect(result.ok).not.toBe(true)
      expect(result.lifecycle).not.toBe('succeeded')
    }
  })

  test('gate attaches Rox2 without making a DTO claim live', () => {
    const gated = gateMeetingConationShell('mail', { status: 'queued', live: false })
    expect(isClaimableLive(gated.rox2)).toBe(false)
    expect(gated.status).toBe('queued')
    expect(gated.live).toBe(false)
    expect(gated.rox2.verification).toBe('unverified')
  })
})
