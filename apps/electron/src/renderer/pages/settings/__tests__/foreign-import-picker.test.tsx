import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { FOREIGN_IMPORT_ROW_HEIGHT, ForeignImportPickerList, type ForeignImportPickerRow } from '../foreign-import-picker'

useDomForFile()

const VIEWPORT_HEIGHT = 320

let originalRect: typeof Element.prototype.getBoundingClientRect
beforeAll(() => {
  originalRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const viewport = this.closest('[data-test-viewport]') as HTMLElement | null
    if (viewport && viewport !== this) return new DOMRect(0, -viewport.scrollTop, 0, FOREIGN_IMPORT_ROW_HEIGHT)
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

describe('ForeignImportPickerList', () => {
  it('mounts ≤ 2× visible rows for 5k fixtures', async () => {
    const rows: ForeignImportPickerRow[] = Array.from({ length: 5000 }, (_, i) => ({
      sourcePath: `/tmp/${i}`,
      kind: 'claude-code',
      title: `c${i}`,
      userTurns: 1,
    }))
    const element = document.createElement('div')
    element.setAttribute('data-test-viewport', '')
    Object.defineProperty(element, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true })
    let scrollTop = 0
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value },
    })
    document.body.appendChild(element)
    viewport = element
    await act(async () => {
      root = createRoot(element)
      root.render(
        <ForeignImportPickerList
          rows={rows}
          selected={{}}
          onToggle={() => {}}
          viewportRef={{ current: element }}
        />,
      )
    })
    const mounted = element.querySelectorAll('[role="option"]').length
    const visible = Math.ceil(VIEWPORT_HEIGHT / FOREIGN_IMPORT_ROW_HEIGHT)
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThanOrEqual(visible * 2)
    expect(mounted).toBeLessThan(5000)
  })
})
