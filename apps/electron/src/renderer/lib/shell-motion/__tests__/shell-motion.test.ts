import { useDomForFile as installDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'

installDom()

const { navDirection, routeDepth, screenKeyOf } = await import('../screen-transition')
const { elementKey, resolveKey } = await import('../scroll-restore')

describe('screen transition', () => {
  it('derives direction from route depth', () => {
    expect(routeDepth('sessions/abc/x')).toBe(3)
    expect(navDirection(null, 'feed')).toBe('none')
    expect(navDirection('feed', 'sessions/abc')).toBe('forward')
    expect(navDirection('sessions/abc', 'feed')).toBe('back')
    expect(navDirection('feed', 'docs')).toBe('none')
    expect(screenKeyOf('/docs/abc?x=1')).toBe('docs')
    expect(screenKeyOf('')).toBe('home')
  })
})

describe('scroll restore keys', () => {
  it('round-trips child-index paths and explicit keys', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div><span></span><section><ul></ul></section></div><div data-scroll-key="list"></div>'
    const ul = root.querySelector('ul')!
    const key = elementKey(root, ul)!
    expect(key).toBe('p:0.1.0')
    expect(resolveKey(root, key)).toBe(ul as unknown as HTMLElement)
    const list = root.querySelector('[data-scroll-key]')!
    expect(elementKey(root, list)).toBe('k:list')
    expect(resolveKey(root, 'k:list')).toBe(list as unknown as HTMLElement)
    expect(resolveKey(root, 'p:9.9')).toBeNull()
  })
})
