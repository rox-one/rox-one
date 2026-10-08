import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { BrowserIntelOptIn as BrowserIntelOptInComponent } from '../BrowserIntelOptIn'
import type { BrowserIntelState } from '@rox/browser-intel'

useDomForFile()

// The UI package pulls browser-only assets and i18n; stub both like the
// sibling onboarding suites so the component renders under Bun.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let BrowserIntelOptIn: typeof BrowserIntelOptInComponent

// Static import cannot work: the component graph must load after the
// browser-only pdfjs/i18n mocks above are registered.
beforeAll(async () => {
  ({ BrowserIntelOptIn } = await import('../BrowserIntelOptIn'))
})

afterEach(() => { resetDom() })

function intelState(consent: boolean): BrowserIntelState {
  return { consent, consentAt: consent ? 1 : null, lastRunAt: null, lastResult: null, error: null, revision: 0 }
}

function setApi(api: Record<string, unknown>): void {
  Object.assign(window, { electronAPI: api })
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

function checkboxOf(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error('checkbox not rendered')
  return input
}

describe('BrowserIntelOptIn', () => {
  it('reads persisted consent and renders unchecked when it is false', async () => {
    const getState = mock(async () => intelState(false))
    setApi({ getBrowserIntelState: getState, setBrowserIntelConsent: mock(async () => intelState(true)) })

    const { container, root } = await render(<BrowserIntelOptIn />)
    await flush()

    expect(getState).toHaveBeenCalledTimes(1)
    expect(checkboxOf(container).checked).toBe(false)
    expect(container.querySelector('[data-testid="browser-intel-opt-in"]')).not.toBeNull()
    await unmount(root)
  })

  it('toggles optimistically, writes once, and reports saving state', async () => {
    const setConsent = mock(async () => intelState(true))
    setApi({ getBrowserIntelState: async () => intelState(false), setBrowserIntelConsent: setConsent })
    const saving: boolean[] = []

    const { container, root } = await render(<BrowserIntelOptIn onSavingChange={(value) => saving.push(value)} />)
    await flush()

    await act(async () => { checkboxOf(container).click() })
    await flush()

    expect(setConsent).toHaveBeenCalledTimes(1)
    expect(setConsent).toHaveBeenCalledWith(true)
    expect(checkboxOf(container).checked).toBe(true)
    expect(saving).toEqual([true, false])
    await unmount(root)
  })

  it('rolls back to unchecked and shows a retryable alert when the write fails', async () => {
    setApi({
      getBrowserIntelState: async () => intelState(false),
      setBrowserIntelConsent: mock(async () => { throw new Error('bridge-unavailable') }),
    })

    const { container, root } = await render(<BrowserIntelOptIn />)
    await flush()

    await act(async () => { checkboxOf(container).click() })
    await flush()

    expect(checkboxOf(container).checked).toBe(false)
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.textContent).toContain('onboarding.browserIntel.savingError')
    expect(container.textContent).toContain('common.retry')
    await unmount(root)
  })
})