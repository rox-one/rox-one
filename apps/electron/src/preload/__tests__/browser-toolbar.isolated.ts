import { expect, test, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
let bridge: any
const ipc = Object.assign(new EventEmitter(), { invoke: () => Promise.resolve() })
Object.defineProperty(globalThis, 'location', { value: { search: '?instanceId=toolbar-1' }, configurable: true })
mock.module('electron', () => ({ contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { expect(name).toBe('browserToolbar'); bridge = value } }, ipcRenderer: ipc }))
await import('../browser-toolbar')
test('toolbar preload replays the state and theme colour pushed before the renderer subscribed', () => {
  const first = { url: 'https://example.com/', title: 'Example', isLoading: false, canGoBack: true, canGoForward: false, themeColor: '#123456' }
  // did-finish-load push arrives while the renderer is still loading its locale.
  ipc.emit('browser-toolbar:state-update', {}, first)
  ipc.emit('browser-toolbar:theme-color', {}, null)
  const states: unknown[] = []
  const colors: unknown[] = []
  const disposeState = bridge.onStateUpdate((state: unknown) => states.push(state))
  const disposeColor = bridge.onThemeColor((color: unknown) => colors.push(color))
  expect(states).toEqual([first])
  expect(colors).toEqual([null])
  const second = { ...first, url: 'https://example.org/' }
  ipc.emit('browser-toolbar:state-update', {}, second)
  expect(states).toEqual([first, second])
  disposeState(); disposeColor()
  ipc.emit('browser-toolbar:state-update', {}, first)
  expect(states).toEqual([first, second])
  // Only the preload's own buffering listeners remain.
  expect(ipc.listenerCount('browser-toolbar:state-update')).toBe(1)
  expect(ipc.listenerCount('browser-toolbar:theme-color')).toBe(1)
})
