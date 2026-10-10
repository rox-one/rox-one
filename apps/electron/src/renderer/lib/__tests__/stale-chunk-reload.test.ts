/**
 * One-shot stale-chunk reload (openclaw-port row b1.2).
 *
 * The recovery must heal a post-update chunk 404 with exactly one reload: a
 * second failure in the same session (or the second event from the same broken
 * chunk) reloads nothing, and an unrelated rejection never reloads the window.
 */
import { describe, expect, it } from 'bun:test'
import {
  createStaleChunkReload,
  installStaleChunkReload,
  isChunkLoadRejection,
} from '../stale-chunk-reload'

type Listener = (event: unknown) => void

function fakeWindow() {
  const listeners = new Map<string, Listener[]>()
  let reloads = 0
  const target = {
    addEventListener(type: string, listener: EventListener) {
      const list = listeners.get(type) ?? []
      list.push(listener as unknown as Listener)
      listeners.set(type, list)
    },
    removeEventListener(type: string, listener: EventListener) {
      const list = listeners.get(type) ?? []
      const index = list.indexOf(listener as unknown as Listener)
      if (index >= 0) list.splice(index, 1)
    },
    location: { reload: () => { reloads += 1 } },
  }
  const emit = (type: string, event: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  return { target: target as unknown as Window, emit, reloadCount: () => reloads }
}

describe('isChunkLoadRejection', () => {
  it('recognises the browser and Vite chunk-load messages', () => {
    expect(isChunkLoadRejection(new Error('Failed to fetch dynamically imported module: ./NotesPage.js'))).toBe(true)
    expect(isChunkLoadRejection('error loading dynamically imported module')).toBe(true)
    expect(isChunkLoadRejection({ message: 'ChunkLoadError: Loading chunk 42 failed' })).toBe(true)
    expect(isChunkLoadRejection(new Error('Unable to preload CSS for ./x.css'))).toBe(true)
  })

  it('ignores unrelated rejections', () => {
    expect(isChunkLoadRejection(new Error('Network request failed'))).toBe(false)
    expect(isChunkLoadRejection(null)).toBe(false)
    expect(isChunkLoadRejection({ code: 'ECONNRESET' })).toBe(false)
  })
})

describe('createStaleChunkReload', () => {
  it('reloads once when the handler is invoked twice', () => {
    let reloads = 0
    let marks = 0
    const recovery = createStaleChunkReload({
      reload: () => { reloads += 1 },
      hasReloaded: () => false,
      markReloaded: () => { marks += 1 },
    })
    expect(recovery.handlePreloadError()).toBe(true)
    expect(recovery.handlePreloadError()).toBe(false)
    expect(recovery.handle(new Error('Failed to fetch dynamically imported module'))).toBe(false)
    expect(reloads).toBe(1)
    expect(marks).toBe(1)
  })

  it('marks the session guard before reloading, so the next boot does not reload again', () => {
    let reloads = 0
    let reloadSawMark = false
    let marked = false
    const recovery = createStaleChunkReload({
      reload: () => { reloads += 1; reloadSawMark = marked },
      hasReloaded: () => false,
      markReloaded: () => { marked = true },
    })
    recovery.handle(new Error('Importing a module script failed.'))
    expect(reloads).toBe(1)
    expect(reloadSawMark).toBe(true)
  })

  it('does nothing when the session already reloaded', () => {
    let reloads = 0
    const recovery = createStaleChunkReload({
      reload: () => { reloads += 1 },
      hasReloaded: () => true,
      markReloaded: () => {},
    })
    expect(recovery.handlePreloadError()).toBe(false)
    expect(recovery.handle(new Error('Failed to fetch dynamically imported module'))).toBe(false)
    expect(reloads).toBe(0)
  })

  it('never reloads for an unrelated rejection', () => {
    let reloads = 0
    const recovery = createStaleChunkReload({
      reload: () => { reloads += 1 },
      hasReloaded: () => false,
      markReloaded: () => {},
    })
    expect(recovery.handle(new Error('RPC 500: workspace busy'))).toBe(false)
    expect(reloads).toBe(0)
    // A genuine chunk failure afterwards still heals.
    expect(recovery.handle(new Error('Failed to fetch dynamically imported module'))).toBe(true)
    expect(reloads).toBe(1)
  })
})

describe('installStaleChunkReload', () => {
  it('reloads once for two vite:preloadError events and stops listening after dispose', () => {
    const win = fakeWindow()
    const dispose = installStaleChunkReload(win.target)
    win.emit('vite:preloadError', { payload: new Error('Failed to fetch dynamically imported module') })
    win.emit('vite:preloadError', { payload: new Error('Failed to fetch dynamically imported module') })
    expect(win.reloadCount()).toBe(1)
    dispose()
    win.emit('vite:preloadError', { payload: new Error('Failed to fetch dynamically imported module') })
    expect(win.reloadCount()).toBe(1)
  })

  it('reloads on a chunk-load unhandled rejection and prevents it (other rejections pass through)', () => {
    const win = fakeWindow()
    installStaleChunkReload(win.target)
    let unrelatedPrevented = true
    win.emit('unhandledrejection', {
      reason: new Error('RPC 500'),
      preventDefault: () => { unrelatedPrevented = true },
    })
    expect(win.reloadCount()).toBe(0)
    let prevented = false
    win.emit('unhandledrejection', {
      reason: new Error('Failed to fetch dynamically imported module: ./NotesPage.js'),
      preventDefault: () => { prevented = true },
    })
    expect(win.reloadCount()).toBe(1)
    expect(prevented).toBe(true)
    expect(unrelatedPrevented).toBe(true)
  })
})