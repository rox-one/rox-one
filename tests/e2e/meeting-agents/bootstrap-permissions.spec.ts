/**
 * E02-ish bootstrap/permissions smoke for I029 / #385.
 * Requires ROX_MEETING_E2E_FIXTURE=1 (set by test:meetings:e2e). Fixture is U1 only —
 * never labeled E3. Product UI→RPC→storage→readback is NOT proven here.
 */
import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bootMeetingApp, stampHarnessEvidence } from './harness'

test.describe('meeting-agents bootstrap/permissions (#385)', () => {
  test.beforeAll(() => {
    if (process.env.ROX_MEETING_E2E_FIXTURE !== '1' && process.env.ROX_MEETING_USE_PACKAGED_APP !== '1') {
      throw new Error(
        'blocked: no product Electron→RPC→storage path; set ROX_MEETING_E2E_FIXTURE=1 (U1) or ROX_MEETING_USE_PACKAGED_APP=1',
      )
    }
  })

  test('boots isolated profile with loopback fixture gateway', async () => {
    const h = await bootMeetingApp({ caseId: 'bootstrap' })
    try {
      expect(h.profileDir).toBeTruthy()
      expect(existsSync(join(h.profileDir, 'home'))).toBe(true)
      expect(existsSync(join(h.profileDir, 'config'))).toBe(true)
      expect(h.gateway.kind).toBe('loopback-fixture')
      expect(new URL(h.gateway.origin).hostname).toBe('127.0.0.1')
      expect((await h.gateway.counts()).forbiddenCalls).toBe(0)
      expect(h.entrypoint).toBe('test-fixture')
      // Honest stamp: test-fixture entry is U1, never E3:passed
      const stamp = stampHarnessEvidence({
        entrypoint: h.entrypoint,
        productStateExercised: false,
      })
      expect(stamp.level).toBe('U1')
      expect(`${stamp.level}:${stamp.status}`).not.toBe('E3:passed')
    } finally {
      await h.dispose()
    }
  })
})
