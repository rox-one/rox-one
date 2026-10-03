import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { TourProgress } from '../contracts'
import { inLearningBrowser, startLearningBrowserTests, stopLearningBrowserTests } from '../persistence/browser-test-harness'
import { sanitizeLearningEvent } from './events'
import { computeLearningMetrics } from './metrics'

test('DATA-07 allowlist discards all content and correlation IDs including disguised enum values', () => {
  const event = sanitizeLearningEvent({ eventName: 'step-verified', tourId: 'OBT-01', stepId: 'first.send', version: 1, evidenceLevel: 'verified',
    messageText: 'private', toolInput: { token: 'secret' }, toolResult: 'private', credential: 'secret', path: '/private', url: 'https://secret',
    documentName: 'private', email: 'private@example.org', workspaceId: 'workspace-secret', sessionId: 'session-secret', entityId: 'entity-secret',
    binding: { workspaceId: 'secret' }, operationToken: 'secret', eventToken: 'secret', runToken: 'secret',
    reason: '/private/path', locale: 'private@example.org', phase: 'private', platform: 'private' })
  expect(event).toEqual({ eventName: 'step-verified', tourId: 'OBT-01', stepId: 'first.send', version: 1, evidenceLevel: 'verified' })
  expect(sanitizeLearningEvent({ eventName: 'private@example.org', stepId: 'first.send' })).toBeNull()
  expect(sanitizeLearningEvent({ eventName: 'step-shown', tourId: 'OBT-99', stepId: 'private', version: Infinity })).toEqual({ eventName: 'step-shown' })
})

test('diagnostic projection reads only captured own data properties and never invokes accessors', () => {
  let calls = 0
  const input = { eventName: 'tour-started', get phase() { calls++; return calls === 1 ? 'idle' : 'PRIVATE-CONTENT' },
    get tourId() { calls++; throw new Error('must not read') }, version: 1 }
  expect(sanitizeLearningEvent(input)).toEqual({ eventName: 'tour-started', version: 1 })
  expect(calls).toBe(0)
  expect(sanitizeLearningEvent(Object.create({ eventName: 'tour-started', phase: 'idle' }))).toBeNull()
  expect(sanitizeLearningEvent({ get eventName() { calls++; return 'tour-started' } })).toBeNull()
  expect(calls).toBe(0)
  expect(sanitizeLearningEvent(new Proxy({}, { ownKeys() { throw new Error('unavailable') } }))).toBeNull()
  const hidden = Object.defineProperty({ eventName: 'tour-started' }, 'phase', { value: 'idle' })
  expect(sanitizeLearningEvent(hidden)).toEqual({ eventName: 'tour-started' })
})

test('metrics count milestones separately and deduplicate replay snapshots', () => {
  const progress: TourProgress = { schemaVersion: 1, scopeKey: 'scope', tourId: 'OBT-01', tourVersion: 1, revision: 1, status: 'partial', steps: {
    'first.send': { stepId: 'first.send', stepVersion: 1, shownAt: 0, observedAt: 1, verifiedAt: 2 },
    'first.permissions': { stepId: 'first.permissions', stepVersion: 1, acknowledgedAt: 1 },
    'first.result': { stepId: 'first.result', stepVersion: 1, skippedAt: 1 },
  } }
  expect(computeLearningMetrics([progress, progress])).toEqual({ shown: 1, acknowledged: 1, observed: 1, verified: 1, skipped: 1,
    notApplicable: 0, totalTours: 1, completedLearningTours: 0 })
})

describe('real IndexedDB private diagnostics', () => {
  beforeAll(startLearningBrowserTests)
  afterAll(stopLearningBrowserTests)

  test('DATA-08 disabled diagnostics store no events, opt-in enables safe log and disabling clears only log', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async () => {
      const profile = window.learningTest.createLearningProfileRepository()
      const logger = window.learningTest.createLearningDiagnosticsRepository()
      const off = await logger.append({ eventName: 'tour-started', binding: { workspaceId: 'secret' } })
      const empty = await logger.read()
      const enabled = await profile.updatePreferences({ diagnosticsEnabled: true, invitationsEnabled: true })
      const saved = await logger.append({ eventName: 'step-verified', tourId: 'OBT-01', stepId: 'first.send', sessionId: 'secret', path: '/private' }, 'raw-native-event')
      const duplicate = await logger.append({ eventName: 'step-verified' }, 'raw-native-event')
      let reads = 0
      const accessor = await logger.append({ eventName: 'tour-paused', get reason() { reads++; return reads === 1 ? 'user-paused' : 'PRIVATE-CONTENT' } })
      const log = await logger.read()
      await profile.updatePreferences({ diagnosticsEnabled: false })
      return { off, empty, enabled, saved, duplicate, accessor, reads, log, cleared: await logger.read(), profile: await profile.read() }
    }))
    expect(result.off).toEqual({ status: 'saved', value: false })
    expect(result.empty).toEqual({ status: 'saved', value: [] })
    expect(result.saved).toEqual({ status: 'saved', value: true })
    expect(result.duplicate).toEqual({ status: 'saved', value: false })
    expect(result.log.status === 'saved' && result.log.value).toHaveLength(2)
    expect(result.accessor).toEqual({ status: 'saved', value: true })
    expect(result.reads).toBe(0)
    expect(result.log.status === 'saved' && result.log.value[1]?.eventName).toBe('tour-paused')
    expect(result.log.status === 'saved' && result.log.value[1]?.reason).toBeUndefined()
    expect(JSON.stringify(result.log)).not.toContain('PRIVATE-CONTENT')
    expect(JSON.stringify(result.log)).not.toContain('secret')
    expect(JSON.stringify(result.log)).not.toContain('raw-native-event')
    expect(result.cleared).toEqual({ status: 'saved', value: [] })
    expect(result.profile.status === 'saved' && result.profile.value.preferences.invitationsEnabled).toBeTrue()
  })

  test('diagnostic retention caps 500 records and removes records older than seven days', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async () => {
      let at = 1_000
      await window.learningTest.createLearningProfileRepository().updatePreferences({ diagnosticsEnabled: true })
      const logger = window.learningTest.createLearningDiagnosticsRepository({ now: () => at })
      for (let i = 0; i < 505; i++) { at++; await logger.append({ eventName: 'step-shown', version: i + 1 }) }
      const capped = await logger.read()
      at += 7 * 24 * 60 * 60 * 1000 + 1
      const expired = await logger.read()
      return { capped, expired }
    }))
    expect(result.capped.status === 'saved' && result.capped.value).toHaveLength(500)
    expect(result.capped.status === 'saved' && result.capped.value[0]?.version).toBe(6)
    expect(result.expired).toEqual({ status: 'saved', value: [] })
  }, Math.min(120_000, Math.max(20_000, Number(process.env.ROX_LEARNING_BROWSER_TIMEOUT_MS) || 20_000)))
})
