import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { focusedPanelIdAtom } from '../../atoms/panel-stack'
import { panelOwnsKeyboardTarget } from '../panel-keyboard'

// Offline DOM adapter. Event delivery is native EventTarget dispatch; browser layout
// is represented explicitly, so these tests do not claim Chromium acceptance.
class PaneElement extends EventTarget {
  dataset: { panelId?: string } = {}
  parentElement: PaneElement | null = null
  isConnected = true
  hidden = false
  inert = false
  ariaHidden = false
  display = 'block'
  visibility = 'visible'
  hasBox = true
  ownerDocument = { defaultView: { getComputedStyle: (element: PaneElement) => ({ display: element.display, visibility: element.visibility }) } }
  constructor(panelId?: string, parent?: PaneElement) { super(); this.dataset.panelId = panelId; this.parentElement = parent ?? null }
  closest(selector: string): PaneElement | null {
    for (let element: PaneElement | null = this; element; element = element.parentElement) {
      if (selector === '[data-panel-id]' ? element.dataset.panelId : element.hidden || element.inert || element.ariaHidden) return element
    }
    return null
  }
  getClientRects() { return this.hasBox ? [{}] : [] }
}

function keyboardTarget(element: PaneElement) { return element as unknown as EventTarget }

describe('mounted panel keyboard authority', () => {
  it('dispatches a key only to the focused event-origin pane while the main remains mounted', () => {
    const store = createStore()
    const main = new PaneElement('main'), tool = new PaneElement('tasks')
    const mainButton = new PaneElement(undefined, main), toolButton = new PaneElement(undefined, tool)
    let mainActions = 0, toolActions = 0
    const mountedMainListener = (event: Event) => { if (panelOwnsKeyboardTarget('main', store.get(focusedPanelIdAtom), event.target)) mainActions++ }
    const mountedToolListener = (event: Event) => { if (panelOwnsKeyboardTarget('tasks', store.get(focusedPanelIdAtom), event.target)) toolActions++ }
    for (const button of [mainButton, toolButton]) {
      button.addEventListener('keydown', mountedMainListener)
      button.addEventListener('keydown', mountedToolListener)
    }
    store.set(focusedPanelIdAtom, 'main')
    mainButton.dispatchEvent(new Event('keydown'))
    expect([mainActions, toolActions]).toEqual([1, 0])
    // The event-time atom changes before a React render can update any handler closure.
    store.set(focusedPanelIdAtom, 'tasks')
    mainButton.dispatchEvent(new Event('keydown'))
    toolButton.dispatchEvent(new Event('keydown'))
    expect([mainActions, toolActions]).toEqual([1, 1])
    store.set(focusedPanelIdAtom, 'main')
    mainButton.dispatchEvent(new Event('keydown'))
    expect([mainActions, toolActions]).toEqual([2, 1])
  })

  it('denies a hidden, inert or aria-hidden main even if stale atom focus still names it', () => {
    const wrapper = new PaneElement(), main = new PaneElement('main', wrapper), button = new PaneElement(undefined, main)
    for (const state of ['hidden', 'inert', 'ariaHidden'] as const) {
      wrapper[state] = true
      expect(panelOwnsKeyboardTarget('main', 'main', keyboardTarget(button))).toBe(false)
      wrapper[state] = false
    }
    expect(panelOwnsKeyboardTarget('main', 'main', keyboardTarget(button))).toBe(true)
  })

  it('denies CSS-hidden, collapsed, boxless and disconnected panes', () => {
    const main = new PaneElement('main'), button = new PaneElement(undefined, main)
    main.display = 'none'
    expect(panelOwnsKeyboardTarget('main', 'main', keyboardTarget(button))).toBe(false)
    main.display = 'block'; button.visibility = 'hidden'
    expect(panelOwnsKeyboardTarget('main', 'main', keyboardTarget(button))).toBe(false)
    button.visibility = 'visible'; main.visibility = 'collapse'
    expect(panelOwnsKeyboardTarget('main', 'main', keyboardTarget(button))).toBe(false)
    main.visibility = 'visible'; main.hasBox = false
    expect(panelOwnsKeyboardTarget('main', 'main', keyboardTarget(button))).toBe(false)
    main.hasBox = true; main.isConnected = false
    expect(panelOwnsKeyboardTarget('main', 'main', keyboardTarget(button))).toBe(false)
  })

  it('keeps sidebar, portalled dialog and document targets out of retained page shortcuts', () => {
    const outside = new PaneElement()
    expect(panelOwnsKeyboardTarget('main', 'main', keyboardTarget(outside))).toBe(false)
    expect(panelOwnsKeyboardTarget('main', 'main', new EventTarget())).toBe(false)
    expect(panelOwnsKeyboardTarget(undefined, 'main', keyboardTarget(new PaneElement('main')))).toBe(false)
    expect(panelOwnsKeyboardTarget('main', null, keyboardTarget(new PaneElement('main')))).toBe(false)
  })
})
