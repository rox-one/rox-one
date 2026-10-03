import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { TourDefinition } from '../contracts'
import { inLearningBrowser, inLearningWindows, startLearningBrowserTests, stopLearningBrowserTests } from './browser-test-harness'
import { createMemoryOnlyRepository } from './progress'

const tour: TourDefinition = { id: 'OBT-01', version: 1, slug: 'test-only', title: '', goal: '', why: '', trigger: '', entryTriggers: [],
  titleKey: '', goalKey: '', whyKey: '', requires: [], owner: 'A3', evidence: [], priority: 'P0', steps: ['first.send', 'first.result'].map(id => ({
    id, version: 1, target: 'composer.send', routeKey: 'current-session', scope: 'bound-panel', copyKey: '', copy: { ru: { title: '', body: '' }, en: { title: '', body: '' } },
    completion: { kind: 'signal', signal: 'user-turn.accepted', evidence: 'verified', priorState: 'after-activation', requireAcknowledgementAfterEvidence: false },
    handoff: false, optional: false, requires: [], onUnavailable: 'block', missingTarget: 'block-and-offer-retry-or-pause', notes: '', testId: 'DATA' })) } as TourDefinition

describe('real IndexedDB learning transactions', () => {
  beforeAll(startLearningBrowserTests)
  afterAll(stopLearningBrowserTests)

  test('DATA-01 concurrent windows preserve both milestones and deduplicate replay', async () => {
    const result = await inLearningWindows(async (first, second) => {
      await Promise.all([
        first.evaluate(async tour => window.learningTest.createProgressRepository().apply('scope', tour,
          { kind: 'evidence', stepId: 'first.send', stepVersion: 1, level: 'verified', at: 1 }), tour),
        second.evaluate(async tour => window.learningTest.createProgressRepository().apply('scope', tour,
          { kind: 'evidence', stepId: 'first.result', stepVersion: 1, level: 'verified', at: 2 }), tour),
      ])
      return first.evaluate(async tour => {
        const repository = window.learningTest.createProgressRepository()
        return { before: await repository.read('scope', tour.id), replay: await repository.apply('scope', tour,
          { kind: 'evidence', stepId: 'first.send', stepVersion: 1, level: 'verified', at: 50 }) }
      }, tour)
    })
    expect(result.before.status).toBe('saved')
    if (result.before.status === 'saved' && result.replay.status === 'saved') {
      expect(result.before.value?.steps['first.send']?.verifiedAt).toBe(1)
      expect(result.before.value?.steps['first.result']?.verifiedAt).toBe(2)
      expect(result.replay.value.revision).toBe(result.before.value!.revision)
    }
  })

  test('DATA-02 atomic acquisition, TTL takeover and stale release preserve fencing', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async () => {
      const a = window.learningTest.createLeaseRepository()
      const b = window.learningTest.createLeaseRepository()
      const simultaneous = await Promise.all([a.acquire('profile', 'a', 100), b.acquire('profile', 'b', 100)])
      const first = simultaneous.find(lease => lease !== null)!
      const next = await b.acquire('profile', 'next', first.expiresAt)
      const oldRenew = await a.renew('profile', first, first.expiresAt + 1)
      await a.release('profile', first)
      const kept = await b.renew('profile', next!, first.expiresAt + 2)
      await b.release('profile', kept!)
      const afterRelease = await a.acquire('profile', first.ownerWindowId, first.expiresAt + 3)
      return { simultaneous, first, next, oldRenew, kept, afterRelease }
    }))
    expect(result.simultaneous.filter(Boolean)).toHaveLength(1)
    expect(result.next?.fence).toBe(result.first.fence + 1)
    expect(result.oldRenew).toBeNull()
    expect(result.kept?.ownerWindowId).toBe('next')
    expect(result.afterRelease?.fence).toBe(result.next!.fence + 1)
  })

  test('DATA-02 stale owner cannot persist milestones after another window acquires a newer fence', async () => {
    const result = await inLearningWindows(async (first, second) => {
      const original = await first.evaluate(async () => window.learningTest.createLeaseRepository().acquire('profile', 'a', 100))
      if (!original) throw new Error('Expected original lease')
      const replacement = await second.evaluate(async expiresAt => window.learningTest.createLeaseRepository().acquire('profile', 'b', expiresAt), original.expiresAt)
      if (!replacement) throw new Error('Expected replacement lease')
      const stale = await first.evaluate(async ({ tour, lease, now }) => {
        const repository = window.learningTest.createProgressRepository({ now: () => now })
        const scope = window.learningTest.createLearningScopeKey('profile', 'workspace')
        try {
          await repository.apply(scope, tour, { kind: 'evidence', stepId: 'first.send', stepVersion: 1, level: 'verified', at: now },
            { profileId: 'profile', lease })
          return { rejected: false, progress: await repository.read(scope, tour.id) }
        } catch (error) {
          return { rejected: error instanceof window.learningTest.LearningLeaseLostError, progress: await repository.read(scope, tour.id) }
        }
      // A locally valid expiry must not bypass the newer persisted fence.
      }, { tour, lease: { ...original, expiresAt: replacement.expiresAt }, now: original.expiresAt + 1 })
      const accepted = await second.evaluate(async ({ tour, lease, now }) => window.learningTest.createProgressRepository({ now: () => now }).apply(
        window.learningTest.createLearningScopeKey('profile', 'workspace'), tour,
        { kind: 'evidence', stepId: 'first.result', stepVersion: 1, level: 'verified', at: now }, { profileId: 'profile', lease }),
      { tour, lease: replacement, now: original.expiresAt + 2 })
      return { stale, accepted }
    })
    expect(result.stale.rejected).toBeTrue()
    expect(result.stale.progress).toEqual({ status: 'saved', value: null })
    expect(result.accepted.status).toBe('saved')
    if (result.accepted.status === 'saved') {
      expect(result.accepted.value.steps['first.send']).toBeUndefined()
      expect(result.accepted.value.steps['first.result']?.verifiedAt).toBe(15_102)
    }
  })

  test('guard rejects a released durable lease without switching progress into memory fallback', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async tour => {
      const repository = window.learningTest.createProgressRepository({ now: () => 101 })
      const leases = window.learningTest.createLeaseRepository()
      const lease = await leases.acquire('profile', 'a', 100)
      const scope = window.learningTest.createLearningScopeKey('profile', 'workspace')
      await leases.release('profile', lease!)
      let rejected = false
      try { await repository.apply(scope, tour, { kind: 'skip', stepId: 'first.send', stepVersion: 1, at: 101 }, { profileId: 'profile', lease: lease! }) }
      catch (error) { rejected = error instanceof window.learningTest.LearningLeaseLostError }
      return { rejected, read: await repository.read(scope, tour.id) }
    }, tour))
    expect(result).toEqual({ rejected: true, read: { status: 'saved', value: null } })
  })

  test('explicit memory guard validates realm lease and never writes durable milestones', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async tour => {
      const leaseRepository = window.learningTest.createLeaseRepository({ indexedDB: null, allowMemoryOnlyLease: true })
      const lease = await leaseRepository.acquire('profile', 'a', 100)
      const scope = window.learningTest.createLearningScopeKey('profile', 'workspace')
      const repository = window.learningTest.createProgressRepository({ now: () => 101 })
      const progress = await repository.apply(scope, tour, { kind: 'evidence', stepId: 'first.send', stepVersion: 1, level: 'verified', at: 101 },
        { profileId: 'profile', lease: lease!, memoryOnly: true })
      const durable = await window.learningTest.createProgressRepository().read(scope, tour.id)
      await leaseRepository.release('profile', lease!)
      let rejected = false
      try { await repository.apply(scope, tour, { kind: 'skip', stepId: 'first.result', stepVersion: 1, at: 102 },
        { profileId: 'profile', lease: lease!, memoryOnly: true }) }
      catch (error) { rejected = error instanceof window.learningTest.LearningLeaseLostError }
      return { progress, durable, memoryRead: await repository.read(scope, tour.id), rejected }
    }, tour))
    expect(result.progress.status).toBe('memory-only')
    expect(result.memoryRead.status).toBe('memory-only')
    expect(result.durable).toEqual({ status: 'saved', value: null })
    expect(result.rejected).toBeTrue()
  })

  test('DATA-03 denied storage is explicit memory-only and cannot claim a partition lease', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async tour => {
      const progress = window.learningTest.createProgressRepository({ indexedDB: null })
      const lease = window.learningTest.createLeaseRepository({ indexedDB: null })
      return { progress: await progress.apply('scope', tour, { kind: 'skip', stepId: 'first.send', stepVersion: 1, at: 1 }),
        lease: await lease.acquire('profile', 'a', 1), status: lease.getStorageStatus() }
    }, tour))
    expect(result.progress.status).toBe('memory-only')
    expect(result.lease).toBeNull()
    expect(result.status).toBe('memory-only')
  })

  test('DATA-03 write success followed by transaction abort never returns saved', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async tour => {
      const original = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        const request = original.apply(this, args as Parameters<typeof original>)
        if (this.name === 'progress') request.addEventListener('success', () => this.transaction.abort())
        return request
      }
      return window.learningTest.createProgressRepository().apply('scope', tour,
        { kind: 'evidence', stepId: 'first.send', stepVersion: 1, level: 'verified', at: 1 })
    }, tour))
    expect(result.status).toBe('memory-only')
  })

  test('failed later writes preserve cached milestones, dismissal and revision in memory', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async tour => {
      const repository = window.learningTest.createProgressRepository()
      await repository.apply('scope', tour, { kind: 'evidence', stepId: 'first.send', stepVersion: 1, level: 'verified', at: 1 })
      const before = await repository.apply('scope', tour, { kind: 'dismiss', tourVersion: 1 })
      const original = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'progress') throw new DOMException('Denied', 'QuotaExceededError')
        return original.apply(this, args as Parameters<typeof original>)
      }
      const failedWrite = await repository.apply('scope', tour, { kind: 'evidence', stepId: 'first.result', stepVersion: 1, level: 'verified', at: 2 })
      return { before, failedWrite }
    }, tour))
    expect(result.failedWrite.status).toBe('memory-only')
    if (result.before.status === 'saved' && result.failedWrite.status === 'memory-only') {
      expect(result.failedWrite.value.status).toBe('dismissed')
      expect(result.failedWrite.value.dismissedUntilVersion).toBe(1)
      expect(result.failedWrite.value.steps['first.send']?.verifiedAt).toBe(1)
      expect(result.failedWrite.value.revision).toBe(result.before.value.revision + 1)
    }
  })

  test('DATA-04 future database schema is preserved and unavailable', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async tour => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('rox-product-tour', 2)
        request.onupgradeneeded = () => { request.result.createObjectStore('future').put('keep', 'sentinel') }
        request.onsuccess = () => { request.result.close(); resolve() }; request.onerror = () => reject(request.error)
      })
      const repository = window.learningTest.createProgressRepository()
      const read = await repository.read('scope', tour.id)
      const write = await repository.apply('scope', tour, { kind: 'skip', stepId: 'first.send', stepVersion: 1, at: 1 })
      const kept = await new Promise(resolve => {
        const request = indexedDB.open('rox-product-tour', 2)
        request.onsuccess = () => { const db = request.result; const get = db.transaction('future').objectStore('future').get('sentinel');
          get.onsuccess = () => { db.close(); resolve(get.result) } }
      })
      return { read, write, kept }
    }, tour))
    expect(result.read.status).toBe('failed')
    expect(result.write.status).toBe('failed')
    expect(result.kept).toBe('keep')
  })

  test('corrupt progress safely reads empty; future record schema is not overwritten', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async tour => {
      const repository = window.learningTest.createProgressRepository()
      await repository.read('scope', tour.id)
      const writeRecord = (scope: string, record: unknown) => new Promise<void>(resolve => {
        const request = indexedDB.open('rox-product-tour', 1)
        request.onsuccess = () => { const db = request.result; const tx = db.transaction('progress', 'readwrite');
          tx.objectStore('progress').put(record, [scope, tour.id]); tx.oncomplete = () => { db.close(); resolve() } }
      })
      await writeRecord('scope', { schemaVersion: 1, steps: { 'first.send': { verifiedAt: 'bad' } } })
      const corrupted = await repository.read('scope', tour.id)
      const recovered = await repository.apply('scope', tour, { kind: 'evidence', stepId: 'first.send', stepVersion: 1, level: 'verified', at: 1 })
      await writeRecord('future', { schemaVersion: 9, secretFutureData: 'keep' })
      const future = await repository.apply('future', tour, { kind: 'skip', stepId: 'first.send', stepVersion: 1, at: 1 })
      return { corrupted, recovered, future }
    }, tour))
    expect(result.corrupted).toEqual({ status: 'saved', value: null })
    expect(result.recovered.status).toBe('saved')
    expect(result.future.status).toBe('failed')
  })

  test('DATA-05 scoped reset keeps other workspace, profile preferences and native markers', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async tour => {
      const repository = window.learningTest.createProgressRepository()
      const profile = window.learningTest.createLearningProfileRepository()
      const before = await profile.updatePreferences({ invitationsEnabled: true })
      localStorage.setItem('memory-onboarding', 'native-marker')
      await repository.apply('a', tour, { kind: 'skip', stepId: 'first.send', stepVersion: 1, at: 1 })
      await repository.apply('b', tour, { kind: 'skip', stepId: 'first.send', stepVersion: 1, at: 1 })
      const reset = await repository.resetScope('a')
      return { before, after: await profile.read(), reset, a: await repository.read('a', tour.id),
        b: await repository.read('b', tour.id), marker: localStorage.getItem('memory-onboarding') }
    }, tour))
    expect(result.reset.status).toBe('saved')
    expect(result.a).toEqual({ status: 'saved', value: null })
    expect(result.b.status === 'saved' && result.b.value?.steps['first.send']?.skippedAt).toBe(1)
    expect(result.after).toEqual(result.before)
    expect(result.marker).toBe('native-marker')
  })

  test('DATA-06 copy revision preserves evidence; semantic revision resets only changed step', async () => {
    const result = await inLearningBrowser(page => page.evaluate(async tour => {
      const repository = window.learningTest.createProgressRepository()
      for (const step of tour.steps) await repository.apply('scope', tour, { kind: 'evidence', stepId: step.id, stepVersion: 1, level: 'verified', at: 1 })
      const copy = await repository.apply('scope', { ...tour, version: 2 }, { kind: 'evidence', stepId: 'first.send', stepVersion: 1, level: 'shown', at: 2 })
      const semantic = { ...tour, version: 3, steps: tour.steps.map(step => step.id === 'first.send' ? { ...step, version: 2 } : step) }
      const changed = await repository.apply('scope', semantic, { kind: 'evidence', stepId: 'first.send', stepVersion: 2, level: 'shown', at: 3 })
      const stale = await repository.apply('scope', tour, { kind: 'evidence', stepId: 'first.send', stepVersion: 1, level: 'verified', at: 4 })
      return { copy, changed, stale }
    }, tour))
    if (result.copy.status === 'saved' && result.changed.status === 'saved' && result.stale.status === 'saved') {
      expect(result.copy.value.steps['first.send']?.verifiedAt).toBe(1)
      expect(result.changed.value.steps['first.send']?.verifiedAt).toBeUndefined()
      expect(result.changed.value.steps['first.result']?.verifiedAt).toBe(1)
      expect(result.stale.value).toEqual(result.changed.value)
    } else throw new Error('Expected real committed IndexedDB progress')
  })

  test('profile identity is random, stable and atomic across two clients', async () => {
    const profiles = await inLearningBrowser(page => page.evaluate(async () => Promise.all([
      window.learningTest.createLearningProfileRepository().read(), window.learningTest.createLearningProfileRepository().read() ])))
    expect(profiles[0]).toEqual(profiles[1])
    expect(profiles[0].status === 'saved' && profiles[0].value.preferences).toEqual({ invitationsEnabled: false, diagnosticsEnabled: false })
    expect(profiles[0].status === 'saved' && profiles[0].value.clientProfileId).toMatch(/^[0-9a-f-]{36}$/)
  })
})

test('memory-only repository is scoped and never promotes skip into verification', async () => {
  const repository = createMemoryOnlyRepository()
  const result = await repository.apply('a', tour, { kind: 'skip', stepId: 'first.send', stepVersion: 1, at: 1 })
  expect(result.status).toBe('memory-only')
  expect(result.status === 'memory-only' && result.value.steps['first.send']?.verifiedAt).toBeUndefined()
  await repository.resetScope('a')
  expect(await repository.read('a', tour.id)).toEqual({ status: 'memory-only', reason: 'storage-unavailable', value: null })
})
