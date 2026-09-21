/**
 * E02-ish bootstrap/permissions smoke for I029 / #385.
 * Boots the automation/test Electron entrypoint with isolated profile.
 * Product UI→RPC→storage→readback is NOT proven here — evidence stays below E3:passed.
 */
import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bootMeetingApp, stampHarnessEvidence } from './harness'

test.describe('meeting-agents bootstrap/permissions (#385)', () => {
  test('boots isolated profile with loopback fixture gateway', async () => {
    const h = await bootMeetingApp({ caseId: 'bootstrap' })
    try {
      expect(h.profileDir).toBeTruthy()
      expect(existsSync(join(h.profileDir, 'home'))).toBe(true)
      expect(existsSync(join(h.profileDir, 'config'))).toBe(true)
      expect(h.gateway.kind).toBe('loopback-fixture')
      expect(new URL(h.gateway.origin).hostname).toBe('127.0.0.1')
      expect((await h.gateway.counts()).forbiddenCalls).toBe(0)
      // Honest stamp: test-fixture entry is U1, never E3:passed
      const stamp = stampHarnessEvidence({
        entrypoint: h.entrypoint,
        productStateExercised: false,
      })
      expect(`${stamp.level}:${stamp.status}`).not.toBe('E3:passed')
    } finally {
      await h.dispose()
    }
  })
})
