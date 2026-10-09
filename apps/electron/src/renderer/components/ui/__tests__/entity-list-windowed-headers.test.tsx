/**
 * Windowed EntityList group headers. The windowed body keeps the header entry
 * that covers the window start mounted and gives its slot the height of the
 * whole group, so the inner `sticky top-0` header stays pinned exactly like in
 * the non-windowed layout. The window/covering math is covered by the kernel
 * tests; here the real component proves the wiring: slot height, click-through
 * slot, ref and pointer events on the inner header.
 */
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { EntityList, type EntityListGroup } from '../entity-list'

useDomForFile()

interface Item {
  id: string
}

let i18n: I18n
beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({ lng: 'en', fallbackLng: 'en', keySeparator: false, resources: { en: { translation: {} } } })
})

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

const items = (prefix: string, count: number): Item[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }))

async function mountList(props: { groups?: EntityListGroup<Item>[]; items?: Item[] }): Promise<HTMLDivElement> {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = document.createElement('div')
  document.body.appendChild(container)
  const viewport = document.createElement('div')
  Object.defineProperty(viewport, 'clientHeight', { value: 2000, configurable: true })
  const host = container
  await act(async () => {
    root = createRoot(host)
    root.render(
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(EntityList<Item>, {
          ...props,
          virtualize: true,
          getKey: (item: Item) => item.id,
          viewportRef: { current: viewport },
          renderItem: (item: Item) => React.createElement('div', null, item.id),
        }),
      ),
    )
  })
  return host
}

const grouped: EntityListGroup<Item>[] = [
  { key: 'g1', label: 'Group one', items: items('a', 30) },
  { key: 'g2', label: 'Group two', items: items('b', 30) },
]

describe('EntityList windowed group headers', () => {
  it('spans the header slot over its whole group and keeps the inner header clickable', async () => {
    const el = await mountList({ groups: grouped })

    const slots = el.querySelectorAll('[data-windowed-header]')
    expect(slots.length).toBeGreaterThan(0)

    const first = slots[0] as HTMLElement
    expect(first.dataset.windowedHeader).toBe('g1')
    // The slot covers the group (30 rows + the next header), not just one row.
    expect(Number.parseFloat(first.style.height)).toBeGreaterThan(30)
    // A tall click-through slot must not swallow clicks meant for the rows or the header.
    expect(first.style.pointerEvents).toBe('none')
    const inner = first.querySelector('.sticky') as HTMLElement | null
    expect(inner).not.toBeNull()
    expect(inner!.style.pointerEvents).toBe('auto')
  })

  it('runs the last group slot to the end of the list', async () => {
    const el = await mountList({ groups: grouped })
    const slots = el.querySelectorAll('[data-windowed-header]')
    const last = slots[slots.length - 1] as HTMLElement
    expect(last.dataset.windowedHeader).toBe('g2')
    expect(Number.parseFloat(last.style.height)).toBeGreaterThan(30)
  })

  it('leaves an ungrouped windowed list without header slots', async () => {
    const el = await mountList({ items: items('u', 60) })
    expect(el.querySelectorAll('[data-windowed-header]')).toHaveLength(0)
  })
})