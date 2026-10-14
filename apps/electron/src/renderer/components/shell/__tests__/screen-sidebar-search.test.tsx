import { useDomForFile as installDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

installDom()

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

const { isSidebarSearchUsable, registerScreenSidebarSearch, resetScreenSidebarSearch, useScreenSidebarSearchInput } = await import('../screen-sidebar')
const { ScreenSidebar } = await import('../ScreenSidebar')
const { TooltipProvider } = await import('@rox/ui')
type Config = import('../screen-sidebar').ScreenSidebarConfig

/** Fake layout: an element is `w` wide unless it (or an ancestor) has data-w="0". */
const realRect = HTMLElement.prototype.getBoundingClientRect
function fakeLayout() {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const width = this.closest('[data-w="0"]') ? 0 : 200
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 20, width, height: 20, toJSON() { return {} } } as DOMRect
  }
}

let root: Root | null = null
let host: HTMLDivElement | null = null
let seen: HTMLInputElement | null = null
function Probe() { seen = useScreenSidebarSearchInput('s'); return null }
const config: Config = { screenId: 's', title: 'S', search: { placeholder: 'Find', value: '', onChange: () => {} }, groups: [] }

async function render(mode: 'expanded' | 'icons', slotAttrs: Record<string, string> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(
    <TooltipProvider>
      <div data-panel-role="sidebar" {...slotAttrs}><ScreenSidebar config={config} mode={mode} /></div>
      <Probe />
    </TooltipProvider>,
  ))
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  root = null; host = null; seen = null
  resetScreenSidebarSearch()
  HTMLElement.prototype.getBoundingClientRect = realRect
})

describe('sidebar search registration', () => {
  it('registers the shell box only when expanded and visible with width', async () => {
    fakeLayout()
    await render('expanded')
    expect(seen).not.toBeNull()
    expect(seen!.getAttribute('aria-label')).toBe('Find')
  })
  it('does not register in icons mode', async () => {
    fakeLayout()
    await render('icons')
    expect(seen).toBeNull()
  })
  it('does not register when the sidebar slot is hidden at width 0', async () => {
    fakeLayout()
    await render('expanded', { 'data-w': '0' })
    expect(seen).toBeNull()
  })
  it('does not register inside an inert slot', async () => {
    fakeLayout()
    await render('expanded', { inert: '' })
    expect(seen).toBeNull()
  })
  it('clears on unmount', async () => {
    fakeLayout()
    await render('expanded')
    expect(seen).not.toBeNull()
    await act(async () => root!.render(<Probe />))
    expect(seen).toBeNull()
  })
})

describe('registerScreenSidebarSearch', () => {
  it('is owner-checked: another element detaching does not clear the entry', () => {
    const a = document.createElement('input'); const b = document.createElement('input')
    registerScreenSidebarSearch('x', a)
    registerScreenSidebarSearch('x', null, b)
    let current: HTMLInputElement | null = null
    function P() { current = useScreenSidebarSearchInput('x'); return null }
    const h = document.createElement('div'); const r = createRoot(h)
    act(() => r.render(<P />))
    expect<HTMLInputElement | null>(current).toBe(a)
    act(() => registerScreenSidebarSearch('x', null, a))
    expect(current).toBeNull()
    act(() => r.unmount())
  })
  it('isSidebarSearchUsable rejects disconnected inputs', () => {
    expect(isSidebarSearchUsable(document.createElement('input'))).toBe(false)
  })
})
