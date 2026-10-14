import { useDomForFile as installDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createStore } from 'jotai'

installDom()

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

const { SidebarSection, rowAria } = await import('../SidebarSection')
const { TooltipProvider } = await import('@rox/ui')
const strip = await import('../panel-strip')
const { panelStackAtom, focusedPanelIdAtom } = await import('@/atoms/panel-stack')
type Group = import('../screen-sidebar').SidebarGroup
type Item = import('../screen-sidebar').SidebarItem

let root: Root | null = null
let host: HTMLDivElement | null = null
async function render(ui: React.ReactNode) {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{ui}</TooltipProvider>))
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null })

const item = (over: Partial<Item> = {}): Item => ({ id: 'a', label: 'A', onSelect() {}, ...over })

describe('sidebar requests', () => {
  it('ariaKind maps active to aria-current / aria-pressed', () => {
    expect(rowAria(item({ active: true }))).toEqual({ 'aria-current': 'page' })
    expect(rowAria(item({ active: true, ariaKind: 'selected' }))).toEqual({ 'aria-current': 'true' })
    expect(rowAria(item({ active: false, ariaKind: 'pressed' }))).toEqual({ 'aria-pressed': false })
    expect(rowAria(item({ active: false }))).toEqual({})
  })

  it('renders group custom content even with no items', async () => {
    const group: Group = { id: 'cal', title: 'Calendar', items: [], content: <div data-testid="mini">mini</div> }
    await render(<SidebarSection screenId="calendar" group={group} mode="expanded" />)
    expect(host!.querySelector('[data-sidebar-group-content] [data-testid="mini"]')).not.toBeNull()
  })

  it('drop target accepts only listed types', async () => {
    const dropped: string[] = []
    const group: Group = { id: 'lists', items: [item({ id: 'l1', label: 'List', drop: { accepts: ['application/x-rox-task'], onDrop: (d) => dropped.push(d.getData('application/x-rox-task')) } })] }
    await render(<SidebarSection screenId="tasks" group={group} mode="expanded" />)
    const row = host!.querySelector('[data-sidebar-item="l1"]') as HTMLElement
    const fire = (types: string[]) => {
      const event = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown }
      event.dataTransfer = { types, getData: () => 't1', dropEffect: 'none' }
      row.dispatchEvent(event)
    }
    await act(async () => fire(['text/plain']))
    expect(dropped).toEqual([])
    await act(async () => fire(['application/x-rox-task']))
    expect(dropped).toEqual(['t1'])
  })
})

describe('panel strip', () => {
  it('opens a new screen at the left and focuses an already open screen', () => {
    const store = createStore()
    const a = store.set(strip.openScreenPanelAtom, { route: 'feed' as never })
    const b = store.set(strip.openScreenPanelAtom, { route: 'docs' as never })
    expect(store.get(panelStackAtom).map((p) => p.id)).toEqual([b, a])
    const again = store.set(strip.openScreenPanelAtom, { route: 'feed' as never })
    expect(again).toBe(a)
    expect(store.get(focusedPanelIdAtom)).toBe(a)
    expect(store.get(panelStackAtom)).toHaveLength(2)
    const sum = store.get(panelStackAtom).reduce((s, p) => s + p.proportion, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
  })

  it('persists clamped widths per screen key', () => {
    const store = createStore()
    store.set(strip.setStripWidthAtom, { route: 'docs/abc', width: 99999 })
    expect(strip.stripWidthFor(store.get(strip.stripWidthsAtom), 'docs/zzz')).toBe(strip.STRIP_MAX_WIDTH)
    store.set(strip.setStripWidthAtom, { route: 'feed', width: 10 })
    expect(strip.stripWidthFor(store.get(strip.stripWidthsAtom), 'feed')).toBe(strip.STRIP_MIN_WIDTH)
    expect(strip.stripWidthFor(store.get(strip.stripWidthsAtom), 'tasks')).toBe(strip.STRIP_DEFAULT_WIDTH)
  })

  it('per-screen pause policy overrides the heavy-type default', () => {
    expect(strip.canHibernate({ route: 'browser/1', panelType: 'browser' } as never, {})).toBe(true)
    expect(strip.canHibernate({ route: 'browser/1', panelType: 'browser' } as never, { browser: { hibernate: false } })).toBe(false)
    expect(strip.canHibernate({ route: 'feed', panelType: 'other' } as never, { feed: { hibernate: true } })).toBe(true)
    expect(strip.canHibernate({ route: 'feed', panelType: 'other' } as never, {})).toBe(false)
  })
})
