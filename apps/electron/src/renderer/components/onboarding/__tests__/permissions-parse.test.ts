import { describe, expect, it } from 'bun:test'
import { parsePermissionState } from '../permissions-model'
import { BUBBLE_GROUP_IDS } from '../bubbles-catalog'
import { parseBubbleSelections } from '../QuestionnaireStep'

describe('parseBubbleSelections (S1-06 draft restore)', () => {
  it('restores known groups and drops unknown ids and non-string entries', () => {
    const known = BUBBLE_GROUP_IDS[0]!
    const parsed = parseBubbleSelections({ [known]: ['a', 7, 'b'], retiredGroup: ['x'] })
    expect(parsed?.[known]).toEqual(['a', 'b'])
    expect(parsed && 'retiredGroup' in parsed).toBe(false)
  })

  it('returns undefined for unusable drafts so the step keeps its defaults', () => {
    expect(parseBubbleSelections(undefined)).toBeUndefined()
    expect(parseBubbleSelections([])).toBeUndefined()
    expect(parseBubbleSelections({ unknownOnly: ['x'] })).toBeUndefined()
  })
})

describe('parsePermissionState (S1-06 draft restore)', () => {
  it('restores enabled flags and grants from a saved first-run blob', () => {
    const parsed = parsePermissionState({
      platform: 'mac',
      enabled: { keepAwake: false, fullDiskAccess: true },
      grants: { fullDiskAccess: 'granted' },
    })
    expect(parsed).toEqual({
      platform: 'mac',
      enabled: { keepAwake: false, fullDiskAccess: true },
      grants: { fullDiskAccess: 'granted' },
    })
  })

  it('returns undefined for corrupt or empty input instead of throwing', () => {
    expect(parsePermissionState(undefined)).toBeUndefined()
    expect(parsePermissionState(null)).toBeUndefined()
    expect(parsePermissionState('mac')).toBeUndefined()
    expect(parsePermissionState({ enabled: { keepAwake: false } })).toBeUndefined()
    expect(parsePermissionState({ platform: 'amiga', enabled: {} })).toBeUndefined()
  })

  it('drops non-boolean enabled values and unknown grant statuses', () => {
    const parsed = parsePermissionState({
      platform: 'win',
      enabled: { keepAwake: 'yes', winMicrophone: false },
      grants: { winMicrophone: 'maybe', winFileSystemAccess: 'denied' },
    })
    expect(parsed?.platform).toBe('win')
    expect(parsed?.enabled).toEqual({ winMicrophone: false })
    expect(parsed?.grants).toEqual({ winFileSystemAccess: 'denied' })
  })
})
