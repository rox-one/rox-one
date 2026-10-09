import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { resetDom, useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import * as React from 'react'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import type { ClipEntryDetail, ClipEntrySummary, ClipListResult, ClipSettings } from '@rox/shared/clipboard-history'
import type { ClipboardHistoryPanel as PanelComponent } from '../ClipboardHistoryPanel'
import type { ClipboardHistoryController } from '../use-clipboard-history'
import type { ClipboardCardProps } from '../ClipboardCard'

useDomForFile()

// Static import cannot work: Bun may evaluate react-dom (CJS) before the shared
// dom-env body installs `document`, which makes React pick its fallback input
// event path and never fire onChange. Import it once the DOM exists.
const { createRoot } = await import('react-dom/client')

// Radix's focus scope walks the DOM with NodeFilter, which the shared happy-dom
// harness does not install; wire it (from the window when available) before any
// dialog can open.
if (typeof (globalThis as { NodeFilter?: unknown }).NodeFilter === 'undefined') {
  const domNodeFilter = (window as unknown as { NodeFilter?: unknown }).NodeFilter
  Object.assign(globalThis, { NodeFilter: domNodeFilter ?? { SHOW_ELEMENT: 1, SHOW_ALL: 0xffffffff } })
}

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ru', resolvedLanguage: 'ru', changeLanguage: async () => {} },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children?: React.ReactNode }) => children ?? null,
}))

// The panel is the only focused surface in these cases.
mock.module(join(__dirname, '../../../lib/usePanelKeyboardGuard.ts'), () => ({
  usePanelKeyboardGuard: () => () => true,
}))

const nowIso = new Date().toISOString()

function entry(id: number, overrides: Partial<ClipEntrySummary> = {}): ClipEntrySummary {
  return {
    id,
    kind: 'text',
    preview: `entry-${id}`,
    text: `entry-${id}`,
    charCount: 7,
    imageFormat: null,
    imageWidth: null,
    imageHeight: null,
    imageByteSize: null,
    thumbDataUrl: null,
    tags: [],
    starred: false,
    createdAt: nowIso,
    sourceApp: null,
    ...overrides,
  }
}

const calls: Array<{ method: string; args: unknown[] }> = []
const defaults: ClipSettings = {
  captureEnabled: true,
  captureImages: true,
  retentionDays: 30,
  maxEntries: 2000,
  hideSensitive: true,
  globalShortcutEnabled: false,
  globalShortcut: 'CommandOrControl+Shift+V',
}

const listClipboardEntries = mock(async (query: unknown): Promise<ClipListResult> => {
  calls.push({ method: 'list', args: [query] })
  return {
    entries: [entry(1), entry(2)],
    total: 2,
    counts: { total: 2, starred: 0, text: 2, image: 0 },
    hasMore: false,
  }
})

/** The per-test default list payload; re-applied in `beforeEach` because
 *  individual cases swap in image-heavy implementations. */
const defaultListImplementation = listClipboardEntries.getMockImplementation()!
const setClipboardEntryStarred = mock(async (id: number, starred: boolean) => {
  calls.push({ method: 'star', args: [id, starred] })
  return { ok: true as const }
})

const getClipboardEntry = mock(async (id: number): Promise<ClipEntryDetail> => ({ ...entry(id), imageDataUrl: null }))

const deleteClipboardEntry = mock(async (id: number) => {
  calls.push({ method: 'delete', args: [id] })
  return { ok: true as const }
})

Object.assign(window, {
  electronAPI: {
    listClipboardEntries,
    getClipboardEntry,
    setClipboardEntryStarred,
    setClipboardEntryTags: mock(async () => ({ ok: true as const })),
    deleteClipboardEntry,
    clearClipboardHistory: mock(async () => ({ removed: 0 })),
    copyClipboardEntry: mock(async (id: number) => { calls.push({ method: 'copy', args: [id] }); return { ok: true as const } }),
    getClipboardSettings: mock(async () => defaults),
    saveClipboardSettings: mock(async (patch: Partial<ClipSettings>) => ({ ...defaults, ...patch })),
    getClipboardTagCounts: mock(async () => []),
    getClipboardStats: mock(async () => ({ total: 2, starred: 0, text: 2, image: 0, bytes: 0, storageBytes: 0, oldestAt: null })),
    onClipboardChanged: mock(() => () => {}),
  },
})

let ClipboardHistoryPanel: typeof PanelComponent

describe('ClipboardHistoryPanel', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeAll(async () => {
    // Static import cannot work: the component module graph must load after the
    // i18n/keyboard-guard mocks above are registered (mock.module is per-process).
    ClipboardHistoryPanel = (await import('../ClipboardHistoryPanel')).ClipboardHistoryPanel
  })

  async function render(): Promise<void> {
    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(ClipboardHistoryPanel))
    })
    // Let the initial list request settle.
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
  }

  beforeEach(async () => {
    calls.length = 0
    listClipboardEntries.mockReset()
    listClipboardEntries.mockImplementation(defaultListImplementation)
    setClipboardEntryStarred.mockClear()
    deleteClipboardEntry.mockClear()
    await render()
  })

  afterEach(async () => {
    const mounted = root
    root = null
    if (mounted) await act(async () => { mounted.unmount() })
    resetDom()
  })

  const lastListQuery = (): Record<string, unknown> | undefined => {
    const list = calls.filter((call) => call.method === 'list').at(-1)
    return list?.args[0] as Record<string, unknown> | undefined
  }

  it('renders a card per entry and switches to the starred tab', async () => {
    expect(document.querySelectorAll('[data-testid="clipboard-card"]').length).toBe(2)

    const starredTab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.includes('clipboard.tab.starred'))
    expect(starredTab).toBeDefined()
    await act(async () => { starredTab!.click() })
    await act(async () => { await Promise.resolve() })

    expect(lastListQuery()?.starredOnly).toBe(true)
  })

  it('debounces the search query before it reaches the API', async () => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="clipboard-search"]')!
    await act(async () => {
      input.focus()
      // React tracks the native value; bypass the tracker with the prototype setter.
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'needle')
      input.dispatchEvent(new window.InputEvent('input', { bubbles: true, data: 'needle' }))
      input.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
    expect(input.value).toBe('needle')
    // Before the debounce window elapses the API has not seen the query.
    expect(lastListQuery()?.q).toBeUndefined()

    // The 150 ms debounce runs on the platform clock, so this one case waits it
    // out deliberately (deterministic fake timers cannot drive React's act queue
    // here and would only move the race).
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 200)
    await act(async () => { await promise })
    await act(async () => { await Promise.resolve() })

    expect(lastListQuery()?.q).toBe('needle')
  })

  it('toggles the star optimistically through the API', async () => {
    const star = document.querySelector<HTMLButtonElement>('[data-testid="clipboard-card-star"]')!
    await act(async () => { star.click() })
    await act(async () => { await Promise.resolve() })

    expect(setClipboardEntryStarred.mock.calls[0]).toEqual([1, true])
  })

  it('opens quick look on Space after selecting a card', async () => {
    const card = document.querySelector<HTMLElement>('[data-testid="clipboard-card"]')!
    await act(async () => { card.click() })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })

    expect(document.querySelector('[data-testid="clipboard-quick-look"]')).not.toBeNull()
  })

  it('renders the keyboard hint footer with the search chord interpolated', async () => {
    const hint = document.querySelector('[data-testid="clipboard-keys-hint"]')
    expect(hint).not.toBeNull()
    expect(hint?.textContent).toContain('clipboard.screen.keysHint')
  })

  it('renders the char count through the shared clipboard.charCount key', async () => {
    const card = document.querySelector<HTMLElement>('[data-testid="clipboard-card"]')!
    await act(async () => { card.click() })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    await act(async () => { await Promise.resolve() })

    const details = document.querySelector('[data-testid="clipboard-quick-look-details"]')
    expect(details?.textContent).toContain('clipboard.charCount')
  })

  it('filters by image format through the list query', async () => {
    listClipboardEntries.mockImplementation(async (query: unknown) => {
      calls.push({ method: 'list', args: [query] })
      return {
        entries: [entry(1, { kind: 'image', imageFormat: 'png', thumbDataUrl: 'data:image/png;base64,AAAA' })],
        total: 1,
        counts: { total: 1, starred: 0, text: 0, image: 1 },
        hasMore: false,
      }
    })
    const refresh = document.querySelector<HTMLButtonElement>('[data-testid="clipboard-refresh"]')!
    await act(async () => { refresh.click() })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    const row = document.querySelector('[data-testid="clipboard-format-filter"]')
    expect(row).not.toBeNull()
    const png = Array.from(row!.querySelectorAll<HTMLButtonElement>('button'))
      .find((chip) => chip.textContent === 'PNG')
    expect(png).toBeDefined()
    await act(async () => { png!.click() })
    await act(async () => { await Promise.resolve() })

    expect(lastListQuery()?.format).toBe('png')
  })

  it('confirms before deleting a single entry', async () => {
    const del = document.querySelector<HTMLButtonElement>('[data-testid="clipboard-card-delete"]')!
    await act(async () => { del.click() })

    expect(document.querySelector('[data-testid="clipboard-delete-confirm"]')).not.toBeNull()
    expect(deleteClipboardEntry.mock.calls.length).toBe(0)
    expect(document.querySelectorAll('[data-testid="clipboard-card"]').length).toBe(2)

    const confirm = document.querySelector<HTMLButtonElement>('[data-testid="clipboard-delete-confirm"]')!
    await act(async () => { confirm.click() })
    await act(async () => { await Promise.resolve() })

    expect(deleteClipboardEntry.mock.calls[0]?.[0]).toBe(1)
  })
})

describe('ClipboardCard badges', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let Card: React.ComponentType<ClipboardCardProps>

  beforeAll(async () => {
    // The mock.module calls above must register before this module graph loads.
    Card = (await import('../ClipboardCard')).ClipboardCard
  })

  afterEach(async () => {
    const mounted = root
    root = null
    if (mounted) await act(async () => { mounted.unmount() })
    resetDom()
  })

  async function renderCard(summary: ClipEntrySummary): Promise<HTMLElement> {
    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(Card, {
        entry: summary,
        selected: false,
        now: Date.now(),
        onSelect: () => {},
        onCopy: () => {},
        onToggleStar: () => {},
        onDelete: () => {},
        onPreview: () => {},
        onEditTags: () => {},
      }))
    })
    return container.querySelector<HTMLElement>('[data-testid="clipboard-card"]')!
  }

  it('never labels a text entry as an image', async () => {
    const card = await renderCard(entry(1))
    expect(card.textContent).not.toContain('clipboard.image.label')
  })

  it('badges an image entry with its format, not the generic label', async () => {
    const card = await renderCard(entry(1, { kind: 'image', imageFormat: 'png', thumbDataUrl: 'data:image/png;base64,AAAA' }))
    expect(card.textContent).toContain('PNG')
    expect(card.textContent).not.toContain('clipboard.image.label')
  })
})

describe('useClipboardHistory paging and quick look', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let controller: ClipboardHistoryController | null = null
  let useClipboardHistory: () => ClipboardHistoryController

  beforeAll(async () => {
    // The mock.module calls above must register before this module graph loads.
    useClipboardHistory = (await import('../use-clipboard-history')).useClipboardHistory
  })

  const flush = async () => {
    // Drain the promise chain (then → finally → setState) without real timers.
    await act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
    })
  }

  function Probe() {
    controller = useClipboardHistory()
    return React.createElement('div', {
      'data-testid': 'clipboard-hook-probe',
      'data-count': String(controller.entries.length),
      'data-detail-id': controller.detail ? String(controller.detail.id) : '',
    })
  }

  async function mount(): Promise<void> {
    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(Probe))
    })
    await flush()
  }

  afterEach(async () => {
    const mounted = root
    root = null
    controller = null
    if (mounted) await act(async () => { mounted.unmount() })
    resetDom()
  })

  it('pages by real offset: the second page uses offset 50 and three pages yield 150 entries', async () => {
    const pageQueries: Array<Record<string, unknown>> = []
    listClipboardEntries.mockImplementation(async (query: unknown) => {
      const typed = (query ?? {}) as Record<string, unknown>
      pageQueries.push(typed)
      const offset = Number(typed.offset ?? 0)
      return {
        entries: Array.from({ length: 50 }, (_, index) => entry(offset + index + 1)),
        total: 150,
        counts: { total: 150, starred: 0, text: 150, image: 0 },
        hasMore: offset + 50 < 150,
      }
    })

    await mount()
    expect(controller!.entries.length).toBe(50)
    expect(controller!.hasMore).toBe(true)
    expect(pageQueries.at(-1)?.offset).toBe(0)

    await act(async () => { controller!.loadMore() })
    await flush()
    expect(pageQueries.at(-1)?.offset).toBe(50)
    expect(controller!.entries.length).toBe(100)

    await act(async () => { controller!.loadMore() })
    await flush()
    expect(pageQueries.at(-1)?.offset).toBe(100)
    expect(controller!.entries.length).toBe(150)
    expect(controller!.hasMore).toBe(false)
  })

  it('stops the sentinel honestly when the store reports no more rows', async () => {
    listClipboardEntries.mockImplementation(async (query: unknown) => {
      const offset = Number(((query ?? {}) as Record<string, unknown>).offset ?? 0)
      return {
        entries: Array.from({ length: 50 }, (_, index) => entry(offset + index + 1)),
        total: 500,
        counts: { total: 500, starred: 0, text: 500, image: 0 },
        hasMore: false,
      }
    })

    await mount()
    expect(controller!.entries.length).toBe(50)
    expect(controller!.hasMore).toBe(false)
  })

  it('clears the previous detail and ignores a superseded quick-look response', async () => {
    listClipboardEntries.mockImplementation(async () => ({
      entries: [entry(1), entry(2)],
      total: 2,
      counts: { total: 2, starred: 0, text: 2, image: 0 },
      hasMore: false,
    }))
    const pending = new Map<number, (detail: ClipEntryDetail) => void>()
    getClipboardEntry.mockImplementation(async (id: number): Promise<ClipEntryDetail> => {
      const { promise, resolve } = Promise.withResolvers<ClipEntryDetail>()
      pending.set(id, resolve)
      return promise
    })

    await mount()
    expect(controller!.detail).toBeNull()

    await act(async () => { controller!.openQuickLook(2) })
    expect(controller!.quickLookId).toBe(2)
    expect(controller!.detail).toBeNull()

    await act(async () => { controller!.openQuickLook(3) })
    expect(controller!.quickLookId).toBe(3)

    // The superseded id resolves late: its detail must never surface.
    await act(async () => {
      pending.get(2)?.({ ...entry(2), imageDataUrl: null })
      await Promise.resolve()
    })
    expect(controller!.detail).toBeNull()

    await act(async () => {
      pending.get(3)?.({ ...entry(3), imageDataUrl: null })
      await Promise.resolve()
    })
    await flush()
    expect(controller!.detail?.id).toBe(3)
  })
})