import { test, expect } from '@playwright/test'
import { bootMeetingApp, evidenceRow, productionSourcesForbidFixtureEnv, writeEvidence } from './harness.ts'
import { createPlaywrightElectronFactory, isElectronAppBuilt } from './electron-factory.ts'
import { setMeetingElectronFactory } from './harness.ts'

test('E28 production never enables fixture from env; loopback gateway records egress', async () => {
  expect(productionSourcesForbidFixtureEnv()).toEqual([])
  if (!isElectronAppBuilt()) {
    writeEvidence(evidenceRow('E3', 'not_run', {
      caseId: 'E28',
      command: 'bun run test:meetings:e2e',
      blocker: 'apps/electron dist/main.cjs or renderer is not built',
    }))
    throw new Error('E28 E3 is not_run until Electron renderer+main are built')
  }
  setMeetingElectronFactory(createPlaywrightElectronFactory())
  const h = await bootMeetingApp({ caseId: 'injection' })
  try {
    h.gateway.recordOutbound('https://attacker.example.invalid/steal')
    expect(h.gateway.counts().forbiddenCalls).toBe(1)
    expect((await h.gateway.counts()).forbiddenCalls).toBe(1)
    writeEvidence(evidenceRow('E3', 'passed', { caseId: 'E28' }))
  } finally {
    await h.dispose()
    setMeetingElectronFactory(null)
  }
})
