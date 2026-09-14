import { describe, expect, it } from 'bun:test'
import { createNativeSurfaceInvalidator, observeNativeSurfaceDOM, readNativeSurfaceDOMBounds, resolveNativeSurfaceDOMBounds } from '../native-surface-dom'

function fixture() {
  const document = {
    visibilityState: 'visible',
    defaultView: { innerWidth: 1_000, innerHeight: 800, getComputedStyle: (node: { style: object }) => node.style },
  }
  const element = (box: { x: number; y: number; width: number; height: number }) => ({
    ownerDocument: document, isConnected: true, hidden: false, inert: false,
    parentElement: null as unknown,
    attributes: {} as Record<string, string>,
    getAttribute(name: string) { return this.attributes[name] ?? null },
    box,
    clientLeft: 0, clientTop: 0,
    get clientWidth() { return this.box.width },
    get clientHeight() { return this.box.height },
    getBoundingClientRect() { return this.box },
    style: { display: 'block', visibility: 'visible', opacity: '1', contentVisibility: 'visible', overflowX: 'visible', overflowY: 'visible' },
  })
  const parent = element({ x: 20, y: 40, width: 600, height: 400 })
  const host = element({ x: 40, y: 60, width: 400, height: 300 })
  host.parentElement = parent
  return { document, parent, host, read: () => readNativeSurfaceDOMBounds(host as unknown as HTMLElement) }
}

describe('native surfaces follow retained panel visibility', () => {
  it('hides for inert, aria-hidden, hidden and CSS-hidden ancestors', () => {
    const f = fixture()
    expect(f.read().state).toBe('visible')
    f.parent.inert = true
    expect(f.read()).toEqual({ state: 'hidden', rect: null })
    f.parent.inert = false
    f.parent.attributes['aria-hidden'] = 'true'
    expect(f.read().rect).toBeNull()
    delete f.parent.attributes['aria-hidden']
    f.parent.hidden = true
    expect(f.read().rect).toBeNull()
    f.parent.hidden = false
    f.parent.style.visibility = 'hidden'
    // A descendant with visibility:visible cannot revive a hidden native slot.
    expect(f.read().rect).toBeNull()
    f.parent.style.visibility = 'visible'
    f.parent.style.display = 'none'
    expect(f.read().rect).toBeNull()
    f.parent.style.display = 'block'
    expect(f.read().rect).toEqual(f.host.box)
  })

  it('hides on document suspension and detached hosts without changing the bounds state', () => {
    const f = fixture()
    f.document.visibilityState = 'hidden'
    expect(f.read().rect).toBeNull()
    f.document.visibilityState = 'visible'
    expect(f.read().rect).toEqual(f.host.box)
    f.host.isConnected = false
    expect(f.read().rect).toBeNull()
  })

  it('rejects partially clipped and offscreen scroll positions, then restores fresh coordinates', () => {
    const f = fixture()
    f.parent.style.overflowX = 'auto'
    f.parent.style.overflowY = 'auto'
    f.host.box.y = 20
    expect(f.read()).toEqual({ state: 'clipped', rect: null })
    f.host.box.y = 900
    expect(f.read().rect).toBeNull()
    f.host.box.y = 70
    f.host.box.x = 350
    expect(f.read().state).toBe('clipped')
    f.host.box.x = 80
    expect(f.read()).toEqual({ state: 'visible', rect: { x: 80, y: 70, width: 400, height: 300 } })
  })

  it('honors horizontal and vertical clipping independently and tolerates subpixel rounding', () => {
    const viewport = { x: 0, y: 0, width: 1_000, height: 800 }
    const bounds = { x: 20, y: 20, width: 300, height: 200 }
    const result = resolveNativeSurfaceDOMBounds({
      rect: bounds, viewport, documentVisible: true,
      ancestors: [{ hidden: false, rect: { x: 20.4, y: 60, width: 300, height: 200 }, clipX: true, clipY: false }],
    })
    expect(result.rect).toEqual(bounds)
    expect(resolveNativeSurfaceDOMBounds({ rect: { ...bounds, width: 40 }, viewport, documentVisible: true, ancestors: [] }).state).toBe('clipped')
  })

  it('observes captured scroll and ancestor changes and removes those listeners on cleanup', () => {
    const previousResize = globalThis.ResizeObserver
    const previousMutation = globalThis.MutationObserver
    const observed: unknown[] = []
    let disconnected = 0
    const mutations: MutationObserverInit[] = []
    Object.assign(globalThis, {
      ResizeObserver: class { observe(value: unknown) { observed.push(value) } disconnect() { disconnected++ } },
      MutationObserver: class { observe(_target: unknown, options: MutationObserverInit) { mutations.push(options) } disconnect() { disconnected++ } },
    })
    try {
      const view = new EventTarget()
      const document = Object.assign(new EventTarget(), { defaultView: view, body: {} })
      const parent = { parentElement: null }
      const host = { ownerDocument: document, parentElement: parent }
      let changes = 0
      const stop = observeNativeSurfaceDOM(host as unknown as HTMLElement, () => { changes++ })
      expect(observed).toEqual([host, parent])
      expect(mutations[0]?.attributeFilter).toContain('inert')
      expect(mutations[0]?.attributeFilter).toContain('style')
      document.dispatchEvent(new Event('scroll'))
      document.dispatchEvent(new Event('visibilitychange'))
      view.dispatchEvent(new Event('resize'))
      expect(changes).toBe(3)
      stop()
      document.dispatchEvent(new Event('scroll'))
      expect(changes).toBe(3)
      expect(disconnected).toBe(3)
    } finally {
      Object.assign(globalThis, { ResizeObserver: previousResize, MutationObserver: previousMutation })
    }
  })

  it('coalesces invalidations once per frame and never measures hidden or disposed hosts', () => {
    const frames = new Map<number, FrameRequestCallback>()
    const cancelled: number[] = []
    let nextFrame = 0
    let paused = false
    let reads = 0
    let hides = 0
    const invalidator = createNativeSurfaceInvalidator({
      paused: () => paused,
      hide: () => { hides++ },
      measure: () => { reads++ },
      requestFrame: callback => { frames.set(++nextFrame, callback); return nextFrame },
      cancelFrame: id => { cancelled.push(id) },
    })
    for (let i = 0; i < 100; i++) invalidator.invalidate()
    expect(frames.size).toBe(1)
    frames.get(1)!(0)
    expect(reads).toBe(1)
    invalidator.invalidate()
    paused = true
    invalidator.invalidate()
    expect(cancelled).toContain(2)
    expect(hides).toBe(1)
    paused = false
    invalidator.invalidate()
    // A canceled callback cannot revive old bounds after a hide/reveal.
    frames.get(2)!(0)
    expect(reads).toBe(1)
    frames.get(3)!(0)
    expect(reads).toBe(2)
    invalidator.invalidate()
    invalidator.dispose()
    frames.get(4)!(0)
    expect(reads).toBe(2)
    invalidator.invalidate()
    expect(frames.size).toBe(4)
  })
})
