/**
 * CookbooksSurfacePage — the native «Кукбуки» surface (SPEC Amendment 1).
 *
 * Covers every honest runtime state, the two-pane catalog + document UI, the
 * per-cell and run-all execution paths, save/reset/new-copy, the missing-key
 * banner and the busy indicator. Strings are compared through the same i18n
 * instance the page uses, so a missing translation or a wrong interpolation
 * parameter fails here rather than silently rendering the raw key.
 *
 * Harness mirrors the sibling suites: happy-dom globals via `useDomForFile`,
 * the real RU i18n bundle through `setupI18n`, and `react-dom/client` imported
 * after the DOM exists.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { initReactI18next, setI18n } from 'react-i18next'
import { setupI18n } from '@rox/shared/i18n'
import type {
  CookbooksCard,
  CookbooksDocument,
  CookbooksRunCell,
  CookbooksRunResult,
  CookbooksStatus,
} from '../../../../shared/cookbooks'
import type { CookbooksSurfacePage as CookbooksSurfacePageComponent } from '../CookbooksSurfacePage'

useDomForFile()
const i18n = setupI18n([initReactI18next])
setI18n(i18n)

const t = (key: string, params?: Record<string, unknown>): string => i18n.t(key, params) as string

let CookbooksSurfacePage: typeof CookbooksSurfacePageComponent
let mounted: Root | null = null

// Static import cannot work here: React DOM must load after `useDomForFile()`
// installs the happy-dom globals, and the page pulls React DOM in its graph.
beforeAll(async () => {
  ;({ default: CookbooksSurfacePage } = await import('../CookbooksSurfacePage'))
})

afterEach(async () => {
  // Unmount while the happy-dom globals are still installed: a still-mounted
  // root would flush pending work after `uninstallDom()` and crash React.
  if (mounted) {
    const root = mounted
    mounted = null
    await act(async () => {
      root.unmount()
    })
  }
  resetDom()
})

beforeEach(() => {
  Reflect.deleteProperty(window, 'electronAPI')
})

// ---------------------------------------------------------------------------
// Fixtures — the catalog really has 13 entries; the mocks keep three so the
// filter and the counters are checkable.
// ---------------------------------------------------------------------------

const CARDS: CookbooksCard[] = [
  {
    id: 'rox-analytics',
    title: 'ROX Analytics',
    vendor: 'ROX',
    kind: 'ipynb',
    secretsHave: ['ROX_API_KEY'],
    secretsMissing: [],
    disabled: false,
    disabledReason: null,
  },
  {
    id: 'churn-playbook',
    title: 'Churn playbook',
    vendor: 'Growth',
    kind: 'md',
    secretsHave: [],
    secretsMissing: ['ROX_WORKSPACE_ID'],
    disabled: false,
    disabledReason: null,
  },
  {
    id: 'legacy-lab',
    title: 'Legacy lab',
    vendor: 'ROX',
    kind: 'ipynb',
    secretsHave: [],
    secretsMissing: [],
    disabled: true,
    disabledReason: 'file missing',
  },
]

const NOTEBOOK: CookbooksDocument = {
  itemId: 'rox-analytics',
  kind: 'ipynb',
  title: 'ROX Analytics',
  supported: true,
  missing: [],
  // Cell 0 is markdown on purpose: every catalog notebook opens with one, and a
  // markdown entry must never reach `run-all` (the sidecar answers 400 for it).
  cells: [
    { cellType: 'markdown', source: '# Заметка', outputs: [] },
    { cellType: 'code', source: 'print(1)', outputs: [] },
    { cellType: 'code', source: 'raise ValueError("boom")', outputs: [] },
    { cellType: 'code', source: 'print(3)', outputs: [] },
  ],
  text: null,
}

const PLAYBOOK: CookbooksDocument = {
  itemId: 'churn-playbook',
  kind: 'md',
  title: 'Churn playbook',
  supported: true,
  missing: [],
  cells: [],
  text: '# Churn\nШаги плейбука',
}

/** Document served when a test opens an item it did not pre-register. */
const FALLBACK_DOC: CookbooksDocument = {
  itemId: 'fallback',
  kind: 'ipynb',
  title: 'Fallback',
  supported: true,
  missing: [],
  cells: [],
  text: null,
}

const RUN_OK: CookbooksRunResult = { ok: true, stdout: '42\n', error: null, timedOut: false, missing: [] }
const RUN_ERROR: CookbooksRunResult = {
  ok: false,
  stdout: '',
  error: 'ValueError: boom',
  timedOut: false,
  missing: [],
}

/** `run-all` never sees the markdown cell; execution stops at the first failure. */
const RUN_ALL: CookbooksRunCell[] = [
  { index: 1, status: 'ok', stdout: 'ok-1', error: null },
  { index: 2, status: 'error', stdout: '', error: 'ValueError: boom' },
  { index: 3, status: 'skipped', stdout: '', error: null },
]

/** The exact payload `run-all` must send: code cells only, document indices kept. */
const RUN_ALL_PAYLOAD = [
  { index: 1, source: 'print(1)' },
  { index: 2, source: 'raise ValueError("boom")' },
  { index: 3, source: 'print(3)' },
]

// ---------------------------------------------------------------------------
// window.electronAPI.cookbooksLab double
// ---------------------------------------------------------------------------

interface OpenCall {
  itemId: string
  newCopy?: boolean
}
interface RunCall {
  itemId: string
  code: string
  index: number
}
interface RunAllCall {
  itemId: string
  cells: { index: number; source: string }[]
}
interface SaveCall {
  itemId: string
  index?: number
  source?: string
  text?: string
}
interface ItemCall {
  itemId: string
}

interface ApiModel {
  status: CookbooksStatus
  cards?: CookbooksCard[]
  documents?: Record<string, CookbooksDocument>
  run?: (call: RunCall) => Promise<CookbooksRunResult>
  runAll?: (call: RunAllCall) => Promise<{ cells: CookbooksRunCell[] }>
}

interface ApiCounts {
  ensure: number
  status: number
  restart: number
  catalog: number
  open: OpenCall[]
  document: ItemCall[]
  run: RunCall[]
  runAll: RunAllCall[]
  save: SaveCall[]
  reset: ItemCall[]
}

function installApi(model: ApiModel) {
  const counts: ApiCounts = {
    ensure: 0,
    status: 0,
    restart: 0,
    catalog: 0,
    open: [],
    document: [],
    run: [],
    runAll: [],
    save: [],
    reset: [],
  }
  const listeners = new Set<(status: CookbooksStatus) => void>()
  const documents = new Map(Object.entries(model.documents ?? {}))
  const docFor = (itemId: string): CookbooksDocument => documents.get(itemId) ?? { ...FALLBACK_DOC, itemId }

  const api = {
    ensure: async () => {
      counts.ensure += 1
      return model.status
    },
    status: async () => {
      counts.status += 1
      return model.status
    },
    restart: async () => {
      counts.restart += 1
      return model.status
    },
    catalog: async () => {
      counts.catalog += 1
      return model.cards ?? []
    },
    open: async (call: OpenCall) => {
      counts.open.push(call)
      return { copyId: `${call.itemId}-copy`, document: docFor(call.itemId) }
    },
    document: async (call: ItemCall) => {
      counts.document.push(call)
      return docFor(call.itemId)
    },
    run: async (call: RunCall) => {
      counts.run.push(call)
      return model.run ? model.run(call) : RUN_OK
    },
    runAll: async (call: RunAllCall) => {
      counts.runAll.push(call)
      return model.runAll ? model.runAll(call) : { cells: RUN_ALL }
    },
    save: async (call: SaveCall) => {
      counts.save.push(call)
    },
    reset: async (call: ItemCall) => {
      counts.reset.push(call)
    },
    onStatusChanged: (callback: (status: CookbooksStatus) => void) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
  }

  Object.assign(window, { electronAPI: { cookbooksLab: api } })
  return {
    counts,
    emitStatus: (status: CookbooksStatus) => {
      for (const listener of listeners) listener(status)
    },
  }
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 0)
    await act(async () => {
      await promise
    })
  }
}

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted = root
  await act(async () => {
    root.render(React.createElement(CookbooksSurfacePage))
  })
  await flush()
  return container
}

const surface = (container: HTMLElement) => container.querySelector('[data-testid="cookbooks-surface"]')
const testId = (container: HTMLElement, id: string) => container.querySelector(`[data-testid="${id}"]`)
const allTestIds = (container: HTMLElement, prefix: string) =>
  Array.from(container.querySelectorAll(`[data-testid^="${prefix}"]`))

async function click(container: HTMLElement, id: string): Promise<void> {
  const element = testId(container, id) as HTMLElement | null
  if (!element) throw new Error(`missing ${id}`)
  await act(async () => {
    element.click()
  })
  await flush()
}

/** Drives a controlled input/textarea the way the sibling renderer suites do. */
function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set
  field.focus()
  setter?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }))
}

async function type(container: HTMLElement, id: string, value: string): Promise<void> {
  const field = testId(container, id) as HTMLInputElement | null
  if (!field) throw new Error(`missing ${id}`)
  await act(async () => {
    typeInto(field, value)
  })
  await flush()
}

function stubConfirm(answer: boolean): { calls: string[] } {
  const calls: string[] = []
  Object.defineProperty(window, 'confirm', {
    configurable: true,
    writable: true,
    value: (message?: string) => {
      calls.push(String(message))
      return answer
    },
  })
  return { calls }
}

/** Ready page with the catalog loaded and the notebook open. */
async function renderNotebook(model: Partial<ApiModel> = {}) {
  const api = installApi({ status: { state: 'running', reason: null, port: 51234 }, cards: CARDS, documents: { 'rox-analytics': NOTEBOOK }, ...model })
  const container = await render()
  await click(container, 'cookbooks-card-rox-analytics')
  return { api, container }
}

// ---------------------------------------------------------------------------
// Runtime states
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage runtime states', () => {
  it('starting renders the preparing copy plus a text-bearing spinner', async () => {
    installApi({ status: { state: 'starting', reason: null, port: null } })
    const container = await render()
    expect(surface(container)?.getAttribute('data-state')).toBe('starting')
    const spinner = testId(container, 'cookbooks-spinner')
    expect(spinner).not.toBeNull()
    expect(spinner!.textContent?.trim()).toBeTruthy()
    expect(container.textContent).toContain('Готовим кукбуки')
  })

  it('failed(python-missing) renders the unavailable state with a retry control', async () => {
    installApi({ status: { state: 'failed', reason: 'python-missing', port: null } })
    const container = await render()
    expect(surface(container)?.getAttribute('data-state')).toBe('unavailable')
    expect(surface(container)?.getAttribute('data-reason')).toBe('python-missing')
    expect(container.textContent).toContain('Не найден Python')
    expect(testId(container, 'cookbooks-retry')).not.toBeNull()
  })

  it('failed(crashed) renders the failed state with a retry control', async () => {
    installApi({ status: { state: 'failed', reason: 'crashed', port: null } })
    const container = await render()
    expect(surface(container)?.getAttribute('data-state')).toBe('failed')
    expect(container.textContent).toContain('Среда кукбуков не запустилась')
    expect(testId(container, 'cookbooks-retry')).not.toBeNull()
  })

  it('stopped renders the stopped state with a retry control', async () => {
    installApi({ status: { state: 'stopped', reason: null, port: null } })
    const container = await render()
    expect(surface(container)?.getAttribute('data-state')).toBe('stopped')
    expect(testId(container, 'cookbooks-retry')).not.toBeNull()
  })

  it('«Повторить» restarts the runtime', async () => {
    const api = installApi({ status: { state: 'failed', reason: 'crashed', port: null } })
    const container = await render()
    await click(container, 'cookbooks-retry')
    expect(api.counts.restart).toBe(1)
  })

  it('renders the ready surface from a pushed status change', async () => {
    const api = installApi({ status: { state: 'starting', reason: null, port: null } })
    const container = await render()
    expect(surface(container)?.getAttribute('data-state')).toBe('starting')
    await act(async () => {
      api.emitStatus({ state: 'running', reason: null, port: 51234 })
    })
    await flush()
    expect(surface(container)?.getAttribute('data-state')).toBe('ready')
  })
})

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage catalog', () => {
  it('loads the catalog once running, renders the counter and the cards', async () => {
    const api = installApi({ status: { state: 'running', reason: null, port: 51234 }, cards: CARDS })
    const container = await render()
    expect(surface(container)?.getAttribute('data-state')).toBe('ready')
    expect(api.counts.catalog).toBe(1)
    expect(allTestIds(container, 'cookbooks-card-')).toHaveLength(3)
    expect(testId(container, 'cookbooks-catalog-count')?.textContent).toBe(t('cookbooks.catalog.count', { count: 3 }))
    expect(container.textContent).toContain('ROX Analytics')
    expect(container.textContent).toContain('Growth')
  })

  it('renders kind pills, key chips with status dots and the disabled reason', async () => {
    installApi({ status: { state: 'running', reason: null, port: 51234 }, cards: CARDS })
    const container = await render()
    const notebookCard = testId(container, 'cookbooks-card-rox-analytics')!
    expect(notebookCard.getAttribute('data-kind')).toBe('ipynb')
    expect(notebookCard.textContent).toContain(t('cookbooks.card.kindNotebook'))
    expect(testId(container, 'cookbooks-card-churn-playbook')!.textContent).toContain(t('cookbooks.card.kindPlaybook'))

    expect(testId(container, 'cookbooks-keys-have-rox-analytics')?.textContent).toContain(t('cookbooks.card.keysHave'))
    expect(testId(container, 'cookbooks-keys-missing-churn-playbook')?.textContent).toContain(
      t('cookbooks.card.keysMissing'),
    )

    const disabled = testId(container, 'cookbooks-card-legacy-lab') as HTMLButtonElement
    expect(disabled.disabled).toBe(true)
    expect(testId(container, 'cookbooks-reason-legacy-lab')?.textContent).toBe(t('cookbooks.card.fileMissing'))
  })

  it('filters the catalog client-side and updates the counter', async () => {
    installApi({ status: { state: 'running', reason: null, port: 51234 }, cards: CARDS })
    const container = await render()
    await type(container, 'cookbooks-filter', 'churn')
    expect(allTestIds(container, 'cookbooks-card-')).toHaveLength(1)
    expect(testId(container, 'cookbooks-card-churn-playbook')).not.toBeNull()
    expect(testId(container, 'cookbooks-catalog-count')?.textContent).toBe(t('cookbooks.catalog.count', { count: 1 }))

    await type(container, 'cookbooks-filter', 'ROX')
    expect(allTestIds(container, 'cookbooks-card-')).toHaveLength(2)
  })

  it('opens a card into the document pane and reports «Открыто»', async () => {
    const api = installApi({
      status: { state: 'running', reason: null, port: 51234 },
      cards: CARDS,
      documents: { 'rox-analytics': NOTEBOOK },
    })
    const container = await render()
    await click(container, 'cookbooks-card-rox-analytics')

    expect(api.counts.open).toHaveLength(1)
    expect(api.counts.open[0]).toEqual({ itemId: 'rox-analytics' })
    expect(testId(container, 'cookbooks-document')).not.toBeNull()
    expect(testId(container, 'cookbooks-document-title')?.textContent).toBe('ROX Analytics')
    expect(testId(container, 'cookbooks-status')?.textContent).toContain(t('cookbooks.status.opened'))

    expect(allTestIds(container, 'cookbooks-cell-')).toHaveLength(4)
    const source = testId(container, 'cookbooks-source-1') as HTMLTextAreaElement
    expect(source.value).toBe('print(1)')
    expect(source.getAttribute('aria-label')).toBe(t('cookbooks.cell.sourceLabel', { index: 1 }))
    expect(testId(container, 'cookbooks-output-1')?.textContent).toBe(t('cookbooks.output.hint'))
  })
})

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage execution', () => {
  it('runs one cell: sends the edited source and renders the output with its status', async () => {
    const api = installApi({
      status: { state: 'running', reason: null, port: 51234 },
      cards: CARDS,
      documents: { 'rox-analytics': NOTEBOOK },
      run: async () => RUN_OK,
    })
    const container = await render()
    await click(container, 'cookbooks-card-rox-analytics')
    await click(container, 'cookbooks-run-1')

    expect(api.counts.run).toHaveLength(1)
    expect(api.counts.run[0]).toEqual({ itemId: 'rox-analytics', code: 'print(1)', index: 1 })

    const output = testId(container, 'cookbooks-output-1')!
    expect(output.getAttribute('data-status')).toBe('ok')
    expect(output.getAttribute('aria-label')).toBe(t('cookbooks.cell.outputLabel', { index: 1 }))
    expect(output.textContent).toContain('42')
    expect(testId(container, 'cookbooks-status')?.textContent).toContain(t('cookbooks.status.cellOk', { index: 1 }))
  })

  it('renders a failing cell with data-status="error" and the failure copy', async () => {
    installApi({
      status: { state: 'running', reason: null, port: 51234 },
      cards: CARDS,
      documents: { 'rox-analytics': NOTEBOOK },
      run: async () => RUN_ERROR,
    })
    const container = await render()
    await click(container, 'cookbooks-card-rox-analytics')
    await click(container, 'cookbooks-run-2')

    const output = testId(container, 'cookbooks-output-2')!
    expect(output.getAttribute('data-status')).toBe('error')
    expect(output.textContent).toContain('ValueError: boom')
    expect(testId(container, 'cookbooks-status')?.textContent).toContain(t('cookbooks.status.cellError', { index: 2 }))
  })

  it('runs all code cells: skips markdown in the payload and renders skipped/error outputs', async () => {
    const api = installApi({
      status: { state: 'running', reason: null, port: 51234 },
      cards: CARDS,
      documents: { 'rox-analytics': NOTEBOOK },
    })
    const container = await render()
    await click(container, 'cookbooks-card-rox-analytics')
    await click(container, 'cookbooks-run-all')

    expect(api.counts.runAll).toHaveLength(1)
    expect(api.counts.runAll[0].itemId).toBe('rox-analytics')
    // Code cells only, with their own document indices: a markdown entry makes
    // the sidecar answer 400 and would break «Запустить всё» for every notebook.
    expect(api.counts.runAll[0].cells).toEqual(RUN_ALL_PAYLOAD)
    expect(api.counts.runAll[0].cells.some((cell) => cell.index === 0)).toBe(false)

    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('ok')
    expect(testId(container, 'cookbooks-output-1')!.textContent).toContain('ok-1')
    expect(testId(container, 'cookbooks-output-2')!.getAttribute('data-status')).toBe('error')
    expect(testId(container, 'cookbooks-output-2')!.textContent).toContain('ValueError: boom')
    expect(testId(container, 'cookbooks-output-3')!.getAttribute('data-status')).toBe('skipped')
    expect(testId(container, 'cookbooks-output-3')!.textContent).toBe(t('cookbooks.output.skipped'))
    // The markdown cell was never executed, so it keeps the pre-run hint.
    expect(testId(container, 'cookbooks-output-0')!.getAttribute('data-status')).toBe('idle')
    expect(testId(container, 'cookbooks-status')?.textContent).toContain(
      t('cookbooks.status.runAll', { count: 3, ok: 1, failed: 1, skipped: 1 }),
    )
  })

  it('shows an empty-output placeholder when a successful cell prints nothing', async () => {
    installApi({
      status: { state: 'running', reason: null, port: 51234 },
      cards: CARDS,
      documents: { 'rox-analytics': NOTEBOOK },
      run: async () => ({ ok: true, stdout: '', error: null, timedOut: false, missing: [] }),
    })
    const container = await render()
    await click(container, 'cookbooks-card-rox-analytics')
    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-output-1')!.textContent).toBe(t('cookbooks.output.empty'))
  })

  it('disables the acting control and shows the running status while a cell runs', async () => {
    const gate = Promise.withResolvers<CookbooksRunResult>()
    installApi({
      status: { state: 'running', reason: null, port: 51234 },
      cards: CARDS,
      documents: { 'rox-analytics': NOTEBOOK },
      run: () => gate.promise,
    })
    const container = await render()
    await click(container, 'cookbooks-card-rox-analytics')

    await act(async () => {
      ;(testId(container, 'cookbooks-run-1') as HTMLButtonElement).click()
    })
    await flush(1)

    expect((testId(container, 'cookbooks-run-1') as HTMLButtonElement).disabled).toBe(true)
    expect(testId(container, 'cookbooks-status')?.textContent).toContain(t('cookbooks.status.running'))

    await act(async () => {
      gate.resolve(RUN_OK)
      await gate.promise
    })
    await flush()
    expect((testId(container, 'cookbooks-run-1') as HTMLButtonElement).disabled).toBe(false)
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// Saving, reset, copies, playbooks
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage mutations', () => {
  it('saves an edited cell and reports «Ячейка N сохранена»', async () => {
    const api = await renderNotebook()
    await type(api.container, 'cookbooks-source-1', 'print(2)')
    await click(api.container, 'cookbooks-save-1')

    expect(api.api.counts.save).toHaveLength(1)
    expect(api.api.counts.save[0]).toEqual({ itemId: 'rox-analytics', index: 1, source: 'print(2)' })
    expect(testId(api.container, 'cookbooks-status')?.textContent).toContain(
      t('cookbooks.status.cellSaved', { index: 1 }),
    )
  })

  it('resets to the original after confirmation and re-reads the document', async () => {
    const confirm = stubConfirm(true)
    const api = await renderNotebook()
    await click(api.container, 'cookbooks-reset')

    expect(confirm.calls).toEqual([t('cookbooks.reset.confirm')])
    expect(api.api.counts.reset).toEqual([{ itemId: 'rox-analytics' }])
    expect(api.api.counts.document).toEqual([{ itemId: 'rox-analytics' }])
    expect(testId(api.container, 'cookbooks-status')?.textContent).toContain(t('cookbooks.status.reset'))
  })

  it('leaves the copy untouched when reset is declined', async () => {
    stubConfirm(false)
    const api = await renderNotebook()
    await click(api.container, 'cookbooks-reset')
    expect(api.api.counts.reset).toHaveLength(0)
  })

  it('opens a fresh copy on «Новая копия»', async () => {
    const api = await renderNotebook()
    await click(api.container, 'cookbooks-new-copy')

    expect(api.api.counts.open).toHaveLength(2)
    expect(api.api.counts.open[1]).toEqual({ itemId: 'rox-analytics', newCopy: true })
    expect(testId(api.container, 'cookbooks-status')?.textContent).toContain(t('cookbooks.status.newCopy'))
  })

  it('renders a playbook as one textarea and saves its text', async () => {
    const api = installApi({
      status: { state: 'running', reason: null, port: 51234 },
      cards: CARDS,
      documents: { 'churn-playbook': PLAYBOOK },
    })
    const container = await render()
    await click(container, 'cookbooks-card-churn-playbook')

    const text = testId(container, 'cookbooks-playbook-text') as HTMLTextAreaElement
    expect(text.getAttribute('aria-label')).toBe(t('cookbooks.playbook.textLabel'))
    expect(text.value).toBe('# Churn\nШаги плейбука')
    expect(allTestIds(container, 'cookbooks-cell-')).toHaveLength(0)
    // A playbook has no runnable cells, so the notebook-only action is absent.
    expect(testId(container, 'cookbooks-run-all')).toBeNull()

    await type(container, 'cookbooks-playbook-text', '# Churn\nПравка')
    await click(container, 'cookbooks-playbook-save')
    expect(api.counts.save).toEqual([{ itemId: 'churn-playbook', text: '# Churn\nПравка' }])
    expect(testId(container, 'cookbooks-status')?.textContent).toContain(t('cookbooks.status.saved'))
  })

  it('hides «Запустить всё» for an unsupported notebook', async () => {
    installApi({
      status: { state: 'running', reason: null, port: 51234 },
      cards: CARDS,
      documents: { 'rox-analytics': { ...NOTEBOOK, supported: false } },
    })
    const container = await render()
    await click(container, 'cookbooks-card-rox-analytics')
    expect(testId(container, 'cookbooks-run-all')).toBeNull()
    // The document is still rendered — only the run-all action is withheld.
    expect(allTestIds(container, 'cookbooks-cell-')).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// Banner, help and the token invariant
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage chrome', () => {
  it('banners the missing ROX keys of the opened document', async () => {
    installApi({
      status: { state: 'running', reason: null, port: 51234 },
      cards: CARDS,
      documents: { 'rox-analytics': { ...NOTEBOOK, missing: ['ROX_API_KEY', 'ROX_WORKSPACE_ID'] } },
    })
    const container = await render()
    await click(container, 'cookbooks-card-rox-analytics')

    const banner = testId(container, 'cookbooks-missing-keys')
    expect(banner).not.toBeNull()
    expect(banner!.getAttribute('role')).toBe('alert')
    expect(banner!.textContent).toBe(
      t('cookbooks.missingKeys', { keys: 'ROX_API_KEY, ROX_WORKSPACE_ID' }),
    )
  })

  it('renders the compact help disclosure with all seven keys', async () => {
    installApi({ status: { state: 'running', reason: null, port: 51234 }, cards: CARDS })
    const container = await render()
    expect(testId(container, 'cookbooks-help')?.tagName.toLowerCase()).toBe('details')
    expect(container.textContent).toContain(t('cookbooks.help.title'))
    for (const key of [
      'cookbooks.help.cookbook',
      'cookbooks.help.copy',
      'cookbooks.help.run',
      'cookbooks.help.secrets',
      'cookbooks.help.reset',
      'cookbooks.help.timeout',
    ]) {
      expect(container.textContent).toContain(t(key))
    }
  })

  it('never exposes the sidecar token or a full URL in the DOM', async () => {
    const api = await renderNotebook()
    await click(api.container, 'cookbooks-run-1')
    await click(api.container, 'cookbooks-run-all')
    const html = api.container.innerHTML
    expect(html).not.toContain('token=')
    expect(html).not.toContain('http://')
    expect(html).not.toContain('lab.html')
  })
})
