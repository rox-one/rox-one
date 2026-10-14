/**
 * EntityList windows automatically above 200 rows (#1578) through the shared
 * VirtualList, while lists of up to 200 rows keep the plain full render. The
 * EntityPanel case proves roving focus still reaches rows outside the window.
 *
 * happy-dom has no layout: the Radix ScrollArea viewport is given a fixed
 * clientHeight so the window size is deterministic.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { EntityList, type EntityListGroup } from '../entity-list'
import { createEntitySelection } from '@/hooks/useEntitySelection'
import type { EntityPanelProps } from '../entity-panel'

useDomForFile()

mock.module('@/actions', () => ({ useAction: () => {} }))

interface Item {
  id: string
}

const VIEWPORT_HEIGHT = 480

let EntityPanel: <T>(props: EntityPanelProps<T>) => React.ReactElement
let i18n: I18n
let clientHeightDescriptor: PropertyDescriptor | undefined
let stubbedScrollIntoView = false

beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({ lng: 'en', fallbackLng: 'en', keySeparator: false, resources: { en: { translation: {} } } })
  EntityPanel = (await import('../entity-panel')).EntityPanel as typeof EntityPanel

  clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-radix-scroll-area-viewport') ? VIEWPORT_HEIGHT : 0
    },
  })
  if (typeof (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView !== 'function') {
    HTMLElement.prototype.scrollIntoView = () => {}
    stubbedScrollIntoView = true
  }
})

afterAll(() => {
  if (typeof HTMLElement === 'undefined') return
  if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor)
  else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  if (stubbedScrollIntoView) delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

const makeItems = (prefix: string, count: number): Item[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }))

async function render(element: React.ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  container = host
  await act(async () => {
    root = createRoot(host)
    root.render(React.createElement(I18nextProvider, { i18n }, element))
  })
  return host
}

function renderList(props: { items?: Item[]; groups?: EntityListGroup<Item>[] }): Promise<HTMLDivElement> {
  return render(
    React.createElement(EntityList<Item>, {
      ...props,
      getKey: (item: Item) => item.id,
      renderItem: (item: Item) => React.createElement('div', { 'data-row': item.id }, item.id),
    }),
  )
}

const renderedRows = (element: HTMLElement): string[] =>
  Array.from(element.querySelectorAll<HTMLElement>('[data-row]')).map((row) => row.dataset.row!)

describe('EntityList automatic windowing', () => {
  it('renders all 200 rows of a 200-row list without windowing wrappers', async () => {
    const element = await renderList({ items: makeItems('r', 200) })
    const rows = renderedRows(element)
    expect(rows).toHaveLength(200)
    expect(rows[0]).toBe('r0')
    expect(rows[199]).toBe('r199')
    expect(element.querySelectorAll('[data-virtual-row]')).toHaveLength(0)
  })

  it('windows a 201-row list', async () => {
    const element = await renderList({ items: makeItems('r', 201) })
    expect(element.querySelectorAll('[data-virtual-row]').length).toBeGreaterThan(0)
    expect(renderedRows(element)).not.toContain('r200')
  })

  it('keeps a 10,000-row grouped list within 2× the visible rows, headers in order', async () => {
    const groups = Array.from({ length: 4 }, (_, group) => ({
      key: `g${group}`,
      label: `Group ${group}`,
      items: makeItems(`g${group}-`, 2500),
    }))
    const element = await renderList({ groups })
    const rows = renderedRows(element)
    // 480px viewport / 48px estimated rows = 10 visible rows.
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(2 * 10)
    expect(rows[0]).toBe('g0-0')
    const headers = Array.from(element.querySelectorAll<HTMLElement>('[data-virtual-header]'))
    expect(headers.map((header) => header.dataset.virtualHeader)).toEqual(['g0'])
    expect(headers[0]!.textContent).toContain('Group 0')
  })
})

describe('EntityPanel above the threshold', () => {
  it('moves roving focus to rows that were outside the window', async () => {
    const items = makeItems('s', 10_000)
    const element = await render(
      React.createElement(EntityPanel<Item>, {
        items,
        getId: (item: Item) => item.id,
        mapItem: (item: Item) => ({ title: item.id }),
        selection: createEntitySelection(),
        onItemClick: () => {},
        selectedId: null,
      }),
    )
    expect(element.querySelectorAll('[role="option"]').length).toBeLessThanOrEqual(2 * 10)
    expect(element.querySelector('#item-s9999')).toBeNull()

    await act(async () => {
      element.querySelector<HTMLElement>('#item-s0')!.focus()
    })
    const press = async (key: string) => {
      await act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
        // Roving focus moves on the next animation frame.
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
    }

    await press('End')
    expect(document.activeElement?.id).toBe('item-s9999')

    await press('ArrowUp')
    expect(document.activeElement?.id).toBe('item-s9998')
  })
})
