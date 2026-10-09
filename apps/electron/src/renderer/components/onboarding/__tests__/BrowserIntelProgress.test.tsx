import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock, type Mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { BrowserIntelProgress as BrowserIntelProgressComponent } from '../BrowserIntelProgress'
import type { BrowserIntelState, PipelineProgress } from '@rox/browser-intel'

useDomForFile()

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let BrowserIntelProgress: typeof BrowserIntelProgressComponent

// Static import cannot work: the component graph must load after the
// browser-only pdfjs/i18n mocks above are registered.
beforeAll(async () => {
  ({ BrowserIntelProgress } = await import('../BrowserIntelProgress'))
})

afterEach(() => { resetDom() })

let progressCallback: ((progress: PipelineProgress) => void) | null = null
let stateCallback: ((state: BrowserIntelState) => void) | null = null

function progress(current: number, total: number): PipelineProgress {
  return { stage: 'stage', message: 'Staged', current, total, startedAt: 0 }
}

function setApi(): { offProgress: Mock<() => void>; offState: Mock<() => void> } {
  progressCallback = null
  stateCallback = null
  const offProgress = mock(() => {})
  const offState = mock(() => {})
  Object.assign(window, {
    electronAPI: {
      onBrowserIntelProgress: (callback: (value: PipelineProgress) => void) => { progressCallback = callback; return offProgress },
      onBrowserIntelStateChanged: (callback: (value: BrowserIntelState) => void) => { stateCallback = callback; return offState },
    },
  })
  return { offProgress, offState }
}

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return { container, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => { root.unmount() })
}

function rowOf(container: HTMLElement): Element | null {
  return container.querySelector('[data-testid="browser-intel-progress"]')
}

describe('BrowserIntelProgress', () => {
  it('renders nothing before a run starts', async () => {
    setApi()
    const { container, root } = await render(<BrowserIntelProgress />)
    expect(rowOf(container)).toBeNull()
    await unmount(root)
  })

  it('shows the row with the percentage from a progress event', async () => {
    setApi()
    const { container, root } = await render(<BrowserIntelProgress />)

    await act(async () => { progressCallback?.(progress(1, 4)) })

    expect(rowOf(container)).not.toBeNull()
    expect(container.textContent).toContain('onboarding.browserIntel.indexing')
    expect(container.textContent).toContain('onboarding.browserIntel.progress')
    const bar = container.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuenow')).toBe('1')
    expect(bar?.getAttribute('aria-valuemin')).toBe('0')
    expect(bar?.getAttribute('aria-valuemax')).toBe('4')
    const fill = bar?.firstElementChild as HTMLElement | undefined
    expect(fill?.style.width).toBe('25%')
    await unmount(root)
  })

  it('hides once a progress event reaches its total', async () => {
    setApi()
    const { container, root } = await render(<BrowserIntelProgress />)

    await act(async () => { progressCallback?.(progress(2, 4)) })
    expect(rowOf(container)).not.toBeNull()

    await act(async () => { progressCallback?.(progress(4, 4)) })
    expect(rowOf(container)).toBeNull()
    await unmount(root)
  })

  it('hides when a completed run receipt arrives', async () => {
    setApi()
    const { container, root } = await render(<BrowserIntelProgress />)

    await act(async () => { progressCallback?.(progress(1, 4)) })
    expect(rowOf(container)).not.toBeNull()

    await act(async () => {
      stateCallback?.({
        consent: true,
        consentAt: 1,
        lastRunAt: Date.now() + 1000,
        lastResult: { profiles: 1, visits: 2, urls: 3, slots: 4, errors: 0 },
        error: null,
        revision: 1,
      })
    })
    expect(rowOf(container)).toBeNull()
    await unmount(root)
  })

  it('unsubscribes both listeners on unmount', async () => {
    const { offProgress, offState } = setApi()
    const { root } = await render(<BrowserIntelProgress />)
    await unmount(root)
    expect(offProgress).toHaveBeenCalledTimes(1)
    expect(offState).toHaveBeenCalledTimes(1)
  })
})