import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

useDomForFile()

const navigated: string[] = []
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
mock.module('@/contexts/NavigationContext', () => ({
  useNavigationActions: () => ({ navigate: (route: string) => { navigated.push(route) } }),
}))

let currentRoute: string | null = null
const realJotai = await import('jotai')
const realPanelStack = await import('@/atoms/panel-stack')
const routeStore = { get: (atom: unknown) => atom === realPanelStack.focusedPanelRouteAtom ? currentRoute : realJotai.getDefaultStore().get(atom as never) }
mock.module('jotai', () => ({ ...realJotai, useStore: () => routeStore }))

let GuidedTourHost: typeof import('../GuidedTour').GuidedTourHost
let model: typeof import('../model')
let state: typeof import('../state')
beforeAll(async () => {
  state = await import('../state')
  ;({ GuidedTourHost } = await import('../GuidedTour'))
  model = await import('../model')
})

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; resetDom(); localStorage.clear(); navigated.length = 0; currentRoute = null })

function target(attr: string, value: string) {
  const el = document.createElement('div')
  el.setAttribute(attr, value)
  el.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 300, right: 210, bottom: 310, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect
  document.body.appendChild(el)
  return el
}
const wait = (ms: number) => act(() => new Promise<void>(resolve => setTimeout(resolve, ms)))
const card = () => document.querySelector('[data-guided-tour]')
const step = () => card()?.getAttribute('data-step')
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })

async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<GuidedTourHost shellReady />))
  await wait(600)
}

describe('GuidedTourHost', () => {
  it('auto-starts on Home, skips missing targets, persists completion', async () => {
    target('data-sidebar-primary-nav', '')
    await mount()
    expect(navigated).toEqual(['home'])
    expect(step()).toBe('welcome')
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement?.hasAttribute('data-guided-tour-next')).toBe(true)
    await key('ArrowRight')
    expect(step()).toBe('navigation')
    expect(document.querySelector('[data-guided-tour] rect')).not.toBeNull()
    await key('ArrowLeft')
    expect(step()).toBe('welcome')
    await key('ArrowRight'); await key('ArrowRight') // tools…composer missing → cloud (centred fallback)
    expect(step()).toBe('cloud')
    await key('ArrowRight')
    expect(step()).toBe('search')
    await key('ArrowRight')
    expect(card()).toBeNull()
    expect(JSON.parse(localStorage.getItem('craft-guided-tour')!)).toMatchObject({ status: 'completed', version: model.GUIDED_TOUR_VERSION })
  })

  it('Esc skips and is remembered; the profile menu event relaunches it', async () => {
    await mount()
    expect(step()).toBe('welcome')
    await key('Escape')
    expect(card()).toBeNull()
    expect(JSON.parse(localStorage.getItem('craft-guided-tour')!).status).toBe('skipped')
    act(() => root!.unmount()); root = null
    await mount()
    expect(card()).toBeNull()
    act(() => model.requestGuidedTour())
    await wait(600)
    expect(step()).toBe('welcome')
  })

  it('waits for another open dialog before starting', async () => {
    const other = document.createElement('div'); other.setAttribute('role', 'dialog'); other.setAttribute('data-state', 'open')
    document.body.appendChild(other)
    await mount()
    expect(card()).toBeNull()
    other.remove()
    await wait(600)
    expect(step()).toBe('welcome')
  })

  it('existing users: restores the previous route when the tour ends', async () => {
    currentRoute = 'settings/app'
    await mount()
    expect(navigated).toEqual(['home'])
    expect(state.getGuidedTourStatus()).toBe('running')
    await key('Escape')
    expect(navigated).toEqual(['home', 'settings/app'])
    expect(state.getGuidedTourStatus()).toBe('idle')
  })

  it('first run: stays on Home after the tour', async () => {
    currentRoute = 'settings/app'
    state.markGuidedTourFirstRun()
    await mount()
    await key('Escape')
    expect(navigated).toEqual(['home'])
  })

  it('ignores repeated start requests while pending or running', async () => {
    localStorage.setItem('craft-guided-tour', JSON.stringify({ status: 'skipped', version: model.GUIDED_TOUR_VERSION, at: 1 }))
    await mount()
    act(() => { model.requestGuidedTour(); model.requestGuidedTour() })
    expect(state.getGuidedTourStatus()).toBe('pending')
    await wait(600)
    expect(step()).toBe('welcome')
    act(() => model.requestGuidedTour())
    await wait(600)
    expect(document.querySelectorAll('[data-guided-tour]').length).toBe(1)
  })
})
