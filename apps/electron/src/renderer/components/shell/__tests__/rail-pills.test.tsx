import { useDomForFile as installDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Circle, Home } from 'lucide-react'

installDom()

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts?.name ? `${key}:${opts.name}` : key), i18n: { language: 'en' } }),
}))

const { buildRailModel } = await import('../rail-model')
const { movePill, currentPillIds, MAX_PILLS } = await import('../pills')
const { PillsConfigurator } = await import('../PillsConfigurator')
const prefs = await import('../shell-prefs')
type Entry = import('../../app-shell/primary-nav').ResolvedPrimaryNavEntry

const entry = (id: string, placement: 'pills' | 'menu' | 'hidden' = 'menu'): Entry => ({
  id, linkId: `nav:${id}`, group: 'primary', labelKey: id, icon: Circle, route: null, isActive: () => false, disabled: false, placement,
} as unknown as Entry)

afterEach(() => { localStorage.clear(); prefs.resetShellPrefs() })

describe('buildRailModel', () => {
  it('keeps pin order, sends the rest (including hidden placements) to ⋯ and Settings to the bottom', () => {
    const model = buildRailModel({
      surfaces: [entry('home'), entry('docs'), entry('tasks', 'hidden'), entry('settings'), entry('feed')],
      extraScreens: [],
      pins: ['feed', 'home', 'ghost', 'settings'],
      t: (key) => key,
    })
    expect(model.pinned.map((s) => s.id)).toEqual(['feed', 'home'])
    expect(model.overflow.map((s) => s.id)).toEqual(['docs', 'tasks'])
    expect(model.bottom.map((s) => s.id)).toEqual(['settings'])
  })
})

describe('shell prefs', () => {
  it('toggles rail pins and never pins settings', () => {
    prefs.railPinsStore.set(['home'])
    prefs.toggleRailPin('docs')
    prefs.toggleRailPin('home')
    prefs.toggleRailPin('settings')
    expect(prefs.railPinsStore.get()).toEqual(['docs'])
  })
  it('sums unread from several sources and clears per source', () => {
    const a = Symbol('a'); const b = Symbol('b')
    prefs.setScreenUnread(a, 'inbox', 2)
    prefs.setScreenUnread(b, 'inbox', 3)
    expect(prefs.useUnreadCounts).toBeDefined()
    prefs.setScreenUnread(a, 'inbox', 0)
    // read through the hook's snapshot getter
    let snapshot: Record<string, number> = {}
    function Probe() { snapshot = prefs.useUnreadCounts() as Record<string, number>; return null }
    const host = document.createElement('div'); const root = createRoot(host)
    act(() => root.render(<Probe />))
    expect(snapshot.inbox).toBe(3)
    act(() => root.unmount())
  })
})

describe('pills helpers', () => {
  it('moves and orders', () => {
    expect(movePill(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(currentPillIds([entry('a', 'pills'), entry('b', 'pills'), entry('c')], ['b', 'x'])).toEqual(['b', 'a'])
    expect(MAX_PILLS).toBeGreaterThan(4)
  })
})

describe('PillsConfigurator', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null })

  function Harness({ initial, onValue }: { initial: string[]; onValue: (v: string[]) => void }) {
    const [value, setValue] = React.useState(initial)
    return <PillsConfigurator
      options={[{ id: 'home', title: 'Home', icon: Home, iconOnly: true }, { id: 'feed', title: 'Feed', icon: Circle }, { id: 'docs', title: 'Docs', icon: Circle }]}
      value={value}
      onChange={(next) => { setValue(next); onValue(next) }}
    />
  }

  it('adds, removes, reorders with buttons and keyboard, and allows zero pills', async () => {
    let last: string[] = []
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => root!.render(<Harness initial={['home', 'feed']} onValue={(v) => { last = v }} />))
    const q = (sel: string) => host!.querySelector(sel) as HTMLElement
    await act(async () => q('[data-pill-add="docs"]').click())
    expect(last).toEqual(['home', 'feed', 'docs'])
    await act(async () => (q('[data-pill-row="docs"] button[aria-label="shell.pills.moveUp:Docs"]')).click())
    expect(last).toEqual(['home', 'docs', 'feed'])
    const handle = q('[data-pill-row="home"] [data-pill-handle]')
    await act(async () => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
    await act(async () => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(last).toEqual(['docs', 'home', 'feed'])
    await act(async () => q('[data-pill-remove="feed"]').click())
    expect(last).toEqual(['docs', 'home'])
    await act(async () => q('[data-pills-clear]').click())
    expect(last).toEqual([])
    expect(q('[data-pills-empty]')).not.toBeNull()
  })
})
