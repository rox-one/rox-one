import { expect, it, mock } from 'bun:test'
import { observeTargetGeometry } from '../geometry-observer'

it('UI-05/UI-11 geometry invalidation coalesces frames and releases every resource', () => {
  const handlers = new Map<string, () => void>()
  const callbacks = new Map<number, FrameRequestCallback>()
  const disconnected = mock(() => {})
  const observed = mock(() => {})
  let resize!: () => void
  let mutation!: () => void
  let serial = 0
  const view = {
    innerWidth: 1000, innerHeight: 800, frameElement: null,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflow: 'visible' }),
    addEventListener: (name: string, callback: () => void) => { handlers.set(name, callback) },
    removeEventListener: (name: string) => { handlers.delete(name) },
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++serial; callbacks.set(id, callback); return id },
    cancelAnimationFrame: (id: number) => { callbacks.delete(id) },
    ResizeObserver: class { constructor(callback: () => void) { resize = callback }; observe = observed; disconnect = disconnected },
    MutationObserver: class { constructor(callback: () => void) { mutation = callback }; observe = observed; disconnect = disconnected },
  }
  const document = { defaultView: view, addEventListener: view.addEventListener, removeEventListener: view.removeEventListener }
  const element = { ownerDocument: document, parentElement: null, isConnected: true, hidden: false, getAttribute: () => null, getClientRects: () => [1], getBoundingClientRect: () => ({ left: 10, top: 20, right: 100, bottom: 50, width: 90, height: 30 }) } as unknown as HTMLElement
  const changed = mock(() => {})
  const cleanup = observeTargetGeometry(element, changed)
  resize(); mutation(); handlers.get('scroll')?.(); handlers.get('resize')?.()
  expect(callbacks.size).toBe(1)
  const [id, callback] = callbacks.entries().next().value!
  callbacks.delete(id); callback(0)
  expect(changed).toHaveBeenCalledTimes(1)
  resize()
  expect(callbacks.size).toBe(1)
  cleanup()
  expect(callbacks.size).toBe(0)
  expect(handlers.size).toBe(0)
  expect(disconnected).toHaveBeenCalledTimes(2)
  resize(); mutation()
  expect(callbacks.size).toBe(0)
})
