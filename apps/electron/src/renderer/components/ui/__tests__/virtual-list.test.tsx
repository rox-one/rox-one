/**
 * Shared VirtualList (#1578): DOM size stays bounded by the viewport plus
 * overscan, flattened group headers keep their order, and keyboard navigation
 * reaches rows outside the mounted window.
 *
 * happy-dom has no layout, so the scroll parent is a stub with a fixed
 * clientHeight and a writable scrollTop, and rects inside it are shifted by
 * scrollTop the way a real scroll container shifts its content.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { VirtualList, type VirtualListGroup } from '../virtual-list'

useDomForFile()

interface Item {
  id: string
}

const VIEWPORT_HEIGHT = 480
const ROW_HEIGHT = 48
const HEADER_HEIGHT = 30
const OVERSCAN = 5

let originalRect: typeof Element.prototype.getBoundingClientRect
beforeAll(() => {
  originalRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const viewport = this.closest('[data-test-viewport]') as HTMLElement | null
    if (viewport && viewport !== this) return new DOMRect(0, -viewport.scrollTop, 0, 0)
    return originalRect.call(this)
  }
})
afterAll(() => {
  if (typeof Element === 'undefined') return
  Element.prototype.getBoundingClientRect = originalRect
})

let root: Root | null = null
let viewport: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  viewport?.remove()
  root = null
  viewport = null
})

const makeItems = (prefix: string, count: number): Item[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }))

function createViewport(): HTMLDivElement {
  const element = document.createElement('div')
  element.setAttribute('data-test-viewport', '')
  let scrollTop = 0
  Object.defineProperty(element, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => { scrollTop = value },
  })
  document.body.appendChild(element)
  return element
}

async function mount(props: {
  items?: Item[]
  groups?: VirtualListGroup<Item>[]
  keyboardNavigation?: boolean
}): Promise<HTMLDivElement> {
  const element = createViewport()
  viewport = element
  await act(async () => {
    root = createRoot(element)
    root.render(
      React.createElement(VirtualList<Item>, {
        ...props,
        getKey: (item: Item) => item.id,
        estimateRowHeight: ROW_HEIGHT,
        estimateHeaderHeight: HEADER_HEIGHT,
        overscan: OVERSCAN,
        viewportRef: { current: element },
        renderItem: (item: Item) => React.createElement('span', null, item.id),
        renderGroupHeader: (group, headerProps) =>
          React.createElement('div', { ref: headerProps.ref, style: headerProps.style, className: 'sticky' }, group.key),
      }),
    )
  })
  return element
}

const rowKeys = (element: HTMLElement): string[] =>
  Array.from(element.querySelectorAll<HTMLElement>('[data-virtual-row]')).map((row) => row.dataset.virtualRow!)

const headerKeys = (element: HTMLElement): string[] =>
  Array.from(element.querySelectorAll<HTMLElement>('[data-virtual-header]')).map((header) => header.dataset.virtualHeader!)

async function scrollTo(element: HTMLDivElement, top: number): Promise<void> {
  await act(async () => {
    element.scrollTop = top
    element.dispatchEvent(new Event('scroll'))
  })
}

async function press(key: string): Promise<void> {
  await act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

const focusedRow = (): string | undefined =>
  (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-virtual-row]')?.dataset.virtualRow

describe('VirtualList windowing', () => {
  it('renders at most the visible rows plus overscan on both sides for 10,000 rows', async () => {
    const element = await mount({ items: makeItems('i', 10_000) })
    const rows = rowKeys(element)
    // 480px / 48px = 10 visible rows, plus 5 overscan rows below (none above at the top).
    expect(rows.length).toBeLessThanOrEqual(10 + 2 * OVERSCAN)
    expect(rows[0]).toBe('i0')
    expect(rows).toContain('i9')
    expect(rows).not.toContain('i9999')
  })

  it('keeps flattened group headers in order after scrolling between groups', async () => {
    const groups = Array.from({ length: 100 }, (_, group) => ({ key: `g${group}`, items: makeItems(`g${group}-`, 100) }))
    const element = await mount({ groups })
    expect(headerKeys(element)[0]).toBe('g0')

    // Each group is 30 + 100 × 48 = 4830px. Row 98 of g5 starts at
    // 5 × 4830 + 30 + 98 × 48 = 28884, so the viewport shows the end of g5 and
    // the start of g6.
    await scrollTo(element, 28_884)

    expect(headerKeys(element)).toEqual(['g5', 'g6'])
    const rows = rowKeys(element)
    expect(rows).toContain('g5-98')
    expect(rows).toContain('g6-0')
    expect(rows).not.toContain('g0-0')
    expect(rows.every((key) => key.startsWith('g5-') || key.startsWith('g6-'))).toBe(true)
  })
})

describe('VirtualList keyboard navigation', () => {
  it('moves focus to rows outside the mounted window', async () => {
    const element = await mount({ items: makeItems('i', 10_000), keyboardNavigation: true })
    // The window at the top holds rows 0-14 (10 visible + 5 overscan).
    expect(element.querySelector('[data-virtual-row="i15"]')).toBeNull()

    await act(async () => {
      element.querySelector<HTMLElement>('[data-virtual-row="i14"]')!.focus()
    })
    await press('ArrowDown')
    expect(focusedRow()).toBe('i15')

    await press('End')
    expect(focusedRow()).toBe('i9999')

    await press('ArrowUp')
    expect(focusedRow()).toBe('i9998')

    await press('Home')
    expect(focusedRow()).toBe('i0')
  })
})
