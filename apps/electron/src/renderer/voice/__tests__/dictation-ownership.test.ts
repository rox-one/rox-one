import { describe, expect, it } from 'bun:test'
import {
  claimDictation,
  currentOwner,
  isComposerOwned,
  peekIntent,
  releaseDictation,
  setDictationIntent,
} from '../dictation-ownership'

/** Every test starts from a released module-level state. */
function reset(): void {
  const owner = currentOwner()
  if (owner) releaseDictation(owner)
}

describe('dictation ownership arbitration', () => {
  it('grants the claim to a single owner and rejects competitors', () => {
    reset()
    const first = {} // first claimant token
    const second = {} // competitor token
    expect(claimDictation(first)).toBe(true)
    expect(currentOwner()).toBe(first)
    expect(claimDictation(second)).toBe(false)
    expect(currentOwner()).toBe(first)
    releaseDictation(first)
  })

  it('lets the owning surface re-claim idempotently', () => {
    reset()
    const owner = {} // owner token: any object identity works
    expect(claimDictation(owner)).toBe(true)
    expect(claimDictation(owner)).toBe(true)
    expect(currentOwner()).toBe(owner)
    releaseDictation(owner)
  })

  it('ignores a release from a non-owner', () => {
    reset()
    const owner = {} // owner token: any object identity works
    const other = {} // competing owner token
    claimDictation(owner)
    releaseDictation(other)
    expect(currentOwner()).toBe(owner)
    releaseDictation(owner)
    expect(currentOwner()).toBe(null)
  })

  it('clears owner and intent only for the matching owner', () => {
    reset()
    const owner = {} // owner token: any object identity works
    claimDictation(owner)
    setDictationIntent(owner, { source: 'composer', delivery: 'draft' })
    expect(peekIntent()).not.toBe(null)
    releaseDictation(owner)
    expect(currentOwner()).toBe(null)
    expect(peekIntent()).toBe(null)
  })

  it('records intent only for the active owner', () => {
    reset()
    const owner = {} // owner token: any object identity works
    const other = {} // competing owner token
    claimDictation(owner)
    setDictationIntent(other, { source: 'global', delivery: 'clipboard' })
    expect(peekIntent()).toBe(null)
    setDictationIntent(owner, { source: 'composer', delivery: 'clipboard', trailingSpace: true })
    expect(peekIntent()).toEqual({ source: 'composer', delivery: 'clipboard', trailingSpace: true })
    releaseDictation(owner)
  })

  it('scopes peekIntent by target and returns null with no owner', () => {
    reset()
    expect(peekIntent()).toBe(null)
    const owner = {} // owner token: any object identity works
    const other = {} // competing owner token
    claimDictation(owner)
    setDictationIntent(owner, { source: 'global', delivery: 'draft' })
    expect(peekIntent(owner)).toEqual({ source: 'global', delivery: 'draft' })
    expect(peekIntent(other)).toBe(null)
    expect(peekIntent()).toEqual({ source: 'global', delivery: 'draft' })
    releaseDictation(owner)
  })

  it('reports composer ownership only for a composer-sourced intent', () => {
    reset()
    const owner = {} // owner token: any object identity works
    claimDictation(owner)
    expect(isComposerOwned()).toBe(false)
    setDictationIntent(owner, { source: 'global', delivery: 'draft' })
    expect(isComposerOwned()).toBe(false)
    setDictationIntent(owner, { source: 'composer', delivery: 'draft' })
    expect(isComposerOwned()).toBe(true)
    releaseDictation(owner)
    expect(isComposerOwned()).toBe(false)
  })
})