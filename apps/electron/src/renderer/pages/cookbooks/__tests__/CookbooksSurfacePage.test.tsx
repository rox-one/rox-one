/**
 * CookbooksSurfacePage — the native «Кукбуки» surface (SPEC Amendment 1 + wave 7).
 *
 * Covers every honest runtime state, the two-pane catalog + document UI, the
 * per-cell and run-all execution paths, save/reset/new-copy, the missing-key
 * banner and the busy indicator, plus the wave-7 notebook behaviour: markdown
 * cells and playbooks behind the «Изменить»/«Просмотр» toggle (R1), session run
 * counters (R2), measured durations and the ticking elapsed status (R3), busy
 * spinners (R4), the Colab-parity keys (R5), the sticky header, output actions
 * and autoscroll (R6) and the shortcut help (R7). Strings are compared through
 * the same i18n instance the page uses, so a missing translation or a wrong
 * interpolation parameter fails here rather than silently rendering the raw key.
 *
 * Harness mirrors the sibling suites: happy-dom globals via `useDomForFile`,
 * the real RU i18n bundle through `setupI18n`, and `react-dom/client` imported
 * after the DOM exists.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
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
import type {
  CookbooksSurfacePage as CookbooksSurfacePageComponent,
  CookbooksSurfacePageProps,
} from '../CookbooksSurfacePage'

useDomForFile()
const i18n = setupI18n([initReactI18next])
setI18n(i18n)

const t = (key: string, params?: Record<string, unknown>): string => i18n.t(key, params) as string

/** Toast calls the page makes, captured instead of rendered. */
const toasts: string[] = []
mock.module('sonner', () => ({
  toast: {
    success: (message: string) => {
      toasts.push(`success:${message}`)
    },
    error: (message: string) => {
      toasts.push(`error:${message}`)
    },
    info: (message: string) => {
      toasts.push(`info:${message}`)
    },
  },
}))

/** R6 autoscroll spy: the test id of every element the page scrolls into view. */
const scrollCalls: string[] = []
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  writable: true,
  value: function scrollIntoView(this: Element) {
    scrollCalls.push(this.getAttribute('data-testid') ?? this.tagName)
  },
})

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
  toasts.length = 0
  scrollCalls.length = 0
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

const RUNNING: CookbooksStatus = { state: 'running', reason: null, port: 51234 }

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

async function render(props: CookbooksSurfacePageProps = {}): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted = root
  await act(async () => {
    root.render(<CookbooksSurfacePage {...props} />)
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
async function renderNotebook(model: Partial<ApiModel> = {}, props: CookbooksSurfacePageProps = {}) {
  const api = installApi({ status: RUNNING, cards: CARDS, documents: { 'rox-analytics': NOTEBOOK }, ...model })
  const container = await render(props)
  await click(container, 'cookbooks-card-rox-analytics')
  return { api, container }
}

/**
 * The status templates carry a measured duration, so an exact string compare
 * would be flaky: split the frozen template around its `{{duration}}` hole,
 * assert both halves, and require the hole to have been filled with the
 * `formatDuration` shape — an un-interpolated `{{duration}}` fails here.
 */
async function expectStatus(
  container: HTMLElement,
  key: string,
  params: Record<string, string | number> = {},
): Promise<void> {
  const [head, tail = ''] = t(key, { ...params, duration: '\u0000D' }).split('\u0000D')
  const text = testId(container, 'cookbooks-status')?.textContent ?? ''
  expect(text).toContain(head)
  expect(text.slice(text.indexOf(head) + head.length)).toMatch(/^(\d+\.\d+s|\d+m \d+s|\d+m\+|--)$/)
  expect(text).toContain(tail)
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
      api.emitStatus(RUNNING)
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
    const api = installApi({ status: RUNNING, cards: CARDS })
    const container = await render()
    expect(surface(container)?.getAttribute('data-state')).toBe('ready')
    expect(api.counts.catalog).toBe(1)
    expect(allTestIds(container, 'cookbooks-card-')).toHaveLength(3)
    expect(testId(container, 'cookbooks-catalog-count')?.textContent).toBe(t('cookbooks.catalog.count', { count: 3 }))
    expect(container.textContent).toContain('ROX Analytics')
    expect(container.textContent).toContain('Growth')
  })

  it('renders kind pills, key chips with status dots and the disabled reason', async () => {
    installApi({ status: RUNNING, cards: CARDS })
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
    installApi({ status: RUNNING, cards: CARDS })
    const container = await render()
    await type(container, 'cookbooks-filter', 'churn')
    expect(allTestIds(container, 'cookbooks-card-')).toHaveLength(1)
    expect(testId(container, 'cookbooks-card-churn-playbook')).not.toBeNull()
    expect(testId(container, 'cookbooks-catalog-count')?.textContent).toBe(t('cookbooks.catalog.count', { count: 1 }))

    await type(container, 'cookbooks-filter', 'ROX')
    expect(allTestIds(container, 'cookbooks-card-')).toHaveLength(2)
  })

  it('opens a card into the document pane and reports «Открыто»', async () => {
    const api = installApi({ status: RUNNING, cards: CARDS, documents: { 'rox-analytics': NOTEBOOK } })
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
      status: RUNNING,
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
    await expectStatus(container, 'cookbooks.status.cellOk', { index: 1 })
  })

  it('renders a failing cell with data-status="error" and the failure copy', async () => {
    installApi({
      status: RUNNING,
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
    await expectStatus(container, 'cookbooks.status.cellError', { index: 2 })
  })

  it('runs all code cells: skips markdown in the payload and renders skipped/error outputs', async () => {
    const api = installApi({ status: RUNNING, cards: CARDS, documents: { 'rox-analytics': NOTEBOOK } })
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
    await expectStatus(container, 'cookbooks.status.runAll', { count: 3, ok: 1, failed: 1, skipped: 1 })
  })

  it('shows an empty-output placeholder when a successful cell prints nothing', async () => {
    installApi({
      status: RUNNING,
      cards: CARDS,
      documents: { 'rox-analytics': NOTEBOOK },
      run: async () => ({ ok: true, stdout: '', error: null, timedOut: false, missing: [] }),
    })
    const container = await render()
    await click(container, 'cookbooks-card-rox-analytics')
    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-output-1')!.textContent).toBe(t('cookbooks.output.empty'))
  })

  it('disables the acting control and ticks the elapsed status while a cell runs', async () => {
    const gate = Promise.withResolvers<CookbooksRunResult>()
    installApi({
      status: RUNNING,
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
    const [head] = t('cookbooks.status.runningElapsed', { duration: '\u0000D' }).split('\u0000D')
    expect(testId(container, 'cookbooks-status')!.textContent).toContain(head)
    expect(testId(container, 'cookbooks-status')!.textContent).toMatch(/\d+\.\d+s$/)

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
// R1 — markdown rendering
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage markdown cells (R1)', () => {
  it('renders a markdown cell as markdown and toggles into the editor and back', async () => {
    const { container } = await renderNotebook()

    const rendered = testId(container, 'cookbooks-markdown-0')!
    // `mode="minimal"` is the md-cell contract: the editor is not mounted at all.
    expect(rendered.getAttribute('data-mode')).toBe('minimal')
    expect(rendered.querySelector('h1')?.textContent).toBe('Заметка')
    expect(testId(container, 'cookbooks-source-0')).toBeNull()
    expect((testId(container, 'cookbooks-mode-0') as HTMLButtonElement).textContent).toBe(t('cookbooks.cell.editMode'))

    await click(container, 'cookbooks-mode-0')
    const field = testId(container, 'cookbooks-source-0') as HTMLTextAreaElement
    expect(field.value).toBe('# Заметка')
    expect(testId(container, 'cookbooks-markdown-0')).toBeNull()
    expect((testId(container, 'cookbooks-mode-0') as HTMLButtonElement).textContent).toBe(t('cookbooks.cell.readMode'))

    await click(container, 'cookbooks-mode-0')
    expect(testId(container, 'cookbooks-markdown-0')).not.toBeNull()
    expect((testId(container, 'cookbooks-mode-0') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')
  })

  it('re-renders the edited markdown once the cell is back in read mode', async () => {
    const { container } = await renderNotebook()
    await click(container, 'cookbooks-mode-0')
    await type(container, 'cookbooks-source-0', '# Заголовок\n\nтело')
    await click(container, 'cookbooks-mode-0')

    const rendered = testId(container, 'cookbooks-markdown-0')!
    expect(rendered.querySelector('h1')?.textContent).toBe('Заголовок')
    expect(rendered.textContent).toContain('тело')
  })

  it('keeps code cells in a plain textarea with no markdown renderer', async () => {
    const { container } = await renderNotebook()
    expect(testId(container, 'cookbooks-source-1')?.tagName.toLowerCase()).toBe('textarea')
    expect(testId(container, 'cookbooks-markdown-1')).toBeNull()
    expect(testId(container, 'cookbooks-mode-1')).toBeNull()
  })

  it('reads a playbook as a document, edits it through the toggle and saves its text', async () => {
    const api = installApi({ status: RUNNING, cards: CARDS, documents: { 'churn-playbook': PLAYBOOK } })
    const container = await render()
    await click(container, 'cookbooks-card-churn-playbook')

    const rendered = testId(container, 'cookbooks-playbook-markdown')!
    // The playbook is long-form content: `mode="full"`, not the md-cell mode.
    expect(rendered.getAttribute('data-mode')).toBe('full')
    expect(rendered.querySelector('h1')?.textContent).toBe('Churn')
    expect(testId(container, 'cookbooks-playbook-text')).toBeNull()

    await click(container, 'cookbooks-playbook-toggle')
    const field = testId(container, 'cookbooks-playbook-text') as HTMLTextAreaElement
    expect(field.getAttribute('aria-label')).toBe(t('cookbooks.playbook.textLabel'))
    expect(field.value).toBe('# Churn\nШаги плейбука')

    await type(container, 'cookbooks-playbook-text', '# Churn\nПравка')
    await click(container, 'cookbooks-playbook-save')
    expect(api.counts.save).toEqual([{ itemId: 'churn-playbook', text: '# Churn\nПравка' }])
    expect(testId(container, 'cookbooks-status')?.textContent).toContain(t('cookbooks.status.saved'))

    await click(container, 'cookbooks-playbook-toggle')
    expect(testId(container, 'cookbooks-playbook-markdown')?.textContent).toContain('Правка')
  })
})

// ---------------------------------------------------------------------------
// R2 — session run counters
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage run counters (R2)', () => {
  it('counts a single run on its own cell only', async () => {
    const { container } = await renderNotebook({ run: async () => RUN_OK })
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[ ]')
    expect(testId(container, 'cookbooks-runs-1')!.getAttribute('aria-label')).toBe(
      t('cookbooks.cell.runs', { count: 0 }),
    )

    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[1]')
    expect(testId(container, 'cookbooks-runs-2')!.textContent).toBe('[ ]')

    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[2]')
    expect(testId(container, 'cookbooks-runs-1')!.getAttribute('aria-label')).toBe(
      t('cookbooks.cell.runs', { count: 2 }),
    )
  })

  it('counts every executed cell of a run-all and none of the skipped ones', async () => {
    const { api, container } = await renderNotebook()
    await click(container, 'cookbooks-run-all')

    expect(api.counts.runAll).toHaveLength(1)
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[1]')
    expect(testId(container, 'cookbooks-runs-2')!.textContent).toBe('[1]')
    // Skipped never ran; the markdown cell is not executable at all.
    expect(testId(container, 'cookbooks-runs-3')!.textContent).toBe('[ ]')
    expect(testId(container, 'cookbooks-runs-0')!.textContent).toBe('[ ]')
  })

  it('resets the counters when another copy is opened', async () => {
    const { container } = await renderNotebook({ run: async () => RUN_OK })
    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[1]')

    await click(container, 'cookbooks-new-copy')
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[ ]')
  })
})

// ---------------------------------------------------------------------------
// R3 — measured durations
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage durations (R3)', () => {
  it('appends the measured duration to a successful cell status', async () => {
    const { container } = await renderNotebook({ run: async () => RUN_OK })
    await click(container, 'cookbooks-run-1')
    await expectStatus(container, 'cookbooks.status.cellOk', { index: 1 })
  })

  it('appends the measured duration to a failing cell status', async () => {
    const { container } = await renderNotebook({ run: async () => RUN_ERROR })
    await click(container, 'cookbooks-run-2')
    await expectStatus(container, 'cookbooks.status.cellError', { index: 2 })
  })

  it('appends the measured duration to the run-all status', async () => {
    const { container } = await renderNotebook()
    await click(container, 'cookbooks-run-all')
    await expectStatus(container, 'cookbooks.status.runAll', { count: 3, ok: 1, failed: 1, skipped: 1 })
  })

  it('ticks the elapsed status every 250 ms while the run is in flight', async () => {
    const gate = Promise.withResolvers<CookbooksRunResult>()
    const { container } = await renderNotebook({ run: () => gate.promise })

    vi.useFakeTimers()
    try {
      await act(async () => {
        ;(testId(container, 'cookbooks-run-1') as HTMLButtonElement).click()
      })
      expect(testId(container, 'cookbooks-status')!.textContent).toBe(
        t('cookbooks.status.runningElapsed', { duration: '0.0s' }),
      )

      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(testId(container, 'cookbooks-status')!.textContent).toBe(
        t('cookbooks.status.runningElapsed', { duration: '1.0s' }),
      )

      await act(async () => {
        gate.resolve(RUN_OK)
        await gate.promise
      })
    } finally {
      vi.useRealTimers()
    }
    await flush()
    await expectStatus(container, 'cookbooks.status.cellOk', { index: 1 })
  })

  it('keeps the static running copy for actions that are not runs', async () => {
    const api = await renderNotebook()
    await click(api.container, 'cookbooks-new-copy')
    // The action finished; a fresh open never reports a run duration.
    expect(testId(api.container, 'cookbooks-status')!.textContent).toContain(t('cookbooks.status.newCopy'))
  })
})

// ---------------------------------------------------------------------------
// R4 — busy cells
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage busy cells (R4)', () => {
  it('spins the running cell, disables its actions and releases them afterwards', async () => {
    const gate = Promise.withResolvers<CookbooksRunResult>()
    const { container } = await renderNotebook({ run: () => gate.promise })

    await act(async () => {
      ;(testId(container, 'cookbooks-run-1') as HTMLButtonElement).click()
    })
    await flush(1)

    const spinner = testId(container, 'cookbooks-busy-1')
    expect(spinner).not.toBeNull()
    expect(spinner!.getAttribute('aria-hidden')).toBe('true')
    expect(testId(container, 'cookbooks-busy-2')).toBeNull()
    expect((testId(container, 'cookbooks-run-1') as HTMLButtonElement).disabled).toBe(true)
    expect((testId(container, 'cookbooks-save-1') as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      gate.resolve(RUN_OK)
      await gate.promise
    })
    await flush()
    expect(testId(container, 'cookbooks-busy-1')).toBeNull()
    expect((testId(container, 'cookbooks-run-1') as HTMLButtonElement).disabled).toBe(false)
  })

  it('spins every executable cell of a run-all and blocks the header actions', async () => {
    const gate = Promise.withResolvers<{ cells: CookbooksRunCell[] }>()
    const { container } = await renderNotebook({ runAll: () => gate.promise })

    await act(async () => {
      ;(testId(container, 'cookbooks-run-all') as HTMLButtonElement).click()
    })
    await flush(1)

    expect(testId(container, 'cookbooks-busy-1')).not.toBeNull()
    expect(testId(container, 'cookbooks-busy-2')).not.toBeNull()
    expect(testId(container, 'cookbooks-busy-3')).not.toBeNull()
    expect(testId(container, 'cookbooks-busy-0')).toBeNull()
    expect((testId(container, 'cookbooks-run-all') as HTMLButtonElement).disabled).toBe(true)
    expect((testId(container, 'cookbooks-reset') as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      gate.resolve({ cells: RUN_ALL })
      await gate.promise
    })
    await flush()
    expect(testId(container, 'cookbooks-busy-1')).toBeNull()
    expect((testId(container, 'cookbooks-run-all') as HTMLButtonElement).disabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// R5 — Colab-parity keys
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage keyboard (R5)', () => {
  it('Shift+Enter runs the cell and moves focus to the next code cell', async () => {
    const { api, container } = await renderNotebook({ run: async () => RUN_OK })
    const first = testId(container, 'cookbooks-source-1') as HTMLTextAreaElement
    first.focus()

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    })
    await flush()

    expect(api.counts.run).toHaveLength(1)
    expect(api.counts.run[0]).toMatchObject({ itemId: 'rox-analytics', index: 1, code: 'print(1)' })
    expect(document.activeElement).toBe(testId(container, 'cookbooks-source-2'))
  })

  it('Ctrl/Cmd+Enter runs the cell and leaves focus on it', async () => {
    const { api, container } = await renderNotebook({ run: async () => RUN_OK })
    const first = testId(container, 'cookbooks-source-1') as HTMLTextAreaElement
    first.focus()

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    })
    await flush()

    expect(api.counts.run).toHaveLength(1)
    expect(document.activeElement).toBe(first)
  })

  it('Ctrl/Cmd+Shift+Enter anywhere in the document runs every cell', async () => {
    const { api, container } = await renderNotebook()
    const documentPane = testId(container, 'cookbooks-document')!

    await act(async () => {
      documentPane.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, shiftKey: true, bubbles: true }))
    })
    await flush()

    expect(api.counts.runAll).toHaveLength(1)
    expect(api.counts.runAll[0].cells).toEqual(RUN_ALL_PAYLOAD)
  })

  it('leaves run-all inert where the document does not support it', async () => {
    const api = installApi({ status: RUNNING, cards: CARDS, documents: { 'churn-playbook': PLAYBOOK } })
    const container = await render()
    await click(container, 'cookbooks-card-churn-playbook')

    await act(async () => {
      testId(container, 'cookbooks-document')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, shiftKey: true, bubbles: true }),
      )
    })
    await flush()
    expect(api.counts.runAll).toHaveLength(0)
  })

  it('is a no-op while another action is in flight', async () => {
    const gate = Promise.withResolvers<CookbooksRunResult>()
    const { api, container } = await renderNotebook({ run: () => gate.promise })

    await act(async () => {
      ;(testId(container, 'cookbooks-run-1') as HTMLButtonElement).click()
    })
    await flush(1)

    const second = testId(container, 'cookbooks-source-2') as HTMLTextAreaElement
    second.focus()
    await act(async () => {
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
      testId(container, 'cookbooks-document')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, shiftKey: true, bubbles: true }),
      )
    })
    await flush(1)

    expect(api.counts.run).toHaveLength(1)
    expect(api.counts.runAll).toHaveLength(0)
    expect(document.activeElement).toBe(second)

    await act(async () => {
      gate.resolve(RUN_OK)
      await gate.promise
    })
    await flush()
  })

  it('titles the run button with its shortcut', async () => {
    const { container } = await renderNotebook()
    expect((testId(container, 'cookbooks-run-1') as HTMLButtonElement).getAttribute('title')).toMatch(/Enter|↵/)
  })
})

// ---------------------------------------------------------------------------
// R6 — output actions, header, autoscroll
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage output actions and header (R6)', () => {
  it('copies the output the cell is showing and toasts the result', async () => {
    const copied: string[] = []
    const { container } = await renderNotebook({ run: async () => RUN_OK }, {
      writeClipboard: async (text) => {
        copied.push(text)
      },
    })
    await click(container, 'cookbooks-run-1')
    await click(container, 'cookbooks-copy-output-1')

    expect(copied).toEqual(['42\n'])
    expect(toasts).toContain(`success:${t('toast.copied')}`)
  })

  it('toasts a failure when the clipboard write rejects', async () => {
    const { container } = await renderNotebook({ run: async () => RUN_OK }, {
      writeClipboard: async () => {
        throw new Error('denied')
      },
    })
    await click(container, 'cookbooks-run-1')
    await click(container, 'cookbooks-copy-output-1')

    expect(toasts).toContain(`error:${t('toast.copyFailed')}`)
  })

  it('clears the output back to the pre-run hint', async () => {
    const { container } = await renderNotebook({ run: async () => RUN_OK })
    // No output yet: neither output action is offered.
    expect(testId(container, 'cookbooks-copy-output-1')).toBeNull()
    expect(testId(container, 'cookbooks-clear-output-1')).toBeNull()

    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('ok')

    await click(container, 'cookbooks-clear-output-1')
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('idle')
    expect(testId(container, 'cookbooks-output-1')!.textContent).toBe(t('cookbooks.output.hint'))
    expect(testId(container, 'cookbooks-copy-output-1')).toBeNull()
  })

  it('keeps the document header sticky and counts the cells it shows', async () => {
    const { container } = await renderNotebook()
    const header = testId(container, 'cookbooks-document-title')!.closest('header')!
    expect(header.className).toContain('sticky')
    expect(header.className).toContain('top-0')
    expect(header.className).toContain('z-sticky')
    expect(testId(container, 'cookbooks-header-cells')!.textContent).toBe(t('cookbooks.header.cells', { count: 4 }))
    expect(testId(container, 'cookbooks-copy-id')!.textContent).toBe('rox-analytics-copy')
  })

  it('scrolls to the first code cell on run-all and to the first failure after it', async () => {
    const gate = Promise.withResolvers<{ cells: CookbooksRunCell[] }>()
    const { container } = await renderNotebook({ runAll: () => gate.promise })

    await act(async () => {
      ;(testId(container, 'cookbooks-run-all') as HTMLButtonElement).click()
    })
    await flush(1)
    expect(scrollCalls).toEqual(['cookbooks-cell-1'])

    await act(async () => {
      gate.resolve({ cells: RUN_ALL })
      await gate.promise
    })
    await flush()
    expect(scrollCalls).toEqual(['cookbooks-cell-1', 'cookbooks-cell-2'])
  })
})

// ---------------------------------------------------------------------------
// R7 — help
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage help (R7)', () => {
  it('lists the three shortcut lines under their own title', async () => {
    installApi({ status: RUNNING, cards: CARDS })
    const container = await render()

    const block = testId(container, 'cookbooks-help-shortcuts')!
    expect(block.querySelectorAll('li')).toHaveLength(3)
    for (const key of [
      'cookbooks.help.shortcutRun',
      'cookbooks.help.shortcutRunStay',
      'cookbooks.help.shortcutRunAll',
    ]) {
      expect(block.textContent).toContain(t(key))
    }
    expect(container.textContent).toContain(t('cookbooks.help.shortcutsTitle'))
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

  it('hides «Запустить всё» for an unsupported notebook', async () => {
    installApi({ status: RUNNING, cards: CARDS, documents: { 'rox-analytics': { ...NOTEBOOK, supported: false } } })
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
    installApi({ status: RUNNING, cards: CARDS, documents: { 'rox-analytics': { ...NOTEBOOK, missing: ['ROX_API_KEY', 'ROX_WORKSPACE_ID'] } } })
    const container = await render()
    await click(container, 'cookbooks-card-rox-analytics')

    const banner = testId(container, 'cookbooks-missing-keys')
    expect(banner).not.toBeNull()
    expect(banner!.getAttribute('role')).toBe('alert')
    expect(banner!.textContent).toBe(t('cookbooks.missingKeys', { keys: 'ROX_API_KEY, ROX_WORKSPACE_ID' }))
  })

  it('renders the compact help disclosure with all seven keys', async () => {
    installApi({ status: RUNNING, cards: CARDS })
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

// ---------------------------------------------------------------------------
// Wave-7 i18n contract — the frozen RU copy this surface renders through `t()`.
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage wave-7 copy', () => {
  it('carries the eleven new keys with their frozen RU values', () => {
    expect(t('cookbooks.cell.editMode')).toBe('Изменить')
    expect(t('cookbooks.cell.readMode')).toBe('Просмотр')
    expect(t('cookbooks.cell.clearOutput')).toBe('Очистить вывод')
    expect(t('cookbooks.cell.copyOutput')).toBe('Копировать вывод')
    expect(t('cookbooks.cell.runs', { count: 3 })).toBe('Выполнений: 3')
    expect(t('cookbooks.header.cells', { count: 4 })).toBe('Ячеек: 4')
    expect(t('cookbooks.status.runningElapsed', { duration: '1.0s' })).toBe('выполняется… 1.0s')
    expect(t('cookbooks.help.shortcutsTitle')).toBe('Клавиши')
    expect(t('cookbooks.help.shortcutRun')).toContain('Shift+Enter')
    expect(t('cookbooks.help.shortcutRunStay')).toContain('Ctrl/Cmd+Enter')
    expect(t('cookbooks.help.shortcutRunAll')).toContain('Ctrl/Cmd+Shift+Enter')
  })

  it('carries the duration suffix on the three edited status keys', () => {
    expect(t('cookbooks.status.cellOk', { index: 7, duration: '1.2s' })).toBe('Ячейка 7: успешно · 1.2s')
    expect(t('cookbooks.status.cellError', { index: 7, duration: '1.2s' })).toBe('Ячейка 7: ошибка · 1.2s')
    expect(t('cookbooks.status.runAll', { count: 3, ok: 1, failed: 1, skipped: 1, duration: '1.2s' })).toBe(
      'Запущено 3 ячеек: 1 успешно · 1 с ошибкой · 1 пропущено · 1.2s',
    )
  })
})
