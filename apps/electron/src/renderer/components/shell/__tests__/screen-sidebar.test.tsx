import { useDomForFile as installDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

installDom()

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts && 'count' in opts ? `${key}:${opts.count}` : key), i18n: { language: 'en' } }),
}))

const { getScreenSidebar, resetScreenSidebar, splitVisible, useScreenSidebar } = await import('../screen-sidebar')
const { ScreenSidebar } = await import('../ScreenSidebar')
const { TooltipProvider } = await import('@rox/ui')
type Config = import('../screen-sidebar').ScreenSidebarConfig

let root: Root | null = null
let host: HTMLDivElement | null = null
async function render(ui: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{ui}</TooltipProvider>))
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  root = null; host = null
  resetScreenSidebar()
  localStorage.clear()
})

const item = (id: string, extra: Partial<import('../screen-sidebar').SidebarItem> = {}) => ({ id, label: id, onSelect: mock(() => {}), ...extra })

describe('splitVisible', () => {
  it('keeps the first N and counts the rest', () => {
    expect(splitVisible([1, 2, 3, 4, 5, 6, 7], 5, false)).toEqual({ visible: [1, 2, 3, 4, 5], hiddenCount: 2 })
    expect(splitVisible([1, 2], 5, false)).toEqual({ visible: [1, 2], hiddenCount: 0 })
    expect(splitVisible([1, 2, 3], 2, true).hiddenCount).toBe(0)
  })
  it('never hides the active row', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c', active: true }]
    expect(splitVisible(rows, 2, false).visible.map((r) => r.id)).toEqual(['a', 'c'])
  })
})

describe('useScreenSidebar', () => {
  it('publishes while mounted and clears on unmount', async () => {
    const config: Config = { screenId: 'tasks', title: 'Tasks', groups: [] }
    function Screen() { useScreenSidebar(config); return null }
    await render(<Screen />)
    expect(getScreenSidebar()).toBe(config)
    await act(async () => root!.unmount()); root = null
    expect(getScreenSidebar()).toBeNull()
  })
  it('a stale unmount does not clear a newer screen', async () => {
    const a: Config = { screenId: 'a', title: 'A', groups: [] }
    const b: Config = { screenId: 'b', title: 'B', groups: [] }
    function A() { useScreenSidebar(a); return null }
    function B() { useScreenSidebar(b); return null }
    await render(<><A /><B /></>)
    await act(async () => root!.render(<TooltipProvider><B /></TooltipProvider>))
    expect(getScreenSidebar()).toBe(b)
  })
})

describe('ScreenSidebar', () => {
  it('renders header, primary action, groups, show more and real states', async () => {
    const onNew = mock(() => {})
    const onRetry = mock(() => {})
    const rows = Array.from({ length: 7 }, (_, i) => item(`r${i}`))
    const config: Config = {
      screenId: 'sessions',
      title: 'Sessions',
      primaryAction: { id: 'new', label: 'New chat', onSelect: onNew },
      groups: [
        { id: 'recent', title: 'Recents', items: rows },
        { id: 'loading', title: 'Projects', items: [], state: { kind: 'loading' } },
        { id: 'err', title: 'Pinned', items: [], state: { kind: 'error', label: 'Failed', onRetry } },
        { id: 'hidden-empty', title: 'Nothing', items: [] },
      ],
    }
    await render(<ScreenSidebar config={config} mode="expanded" />)
    const q = (sel: string) => host!.querySelector(sel) as HTMLElement | null
    expect(q('[data-sidebar-screen-header] h2')?.textContent).toBe('Sessions')
    await act(async () => q('[data-sidebar-primary-action]')!.click())
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(host!.querySelectorAll('[data-sidebar-group="recent"] [data-sidebar-item]').length).toBe(5)
    await act(async () => q('[data-sidebar-show-more]')!.click())
    expect(host!.querySelectorAll('[data-sidebar-group="recent"] [data-sidebar-item]').length).toBe(7)
    await act(async () => q('[data-sidebar-item="r6"]')!.click())
    expect(rows[6].onSelect).toHaveBeenCalledTimes(1)
    expect(q('[data-sidebar-group="loading"] [data-sidebar-group-state="loading"]')).not.toBeNull()
    await act(async () => (q('[data-sidebar-group="err"] [data-sidebar-group-state="error"] button'))!.click())
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(q('[data-sidebar-group="hidden-empty"]')).toBeNull()
  })

  it('collapses a group and persists it', async () => {
    const config: Config = { screenId: 's', title: 'S', groups: [{ id: 'g', title: 'G', items: [item('x')] }] }
    await render(<ScreenSidebar config={config} mode="expanded" />)
    const toggle = host!.querySelector('[data-sidebar-group="g"] h3 button') as HTMLButtonElement
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(host!.querySelector('[data-sidebar-item="x"]')).toBeNull()
    expect(localStorage.getItem('rox:shell-sidebar-groups-v1') ?? JSON.stringify(Object.fromEntries(Object.entries(localStorage)))).toContain('s:g')
  })

  it('icons mode shows only labelled icon buttons', async () => {
    const config: Config = { screenId: 's', title: 'S', groups: [{ id: 'g', title: 'G', items: [item('x', { active: true })] }] }
    await render(<ScreenSidebar config={config} mode="icons" />)
    const btn = host!.querySelector('[data-sidebar-item="x"]') as HTMLElement
    expect(btn.getAttribute('aria-label')).toBe('x')
    expect(btn.getAttribute('aria-current')).toBe('page')
    expect(host!.querySelector('[data-sidebar-screen-header]')).toBeNull()
  })
})
