import { useDomForFile as installDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'

installDom()

const { resolveModePillLayout, foldPills } = await import('../../app-shell/mode-pill-layout')
const prefs = await import('../shell-prefs')

const base = { leftInset: 0, leftFixedEdge: 100, rightWidth: 100 }

describe('titlebar pills fold into «…» (top50 #3)', () => {
  it('labels → icons → fold trailing pills', () => {
    const metrics = { full: 600, compact: 250, advances: [40, 40, 40, 40, 40] }
    expect(resolveModePillLayout({ ...base, topbarWidth: 1600, metrics })).toMatchObject({ collapsed: false, visibleCount: 5 })
    expect(resolveModePillLayout({ ...base, topbarWidth: 900, metrics })).toMatchObject({ collapsed: true, visibleCount: 5 })
    const tight = resolveModePillLayout({ ...base, topbarWidth: 600, metrics })
    expect(tight.collapsed).toBe(true)
    expect(tight.visibleCount).toBe(3)
    expect(tight.visibleCount).toBeGreaterThanOrEqual(0)
  })

  it('without per-pill metrics nothing folds', () => {
    const layout = resolveModePillLayout({ ...base, topbarWidth: 300, metrics: { full: 600, compact: 250 } })
    expect(layout.visibleCount).toBeGreaterThan(100)
  })

  it('keeps the active pill visible', () => {
    const s = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
    expect(foldPills(s, 2, 'd')).toEqual({ shown: [{ id: 'a' }, { id: 'd' }], folded: [{ id: 'b' }, { id: 'c' }] })
    expect(foldPills(s, 2, 'a').folded.map((x) => x.id)).toEqual(['c', 'd'])
    expect(foldPills(s, 9, null).folded).toEqual([])
    expect(foldPills(s, 0, 'a').shown).toEqual([])
  })
})

describe('narrow window: second sidebar overlay (top50 #3)', () => {
  it('toggle drives the overlay on narrow windows and leaves the saved pref alone', () => {
    const saved = prefs.secondarySidebarStore.get()
    prefs.setNarrowShell(true)
    prefs.toggleSecondarySidebar()
    expect(prefs.secondarySidebarStore.get()).toBe(saved)
    prefs.toggleSecondarySidebar()
    expect(prefs.secondarySidebarStore.get()).toBe(saved)
    prefs.setNarrowSidebarOverlayOpen(true)
    prefs.setNarrowShell(false)
    prefs.toggleSecondarySidebar()
    expect(prefs.secondarySidebarStore.get()).not.toBe(saved)
    prefs.toggleSecondarySidebar()
  })
})
