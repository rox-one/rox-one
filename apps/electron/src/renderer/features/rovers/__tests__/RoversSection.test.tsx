/**
 * RoversSection — read-only «Роверы» catalog inside the Extension Center.
 *
 * window.electronAPI.roversList is stubbed per case; the section renders RU copy
 * through the real i18n bundle (ru is the default language). Asserts the card,
 * the count, the empty and error states, and the absence of any deploy control.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { initReactI18next, setI18n } from 'react-i18next'
import { setupI18n } from '@rox/shared/i18n'
import type { RoversSection as RoversSectionComponent } from '../RoversSection'

useDomForFile()
setI18n(setupI18n([initReactI18next]))

// The @rox/ui barrel pulls browser-only assets (pdfjs);
// stub them like the sibling settings suites.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let RoversSection: typeof RoversSectionComponent

// Static import cannot work: the component graph must load after the
// browser-only pdfjs mocks above are registered.
beforeAll(async () => {
  ;({ RoversSection } = await import('../RoversSection'))
})

afterEach(() => {
  resetDom()
})

const ENTRY = {
  id: 'qdrant',
  name: 'Qdrant',
  category: 'vector-db',
  tagline: { ru: 'Векторная база с фильтрацией', en: 'Vector database with filtering' },
  description: { ru: 'REST и gRPC API для поиска.', en: 'REST and gRPC search API.' },
  icon: 'icons/qdrant.svg',
  spdx: 'Apache-2.0',
  homepage: 'https://qdrant.tech',
  verified: true,
  deploy: { kind: 'none' as const },
}

function setApi(roversList: (() => Promise<{ entries: unknown[] }>) | undefined): void {
  Object.assign(window, { electronAPI: roversList ? { roversList } : {} })
}

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(node)
  })
  await flush()
  return { container, root }
}

async function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await act(async () => {
    await promise
  })
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount()
  })
}

describe('RoversSection', () => {
  it('renders the catalog cards with RU copy and no deploy action', async () => {
    setApi(async () => ({ entries: [ENTRY] }))
    const { container, root } = await render(<RoversSection />)

    expect(container.querySelector('[data-testid="rovers-section"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="rovers-entry-card"]').length).toBe(1)
    const text = container.textContent ?? ''
    expect(text).toContain('Роверы — каталог сервисов')
    expect(text).toContain('Qdrant')
    expect(text).toContain('Векторная база с фильтрацией')
    expect(text).toContain('Векторные базы')
    expect(text).toContain('Проверено Rovers')
    expect(text).toContain('Сервисов: 1')
    expect(container.querySelector('a[href="https://qdrant.tech"]')).not.toBeNull()
    expect(text.toLowerCase()).not.toContain('развернуть')
    await unmount(root)
  })

  it('shows the empty state when the catalog has no entries', async () => {
    setApi(async () => ({ entries: [] }))
    const { container, root } = await render(<RoversSection />)
    expect(container.querySelector('[data-testid="rovers-empty"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="rovers-entry-card"]')).toBeNull()
    expect(container.textContent ?? '').toContain('Каталог Rovers пуст')
    await unmount(root)
  })

  it('shows the error state when the RPC is unavailable', async () => {
    setApi(undefined)
    const { container, root } = await render(<RoversSection />)
    expect(container.querySelector('[data-testid="rovers-error"]')).not.toBeNull()
    expect(container.textContent ?? '').toContain('Не удалось загрузить каталог Rovers')
    await unmount(root)
  })
})