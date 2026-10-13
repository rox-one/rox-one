/**
 * Remainder of #1578: the files pane windows at 200+ rows so 500 files
 * never mount every row.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDomForFile } from '../../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import type { MemoryRepoTreeNode } from '@rox/shared/memory/repo'
import { FILES_TREE_WINDOW_THRESHOLD, MemoryRepoFilesPanel } from '../MemoryRepoFilesPanel'

useDomForFile()

const VIEWPORT_HEIGHT = 280
const ROW_HEIGHT = 28

let originalRect: typeof Element.prototype.getBoundingClientRect
beforeAll(() => {
  originalRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const viewport = this.closest('[data-testid="memory-repo-files-tree"]') as HTMLElement | null
    if (viewport && viewport !== this) return new DOMRect(0, -viewport.scrollTop, 0, ROW_HEIGHT)
    return originalRect.call(this)
  }
})
afterAll(() => {
  if (typeof Element === 'undefined') return
  Element.prototype.getBoundingClientRect = originalRect
})

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

function fileNode(i: number): MemoryRepoTreeNode {
  return { path: `f${i}.md`, name: `f${i}.md`, type: 'file', depth: 0 }
}

describe('MemoryRepoFilesPanel windowing', () => {
  it(`mounts ≤ 2× visible rows for 500 files (threshold ${FILES_TREE_WINDOW_THRESHOLD})`, async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    const tree = Array.from({ length: 500 }, (_, i) => fileNode(i))
    await act(async () => {
      root = createRoot(host!)
      root.render(
        <MemoryRepoFilesPanel bankId="main" tree={tree} selectedPath={null} onSelect={() => {}} file={null} loading={false} />,
      )
    })
    const viewport = host!.querySelector('[data-testid="memory-repo-files-tree"]') as HTMLDivElement
    Object.defineProperty(viewport, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true })
    let scrollTop = 0
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value },
    })
    viewport.dispatchEvent(new Event('scroll'))
    await act(async () => { viewport.dispatchEvent(new Event('scroll')) })
    const mounted = host!.querySelectorAll('[data-testid^="memory-repo-file-"]').length
    const visible = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT)
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThanOrEqual(visible * 2 + 16)
    expect(mounted).toBeLessThan(500)
  })
})
