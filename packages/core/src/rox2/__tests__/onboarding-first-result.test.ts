import { describe, expect, test } from 'bun:test'
import {
  advanceFirstResult,
  emptyFirstResult,
  isAccountRegistered,
  parseFirstResultCheckpoint,
  resumeFirstResult,
  seedOfflineFirstResult,
  skipFirstResult,
  type FirstResultCheckpoint,
  type FirstResultStore,
} from '../onboarding-first-result.ts'

function memoryStore(seed?: FirstResultCheckpoint): FirstResultStore {
  let value = seed ?? null
  return {
    get: () => value,
    set: (next) => {
      value = next
    },
  }
}

describe('ROX-AUD-151 onboarding first result', () => {
  test('restart resumes the checkpoint and skip still completes', () => {
    const store = memoryStore(advanceFirstResult(emptyFirstResult(), { noteId: 'n1' }))
    const resumed = resumeFirstResult(store)
    expect(resumed.step).toBe('session')
    expect(skipFirstResult(resumed).step).toBe('complete')
    expect(skipFirstResult(resumed).skipped).toBe(true)
  })

  test('local profile name is not account registration', () => {
    const checkpoint = parseFirstResultCheckpoint({
      schemaVersion: 1,
      step: 'note',
      skipped: false,
      localProfileName: 'Ada',
      accountAuthenticated: false,
    })
    expect(isAccountRegistered(checkpoint)).toBe(false)
    expect(parseFirstResultCheckpoint({ schemaVersion: 9, step: 'complete' }).step).toBe('note')
  })

  test('offline seed creates a Note→session→Outcome→Task chain that round-trips', () => {
    const seeded = seedOfflineFirstResult(1)
    const complete = advanceFirstResult(emptyFirstResult(), seeded)
    expect(complete.step).toBe('complete')
    expect(complete.noteId).toBe(seeded.noteId)
    expect(complete.taskId).toBe(seeded.taskId)
    expect(complete.outcomeId).toBe(seeded.outcomeId)
  })
})
