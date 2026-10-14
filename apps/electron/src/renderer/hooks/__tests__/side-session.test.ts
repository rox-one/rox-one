import { describe, expect, it } from 'bun:test'
import { usableSideSession } from '../useSideSession'

describe('usableSideSession', () => {
  it('reuses a live remembered session only', () => {
    const metas = new Map([['a', {}], ['b', { isArchived: true }]])
    expect(usableSideSession('a', metas)).toBe('a')
    expect(usableSideSession('b', metas)).toBeNull()
    expect(usableSideSession('gone', metas)).toBeNull()
    expect(usableSideSession(undefined, metas)).toBeNull()
  })
})
