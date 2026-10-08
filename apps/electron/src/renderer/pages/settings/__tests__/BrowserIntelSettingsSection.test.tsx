/**
 * BrowserIntelSettingsSection — privacy settings slice for the local browser
 * intelligence bridge. i18n resolves keys to key names; window.electronAPI is
 * stubbed per case; interaction runs against happy-dom.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { BrowserIntelSettingsSection as BrowserIntelSettingsSectionComponent } from '../BrowserIntelSettingsSection'
import type {
  BrowserIntelState,
  IntelligenceStats,
  PipelineProgress,
  ProfileSlotRecord,
} from '@rox/browser-intel'

useDomForFile()

// The settings barrel pulls the UI package (browser-only assets) and i18n;
// stub both like the sibling onboarding suites so the component renders here.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let BrowserIntelSettingsSection: typeof BrowserIntelSettingsSectionComponent

// Static import cannot work: the component graph must load after the
// browser-only pdfjs/i18n mocks above are registered.
beforeAll(async () => {
  ({ BrowserIntelSettingsSection } = await import('../BrowserIntelSettingsSection'))
})

afterEach(() => { resetDom() })

let progressCallback: ((progress: PipelineProgress) => void) | null = null
let stateCallback: ((state: BrowserIntelState) => void) | null = null

function intelState(consent: boolean): BrowserIntelState {
  return { consent, consentAt: consent ? 1 : null, lastRunAt: null, lastResult: null, error: null, revision: 0 }
}

function intelStats(): IntelligenceStats {
  return {
    profiles: 3,
    profilesByVendor: [{ vendor: 'chromium', count: 3 }],
    urls: 12,
    urlsPending: 2,
    urlsUnfurled: 9,
    urlsFailed: 1,
    visits: 7,
    bookmarks: 4,
    searches: 5,
    firstVisitAt: 1,
    lastVisitAt: 2,
    unfurlDetails: 8,
    slots: 2,
    dbBytes: 2048,
    lastIngestAt: 1,
    lastUnfurlAt: 2,
  }
}

function slot(slotName: string, confidence: number): ProfileSlotRecord {
  return { slot: slotName, value: {}, confidence, evidence: {}, updatedAt: 1, version: 1, model: null }
}

function progress(current: number, total: number): PipelineProgress {
  return { stage: 'stage', message: 'Staged', current, total, startedAt: 0 }
}

function setApi(api: Record<string, unknown>): void {
  progressCallback = null
  stateCallback = null
  const withEvents = {
    onBrowserIntelProgress: (callback: (value: PipelineProgress) => void) => { progressCallback = callback; return () => {} },
    onBrowserIntelStateChanged: (callback: (value: BrowserIntelState) => void) => { stateCallback = callback; return () => {} },
    ...api,
  }
  Object.assign(window, { electronAPI: withEvents })
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

async function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await act(async () => { await promise })
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === text)
  if (!button) throw new Error(`button not found: ${text}`)
  return button
}

function switchOf(container: HTMLElement): HTMLButtonElement {
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')
  if (!toggle) throw new Error('switch not rendered')
  return toggle
}

describe('BrowserIntelSettingsSection', () => {
  it('renders nothing when the bridge is absent', async () => {
    Object.assign(window, { electronAPI: undefined })
    const { container, root } = await render(<BrowserIntelSettingsSection />)
    await flush()
    expect(container.querySelector('[data-testid="browser-intel-settings"]')).toBeNull()
    expect(container.innerHTML).toBe('')
    await unmount(root)
  })

  it('loads consent, stats and slots and shows the values', async () => {
    setApi({
      getBrowserIntelState: async () => intelState(true),
      getBrowserIntelStats: async () => intelStats(),
      getBrowserIntelSlots: async () => [slot('interests', 0.85)],
    })

    const { container, root } = await render(<BrowserIntelSettingsSection />)
    await flush()

    expect(container.querySelector('[data-testid="browser-intel-settings"]')).not.toBeNull()
    expect(container.querySelector('[data-stat="visits"]')?.textContent).toBe('7')
    expect(container.querySelector('[data-stat="profiles"]')?.textContent).toBe('3')
    expect(container.querySelector('[data-stat="dbSize"]')?.textContent).toBe('2.0 KB')
    expect(container.textContent).toContain('interests')
    expect(container.textContent).toContain('85%')
    expect(container.textContent).toContain('settings.browserIntel.revokeNote')
    await unmount(root)
  })

  it('toggles optimistically and writes consent through the bridge', async () => {
    const setConsent = mock(async () => intelState(true))
    setApi({
      getBrowserIntelState: async () => intelState(false),
      setBrowserIntelConsent: setConsent,
      getBrowserIntelStats: async () => intelStats(),
      getBrowserIntelSlots: async () => [slot('interests', 0.85)],
    })

    const { container, root } = await render(<BrowserIntelSettingsSection />)
    await flush()

    expect(switchOf(container).getAttribute('aria-checked')).toBe('false')
    await act(async () => { switchOf(container).click() })
    await flush()

    expect(setConsent).toHaveBeenCalledTimes(1)
    expect(setConsent).toHaveBeenCalledWith(true)
    expect(switchOf(container).getAttribute('aria-checked')).toBe('true')
    await unmount(root)
  })

  it('starts and cancels a run through the bridge', async () => {
    const start = mock(async () => ({ started: true }))
    const cancel = mock(async () => ({ cancelled: true }))
    setApi({
      getBrowserIntelState: async () => intelState(true),
      startBrowserIntelRun: start,
      cancelBrowserIntelRun: cancel,
      getBrowserIntelStats: async () => intelStats(),
      getBrowserIntelSlots: async () => [slot('interests', 0.85)],
    })

    const { container, root } = await render(<BrowserIntelSettingsSection />)
    await flush()

    await act(async () => { buttonByText(container, 'settings.browserIntel.indexNow').click() })
    await flush()

    expect(start).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('settings.browserIntel.cancelRun')

    await act(async () => { buttonByText(container, 'settings.browserIntel.cancelRun').click() })
    await flush()

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('settings.browserIntel.cancelRun')
    await unmount(root)
  })

  it('shows the live progress row and hides it on the terminal event', async () => {
    setApi({
      getBrowserIntelState: async () => intelState(true),
      getBrowserIntelStats: async () => intelStats(),
      getBrowserIntelSlots: async () => [slot('interests', 0.85)],
    })

    const { container, root } = await render(<BrowserIntelSettingsSection />)
    await flush()

    expect(container.querySelector('[data-testid="browser-intel-progress-live"]')).toBeNull()

    await act(async () => { progressCallback?.(progress(1, 4)) })
    const row = container.querySelector('[data-testid="browser-intel-progress-live"]')
    expect(row).not.toBeNull()
    expect(container.textContent).toContain('onboarding.browserIntel.indexing')
    expect(container.textContent).toContain('onboarding.browserIntel.progress')

    await act(async () => { progressCallback?.(progress(4, 4)) })
    expect(container.querySelector('[data-testid="browser-intel-progress-live"]')).toBeNull()
    await unmount(root)
  })

  it('hides the live progress row when a state change carries a run receipt', async () => {
    setApi({
      getBrowserIntelState: async () => intelState(true),
      getBrowserIntelStats: async () => intelStats(),
      getBrowserIntelSlots: async () => [slot('interests', 0.85)],
    })

    const { container, root } = await render(<BrowserIntelSettingsSection />)
    await flush()

    await act(async () => { progressCallback?.(progress(1, 4)) })
    expect(container.querySelector('[data-testid="browser-intel-progress-live"]')).not.toBeNull()

    await act(async () => {
      stateCallback?.({
        consent: true,
        consentAt: 1,
        lastRunAt: Date.now(),
        lastResult: { profiles: 1, visits: 2, urls: 3, slots: 4, errors: 0 },
        error: null,
        revision: 2,
      })
    })
    expect(container.querySelector('[data-testid="browser-intel-progress-live"]')).toBeNull()
    await unmount(root)
  })
})