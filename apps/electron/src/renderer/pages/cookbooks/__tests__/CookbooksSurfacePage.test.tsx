/**
 * CookbooksSurfacePage — the native «Кукбуки» surface (SPEC Amendment 1 + wave 7).
 *
 * Covers every honest runtime state, the two-pane catalog + document UI, the
 * per-cell and run-all execution paths, save/reset/new-copy, the missing-key
 * banner and the busy indicator, plus the wave-7 notebook behaviour: markdown
 * cells and playbooks behind the «Изменить»/«Просмотр» toggle (R1), session run
 * counters (R2), measured durations and the ticking elapsed status (R3), busy
 * spinners (R4), the Colab-parity keys (R5), the sticky header, output actions
 * and autoscroll (R6) and the shortcut help (R7). Q2A «Colab-микро» adds the
 * Alt+↑/↓ cell navigation (R-A), collapsing of long outputs (R-B) and
 * «Очистить все выводы» (R-C). Wave 9 adds the control + navigation half of
 * Colab parity: stop (per cell, run-all and Esc), the outline, «выполнить
 * выше/ниже» subsets, autoscroll of a single run, `\r`-shaped output,
 * «копировать исходник» and the `.ipynb` export — the export runs through the
 * real shared builder, so the JSON this file inspects is the shipped one.
 * Wave 10 adds the P3 renderer half of cell structure: the hover insert rows,
 * the per-cell «⋯» menu (move/duplicate/delete), `Ctrl+M`, the flush-before-
 * mutate contract and the focus/scroll onto a mutation's landing cell — every
 * mutation goes through the one `cookbooks-lab:mutate` double.
 * Wave 11 adds the rich-output half: the `display_data` records of a cell render
 * after its text (image `data:`-URL, sandboxed HTML frame whose document leads
 * with its own `default-src 'none'` policy, pretty JSON, markdown), one widget
 * per display event (the emitter picks a single widget-mime per event), the block
 * reads as the printed text plus every plain-text display, a reopened document
 * seeds the surface from the outputs and the `execution_count` its copy already
 * holds, a rich result with no text falls back to its `text/plain` record (or the
 * frozen «graphical output» marker) and the session's records travel into the
 * exported `.ipynb`.
 * Strings are compared through
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
import {
  CookbooksApiError,
  type CookbooksCard,
  type CookbooksDisplay,
  type CookbooksDocument,
  type CookbooksOutput,
  type CookbooksRunCell,
  type CookbooksRunResult,
  type CookbooksStatus,
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
  // Wave 11: every cell carries its nbformat `execution_count` — null here, so
  // the fixture opens with the same clean `[ ]` counters it always had.
  cells: [
    { cellType: 'markdown', source: '# Заметка', outputs: [], executionCount: null },
    { cellType: 'code', source: 'print(1)', outputs: [], executionCount: null },
    { cellType: 'code', source: 'raise ValueError("boom")', outputs: [], executionCount: null },
    { cellType: 'code', source: 'print(3)', outputs: [], executionCount: null },
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

/**
 * Wave 9 outline fixture: headings spread over two markdown cells, an H4 the
 * outline must skip and a trailing `####` run it must strip.
 */
const OUTLINED: CookbooksDocument = {
  ...NOTEBOOK,
  cells: [
    { cellType: 'markdown', source: '# Первая\n\nтекст\n## Вторая\n#### Слишком глубоко', outputs: [], executionCount: null },
    { cellType: 'code', source: 'print(1)', outputs: [], executionCount: null },
    { cellType: 'markdown', source: '### Третья ###', outputs: [], executionCount: null },
    { cellType: 'code', source: 'print(2)', outputs: [], executionCount: null },
  ],
}

/** Wave 9: a notebook whose markdown carries no heading at all. */
const HEADINGLESS: CookbooksDocument = {
  ...NOTEBOOK,
  cells: [{ cellType: 'code', source: 'print(1)', outputs: [], executionCount: null }],
}

// Wave 11: a run answers its rich records alongside its text; `[]` when the
// sidecar has none (the same default main applies to a wire response without
// the field).
const RUN_OK: CookbooksRunResult = {
  ok: true,
  stdout: '42\n',
  error: null,
  timedOut: false,
  missing: [],
  displays: [],
}
const RUN_ERROR: CookbooksRunResult = {
  ok: false,
  stdout: '',
  error: 'ValueError: boom',
  timedOut: false,
  missing: [],
  displays: [],
}

/** `run-all` never sees the markdown cell; execution stops at the first failure. */
const RUN_ALL: CookbooksRunCell[] = [
  { index: 1, status: 'ok', stdout: 'ok-1', error: null, displays: [] },
  { index: 2, status: 'error', stdout: '', error: 'ValueError: boom', displays: [] },
  { index: 3, status: 'skipped', stdout: '', error: null, displays: [] },
]

/** The exact payload `run-all` must send: code cells only, document indices kept. */
const RUN_ALL_PAYLOAD = [
  { index: 1, source: 'print(1)' },
  { index: 2, source: 'raise ValueError("boom")' },
  { index: 3, source: 'print(3)' },
]

/** R-B: a chatty result, well past the 600-character collapse threshold. */
const LONG_STDOUT = `${'строка вывода — заведомо длиннее порога\n'.repeat(20)}конец`
const LONG_RUN: CookbooksRunResult = {
  ok: true,
  stdout: LONG_STDOUT,
  error: null,
  timedOut: false,
  missing: [],
  displays: [],
}

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
interface ExportCall {
  itemId: string
  filename: string
  content: string
}
/** Wave 10: one structural mutation call — the shared union plus its itemId. */
interface MutateCall {
  itemId: string
  op: 'add' | 'delete' | 'move' | 'duplicate'
  cellType?: 'code' | 'markdown'
  index?: number
  from?: number
  to?: number
}

interface ApiModel {
  status: CookbooksStatus
  cards?: CookbooksCard[]
  documents?: Record<string, CookbooksDocument>
  run?: (call: RunCall) => Promise<CookbooksRunResult>
  runAll?: (call: RunAllCall) => Promise<{ cells: CookbooksRunCell[]; cancelled?: boolean }>
  cancel?: (call: ItemCall) => Promise<{ ok: boolean; cancelled: number }>
  export?: (call: ExportCall) => Promise<{ saved: boolean; path?: string }>
  /** Wave 10: lets a test make the pre-mutation flush fail. */
  save?: (call: SaveCall) => Promise<void>
  /** Wave 10: the document + focus index the sidecar answers a mutation with. */
  mutate?: (call: MutateCall) => Promise<{ document: CookbooksDocument; index: number }>
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
  cancel: ItemCall[]
  export: ExportCall[]
  mutate: MutateCall[]
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
    cancel: [],
    export: [],
    mutate: [],
  }
  /** Wave 10: the cross-array order of sidecar calls — proves save → mutate. */
  const events: string[] = []
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
      events.push('save')
      if (model.save) await model.save(call)
    },
    reset: async (call: ItemCall) => {
      counts.reset.push(call)
    },
    cancel: async (call: ItemCall) => {
      counts.cancel.push(call)
      return model.cancel ? model.cancel(call) : { ok: true, cancelled: 1 }
    },
    export: async (call: ExportCall) => {
      counts.export.push(call)
      return model.export ? model.export(call) : { saved: true, path: '/tmp/rox-analytics.ipynb' }
    },
    // Wave 10: structural cell mutations — the document is re-read after the op.
    mutate: async (call: MutateCall) => {
      counts.mutate.push(call)
      events.push(`mutate:${call.op}`)
      return model.mutate ? model.mutate(call) : { document: docFor(call.itemId), index: 0 }
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
    events,
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

/**
 * Wave 9: a faithful `run-all` double — it answers exactly the cells it was
 * asked for, the way the sidecar does, so a subset run can never pick up
 * another cell's result.
 */
function answerRequestedCells(call: RunAllCall): Promise<{ cells: CookbooksRunCell[] }> {
  return Promise.resolve({
    cells: call.cells.map((cell) => ({
      index: cell.index,
      status: 'ok',
      stdout: `ok-${cell.index}`,
      error: null,
      displays: [],
    })),
  })
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
 * Wave 10: the sidecar's answer to a structural mutation — the document it
 * re-read plus the index the renderer should focus (`-1` after a delete that
 * emptied the notebook).
 */
function mutationResult(document: CookbooksDocument, index: number) {
  return async () => ({ document, index })
}

/** Wave 10: the notebook with one cell spliced in at `index`. */
function withCellAt(document: CookbooksDocument, index: number, cell: CookbooksDocument['cells'][number]) {
  const cells = document.cells.slice()
  cells.splice(index, 0, cell)
  return { ...document, cells }
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
      run: async () => ({ ok: true, stdout: '', error: null, timedOut: false, missing: [], displays: [] }),
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
// R-A — Alt+Arrow cell navigation
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage cell navigation (R-A)', () => {
  it('enters the notebook from its nearest end and swallows the chord', async () => {
    const { container } = await renderNotebook()
    const pane = testId(container, 'cookbooks-document')!

    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true })
    await act(async () => {
      pane.dispatchEvent(down)
    })
    // Cell 0 is markdown: the first code cell is the target, never the md cell.
    expect(document.activeElement).toBe(testId(container, 'cookbooks-source-1'))
    expect(down.defaultPrevented).toBe(true)

    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true })
    await act(async () => {
      pane.dispatchEvent(up)
    })
    expect(document.activeElement).toBe(testId(container, 'cookbooks-source-3'))
    expect(up.defaultPrevented).toBe(true)
  })

  it('moves between code cells and skips markdown entries', async () => {
    const { container } = await renderNotebook()
    const first = testId(container, 'cookbooks-source-1') as HTMLTextAreaElement
    first.focus()

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(testId(container, 'cookbooks-source-2'))

    await act(async () => {
      ;(document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement).toBe(testId(container, 'cookbooks-source-1'))

    // Nothing runnable above cell 1: focus stays put rather than landing on md.
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(first)
  })

  it('navigates while another action is in flight', async () => {
    const gate = Promise.withResolvers<CookbooksRunResult>()
    const { container } = await renderNotebook({ run: () => gate.promise })

    await act(async () => {
      ;(testId(container, 'cookbooks-run-1') as HTMLButtonElement).click()
    })
    await flush(1)

    const first = testId(container, 'cookbooks-source-1') as HTMLTextAreaElement
    await act(async () => {
      first.focus()
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(testId(container, 'cookbooks-source-2'))

    await act(async () => {
      gate.resolve(RUN_OK)
      await gate.promise
    })
    await flush()
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
// R-B — collapsing a long output
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage output collapsing (R-B)', () => {
  it('collapses a long output and toggles it between «Показать полностью» and «Свернуть»', async () => {
    const { container } = await renderNotebook({ run: async () => LONG_RUN })
    await click(container, 'cookbooks-run-1')

    const output = testId(container, 'cookbooks-output-1')!
    expect(output.getAttribute('data-collapsed')).toBe('true')
    // The collapsed block still carries the whole text: the clamp is visual only.
    expect(output.textContent).toBe(LONG_STDOUT)

    const toggle = testId(container, 'cookbooks-output-toggle-1') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toBe(t('cookbooks.cell.expandOutput'))

    await click(container, 'cookbooks-output-toggle-1')
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-collapsed')).toBe('false')
    const expanded = testId(container, 'cookbooks-output-toggle-1') as HTMLButtonElement
    expect(expanded.getAttribute('aria-expanded')).toBe('true')
    expect(expanded.textContent).toBe(t('cookbooks.cell.collapseOutput'))

    await click(container, 'cookbooks-output-toggle-1')
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-collapsed')).toBe('true')
    expect(
      (testId(container, 'cookbooks-output-toggle-1') as HTMLButtonElement).getAttribute('aria-expanded'),
    ).toBe('false')
  })

  it('offers no toggle for a short output', async () => {
    const { container } = await renderNotebook({ run: async () => RUN_OK })
    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-output-toggle-1')).toBeNull()
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-collapsed')).toBe('false')
  })

  it('copies the full text even while the output is collapsed', async () => {
    const copied: string[] = []
    const { container } = await renderNotebook(
      { run: async () => LONG_RUN },
      {
        writeClipboard: async (text) => {
          copied.push(text)
        },
      },
    )
    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-collapsed')).toBe('true')

    await click(container, 'cookbooks-copy-output-1')
    expect(copied).toEqual([LONG_STDOUT])
  })

  it('keeps the expansion state per cell', async () => {
    const { container } = await renderNotebook({ run: async () => LONG_RUN })
    await click(container, 'cookbooks-run-1')
    await click(container, 'cookbooks-run-3')
    await click(container, 'cookbooks-output-toggle-1')

    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-collapsed')).toBe('false')
    expect(testId(container, 'cookbooks-output-3')!.getAttribute('data-collapsed')).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// R-C — clearing every output
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage clear-all (R-C)', () => {
  it('offers «Очистить все выводы» exactly while an output exists and resets it to the hint', async () => {
    const { container } = await renderNotebook({ run: async () => RUN_OK })
    expect(testId(container, 'cookbooks-clear-all-outputs')).toBeNull()

    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-clear-all-outputs')).not.toBeNull()

    await click(container, 'cookbooks-clear-all-outputs')
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('idle')
    expect(testId(container, 'cookbooks-output-1')!.textContent).toBe(t('cookbooks.output.hint'))
    expect(testId(container, 'cookbooks-copy-output-1')).toBeNull()
    expect(testId(container, 'cookbooks-clear-all-outputs')).toBeNull()
  })

  it('clears a whole run-all result set at once, keeping the run counters', async () => {
    const { container } = await renderNotebook()
    await click(container, 'cookbooks-run-all')
    expect(testId(container, 'cookbooks-output-2')!.getAttribute('data-status')).toBe('error')

    await click(container, 'cookbooks-clear-all-outputs')
    for (const index of [1, 2, 3]) {
      expect(testId(container, `cookbooks-output-${index}`)!.getAttribute('data-status')).toBe('idle')
      expect(testId(container, `cookbooks-output-${index}`)!.textContent).toBe(t('cookbooks.output.hint'))
    }
    expect(testId(container, 'cookbooks-clear-all-outputs')).toBeNull()
    // Clearing results never rewinds the session counters — same as a single clear.
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[1]')
  })
})

// ---------------------------------------------------------------------------
// R7 — help
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage help (R7)', () => {
  it('lists the shortcut lines under their own title, including R-A navigation and wave-9 stop', async () => {
    installApi({ status: RUNNING, cards: CARDS })
    const container = await render()

    const block = testId(container, 'cookbooks-help-shortcuts')!
    expect(block.querySelectorAll('li')).toHaveLength(6)
    for (const key of [
      'cookbooks.help.shortcutRun',
      'cookbooks.help.shortcutRunStay',
      'cookbooks.help.shortcutRunAll',
      'cookbooks.help.shortcutNav',
      'cookbooks.help.shortcutStop',
      'cookbooks.help.shortcutInsert',
    ]) {
      expect(block.textContent).toContain(t(key))
    }
    expect(container.textContent).toContain(t('cookbooks.help.shortcutsTitle'))
  })
})

// ---------------------------------------------------------------------------
// Wave 9 — stop
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage stop (wave 9)', () => {
  it('offers a stop control on the running cell only, and drops it once the run settles', async () => {
    const gate = Promise.withResolvers<CookbooksRunResult>()
    const { container } = await renderNotebook({ run: () => gate.promise })

    expect(testId(container, 'cookbooks-stop-1')).toBeNull()

    await act(async () => {
      ;(testId(container, 'cookbooks-run-1') as HTMLButtonElement).click()
    })
    await flush(1)

    const stop = testId(container, 'cookbooks-stop-1') as HTMLButtonElement
    expect(stop).not.toBeNull()
    expect(stop.textContent).toBe(t('cookbooks.actions.stop'))
    expect(stop.getAttribute('aria-label')).toBe(t('cookbooks.cell.stopLabel', { index: 1 }))
    // The stop control is the one action a running cell keeps enabled.
    expect(stop.disabled).toBe(false)
    expect((testId(container, 'cookbooks-run-1') as HTMLButtonElement).disabled).toBe(true)
    // Nothing else is running, so no other cell and no batch control shows one.
    expect(testId(container, 'cookbooks-stop-2')).toBeNull()
    expect(testId(container, 'cookbooks-stop-all')).toBeNull()

    await act(async () => {
      gate.resolve(RUN_OK)
      await gate.promise
    })
    await flush()
    expect(testId(container, 'cookbooks-stop-1')).toBeNull()
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('ok')
  })

  it('stops the running cell through the runtime and reports the cancelled result', async () => {
    const gate = Promise.withResolvers<CookbooksRunResult>()
    const { api, container } = await renderNotebook({ run: () => gate.promise })

    await act(async () => {
      ;(testId(container, 'cookbooks-run-1') as HTMLButtonElement).click()
    })
    await flush(1)
    await click(container, 'cookbooks-stop-1')
    expect(api.counts.cancel).toEqual([{ itemId: 'rox-analytics' }])

    await act(async () => {
      gate.resolve({ ...RUN_OK, cancelled: true })
      await gate.promise
    })
    await flush()

    const output = testId(container, 'cookbooks-output-1')!
    expect(output.getAttribute('data-status')).toBe('cancelled')
    expect(output.textContent).toBe(t('cookbooks.cell.cancelled'))
    await expectStatus(container, 'cookbooks.status.cellCancelled', { index: 1 })
    // The interrupted execution still counts: the cell did run.
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[1]')
    expect(testId(container, 'cookbooks-stop-1')).toBeNull()
  })

  it('stops a run-all from the header and marks the cells the stop cut short', async () => {
    const gate = Promise.withResolvers<{ cells: CookbooksRunCell[]; cancelled?: boolean }>()
    const { api, container } = await renderNotebook({ runAll: () => gate.promise })

    await act(async () => {
      ;(testId(container, 'cookbooks-run-all') as HTMLButtonElement).click()
    })
    await flush(1)

    expect(testId(container, 'cookbooks-stop-all')).not.toBeNull()
    expect((testId(container, 'cookbooks-run-above-3') as HTMLButtonElement).disabled).toBe(true)

    await click(container, 'cookbooks-stop-all')
    expect(api.counts.cancel).toEqual([{ itemId: 'rox-analytics' }])

    // What the sidecar really answers after a stop: one record per requested
    // cell, the ones the stop cut short marked `skipped`, run-wide cancelled.
    await act(async () => {
      gate.resolve({
        cells: [
          { index: 1, status: 'ok', stdout: 'ok-1', error: null, displays: [] },
          { index: 2, status: 'skipped', stdout: '', error: null, displays: [] },
          { index: 3, status: 'skipped', stdout: '', error: null, displays: [] },
        ],
        cancelled: true,
      })
      await gate.promise
    })
    await flush()

    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('ok')
    for (const index of [2, 3]) {
      const output = testId(container, `cookbooks-output-${index}`)!
      // Stopped, not skipped — a stopped batch has no skipped cells.
      expect(output.getAttribute('data-status')).toBe('cancelled')
      expect(output.textContent).toBe(t('cookbooks.cell.cancelled'))
    }
    expect(testId(container, 'cookbooks-status')!.textContent).toContain(t('cookbooks.notice.runCancelled'))
    expect(testId(container, 'cookbooks-stop-all')).toBeNull()
    // Only the cell that answered ran — the stopped ones never moved a counter.
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[1]')
    expect(testId(container, 'cookbooks-runs-2')!.textContent).toBe('[ ]')
  })

  it('marks a requested cell the stopped response never mentioned as cancelled too', async () => {
    const { container } = await renderNotebook({
      runAll: async () => ({
        cells: [{ index: 1, status: 'ok', stdout: 'ok-1', error: null, displays: [] }],
        cancelled: true,
      }),
    })

    await click(container, 'cookbooks-run-all')

    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('ok')
    for (const index of [2, 3]) {
      expect(testId(container, `cookbooks-output-${index}`)!.getAttribute('data-status')).toBe('cancelled')
    }
    expect(testId(container, 'cookbooks-status')!.textContent).toContain(t('cookbooks.notice.runCancelled'))
  })

  it('cancels the run in flight on Esc, and leaves the key alone while nothing runs', async () => {
    const gate = Promise.withResolvers<CookbooksRunResult>()
    const { api, container } = await renderNotebook({ run: () => gate.promise })
    const pane = testId(container, 'cookbooks-document')!

    const idle = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => {
      pane.dispatchEvent(idle)
    })
    expect(idle.defaultPrevented).toBe(false)
    expect(api.counts.cancel).toHaveLength(0)

    await act(async () => {
      ;(testId(container, 'cookbooks-run-1') as HTMLButtonElement).click()
    })
    await flush(1)

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => {
      pane.dispatchEvent(escape)
    })
    await flush(1)
    expect(escape.defaultPrevented).toBe(true)
    expect(api.counts.cancel).toEqual([{ itemId: 'rox-analytics' }])

    await act(async () => {
      gate.resolve({ ...RUN_OK, cancelled: true })
      await gate.promise
    })
    await flush()
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('cancelled')
    await expectStatus(container, 'cookbooks.status.cellCancelled', { index: 1 })
  })
})

// ---------------------------------------------------------------------------
// Wave 9 — outline
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage outline (wave 9)', () => {
  it('lists the H1–H3 headings of the markdown cells in document order', async () => {
    const { container } = await renderNotebook({ documents: { 'rox-analytics': OUTLINED } })

    const outline = testId(container, 'cookbooks-outline')!
    expect(outline.tagName.toLowerCase()).toBe('details')
    expect(outline.querySelector('summary')!.textContent).toBe(t('cookbooks.outline.title'))

    const items = allTestIds(container, 'cookbooks-outline-item-') as HTMLElement[]
    // The H4 and the trailing `###` run are not outline material.
    expect(items.map((item) => item.textContent)).toEqual(['Первая', 'Вторая', 'Третья'])
    expect(items[0].getAttribute('aria-label')).toBe(t('cookbooks.outline.itemLabel', { title: 'Первая' }))
    expect(items[2].getAttribute('aria-label')).toBe(t('cookbooks.outline.itemLabel', { title: 'Третья' }))
  })

  it('scrolls to the block the heading belongs to', async () => {
    const { container } = await renderNotebook({ documents: { 'rox-analytics': OUTLINED } })
    expect(scrollCalls).toEqual([])

    await click(container, 'cookbooks-outline-item-2')
    expect(scrollCalls).toEqual(['cookbooks-cell-2'])

    // Both headings of cell 0 point at that one article.
    await click(container, 'cookbooks-outline-item-1')
    expect(scrollCalls).toEqual(['cookbooks-cell-2', 'cookbooks-cell-0'])
  })

  it('is hidden while the document has no headings', async () => {
    const { container } = await renderNotebook({ documents: { 'rox-analytics': HEADINGLESS } })
    expect(testId(container, 'cookbooks-outline')).toBeNull()
  })

  it('lists a playbook body and scrolls to its own block', async () => {
    const api = installApi({ status: RUNNING, cards: CARDS, documents: { 'churn-playbook': PLAYBOOK } })
    const container = await render()
    await click(container, 'cookbooks-card-churn-playbook')

    const items = allTestIds(container, 'cookbooks-outline-item-') as HTMLElement[]
    // `# Churn` is the only heading of the playbook body.
    expect(items.map((item) => item.textContent)).toEqual(['Churn'])

    await click(container, 'cookbooks-outline-item-0')
    expect(scrollCalls).toEqual(['cookbooks-playbook-markdown'])
    expect(api.counts.open).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Wave 9 — «выполнить выше/ниже»
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage subset runs (wave 9)', () => {
  it('runs the code cells strictly above the clicked one', async () => {
    const { api, container } = await renderNotebook({ runAll: answerRequestedCells })

    await click(container, 'cookbooks-run-above-3')

    expect(api.counts.runAll).toHaveLength(1)
    expect(api.counts.runAll[0].itemId).toBe('rox-analytics')
    expect(api.counts.runAll[0].cells).toEqual([
      { index: 1, source: 'print(1)' },
      { index: 2, source: 'raise ValueError("boom")' },
    ])

    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('ok')
    expect(testId(container, 'cookbooks-output-2')!.getAttribute('data-status')).toBe('ok')
    // Cell 3 was not in the batch — it keeps its pre-run hint and its counter.
    expect(testId(container, 'cookbooks-output-3')!.getAttribute('data-status')).toBe('idle')
    expect(testId(container, 'cookbooks-runs-3')!.textContent).toBe('[ ]')
    // The batch counts only what it ran.
    await expectStatus(container, 'cookbooks.status.runAll', { count: 2, ok: 2, failed: 0, skipped: 0 })
  })

  it('runs the code cells strictly below, and disables the empty side', async () => {
    const { api, container } = await renderNotebook({ runAll: answerRequestedCells })

    // Nothing above the first code cell, nothing below the last one.
    expect((testId(container, 'cookbooks-run-above-1') as HTMLButtonElement).disabled).toBe(true)
    expect((testId(container, 'cookbooks-run-below-3') as HTMLButtonElement).disabled).toBe(true)
    expect((testId(container, 'cookbooks-run-below-1') as HTMLButtonElement).disabled).toBe(false)
    // A markdown cell has nothing to execute — neither subset action exists.
    expect(testId(container, 'cookbooks-run-above-0')).toBeNull()
    expect(testId(container, 'cookbooks-run-below-0')).toBeNull()

    await click(container, 'cookbooks-run-below-1')
    expect(api.counts.runAll[0].cells).toEqual([
      { index: 2, source: 'raise ValueError("boom")' },
      { index: 3, source: 'print(3)' },
    ])
    expect(testId(container, 'cookbooks-output-2')!.getAttribute('data-status')).toBe('ok')
    expect(testId(container, 'cookbooks-runs-2')!.textContent).toBe('[1]')
    // The cell above the subset was never run, so it keeps its hint.
    expect(testId(container, 'cookbooks-output-1')!.getAttribute('data-status')).toBe('idle')
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[ ]')
  })
})

// ---------------------------------------------------------------------------
// Wave 9 — autoscroll and `\r`
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage autoscroll (wave 9)', () => {
  it('scrolls the cell into view when a single run starts', async () => {
    const { container } = await renderNotebook({ run: async () => RUN_OK })
    await click(container, 'cookbooks-run-3')
    expect(scrollCalls).toEqual(['cookbooks-cell-3'])
  })

  it('renders a carriage-return progress bar as its final frame', async () => {
    const { container } = await renderNotebook({
      run: async () => ({
        ok: true,
        stdout: '10%|  | 1/2\r100%|##| 2/2\n',
        error: null,
        timedOut: false,
        missing: [],
        displays: [],
      }),
    })
    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-output-1')!.textContent).toBe('100%|##| 2/2\n')
  })

  it('copies the output exactly as shown, carriage returns normalized', async () => {
    const copied: string[] = []
    const { container } = await renderNotebook(
      {
        run: async () => ({
          ok: true,
          stdout: 'первый кадр\rпоследний кадр\n',
          error: null,
          timedOut: false,
          missing: [],
          displays: [],
        }),
      },
      {
        writeClipboard: async (text) => {
          copied.push(text)
        },
      },
    )
    await click(container, 'cookbooks-run-1')

    const shown = testId(container, 'cookbooks-output-1')!.textContent
    expect(shown).toBe('последний кадр\n')
    await click(container, 'cookbooks-copy-output-1')
    expect(copied).toEqual([shown])
  })
})

// ---------------------------------------------------------------------------
// Wave 9 — copy source
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage copy source (wave 9)', () => {
  it('copies the source as shown, code and markdown alike, and toasts', async () => {
    const copied: string[] = []
    const { container } = await renderNotebook(
      {},
      {
        writeClipboard: async (text) => {
          copied.push(text)
        },
      },
    )
    await type(container, 'cookbooks-source-1', 'print(9)')
    await click(container, 'cookbooks-copy-source-1')

    expect(copied).toEqual(['print(9)'])
    expect(toasts).toContain(`success:${t('cookbooks.notice.sourceCopied')}`)

    // A markdown cell copies its markdown source, not its rendering.
    await click(container, 'cookbooks-copy-source-0')
    expect(copied).toEqual(['print(9)', '# Заметка'])
  })

  it('toasts a failure when the clipboard write rejects', async () => {
    const { container } = await renderNotebook(
      {},
      {
        writeClipboard: async () => {
          throw new Error('denied')
        },
      },
    )
    await click(container, 'cookbooks-copy-source-1')
    expect(toasts).toContain(`error:${t('toast.copyFailed')}`)
  })
})

// ---------------------------------------------------------------------------
// Wave 9 — .ipynb export
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage export (wave 9)', () => {
  it('is offered for a supported notebook only', async () => {
    const { container } = await renderNotebook({
      documents: { 'rox-analytics': NOTEBOOK, 'churn-playbook': PLAYBOOK },
    })
    expect(testId(container, 'cookbooks-export')!.textContent).toBe(t('cookbooks.actions.export'))

    // A playbook is not a notebook: nothing to export.
    await click(container, 'cookbooks-card-churn-playbook')
    expect(testId(container, 'cookbooks-export')).toBeNull()
  })

  it('is withheld for an unsupported notebook', async () => {
    const { container } = await renderNotebook({
      documents: { 'rox-analytics': { ...NOTEBOOK, supported: false } },
    })
    expect(testId(container, 'cookbooks-export')).toBeNull()
    expect(testId(container, 'cookbooks-run-all')).toBeNull()
    // A batch the sidecar would refuse is not offered as a subset either.
    expect((testId(container, 'cookbooks-run-above-3') as HTMLButtonElement).disabled).toBe(true)
    expect((testId(container, 'cookbooks-run-below-1') as HTMLButtonElement).disabled).toBe(true)
  })

  it('builds the notebook from the current sources, counters and outputs', async () => {
    const { api, container } = await renderNotebook({ run: async (call) => (call.index === 2 ? RUN_ERROR : RUN_OK) })
    await click(container, 'cookbooks-run-2')
    await click(container, 'cookbooks-run-1')
    await type(container, 'cookbooks-source-3', 'print(42)')
    await click(container, 'cookbooks-export')

    expect(api.counts.export).toHaveLength(1)
    const call = api.counts.export[0]
    expect(call.itemId).toBe('rox-analytics')
    expect(call.filename).toBe('ROX-Analytics.ipynb')

    const notebook = JSON.parse(call.content) as {
      nbformat: number
      nbformat_minor: number
      metadata: { title: string }
      cells: Record<string, unknown>[]
    }
    expect(notebook.nbformat).toBe(4)
    expect(notebook.nbformat_minor).toBe(5)
    expect(notebook.metadata.title).toBe('ROX Analytics')
    expect(notebook.cells).toHaveLength(4)

    // The markdown cell carries no execution count and no outputs.
    expect(notebook.cells[0]).toMatchObject({ cell_type: 'markdown', source: ['# Заметка'] })
    // A run cell carries its counter and its stdout as a stream output.
    expect(notebook.cells[1]).toMatchObject({ cell_type: 'code', execution_count: 1 })
    expect(notebook.cells[1].outputs).toEqual([{ output_type: 'stream', name: 'stdout', text: ['42\n'] }])
    // A failure lands as stderr, the cell's own traceback.
    expect(notebook.cells[2].outputs).toEqual([
      { output_type: 'stream', name: 'stderr', text: ['ValueError: boom'] },
    ])
    // An unsaved edit is exported as it stands, with no run behind it.
    expect(notebook.cells[3]).toMatchObject({ source: ['print(42)'], execution_count: null, outputs: [] })

    expect(testId(container, 'cookbooks-status')!.textContent).toContain(
      t('cookbooks.export.saved', { path: '/tmp/rox-analytics.ipynb' }),
    )
  })

  it('reports a cancelled save dialog without an error', async () => {
    const { container } = await renderNotebook({ export: async () => ({ saved: false }) })
    await click(container, 'cookbooks-export')
    expect(testId(container, 'cookbooks-status')!.textContent).toContain(t('cookbooks.export.cancelled'))
  })

  it('reports a failed write', async () => {
    const { container } = await renderNotebook({
      export: async () => {
        throw new Error('EACCES: permission denied')
      },
    })
    await click(container, 'cookbooks-export')
    expect(testId(container, 'cookbooks-status')!.textContent).toContain(t('cookbooks.export.failed'))
  })
})

// ---------------------------------------------------------------------------
// Wave 10 — cell structure (insert rows, per-cell menu, Ctrl+M, focus)
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage cell structure (wave 10)', () => {
  it('offers one insert row per cell boundary and after the last cell', async () => {
    const { container } = await renderNotebook()

    for (let index = 0; index <= NOTEBOOK.cells.length; index += 1) {
      expect(testId(container, `cookbooks-insert-${index}`)).not.toBeNull()
    }
    expect(testId(container, `cookbooks-insert-${NOTEBOOK.cells.length + 1}`)).toBeNull()
  })

  it('inserts a code or markdown cell at any boundary', async () => {
    const { api, container } = await renderNotebook()

    await click(container, 'cookbooks-insert-code-0')
    await click(container, 'cookbooks-insert-text-2')
    await click(container, 'cookbooks-insert-code-4')

    expect(api.counts.mutate).toEqual([
      { itemId: 'rox-analytics', op: 'add', cellType: 'code', index: 0 },
      { itemId: 'rox-analytics', op: 'add', cellType: 'markdown', index: 2 },
      { itemId: 'rox-analytics', op: 'add', cellType: 'code', index: 4 },
    ])
  })

  it('keeps the lone insert row of an empty notebook always visible', async () => {
    const { container } = await renderNotebook({ documents: { 'rox-analytics': { ...NOTEBOOK, cells: [] } } })

    const row = testId(container, 'cookbooks-insert-0') as HTMLElement
    expect(row.className).toContain('opacity-100')
    expect(testId(container, 'cookbooks-insert-1')).toBeNull()
    expect((testId(container, 'cookbooks-insert-code-0') as HTMLButtonElement).disabled).toBe(false)
  })

  it('reveals a between-cell insert row on hover or focus only', async () => {
    const { container } = await renderNotebook()
    const row = testId(container, 'cookbooks-insert-1') as HTMLElement
    expect(row.className).toContain('opacity-0')
    expect(row.className).toContain('hover:opacity-100')
    expect(row.className).toContain('focus-within:opacity-100')
  })

  it('flushes the unsaved edits before the mutation, in ascending document order', async () => {
    const { api, container } = await renderNotebook()
    // Type the later cell first: the flush must still save in document order.
    await type(container, 'cookbooks-source-2', 'raise ValueError("boom") # edited')
    await type(container, 'cookbooks-source-1', 'print(9)')

    await click(container, 'cookbooks-insert-code-0')

    expect(api.counts.save).toEqual([
      { itemId: 'rox-analytics', index: 1, source: 'print(9)' },
      { itemId: 'rox-analytics', index: 2, source: 'raise ValueError("boom") # edited' },
    ])
    expect(api.counts.mutate).toEqual([{ itemId: 'rox-analytics', op: 'add', cellType: 'code', index: 0 }])
    // save → mutate, never the other way round.
    expect(api.events).toEqual(['save', 'save', 'mutate:add'])
  })

  it('aborts the mutation when flushing an edit fails', async () => {
    const { api, container } = await renderNotebook({
      save: async () => {
        throw new Error('disk full')
      },
    })
    await type(container, 'cookbooks-source-1', 'print(9)')

    await click(container, 'cookbooks-insert-code-0')

    expect(api.counts.save).toHaveLength(1)
    expect(api.counts.mutate).toHaveLength(0)
    expect(testId(container, 'cookbooks-status')!.textContent).toContain('disk full')
  })

  it('opens the «⋯» menu, disables the edges and runs the operations', async () => {
    const { api, container } = await renderNotebook()
    expect(testId(container, 'cookbooks-menu-row-1')).toBeNull()

    await click(container, 'cookbooks-menu-1')
    expect(testId(container, 'cookbooks-menu-row-1')).not.toBeNull()
    expect((testId(container, 'cookbooks-move-up-1') as HTMLButtonElement).disabled).toBe(false)
    expect((testId(container, 'cookbooks-move-down-1') as HTMLButtonElement).disabled).toBe(false)

    // The first and last cells cannot move past their end of the document.
    await click(container, 'cookbooks-menu-0')
    expect((testId(container, 'cookbooks-move-up-0') as HTMLButtonElement).disabled).toBe(true)
    await click(container, 'cookbooks-menu-3')
    expect((testId(container, 'cookbooks-move-down-3') as HTMLButtonElement).disabled).toBe(true)

    // A second click on the open trigger closes the disclosure again.
    await click(container, 'cookbooks-menu-3')
    expect(testId(container, 'cookbooks-menu-row-3')).toBeNull()

    await click(container, 'cookbooks-menu-1')
    await click(container, 'cookbooks-move-down-1')
    await click(container, 'cookbooks-menu-2')
    await click(container, 'cookbooks-duplicate-2')

    expect(api.counts.mutate).toEqual([
      { itemId: 'rox-analytics', op: 'move', from: 1, to: 2 },
      { itemId: 'rox-analytics', op: 'duplicate', index: 2 },
    ])
  })

  it('closes the open menu on Esc before it reaches the stop binding', async () => {
    const { api, container } = await renderNotebook()
    const pane = testId(container, 'cookbooks-document')!

    await click(container, 'cookbooks-menu-1')
    expect(testId(container, 'cookbooks-menu-row-1')).not.toBeNull()

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => {
      pane.dispatchEvent(escape)
    })
    await flush()

    expect(escape.defaultPrevented).toBe(true)
    expect(testId(container, 'cookbooks-menu-row-1')).toBeNull()
    // Nothing was running, so the stop binding never fired.
    expect(api.counts.cancel).toHaveLength(0)
  })

  it('deletes a cell only after the confirmation is accepted', async () => {
    const confirm = stubConfirm(true)
    const { api, container } = await renderNotebook()

    await click(container, 'cookbooks-menu-2')
    await click(container, 'cookbooks-delete-2')

    expect(confirm.calls).toEqual([t('cookbooks.cell.deleteConfirm')])
    expect(api.counts.mutate).toEqual([{ itemId: 'rox-analytics', op: 'delete', index: 2 }])
  })

  it('leaves the document untouched when the delete is declined', async () => {
    stubConfirm(false)
    const { api, container } = await renderNotebook()

    await click(container, 'cookbooks-menu-2')
    await click(container, 'cookbooks-delete-2')

    expect(api.counts.mutate).toHaveLength(0)
  })

  it('surfaces the sidecar 409 and leaves the document unchanged', async () => {
    const { api, container } = await renderNotebook({
      mutate: async () => {
        throw new CookbooksApiError(409, 'notebook is running')
      },
    })
    const before = allTestIds(container, 'cookbooks-cell-').length

    await click(container, 'cookbooks-insert-code-0')

    // The sidecar's own message reaches the status line, verbatim.
    expect(api.counts.mutate).toHaveLength(1)
    expect(testId(container, 'cookbooks-status')!.textContent).toContain('notebook is running')
    // The mutation never landed: the document was neither re-read nor re-rendered.
    expect(api.counts.document).toHaveLength(0)
    expect(allTestIds(container, 'cookbooks-cell-')).toHaveLength(before)
    // The busy lock is released and the menu stayed shut.
    expect((testId(container, 'cookbooks-insert-code-0') as HTMLButtonElement).disabled).toBe(false)
    expect(testId(container, 'cookbooks-menu-row-0')).toBeNull()
  })

  it('blocks every insert, menu and mutation control while a run is in flight', async () => {
    const gate = Promise.withResolvers<CookbooksRunResult>()
    const { container } = await renderNotebook({ run: () => gate.promise })

    await click(container, 'cookbooks-menu-1')
    await act(async () => {
      ;(testId(container, 'cookbooks-run-1') as HTMLButtonElement).click()
    })
    await flush(1)

    for (const id of ['cookbooks-insert-code-0', 'cookbooks-insert-text-4', 'cookbooks-menu-0']) {
      const control = testId(container, id) as HTMLButtonElement
      expect(control.disabled).toBe(true)
      expect(control.getAttribute('title')).toBe(t('cookbooks.actions.busyHint'))
    }
    for (const id of ['cookbooks-move-down-1', 'cookbooks-duplicate-1', 'cookbooks-delete-1']) {
      expect((testId(container, id) as HTMLButtonElement).disabled).toBe(true)
    }

    await act(async () => {
      gate.resolve(RUN_OK)
      await gate.promise
    })
    await flush()
    expect((testId(container, 'cookbooks-insert-code-0') as HTMLButtonElement).disabled).toBe(false)
  })

  it('Ctrl+M inserts a code cell below the focused cell', async () => {
    const { api, container } = await renderNotebook()
    const field = testId(container, 'cookbooks-source-1') as HTMLTextAreaElement
    field.focus()

    const event = new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true, cancelable: true })
    await act(async () => {
      field.dispatchEvent(event)
    })
    await flush()

    expect(event.defaultPrevented).toBe(true)
    expect(api.counts.mutate).toEqual([{ itemId: 'rox-analytics', op: 'add', cellType: 'code', index: 2 }])
  })

  it('Ctrl+M with nothing focused appends the new cell at the end', async () => {
    const { api, container } = await renderNotebook()
    const pane = testId(container, 'cookbooks-document')!

    const event = new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true, cancelable: true })
    await act(async () => {
      pane.dispatchEvent(event)
    })
    await flush()

    expect(api.counts.mutate).toEqual([{ itemId: 'rox-analytics', op: 'add', cellType: 'code', index: 4 }])
  })

  it('Ctrl+M still inserts in an unsupported notebook, where the run gates stay shut', async () => {
    const { api, container } = await renderNotebook({
      documents: { 'rox-analytics': { ...NOTEBOOK, supported: false } },
    })
    // A structural edit is not a run: the insert UI — and Ctrl+M — are offered
    // even without kernel support, while batch runs remain withheld.
    expect(testId(container, 'cookbooks-run-all')).toBeNull()

    const field = testId(container, 'cookbooks-source-1') as HTMLTextAreaElement
    field.focus()

    const event = new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true, cancelable: true })
    await act(async () => {
      field.dispatchEvent(event)
    })
    await flush()

    expect(event.defaultPrevented).toBe(true)
    expect(api.counts.mutate).toEqual([{ itemId: 'rox-analytics', op: 'add', cellType: 'code', index: 2 }])
  })

  it('leaves Cmd+M and the shifted chord alone', async () => {
    const { api, container } = await renderNotebook()
    const field = testId(container, 'cookbooks-source-1') as HTMLTextAreaElement
    field.focus()

    const meta = new KeyboardEvent('keydown', { key: 'm', metaKey: true, bubbles: true, cancelable: true })
    const shifted = new KeyboardEvent('keydown', {
      key: 'm',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      field.dispatchEvent(meta)
      field.dispatchEvent(shifted)
    })
    await flush()

    expect(api.counts.mutate).toHaveLength(0)
    expect(meta.defaultPrevented).toBe(false)
    expect(shifted.defaultPrevented).toBe(false)
  })

  it('focuses and scrolls to the code cell an insert lands on', async () => {
    const inserted = withCellAt(NOTEBOOK, 0, { cellType: 'code', source: '', outputs: [], executionCount: null })
    const { container } = await renderNotebook({ mutate: mutationResult(inserted, 0) })

    await click(container, 'cookbooks-insert-code-0')

    expect(scrollCalls).toContain('cookbooks-cell-0')
    expect(document.activeElement).toBe(testId(container, 'cookbooks-source-0'))
  })

  it('does not steal a markdown successor into edit mode on delete', async () => {
    const twoCells: CookbooksDocument = {
      ...NOTEBOOK,
      cells: [
        { cellType: 'code', source: 'print(1)', outputs: [], executionCount: null },
        { cellType: 'markdown', source: '# Заметка', outputs: [], executionCount: null },
      ],
    }
    // Deleting the code cell leaves the markdown cell at index 0 — and it must
    // stay in read mode: only an insert opens the markdown editor.
    const afterDelete: CookbooksDocument = {
      ...NOTEBOOK,
      cells: [{ cellType: 'markdown', source: '# Заметка', outputs: [], executionCount: null }],
    }
    stubConfirm(true)
    const { api, container } = await renderNotebook({
      documents: { 'rox-analytics': twoCells },
      mutate: mutationResult(afterDelete, 0),
    })

    await click(container, 'cookbooks-menu-0')
    await click(container, 'cookbooks-delete-0')

    expect(api.counts.mutate).toEqual([{ itemId: 'rox-analytics', op: 'delete', index: 0 }])
    expect(testId(container, 'cookbooks-markdown-0')).not.toBeNull()
    expect(testId(container, 'cookbooks-source-0')).toBeNull()
  })

  it('opens an inserted markdown cell in edit mode so it can take focus', async () => {
    const inserted = withCellAt(NOTEBOOK, 0, { cellType: 'markdown', source: '', outputs: [], executionCount: null })
    const { container } = await renderNotebook({ mutate: mutationResult(inserted, 0) })

    await click(container, 'cookbooks-insert-text-0')

    const field = testId(container, 'cookbooks-source-0') as HTMLTextAreaElement
    expect(field).not.toBeNull()
    expect(document.activeElement).toBe(field)
  })

  it('drops the focus request when a delete empties the notebook', async () => {
    stubConfirm(true)
    const { container } = await renderNotebook({ mutate: mutationResult({ ...NOTEBOOK, cells: [] }, -1) })

    await click(container, 'cookbooks-menu-0')
    await click(container, 'cookbooks-delete-0')

    expect(testId(container, 'cookbooks-source-0')).toBeNull()
    // The emptied notebook shows its lone, always-visible insert row again.
    expect((testId(container, 'cookbooks-insert-0') as HTMLElement).className).toContain('opacity-100')
  })

  it('renders no insert rows, menus or Ctrl+M binding in a playbook', async () => {
    const api = installApi({ status: RUNNING, cards: CARDS, documents: { 'churn-playbook': PLAYBOOK } })
    const container = await render()
    await click(container, 'cookbooks-card-churn-playbook')

    expect(testId(container, 'cookbooks-insert-0')).toBeNull()
    expect(testId(container, 'cookbooks-menu-0')).toBeNull()

    await act(async () => {
      testId(container, 'cookbooks-document')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true, cancelable: true }),
      )
    })
    await flush()
    expect(api.counts.mutate).toHaveLength(0)
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

// ---------------------------------------------------------------------------
// Q2A i18n contract — the frozen RU copy of the Colab-микро wave (R-A/R-B/R-C).
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage Q2A copy', () => {
  it('carries the four new keys with their frozen RU values', () => {
    expect(t('cookbooks.actions.clearAllOutputs')).toBe('Очистить все выводы')
    expect(t('cookbooks.cell.expandOutput')).toBe('Показать полностью')
    expect(t('cookbooks.cell.collapseOutput')).toBe('Свернуть')
    expect(t('cookbooks.help.shortcutNav')).toContain('Alt+↑/↓')
  })
})

// ---------------------------------------------------------------------------
// Wave 11 — rich output (`display_data`) and persisted outputs
// ---------------------------------------------------------------------------

/** A 1×1 PNG, base64 — the payload the sidecar writes for an `image/png` record. */
const PNG_DATA =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
/** `<svg xmlns="http://www.w3.org/2000/svg"/>` in base64 — the svg record's payload. */
const SVG_DATA = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='
/** A JPEG header's bytes in base64 — only the mime of the data-URL is under test. */
const JPEG_DATA = '/9j/4AAQSkZJRg=='

/**
 * Wave 11: the three display events one smoke cell emits — the emitter picks a
 * single widget-mime per event (canon order), so a cell with three events draws
 * three widgets. The cell prints its own line alongside the first one.
 */
const SMOKE_EVENTS: CookbooksOutput[] = [
  savedOutput('печатаю', [{ mime: 'image/png', data: PNG_DATA }]),
  savedOutput('', [{ mime: 'text/html', data: '<b>итог</b>' }]),
  savedOutput('', [{ mime: 'application/json', data: '{"ok":true,"n":2}' }]),
]

/**
 * Wave 11: one saved output record as the sidecar writes it — its text, the
 * rich records it carries and its traceback. Every rich fixture below goes
 * through this shape, so the document and the surface cannot drift.
 */
function savedOutput(text: string, displays: CookbooksDisplay[] = [], traceback: string | null = null): CookbooksOutput {
  return { text, traceback, displays }
}

/**
 * Wave 11: a reopened copy — one code cell with the saved output records and the
 * nbformat `execution_count` the file holds (the wave-11 DTO adds both).
 */
function savedNotebook(outputs: CookbooksOutput[], executionCount: number | null): CookbooksDocument {
  return { ...NOTEBOOK, cells: [{ cellType: 'code', source: 'plot()', outputs, executionCount }] }
}

describe('CookbooksSurfacePage rich output (wave 11)', () => {
  it('renders a saved image record as a data-URL img with its frozen alt text', async () => {
    const { container } = await renderNotebook({
      documents: { 'rox-analytics': savedNotebook([savedOutput('', [{ mime: 'image/png', data: PNG_DATA }])], 3) },
    })

    const output = testId(container, 'cookbooks-output-0')!
    expect(output.getAttribute('data-status')).toBe('saved')
    // The saved result and its counter are on screen before anything runs.
    expect(testId(container, 'cookbooks-runs-0')!.textContent).toBe('[3]')

    const img = output.querySelector('img')!
    expect(img.getAttribute('src')).toBe(`data:image/png;base64,${PNG_DATA}`)
    expect(img.getAttribute('alt')).toBe(t('cookbooks.output.imageAlt'))
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('referrerpolicy') ?? img.getAttribute('referrerPolicy') ?? img.referrerPolicy).toBe(
      'no-referrer',
    )
    expect(img.className).toContain('max-w-full')
    expect(img.className).toContain('rounded-[var(--radius-control)]')
    expect(img.className).toContain('border-border-subtle')
    // Nothing printed, so the block shows the frozen «graphical output» marker.
    expect(output.querySelector('pre')!.textContent).toBe(t('cookbooks.output.richPlaceholder'))
  })

  it('carries each event’s own mime in the data-URL of its image', async () => {
    // One widget-mime per event: an svg event and a jpeg event, one record each.
    const { container } = await renderNotebook({
      documents: {
        'rox-analytics': savedNotebook(
          [
            savedOutput('', [{ mime: 'image/svg+xml', data: SVG_DATA }]),
            savedOutput('', [{ mime: 'image/jpeg', data: JPEG_DATA }]),
          ],
          1,
        ),
      },
    })

    const images = testId(container, 'cookbooks-output-0')!.querySelectorAll('img')
    expect(images).toHaveLength(2)
    expect(images[0].getAttribute('src')).toBe(`data:image/svg+xml;base64,${SVG_DATA}`)
    expect(images[1].getAttribute('src')).toBe(`data:image/jpeg;base64,${JPEG_DATA}`)
  })

  it('renders a saved HTML record in a script-only sandboxed frame', async () => {
    const { container } = await renderNotebook({
      documents: {
        'rox-analytics': savedNotebook([savedOutput('', [{ mime: 'text/html', data: '<b>итог</b>' }])], null),
      },
    })

    const frame = testId(container, 'cookbooks-display-frame-0') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    // Scripts alone would be harmless; same-origin plus scripts would hand the
    // record this window's origin and its preload bridge.
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    // The record carries its OWN policy first, so the application's CSP never
    // leaks into the frame and the record can neither fetch nor post anywhere.
    const srcdoc = frame.getAttribute('srcdoc')!
    expect(srcdoc.startsWith('<meta')).toBe(true)
    expect(srcdoc).toContain('http-equiv="Content-Security-Policy"')
    expect(srcdoc).toContain("default-src 'none'")
    expect(srcdoc).toContain("form-action 'none'")
    expect(srcdoc).toContain("base-uri 'none'")
    // …and the record itself still travels verbatim, right after the policy.
    expect(srcdoc.endsWith('<b>итог</b>')).toBe(true)
    expect(frame.getAttribute('title')).toBe(t('cookbooks.output.frameTitle'))
    expect(frame.getAttribute('referrerpolicy') ?? frame.getAttribute('referrerPolicy') ?? frame.referrerPolicy).toBe(
      'no-referrer',
    )
    expect(frame.className).toContain('min-h-[120px]')
    expect(frame.className).toContain('bg-white')
    // No `execution_count` in the file: a saved result with an empty counter.
    expect(testId(container, 'cookbooks-runs-0')!.textContent).toBe('[ ]')
  })

  it('pretty-prints a JSON record and shows a payload that is not JSON verbatim', async () => {
    const document: CookbooksDocument = {
      ...NOTEBOOK,
      cells: [
        {
          cellType: 'code',
          source: 'a',
          outputs: [savedOutput('', [{ mime: 'application/json', data: '{"b":1,"a":[1,2]}' }])],
          executionCount: 1,
        },
        {
          cellType: 'code',
          source: 'b',
          outputs: [savedOutput('', [{ mime: 'application/json', data: 'not json' }])],
          executionCount: 2,
        },
      ],
    }
    const { container } = await renderNotebook({ documents: { 'rox-analytics': document } })

    expect(testId(container, 'cookbooks-display-json-0')!.textContent).toBe('{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}')
    expect(testId(container, 'cookbooks-display-json-1')!.textContent).toBe('not json')
  })

  it('renders a markdown record through the minimal markdown renderer', async () => {
    const { container } = await renderNotebook({
      documents: { 'rox-analytics': savedNotebook([savedOutput('', [{ mime: 'text/markdown', data: '# Итог' }])], 1) },
    })

    const rendered = testId(container, 'cookbooks-display-markdown-0')!
    // The md-cell contract: the editor is never mounted for a rich record.
    expect(rendered.getAttribute('data-mode')).toBe('minimal')
    expect(rendered.querySelector('h1')?.textContent).toBe('Итог')
  })

  it('carries a mime it does not render without drawing a widget for it', async () => {
    const { container } = await renderNotebook({
      documents: {
        'rox-analytics': savedNotebook(
          [savedOutput('', [{ mime: 'text/latex', data: '$x^2$' }, { mime: 'text/plain', data: 'x**2' }])],
          1,
        ),
      },
    })

    // Latex is out of scope for this wave (SPEC §Вне скоупа): the record is
    // carried by the document and reaches the export, but draws no widget — and
    // the plain-text record still gives the block its fallback text.
    expect(allTestIds(container, 'cookbooks-display-')).toHaveLength(0)
    expect(testId(container, 'cookbooks-output-0')!.querySelector('pre')!.textContent).toBe('x**2')
  })

  it('draws every rich record of a cell, in emission order, after the text', async () => {
    const { container } = await renderNotebook({
      documents: { 'rox-analytics': savedNotebook(SMOKE_EVENTS, 1) },
    })

    const output = testId(container, 'cookbooks-output-0')!
    expect(allTestIds(container, 'cookbooks-display-').map((element) => element.getAttribute('data-testid'))).toEqual([
      'cookbooks-display-image-0',
      'cookbooks-display-frame-0',
      'cookbooks-display-json-0',
    ])
    // The cell's own text stays the first thing the block shows.
    expect(output.firstElementChild?.tagName.toLowerCase()).toBe('pre')
    expect(output.firstElementChild?.textContent).toBe('печатаю')
  })

  it('seeds the surface from the outputs and counters the opened copy holds', async () => {
    const document: CookbooksDocument = {
      ...NOTEBOOK,
      cells: [
        {
          cellType: 'code',
          source: 'a',
          outputs: [savedOutput('первая', [{ mime: 'image/png', data: PNG_DATA }]), savedOutput('вторая')],
          executionCount: 4,
        },
        { cellType: 'code', source: 'b', outputs: [savedOutput('', [], 'ValueError: boom')], executionCount: 1 },
        { cellType: 'code', source: 'c', outputs: [savedOutput('третья')], executionCount: null },
      ],
    }
    const { container } = await renderNotebook({ documents: { 'rox-analytics': document } })

    // Text, displays, status and counter all come from the copy — before any run.
    const first = testId(container, 'cookbooks-output-0')!
    expect(first.getAttribute('data-status')).toBe('saved')
    expect(first.querySelector('pre')!.textContent).toBe('первая\nвторая')
    expect(first.querySelector('img')).not.toBeNull()
    expect(testId(container, 'cookbooks-runs-0')!.textContent).toBe('[4]')
    expect(testId(container, 'cookbooks-runs-0')!.getAttribute('aria-label')).toBe(
      t('cookbooks.cell.runs', { count: 4 }),
    )

    // A saved traceback is the cell's error text; the result is still `saved`.
    const second = testId(container, 'cookbooks-output-1')!
    expect(second.getAttribute('data-status')).toBe('saved')
    expect(second.querySelector('pre')!.textContent).toBe('ValueError: boom')
    expect(testId(container, 'cookbooks-runs-1')!.textContent).toBe('[1]')

    // Saved output, no `execution_count` in the file: an empty counter.
    expect(testId(container, 'cookbooks-output-2')!.getAttribute('data-status')).toBe('saved')
    expect(testId(container, 'cookbooks-runs-2')!.textContent).toBe('[ ]')

    // Saved results are results: «Очистить все выводы» is offered from the start.
    expect(testId(container, 'cookbooks-clear-all-outputs')).not.toBeNull()
  })

  it('replaces a saved result, and counts up from its own counter, once the cell runs', async () => {
    const { container } = await renderNotebook({
      documents: { 'rox-analytics': savedNotebook([savedOutput('первая', [{ mime: 'image/png', data: PNG_DATA }])], 4) },
      run: async () => RUN_OK,
    })
    await click(container, 'cookbooks-run-0')

    const output = testId(container, 'cookbooks-output-0')!
    expect(output.getAttribute('data-status')).toBe('ok')
    expect(output.querySelector('pre')!.textContent).toBe('42\n')
    // The run answered no displays, so the saved image is gone with its result.
    expect(output.querySelector('img')).toBeNull()
    expect(testId(container, 'cookbooks-runs-0')!.textContent).toBe('[5]')
  })

  it('falls back to the plain-text record of a rich result', async () => {
    const { container } = await renderNotebook({
      documents: {
        'rox-analytics': savedNotebook(
          [savedOutput('', [{ mime: 'image/png', data: PNG_DATA }, { mime: 'text/plain', data: '2' }])],
          1,
        ),
      },
    })

    expect(testId(container, 'cookbooks-output-0')!.querySelector('pre')!.textContent).toBe('2')
    // The plain-text record is the fallback text, never a widget of its own.
    expect(allTestIds(container, 'cookbooks-display-')).toHaveLength(1)
  })

  it('reads the printed text and every plain-text display as one block', async () => {
    // `print("x")`, a `display("Подпись")` and a trailing `40+2`: three events —
    // the stream record and the two display records — read as one block, in order.
    const { container } = await renderNotebook({
      documents: {
        'rox-analytics': savedNotebook(
          [
            savedOutput('x'),
            savedOutput('', [{ mime: 'text/plain', data: 'Подпись' }]),
            savedOutput('', [{ mime: 'text/plain', data: '42' }]),
          ],
          1,
        ),
      },
    })

    expect(testId(container, 'cookbooks-output-0')!.querySelector('pre')!.textContent).toBe('x\nПодпись\n42')
  })

  it('shows a lone trailing value once, never twice', async () => {
    // `1+1` is a single `text/plain` record and no stream at all — it reads `2`.
    const { container } = await renderNotebook({
      documents: { 'rox-analytics': savedNotebook([savedOutput('', [{ mime: 'text/plain', data: '2' }])], 1) },
    })
    expect(testId(container, 'cookbooks-output-0')!.querySelector('pre')!.textContent).toBe('2')
  })

  it('merges a run’s stdout with the plain-text records it answered', async () => {
    const { container } = await renderNotebook({
      run: async () => ({ ...RUN_OK, stdout: 'x', displays: [{ mime: 'text/plain', data: 'Подпись' }] }),
    })
    await click(container, 'cookbooks-run-1')
    expect(testId(container, 'cookbooks-output-1')!.querySelector('pre')!.textContent).toBe('x\nПодпись')
  })

  it('copies the printed text together with its plain-text displays', async () => {
    const copied: string[] = []
    const { container } = await renderNotebook(
      {
        documents: {
          'rox-analytics': savedNotebook([savedOutput('x', [{ mime: 'text/plain', data: 'Подпись' }])], 1),
        },
      },
      {
        writeClipboard: async (text) => {
          copied.push(text)
        },
      },
    )
    await click(container, 'cookbooks-copy-output-0')
    expect(copied).toEqual(['x\nПодпись'])
  })

  it('copies the plain-text fallback of a rich result', async () => {
    const copied: string[] = []
    const { container } = await renderNotebook(
      {
        documents: {
          'rox-analytics': savedNotebook(
            [savedOutput('', [{ mime: 'image/png', data: PNG_DATA }, { mime: 'text/plain', data: '2' }])],
            1,
          ),
        },
      },
      {
        writeClipboard: async (text) => {
          copied.push(text)
        },
      },
    )
    await click(container, 'cookbooks-copy-output-0')
    expect(copied).toEqual(['2'])
  })

  it('copies the frozen rich placeholder when the result has no plain text', async () => {
    const copied: string[] = []
    const { container } = await renderNotebook(
      { documents: { 'rox-analytics': savedNotebook([savedOutput('', [{ mime: 'image/svg+xml', data: SVG_DATA }])], 1) } },
      {
        writeClipboard: async (text) => {
          copied.push(text)
        },
      },
    )
    await click(container, 'cookbooks-copy-output-0')
    expect(copied).toEqual([t('cookbooks.output.richPlaceholder')])
    expect(toasts).toContain(`success:${t('toast.copied')}`)
  })

  it('keeps the long-output collapse working for a saved result', async () => {
    const { container } = await renderNotebook({
      documents: {
        'rox-analytics': savedNotebook([savedOutput(LONG_STDOUT, [{ mime: 'image/png', data: PNG_DATA }])], 2),
      },
    })

    const output = testId(container, 'cookbooks-output-0')!
    expect(output.getAttribute('data-collapsed')).toBe('true')
    // The clamp is visual only: the collapsed block still carries every character.
    expect(output.querySelector('pre')!.textContent).toBe(LONG_STDOUT)
    // …and the rich record stays in the block while the text is clamped.
    expect(output.querySelector('img')).not.toBeNull()

    await click(container, 'cookbooks-output-toggle-0')
    expect(testId(container, 'cookbooks-output-0')!.getAttribute('data-collapsed')).toBe('false')
    expect((testId(container, 'cookbooks-output-toggle-0') as HTMLButtonElement).textContent).toBe(
      t('cookbooks.cell.collapseOutput'),
    )
  })

  it('clears a seeded result back to the pre-run hint', async () => {
    const { container } = await renderNotebook({
      documents: { 'rox-analytics': savedNotebook([savedOutput('сохранено', [{ mime: 'image/png', data: PNG_DATA }])], 2) },
    })

    await click(container, 'cookbooks-clear-output-0')
    const output = testId(container, 'cookbooks-output-0')!
    expect(output.getAttribute('data-status')).toBe('idle')
    expect(output.textContent).toBe(t('cookbooks.output.hint'))
    expect(output.querySelector('img')).toBeNull()
    // Clearing a result never rewinds the counter it was seeded from.
    expect(testId(container, 'cookbooks-runs-0')!.textContent).toBe('[2]')
  })

  it('renders the rich records a run answers with', async () => {
    const { container } = await renderNotebook({
      run: async () => ({ ...RUN_OK, stdout: '', displays: [{ mime: 'image/png', data: PNG_DATA }] }),
    })
    await click(container, 'cookbooks-run-1')

    const output = testId(container, 'cookbooks-output-1')!
    expect(output.getAttribute('data-status')).toBe('ok')
    // A run that printed nothing but drew something shows the rich marker…
    expect(output.querySelector('pre')!.textContent).toBe(t('cookbooks.output.richPlaceholder'))
    // …and the record itself.
    expect(output.querySelector('img')!.getAttribute('src')).toBe(`data:image/png;base64,${PNG_DATA}`)
  })

  it('renders the rich records a run-all answers with', async () => {
    const { container } = await renderNotebook({
      runAll: async () => ({
        cells: [
          {
            index: 1,
            status: 'ok',
            stdout: 'ok-1',
            error: null,
            displays: [{ mime: 'text/html', data: '<b>итог</b>' }],
          },
          { index: 2, status: 'error', stdout: '', error: 'ValueError: boom', displays: [] },
          { index: 3, status: 'skipped', stdout: '', error: null, displays: [] },
        ],
      }),
    })
    await click(container, 'cookbooks-run-all')

    // The frame leads with its own policy; the record follows it verbatim.
    const srcdoc = testId(container, 'cookbooks-display-frame-1')!.getAttribute('srcdoc')!
    expect(srcdoc).toContain("default-src 'none'")
    expect(srcdoc.endsWith('<b>итог</b>')).toBe(true)
    // The batch drew nothing else: only cell 1 grew a widget.
    expect(allTestIds(container, 'cookbooks-display-')).toHaveLength(1)
  })

  it('exports the session’s rich records as display_data outputs', async () => {
    const { api, container } = await renderNotebook({
      run: async () => ({ ...RUN_OK, displays: [{ mime: 'image/png', data: PNG_DATA }] }),
    })
    await click(container, 'cookbooks-run-1')
    await click(container, 'cookbooks-export')

    const notebook = JSON.parse(api.counts.export[0].content) as { cells: Record<string, unknown>[] }
    // The stream record comes first, the rich record after it (SPEC §16).
    expect(notebook.cells[1].outputs).toEqual([
      { output_type: 'stream', name: 'stdout', text: ['42\n'] },
      { output_type: 'display_data', metadata: {}, data: { 'image/png': PNG_DATA } },
    ])
  })
})

// ---------------------------------------------------------------------------
// Wave-11 i18n contract — the frozen RU copy of the rich-output keys.
// ---------------------------------------------------------------------------

describe('CookbooksSurfacePage wave-11 copy', () => {
  it('carries the three rich-output keys with their frozen RU values', () => {
    expect(t('cookbooks.output.imageAlt')).toBe('График из ячейки')
    expect(t('cookbooks.output.frameTitle')).toBe('HTML-вывод ячейки')
    expect(t('cookbooks.output.richPlaceholder')).toBe('[графический вывод]')
  })
})
