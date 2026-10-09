/**
 * PERF-10 (#1577): the keep-alive host retains the last five visited surfaces
 * — retention policy, snapshot semantics, pane affordances and the pause
 * contract hidden surfaces rely on.
 */
import { installDom, uninstallDom } from '../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  EMPTY_RETENTION,
  RetainedSurfacePane,
  SURFACE_KEEPALIVE_CAPACITY,
  SURFACE_KEEPALIVE_LOW_MEMORY_CAPACITY,
  advanceRetention,
  detectKeepAliveCapacity,
  useEffectiveVisible,
  useKeepAliveSurfaces,
  useSurfaceActive,
} from '../surface-keepalive'

installDom()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => uninstallDom())

const node = (label: string) => React.createElement('span', { 'data-label': label }, label)

describe('advanceRetention', () => {
  it('keeps the first visited surface and snapshots it when the next one opens', () => {
    const first = advanceRetention(EMPTY_RETENTION, null, 'a', SURFACE_KEEPALIVE_CAPACITY)
    expect(first.keys).toEqual(['a'])
    expect(first.snapshots.size).toBe(0)

    const second = advanceRetention(first, { key: 'a', node: node('a') }, 'b', SURFACE_KEEPALIVE_CAPACITY)
    expect(second.keys).toEqual(['a', 'b'])
    expect(second.snapshots.get('a')).toBeDefined()
    expect(second.snapshots.has('b')).toBe(false)
  })

  it('evicts the least recently used surface once the capacity is exceeded', () => {
    let state = EMPTY_RETENTION
    let previous: { key: string; node: React.ReactNode } | null = null
    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      state = advanceRetention(state, previous, key, SURFACE_KEEPALIVE_CAPACITY)
      previous = { key, node: node(key) }
    }
    expect(state.keys).toEqual(['a', 'b', 'c', 'd', 'e'])

    state = advanceRetention(state, previous, 'f', SURFACE_KEEPALIVE_CAPACITY)
    expect(state.keys).toEqual(['b', 'c', 'd', 'e', 'f'])
    expect(state.snapshots.has('a')).toBe(false)
  })

  it('never evicts the active surface and trims on a lower capacity', () => {
    let state = EMPTY_RETENTION
    let previous: { key: string; node: React.ReactNode } | null = null
    for (const key of ['a', 'b', 'c', 'd']) {
      state = advanceRetention(state, previous, key, SURFACE_KEEPALIVE_CAPACITY)
      previous = { key, node: node(key) }
    }
    const trimmed = advanceRetention(state, previous, 'd', SURFACE_KEEPALIVE_LOW_MEMORY_CAPACITY)
    expect(trimmed.keys).toEqual(['b', 'c', 'd'])
    expect(trimmed.snapshots.has('a')).toBe(false)

    const pinned = advanceRetention(trimmed, { key: 'd', node: node('d') }, 'd', 1)
    expect(pinned.keys).toEqual(['d'])
  })

  it('re-visiting an evicted surface keeps only the live node, not the stale snapshot', () => {
    let state = advanceRetention(EMPTY_RETENTION, null, 'a', 1)
    state = advanceRetention(state, { key: 'a', node: node('a') }, 'b', 1)
    expect(state.keys).toEqual(['b'])
    expect(state.snapshots.size).toBe(0)

    state = advanceRetention(state, { key: 'b', node: node('b') }, 'a', 1)
    expect(state.keys).toEqual(['a'])
    // The stale snapshot of the returning surface must not survive its eviction:
    // a revisit mounts the live node instead of resurrecting the old tree.
    expect(state.snapshots.has('a')).toBe(false)
    // Capacity 1 retains nothing else; the retired surface was pushed out.
    expect(state.snapshots.size).toBe(0)
  })
})

describe('detectKeepAliveCapacity', () => {
  it('drops to three retained surfaces on a low-memory machine', () => {
    expect(detectKeepAliveCapacity(2)).toBe(SURFACE_KEEPALIVE_LOW_MEMORY_CAPACITY)
    expect(detectKeepAliveCapacity(4)).toBe(SURFACE_KEEPALIVE_LOW_MEMORY_CAPACITY)
    expect(detectKeepAliveCapacity(8)).toBe(SURFACE_KEEPALIVE_CAPACITY)
    expect(detectKeepAliveCapacity(undefined)).toBe(SURFACE_KEEPALIVE_CAPACITY)
  })
})

/** A surface with local state and an activity-gated subscription. */
function HarnessSurface({ label, ticks }: { label: string; ticks: (label: string) => void }) {
  const active = useSurfaceActive()
  const visible = useEffectiveVisible()
  const [count, setCount] = React.useState(0)
  React.useEffect(() => {
    if (!visible) return
    ticks(label)
  }, [visible, label, ticks])
  return (
    <button type="button" data-surface={label} onClick={() => setCount(value => value + 1)}>
      {label}:{count}
    </button>
  )
}

function Host({ surfaces, activeKey, capacity = SURFACE_KEEPALIVE_CAPACITY, ticks }: {
  surfaces: Map<string, string>
  activeKey: string
  capacity?: number
  ticks: (label: string) => void
}) {
  const label = surfaces.get(activeKey)
  const entries = useKeepAliveSurfaces(
    activeKey,
    React.createElement(HarnessSurface, { label: label ?? activeKey, ticks }),
    capacity,
  )
  return (
    <>
      {entries.map(entry => (
        <RetainedSurfacePane key={entry.key} active={entry.key === activeKey}>
          {entry.node}
        </RetainedSurfacePane>
      ))}
    </>
  )
}

function mount(surfaces: Map<string, string>, activeKey: string, capacity = SURFACE_KEEPALIVE_CAPACITY) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const ticks: string[] = []
  const ticksFn = (label: string) => { ticks.push(label) }
  act(() => { root.render(<Host surfaces={surfaces} activeKey={activeKey} capacity={capacity} ticks={ticksFn} />) })
  return {
    container,
    root,
    ticks,
    render: (key: string) => act(() => { root.render(<Host surfaces={surfaces} activeKey={key} capacity={capacity} ticks={ticksFn} />) }),
    unmount: () => act(() => root.unmount()),
  }
}

describe('useKeepAliveSurfaces', () => {
  it('preserves a retired surface’s state and DOM across a revisit', () => {
    const surfaces = new Map([['a', 'Notes'], ['b', 'Tasks']])
    const harness = mount(surfaces, 'a')
    try {
      const button = harness.container.querySelector('[data-surface="Notes"]') as HTMLButtonElement
      act(() => button.click())
      act(() => button.click())
      expect(button.textContent).toBe('Notes:2')

      harness.render('b')
      const retired = harness.container.querySelector('[data-surface="Notes"]') as HTMLButtonElement
      expect(retired).toBe(button)
      expect(retired.closest('[data-surface-retained]')?.getAttribute('data-surface-active')).toBe('false')

      harness.render('a')
      expect(harness.container.querySelector('[data-surface="Notes"]')?.textContent).toBe('Notes:2')
    } finally {
      harness.unmount()
    }
  })

  it('marks retired panes hidden, inert and inactive; the active one is content', () => {
    const surfaces = new Map([['a', 'Notes'], ['b', 'Tasks']])
    const harness = mount(surfaces, 'a')
    try {
      const panes = () => Array.from(harness.container.querySelectorAll('[data-surface-retained]'))
      const [first] = panes()
      expect(first?.getAttribute('data-surface-active')).toBe('true')
      expect((first as HTMLElement).hidden).toBe(false)

      harness.render('b')
      const panesAfter = panes()
      const retired = panesAfter.find(pane => pane.getAttribute('data-surface-active') === 'false') as HTMLElement
      expect(retired.hidden).toBe(true)
      expect(retired.getAttribute('aria-hidden')).toBe('true')
      expect(retired.inert).toBe(true)
      expect(retired.style.contentVisibility).toBe('hidden')
    } finally {
      harness.unmount()
    }
  })

  it('stops subscriptions of a hidden surface (zero timer-driven work)', () => {
    const surfaces = new Map([['a', 'Notes'], ['b', 'Tasks']])
    const harness = mount(surfaces, 'a')
    try {
      expect(harness.ticks).toEqual(['Notes'])
      harness.render('b')
      expect(harness.ticks).toEqual(['Notes', 'Tasks'])
      harness.render('a')
      expect(harness.ticks).toEqual(['Notes', 'Tasks', 'Notes'])
    } finally {
      harness.unmount()
    }
  })

  it('gates on window visibility too: a hidden window pauses an active surface', () => {
    const original = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    const surfaces = new Map([['a', 'Notes']])
    const harness = mount(surfaces, 'a')
    try {
      expect(harness.ticks).toEqual(['Notes'])
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      harness.render('a')
      expect(harness.ticks).toEqual(['Notes'])
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      harness.render('a')
      expect(harness.ticks).toEqual(['Notes', 'Notes'])
    } finally {
      harness.unmount()
      if (original) Object.defineProperty(document, 'visibilityState', original)
      else delete (document as { visibilityState?: string }).visibilityState
    }
  })

  it('keeps five surfaces and re-mounts the sixth’s evicted predecessor', () => {
    const surfaces = new Map([
      ['a', 'Home'], ['b', 'Notes'], ['c', 'Tasks'], ['d', 'Inbox'], ['e', 'Feed'], ['f', 'Agents'],
    ])
    const harness = mount(surfaces, 'a')
    try {
      for (const key of ['b', 'c', 'd', 'e']) harness.render(key)
      expect(harness.container.querySelectorAll('[data-surface-retained]').length).toBe(5)

      harness.render('f')
      const labels = Array.from(harness.container.querySelectorAll('[data-surface]'), element => element.getAttribute('data-surface'))
      expect(labels).toEqual(['Notes', 'Tasks', 'Inbox', 'Feed', 'Agents'])

      harness.render('a')
      const mounted = Array.from(harness.container.querySelectorAll('[data-surface]'), element => element.getAttribute('data-surface'))
      expect(mounted).toEqual(['Tasks', 'Inbox', 'Feed', 'Agents', 'Home'])
      expect(harness.container.querySelector('[data-surface="Home"]')?.textContent).toBe('Home:0')
    } finally {
      harness.unmount()
    }
  })
})