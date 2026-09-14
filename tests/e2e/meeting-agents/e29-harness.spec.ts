import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import {
  bootMeetingApp,
  evidenceRow,
  setMeetingElectronFactory,
  writeEvidence,
} from './harness.ts'
import { createPlaywrightElectronFactory, isElectronAppBuilt } from './electron-factory.ts'

test('E29 restart updates handles on the same profile and dispose cleans up', async () => {
  const startedAt = new Date().toISOString()
  if (!isElectronAppBuilt()) {
    writeEvidence(evidenceRow('E3', 'not_run', {
      caseId: 'E29',
      command: 'bun run test:meetings:e2e',
      startedAt,
      blocker: 'apps/electron dist/main.cjs or renderer is not built',
    }))
    throw new Error('E29 E3 is not_run until Electron renderer+main are built')
  }
  setMeetingElectronFactory(createPlaywrightElectronFactory())
  const h = await bootMeetingApp({ caseId: 'e29-restart' })
  const profileDir = h.profileDir
  try {
    await h.restart()
    expect(h.profileDir).toBe(profileDir)
    expect(existsSync(profileDir)).toBe(true)
    expect((await h.gateway.counts()).forbiddenCalls).toBe(0)
    writeEvidence(evidenceRow('E3', 'passed', { caseId: 'E29', startedAt }))
  } finally {
    await h.dispose()
    setMeetingElectronFactory(null)
    expect(existsSync(profileDir)).toBe(false)
  }
})
