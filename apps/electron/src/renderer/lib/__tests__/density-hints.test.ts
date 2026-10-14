import { useDomForFile as installDom } from '../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'

installDom()
const { applyDensity, normalizeDensity, setDensity } = await import('../density-preference')
const { dismissHint, isHintSeen, resetHints } = await import('../one-time-hints')

describe('density (#40)', () => {
  it('normalizes and applies data-density only for comfortable', () => {
    expect(normalizeDensity('x')).toBe('compact')
    const root = document.createElement('html') as unknown as HTMLElement
    applyDensity('comfortable', root)
    expect(root.getAttribute('data-density')).toBe('comfortable')
    applyDensity('compact', root)
    expect(root.hasAttribute('data-density')).toBe(false)
    setDensity('comfortable')
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable')
    setDensity('compact')
  })
})

describe('one-time hints (#43)', () => {
  it('stays dismissed', () => {
    resetHints()
    expect(isHintSeen('a')).toBe(false)
    dismissHint('a')
    expect(isHintSeen('a')).toBe(true)
    resetHints()
  })
})
