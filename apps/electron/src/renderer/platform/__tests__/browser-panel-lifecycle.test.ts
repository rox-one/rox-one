import { afterEach, describe, expect, it, mock } from 'bun:test'
import { createStore } from 'jotai'
import {
  closePanelAtom,
  focusedPanelIdAtom,
  openOrFocusBrowserPanelAtom,
  openOrFocusPanelRouteAtom,
  panelStackAtom,
} from '../../atoms/panel-stack'
import {
  browserInstanceIdFromRoute,
  browserRouteForInstanceId,
  destroyBrowserInstanceForRoute,
  openOrFocusEmbeddedBrowserPanel,
} from '../browser-panel-lifecycle'

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  } else {
    delete (globalThis as { window?: unknown }).window
  }
})

function installMockWindow(destroy: (id: string) => Promise<void>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      electronAPI: {
        browserPane: {
          destroy,
        },
      },
    },
  })
}

describe('browser panel lifecycle', () => {
  it('extracts browser instance ids only from browser panel routes', () => {
    expect(browserInstanceIdFromRoute('browser/instance/browser-embedded-7')).toBe('browser-embedded-7')
    expect(browserInstanceIdFromRoute('sessions/allSessions/session/session-1')).toBeNull()
  })

  it('routes explicit browser panel close to browserPane.destroy', () => {
    const destroy = mock(async (_id: string) => {})
    installMockWindow(destroy)

    expect(destroyBrowserInstanceForRoute('browser/instance/browser-embedded-8')).toBe('browser-embedded-8')
    expect(destroy).toHaveBeenCalledWith('browser-embedded-8')
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys exactly once when explicitly closing one browser panel', () => {
    const store = createStore()
    const destroy = mock(async (_id: string) => {})
    installMockWindow(destroy)

    const opened = store.set(openOrFocusPanelRouteAtom, {
      route: browserRouteForInstanceId('browser-embedded-close'),
      targetLaneId: 'main',
    })
    const entry = store.get(panelStackAtom)[0]

    expect(entry.id).toBe(opened.panelId)
    expect(destroyBrowserInstanceForRoute(entry.route)).toBe('browser-embedded-close')
    store.set(closePanelAtom, entry.id)

    expect(destroy).toHaveBeenCalledWith('browser-embedded-close')
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(store.get(panelStackAtom)).toHaveLength(0)
    expect(store.get(focusedPanelIdAtom)).toBeNull()
  })

  it('does not destroy anything for non-browser panel routes', () => {
    const destroy = mock(async (_id: string) => {})
    installMockWindow(destroy)

    expect(destroyBrowserInstanceForRoute('settings')).toBeNull()
    expect(destroy).not.toHaveBeenCalled()
  })

  it('atomically opens a retained embedded browser once on two immediate resume actions', () => {
    const store = createStore()
    const resume = () => openOrFocusEmbeddedBrowserPanel({
      instanceId: 'browser-embedded-9',
      openOrFocusBrowserPanel: (input) => store.set(openOrFocusBrowserPanelAtom, input),
    })

    const first = resume()
    const second = resume()
    const stack = store.get(panelStackAtom)

    expect(first.status).toBe('opened')
    expect(second.status).toBe('focused')
    expect(stack).toHaveLength(1)
    expect(stack[0].route).toBe(browserRouteForInstanceId('browser-embedded-9'))
    expect(second.panelId).toBe(first.panelId)
    expect(store.get(focusedPanelIdAtom)).toBe(first.panelId)
  })

  it('keeps the canonical route atom atomic across two immediate browser opens', () => {
    const store = createStore()
    const route = browserRouteForInstanceId('browser-embedded-canonical')

    const first = store.set(openOrFocusPanelRouteAtom, { route, targetLaneId: 'main' })
    const second = store.set(openOrFocusPanelRouteAtom, { route, targetLaneId: 'main' })

    expect(first.status).toBe('opened')
    expect(second.status).toBe('focused')
    expect(second.panelId).toBe(first.panelId)
    expect(store.get(panelStackAtom)).toHaveLength(1)
  })
})
