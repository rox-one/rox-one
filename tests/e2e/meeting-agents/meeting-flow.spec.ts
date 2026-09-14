import { test, expect } from '@playwright/test'
import { bootMeetingApp, evidenceRow, writeEvidence } from './harness.ts'
import { createPlaywrightElectronFactory, isElectronAppBuilt } from './electron-factory.ts'
import { setMeetingElectronFactory } from './harness.ts'

test('E02 bootstrap and permissions on a real meetings page', async () => {
  const startedAt = new Date().toISOString()
  if (!isElectronAppBuilt()) {
    writeEvidence(evidenceRow('E3', 'not_run', {
      caseId: 'E02',
      command: 'bun run test:meetings:e2e',
      startedAt,
      blocker: 'apps/electron dist/main.cjs or renderer is not built',
    }))
    throw new Error('apps/electron dist/main.cjs or renderer is not built; E3 is not_run, not skipped-as-pass')
  }
  setMeetingElectronFactory(createPlaywrightElectronFactory())
  const h = await bootMeetingApp({ caseId: 'bootstrap' })
  try {
    const meetingsNav = h.page.getByTestId('meetings-nav')
    await meetingsNav.click()
    expect(await h.page.getByTestId('meeting-agent-readiness').count()).toBeGreaterThan(0)
    expect(await h.page.getByTestId('meeting-agent-row').count()).toBe(8)
    await h.page.getByTestId('meetings-start').click()
    const status = await h.page.getByTestId('meetings-capture-status').text()
    expect(status.length).toBeGreaterThan(0)
    expect((await h.gateway.counts()).forbiddenCalls).toBe(0)
    writeEvidence(evidenceRow('E3', 'passed', {
      caseId: 'E02',
      command: 'bun run test:meetings:e2e',
      startedAt,
    }))
  } finally {
    await h.dispose()
    setMeetingElectronFactory(null)
  }
})
