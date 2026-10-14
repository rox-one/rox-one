/**
 * CookbooksSurfacePage — the native «Кукбуки» surface (cookbooks-surface program).
 *
 * SPEC Amendment 1: the surface is native React in the ROX design system. There
 * is no `WebContentsView`, no `mount`/`setBounds` plumbing and no bounds math —
 * main owns the vendored Python sidecar and is the only process that ever sees
 * the bearer token, while this page renders a typed two-pane catalog + document
 * UI over the `cookbooksLab` IPC.
 *
 * Wave 7 (R1–R7) makes the document pane behave like a notebook: markdown cells
 * and playbooks render through the product `<Markdown>` component behind a
 * local «Изменить»/«Просмотр» toggle, every cell keeps a session run counter
 * and a busy spinner in its gutter, statuses report a measured duration, the
 * document header is sticky, and the Colab-parity keys (Shift+Enter,
 * Ctrl/Cmd+Enter, Ctrl/Cmd+Shift+Enter) are handled by the document container —
 * no global listeners and no `actions/*` registry changes.
 *
 * Wave 9 («Colab Controls & Navigation») adds the controlling half of Colab
 * parity: a stop control on every running cell and in the header while a batch
 * runs (Esc does the same), an outline of the H1–H3 headings of the open
 * document, «выполнить выше/ниже» subset runs, autoscroll to the cell a single
 * run starts, `\r`-shaped output, «копировать исходник» and the `.ipynb`
 * export. Cancellation is the sidecar's own: the surface calls
 * `cookbooks-lab:cancel` and reports whatever the in-flight run answers, so a
 * stopped cell is a result, not a guess.
 *
 * Every string comes from `cookbooks.*` through `t()` and every colour, radius,
 * type size and control height is a ROX token, so the surface follows the app
 * theme in all twelve locales and never drifts into ad-hoc styling.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePlatform } from '@rox/ui'
import { formatDuration } from '@rox/ui/chat/turn-utils'
import { Markdown, type RenderMode } from '@/components/markdown'
import { formatHotkeyDisplay } from '@/lib/platform'
import { prefersReducedMotionNow } from '@/lib/render-profile-motion'
import { cn } from '@/lib/utils'
import {
  buildNotebookExport,
  type CookbooksCard,
  type CookbooksDocument,
  type CookbooksRunCell,
  type CookbooksStatus,
} from '../../../shared/cookbooks'
import { normalizeOutputText } from './output-text'

/** Catalog/kind labels — the pill text is a per-kind i18n key, never a literal. */
const KIND_LABEL_KEY: Record<CookbooksCard['kind'], string> = {
  ipynb: 'cookbooks.card.kindNotebook',
  md: 'cookbooks.card.kindPlaybook',
}

/** The compact `<details>` help (SPEC Amendment 1 §Renderer, 7 keys). */
const HELP_KEYS: readonly string[] = [
  'cookbooks.help.cookbook',
  'cookbooks.help.copy',
  'cookbooks.help.run',
  'cookbooks.help.secrets',
  'cookbooks.help.reset',
  'cookbooks.help.timeout',
]

/**
 * R7: the shortcut block appended to the help disclosure, in R5 order, plus
 * Q2A's R-A navigation line and wave 9's stop key — the cheatsheet mirrors
 * exactly what is bound.
 */
const SHORTCUT_KEYS: readonly string[] = [
  'cookbooks.help.shortcutRun',
  'cookbooks.help.shortcutRunStay',
  'cookbooks.help.shortcutRunAll',
  'cookbooks.help.shortcutNav',
  'cookbooks.help.shortcutStop',
]

/**
 * Wave 9 outline: ATX heading, H1–H3 only, no trailing `#` run. Setext
 * headings are not part of the contract — the outline lists what the document
 * writes as a heading line.
 */
const HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*#*$/

/** The H1–H3 titles of one markdown block, in the order it writes them. */
function headingsOf(source: string): string[] {
  const titles: string[] = []
  for (const line of source.split('\n')) {
    const match = HEADING_PATTERN.exec(line)
    if (match) titles.push(match[2].trim())
  }
  return titles
}

/** One outline entry: its title and the element its click scrolls to. */
interface CookbooksOutlineEntry {
  title: string
  /** `data-testid` of the block the heading belongs to. */
  testId: string
}

/** The only `disabledReason` the contract names; anything else is shown raw. */
const FILE_MISSING_REASON = 'file missing'

/**
 * R-B: an output longer than this starts collapsed, so a chatty cell («print
 * everything») cannot push the rest of the document off screen. One named
 * constant — the copy block and «Копировать вывод» always keep the full text.
 */
const OUTPUT_COLLAPSE_THRESHOLD = 600

/** Shared control chrome: ROX hit target, radius, hover and focus tokens. */
const ACTION_CLASS =
  'inline-flex h-[var(--control-md)] items-center justify-center rounded-[var(--radius-control)] border border-border-subtle bg-surface-hover px-2.5 text-small text-foreground transition-colors hover:bg-surface-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:cursor-default disabled:opacity-50'

/** Shared editable-source chrome: the cell editor and the playbook editor. */
const SOURCE_CLASS =
  'w-full resize-y rounded-[var(--radius-control)] border border-border-subtle bg-surface-input px-2 py-1.5 font-mono text-small text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground'

/** Read-only markdown surface (md cell in `minimal`, playbook in `full`). */
const MARKDOWN_CLASS =
  'rounded-[var(--radius-control)] border border-border-subtle bg-surface-hover px-2.5 py-1.5 text-small text-foreground'

/** Surface UI states, projected from the main-process runtime status. */
type CookbooksPageUi = 'starting' | 'ready' | 'unavailable' | 'failed' | 'stopped'

/**
 * Wave 9: the status vocabulary the surface renders — the sidecar's own three
 * values plus the local `cancelled` a stopped execution lands on. A stopping
 * batch omits the cells it never reached, so their status can only be decided
 * here.
 */
type CookbooksCellStatus = CookbooksRunCell['status'] | 'cancelled'

/** One rendered cell result: the run-all DTO widened with the local status. */
type CookbooksCellResult = Omit<CookbooksRunCell, 'status'> & { status: CookbooksCellStatus }

/**
 * Frozen status → screen mapping: `idle|starting` → preparing; `running` → the
 * native catalog + document; `stopped|stopping` → retryable stop; `failed`
 * splits `python-missing` (its own copy) from every other reason.
 */
function toPageUi(status: CookbooksStatus): CookbooksPageUi {
  switch (status.state) {
    case 'running':
      return 'ready'
    case 'stopped':
    case 'stopping':
      return 'stopped'
    case 'failed':
      return status.reason === 'python-missing' ? 'unavailable' : 'failed'
    default:
      return 'starting'
  }
}

/**
 * One line of feedback under the surface header: either an i18n key with its
 * interpolation parameters, or the sidecar's own text (SPEC: sidecar errors are
 * forwarded verbatim, never swallowed).
 */
type CookbooksNotice =
  | { source: 'key'; key: string; params?: Record<string, string | number> }
  | { source: 'text'; text: string }

function describeFailure(cause: unknown): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : String(cause)
}

/**
 * The clipboard write behind «Копировать вывод». Injectable so tests (and any
 * other host of this page) can capture or stub it instead of touching the real
 * `navigator.clipboard`.
 */
export type CookbooksClipboardWriter = (text: string) => Promise<void>

const defaultWriteClipboard: CookbooksClipboardWriter = (text) => navigator.clipboard.writeText(text)

export interface CookbooksSurfacePageProps {
  /** Overrides `navigator.clipboard.writeText`. */
  writeClipboard?: CookbooksClipboardWriter
}

/** The text a cell output block shows — the block and «Копировать вывод» agree. */
type OutputTextReader = (cell: CookbooksCellResult | undefined) => string

/**
 * The rendered form of one markdown block. Memoized per block, so editing a
 * source, ticking a run status or any other surface state never re-parses the
 * markdown of the blocks that did not change (SPEC R1).
 */
const CellMarkdown = memo(function CellMarkdown({
  mode,
  source,
  testId,
}: {
  mode: RenderMode
  source: string
  testId: string
}) {
  // G4-CB-001: route markdown links through the app's platform handlers — the
  // canonical <a> then preventDefaults both target kinds instead of letting the
  // click fall through to native window navigation.
  const { onOpenUrl, onOpenFile } = usePlatform()
  return (
    <div data-testid={testId} data-mode={mode} className={MARKDOWN_CLASS}>
      <Markdown mode={mode} onUrlClick={onOpenUrl} onFileClick={onOpenFile}>
        {source}
      </Markdown>
    </div>
  )
})

/**
 * The per-cell output block: pill-free, `data-status`-tagged, honest about
 * emptiness. R-B: `long` marks an output past the collapse threshold and
 * `expanded` its per-cell toggle — a collapsed block is height-clamped with a
 * scrollbar while its full text stays in the DOM for «Копировать вывод».
 *
 * Wave 9: the text goes through `normalizeOutputText`, so a progress bar that
 * rewrites one line with `\r` shows its final frame instead of every frame.
 */
function CellOutput({
  index,
  cell,
  outputText,
  long,
  expanded,
}: {
  index: number
  cell: CookbooksCellResult | undefined
  outputText: OutputTextReader
  long: boolean
  expanded: boolean
}) {
  const { t } = useTranslation()
  const collapsed = long && !expanded

  return (
    <pre
      data-testid={`cookbooks-output-${index}`}
      data-status={cell?.status ?? 'idle'}
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label={t('cookbooks.cell.outputLabel', { index })}
      className={cn(
        'overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[var(--radius-control)] bg-surface-hover px-2.5 py-1.5 font-mono text-small',
        // A short block keeps the wave-7 cap; a long one is clamped while
        // collapsed and shown in full once expanded.
        long ? (expanded ? '' : 'max-h-[120px]') : 'max-h-[320px]',
        cell?.status === 'error' ? 'text-destructive-text' : 'text-muted-foreground',
      )}
    >
      {normalizeOutputText(outputText(cell))}
    </pre>
  )
}

export function CookbooksSurfacePage({ writeClipboard = defaultWriteClipboard }: CookbooksSurfacePageProps = {}) {
  const { t } = useTranslation()
  const api = window.electronAPI.cookbooksLab

  const [status, setStatus] = useState<CookbooksStatus>({ state: 'idle', reason: null, port: null })
  const [cards, setCards] = useState<CookbooksCard[]>([])
  const [filter, setFilter] = useState('')
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [copyId, setCopyId] = useState<string | null>(null)
  const [doc, setDoc] = useState<CookbooksDocument | null>(null)
  const [sources, setSources] = useState<Record<number, string>>({})
  const [outputs, setOutputs] = useState<Record<number, CookbooksCellResult>>({})
  /** R2: session-local execution counter per document index. */
  const [runs, setRuns] = useState<Record<number, number>>({})
  /** R1: per-cell «Изменить» state; absent means read mode (markdown rendered). */
  const [editingCells, setEditingCells] = useState<Record<number, boolean>>({})
  /** R-B: per-cell «показан полностью» state; absent means collapsed for long output. */
  const [expandedOutputs, setExpandedOutputs] = useState<Record<number, boolean>>({})
  const [playbookText, setPlaybookText] = useState('')
  const [playbookEditing, setPlaybookEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<CookbooksNotice | null>(null)
  /** R3: start of the active run, or null when no run is in flight. */
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const documentRef = useRef<HTMLElement | null>(null)

  // ensure() on mount + push subscription: main is the only source of truth.
  useEffect(() => {
    let cancelled = false
    const off = api.onStatusChanged((next) => {
      if (!cancelled) setStatus(next)
    })
    api
      .ensure()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch(() => {
        if (!cancelled) setStatus({ state: 'failed', reason: null, port: null })
      })
    return () => {
      cancelled = true
      off()
    }
  }, [api])

  // The catalog is a data-plane call: only legal while the runtime is running.
  useEffect(() => {
    if (status.state !== 'running') return
    let cancelled = false
    api
      .catalog()
      .then((list) => {
        if (!cancelled) setCards(list)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setCards([])
        setNotice({ source: 'text', text: describeFailure(cause) })
      })
    return () => {
      cancelled = true
    }
  }, [api, status.state])

  /**
   * R3: while a run is in flight the header status ticks every 250 ms. Only the
   * run actions set `runStartedAt`, so open/save/reset keep the static copy.
   */
  useEffect(() => {
    if (runStartedAt === null) return
    setElapsedMs(0)
    const timer = window.setInterval(() => setElapsedMs(performance.now() - runStartedAt), 250)
    return () => window.clearInterval(timer)
  }, [runStartedAt])

  /**
   * Busy + failure lifecycle shared by every mutating action: the acting
   * controls are disabled for the duration and a failed call surfaces the
   * sidecar's own message instead of a silent no-op.
   */
  const runWithBusy = useCallback(async (token: string, action: () => Promise<void>) => {
    setBusy(token)
    try {
      await action()
    } catch (cause: unknown) {
      setNotice({ source: 'text', text: describeFailure(cause) })
    } finally {
      setBusy(null)
    }
  }, [])

  const applyDocument = useCallback((next: CookbooksDocument) => {
    setDoc(next)
    const nextSources: Record<number, string> = {}
    next.cells.forEach((cell, index) => {
      nextSources[index] = cell.source
    })
    setSources(nextSources)
    setOutputs({})
    setExpandedOutputs({})
    // Counters and edit modes belong to the document that was open, not to the
    // surface: a freshly opened copy starts from a clean slate.
    setRuns({})
    setEditingCells({})
    setPlaybookEditing(false)
    setPlaybookText(next.text ?? '')
  }, [])

  const openItem = useCallback(
    async (itemId: string, newCopy = false) => {
      await runWithBusy(newCopy ? `${itemId}:copy` : `${itemId}:open`, async () => {
        const result = await api.open(newCopy ? { itemId, newCopy: true } : { itemId })
        setCopyId(result.copyId)
        applyDocument(result.document)
        setOpenItemId(itemId)
        setNotice({ source: 'key', key: newCopy ? 'cookbooks.status.newCopy' : 'cookbooks.status.opened' })
      })
    },
    [api, applyDocument, runWithBusy],
  )

  const setSource = useCallback((index: number, source: string) => {
    setSources((previous) => ({ ...previous, [index]: source }))
  }, [])

  /** R6: nearest-scroll a block into view, honouring the reduced-motion setting. */
  const scrollToBlock = useCallback((testId: string) => {
    const element = documentRef.current?.querySelector(`[data-testid="${testId}"]`)
    element?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotionNow() ? 'auto' : 'smooth' })
  }, [])

  /** R6: the autoscroll target of a run — the cell itself. */
  const scrollToCell = useCallback((index: number) => scrollToBlock(`cookbooks-cell-${index}`), [scrollToBlock])

  /** R5: move focus to the next runnable cell at or after `from`. */
  const focusCellSource = useCallback(
    (from: number) => {
      if (!doc) return
      for (let index = from; index < doc.cells.length; index += 1) {
        if (doc.cells[index].cellType !== 'code') continue
        const field = documentRef.current?.querySelector<HTMLTextAreaElement>(
          `[data-testid="cookbooks-source-${index}"]`,
        )
        field?.focus()
        return
      }
    },
    [doc],
  )

  /**
   * R-A: move focus to the code cell just before/after `from`, skipping every
   * non-code cell — a markdown entry is never a navigation target.
   */
  const focusAdjacentCodeCell = useCallback(
    (from: number, direction: -1 | 1) => {
      if (!doc) return
      for (let index = from + direction; index >= 0 && index < doc.cells.length; index += direction) {
        if (doc.cells[index].cellType !== 'code') continue
        const field = documentRef.current?.querySelector<HTMLTextAreaElement>(
          `[data-testid="cookbooks-source-${index}"]`,
        )
        field?.focus()
        return
      }
    },
    [doc],
  )

  const runCell = useCallback(
    async (index: number, options: { focusNext?: boolean } = {}) => {
      if (!doc || !openItemId || busy !== null) return
      if (doc.cells[index]?.cellType !== 'code') return
      const code = sources[index] ?? doc.cells[index]?.source ?? ''
      const started = performance.now()
      setRunStartedAt(started)
      // R6/wave 9: the running cell is brought into view the moment it starts.
      scrollToCell(index)
      if (options.focusNext) focusCellSource(index + 1)
      try {
        await runWithBusy(`cell:${index}:run`, async () => {
          // Wave 9: a stopped run answers `cancelled` — an outcome, not a failure.
          const result = await api.run({ itemId: openItemId, code, index })
          const cancelled = result.cancelled === true
          setOutputs((previous) => ({
            ...previous,
            [index]: {
              index,
              status: cancelled ? 'cancelled' : result.ok ? 'ok' : 'error',
              stdout: result.stdout,
              error: result.error,
            },
          }))
          setRuns((previous) => ({ ...previous, [index]: (previous[index] ?? 0) + 1 }))
          setNotice({
            source: 'key',
            key: cancelled
              ? 'cookbooks.status.cellCancelled'
              : result.ok
                ? 'cookbooks.status.cellOk'
                : 'cookbooks.status.cellError',
            params: { index, duration: formatDuration(performance.now() - started) },
          })
        })
      } finally {
        setRunStartedAt(null)
      }
    },
    [api, busy, doc, focusCellSource, openItemId, runWithBusy, scrollToCell, sources],
  )

  /**
   * Wave 7: «Запустить всё». Wave 9: the same batch behind «выполнить выше» /
   * «выполнить ниже» — `indices` restricts it to those document indices, and
   * the empty-subset guard keeps a subset with nothing to run inert. Busy
   * token, counters, statuses and autoscroll stay exactly the batch's own.
   */
  const runAllCells = useCallback(
    async (indices?: number[]) => {
      if (!doc || !openItemId || busy !== null) return
      // «Запустить всё» exists only where the sidecar says it is supported.
      if (!(doc.kind === 'ipynb' && doc.supported)) return
      // The sidecar executes code cells only: a markdown entry makes `POST /run-all`
      // answer 400 «cell is not runnable» and kills the whole run. Indices stay the
      // document's own so per-cell outputs land under the right article.
      const cells = doc.cells
        .map((cell, index) => ({ index, source: sources[index] ?? cell.source, cellType: cell.cellType }))
        .filter((cell) => cell.cellType === 'code')
        .filter((cell) => indices === undefined || indices.includes(cell.index))
        .map(({ index, source }) => ({ index, source }))
      if (cells.length === 0) return
      const subset = indices !== undefined
      const started = performance.now()
      setRunStartedAt(started)
      // R6: the batch starts at the first runnable cell.
      scrollToCell(cells[0].index)
      try {
        await runWithBusy('run-all', async () => {
          // Wave 9: a stopped batch answers `cancelled` and omits the cells it
          // never reached.
          const result = await api.runAll({ itemId: openItemId, cells })
          const nextOutputs: Record<number, CookbooksCellResult> = {}
          for (const cell of result.cells) nextOutputs[cell.index] = cell
          if (result.cancelled === true) {
            // The response is the whole truth about what ran: everything the
            // batch was asked for and did not answer was stopped.
            for (const cell of cells) {
              if (nextOutputs[cell.index]) continue
              nextOutputs[cell.index] = { index: cell.index, status: 'cancelled', stdout: '', error: null }
            }
          }
          // A subset run owns only its own cells: the rest of the document
          // keeps the outputs it already showed.
          setOutputs((previous) => (subset ? { ...previous, ...nextOutputs } : nextOutputs))
          // R2: every executed cell counts once, in document order; a skipped —
          // or stopped — cell never produced a result, so it does not move its
          // counter.
          setRuns((previous) => {
            const next = { ...previous }
            for (const cell of [...result.cells].sort((left, right) => left.index - right.index)) {
              if (cell.status === 'skipped' || cell.status === 'cancelled') continue
              next[cell.index] = (next[cell.index] ?? 0) + 1
            }
            return next
          })
          if (result.cancelled === true) {
            setNotice({ source: 'key', key: 'cookbooks.notice.runCancelled' })
          } else {
            setNotice({
              source: 'key',
              key: 'cookbooks.status.runAll',
              params: {
                count: result.cells.length,
                ok: result.cells.filter((cell) => cell.status === 'ok').length,
                failed: result.cells.filter((cell) => cell.status === 'error').length,
                skipped: result.cells.filter((cell) => cell.status === 'skipped').length,
                duration: formatDuration(performance.now() - started),
              },
            })
          }
          // R6: land on the first failure when the batch has one.
          const firstError = result.cells.find((cell) => cell.status === 'error')
          if (firstError) scrollToCell(firstError.index)
        })
      } finally {
        setRunStartedAt(null)
      }
    },
    [api, busy, doc, openItemId, runWithBusy, scrollToCell, sources],
  )

  /**
   * Wave 9: stop what is running. The sidecar kills every live execution of
   * this item, so the pending `run`/`runAll` promise answers `cancelled:true`
   * and the surface reports that result — nothing is guessed locally, and the
   * busy state is left to the run that owns it.
   */
  const cancelRun = useCallback(async () => {
    if (!openItemId) return
    try {
      await api.cancel({ itemId: openItemId })
    } catch (cause: unknown) {
      setNotice({ source: 'text', text: describeFailure(cause) })
    }
  }, [api, openItemId])

  /**
   * R5: Colab-parity keys, scoped to the document container. Every combination
   * that starts work is a no-op while another action is in flight, and nothing
   * is bound globally.
   *
   * R-A: `Alt+ArrowUp/Down` is pure navigation — it is deliberately not gated on
   * `busy`, and `preventDefault` keeps the platform from treating the chord as a
   * caret/scroll gesture.
   *
   * Wave 9: `Esc` is the keyboard twin of the stop control — while an action is
   * in flight it asks the sidecar to kill the executions of this item and
   * swallows the key (a browser would otherwise leave fullscreen / close a
   * dialog on it).
   */
  const handleDocumentKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        if (busy === null) return
        event.preventDefault()
        void cancelRun()
        return
      }
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        if (!doc || doc.cells.length === 0) return
        event.preventDefault()
        const direction: -1 | 1 = event.key === 'ArrowDown' ? 1 : -1
        const target = event.target as HTMLElement | null
        const rawIndex = target?.tagName === 'TEXTAREA' ? target.getAttribute('data-cell-index') : null
        const current = rawIndex === null ? Number.NaN : Number(rawIndex)
        // With no cell focused the chord enters the document from its nearest
        // end: ↓ lands on the first code cell, ↑ on the last one.
        focusAdjacentCodeCell(Number.isInteger(current) ? current : direction === 1 ? -1 : doc.cells.length, direction)
        return
      }
      if (event.key !== 'Enter') return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.shiftKey) {
        if (!(doc?.kind === 'ipynb' && doc.supported)) return
        if (busy !== null) return
        event.preventDefault()
        void runAllCells()
        return
      }
      const target = event.target as HTMLElement | null
      if (target?.tagName !== 'TEXTAREA') return
      const rawIndex = target.getAttribute('data-cell-index')
      if (rawIndex === null) return
      const index = Number(rawIndex)
      if (!Number.isInteger(index) || doc?.cells[index]?.cellType !== 'code') return
      if (busy !== null) return
      if (event.shiftKey) {
        event.preventDefault()
        void runCell(index, { focusNext: true })
        return
      }
      if (mod) {
        event.preventDefault()
        void runCell(index)
      }
    },
    [busy, cancelRun, doc, focusAdjacentCodeCell, runAllCells, runCell],
  )

  const saveCell = useCallback(
    async (index: number) => {
      if (!openItemId) return
      const source = sources[index] ?? ''
      await runWithBusy(`cell:${index}:save`, async () => {
        await api.save({ itemId: openItemId, index, source })
        setNotice({ source: 'key', key: 'cookbooks.status.cellSaved', params: { index } })
      })
    },
    [api, openItemId, runWithBusy, sources],
  )

  const savePlaybook = useCallback(async () => {
    if (!openItemId) return
    await runWithBusy('playbook:save', async () => {
      await api.save({ itemId: openItemId, text: playbookText })
      setNotice({ source: 'key', key: 'cookbooks.status.saved' })
    })
  }, [api, openItemId, playbookText, runWithBusy])

  /** The exact text a cell shows — the output block and «Копировать вывод» share it. */
  const outputText = useCallback<OutputTextReader>(
    (cell) => {
      if (!cell) return t('cookbooks.output.hint')
      // Wave 9: a stopped cell says so — it has no stdout to fall back on.
      if (cell.status === 'cancelled') return t('cookbooks.cell.cancelled')
      if (cell.status === 'skipped') return t('cookbooks.output.skipped')
      const printed = [cell.stdout, cell.error].filter(
        (part): part is string => part !== null && part.trim().length > 0,
      )
      return printed.length > 0 ? printed.join('\n') : t('cookbooks.output.empty')
    },
    [t],
  )

  /** R6: copy the output the cell is showing right now. */
  const copyOutput = useCallback(
    async (index: number) => {
      const cell = outputs[index]
      if (!cell) return
      try {
        await writeClipboard(outputText(cell))
        toast.success(t('toast.copied'))
      } catch {
        toast.error(t('toast.copyFailed'))
      }
    },
    [outputs, outputText, t, writeClipboard],
  )

  /**
   * Wave 9: copy the cell's source as it is on screen — the editor's text, not
   * the copy on disk, so an unsaved edit is what lands on the clipboard.
   */
  const copySource = useCallback(
    async (index: number) => {
      const source = sources[index] ?? doc?.cells[index]?.source ?? ''
      try {
        await writeClipboard(source)
        toast.success(t('cookbooks.notice.sourceCopied'))
      } catch {
        toast.error(t('toast.copyFailed'))
      }
    },
    [doc, sources, t, writeClipboard],
  )

  /** R6: reset the cell output to its pre-run hint. */
  const clearOutput = useCallback((index: number) => {
    setOutputs((previous) => {
      const next = { ...previous }
      delete next[index]
      return next
    })
    setExpandedOutputs((previous) => {
      const next = { ...previous }
      delete next[index]
      return next
    })
  }, [])

  /** R-B: flip one cell's long output between collapsed and full. */
  const toggleOutputExpanded = useCallback((index: number) => {
    setExpandedOutputs((previous) => ({ ...previous, [index]: !(previous[index] ?? false) }))
  }, [])

  /**
   * R-C: «Очистить все выводы» — the whole-document twin of `clearOutput`:
   * every cell returns to its pre-run hint and every collapse state is dropped.
   */
  const clearAllOutputs = useCallback(() => {
    setOutputs({})
    setExpandedOutputs({})
  }, [])

  const toggleCellMode = useCallback((index: number) => {
    setEditingCells((previous) => ({ ...previous, [index]: !(previous[index] ?? false) }))
  }, [])

  const resetToOriginal = useCallback(async () => {
    if (!openItemId) return
    if (!window.confirm(t('cookbooks.reset.confirm'))) return
    await runWithBusy('reset', async () => {
      await api.reset({ itemId: openItemId })
      applyDocument(await api.document({ itemId: openItemId }))
      setNotice({ source: 'key', key: 'cookbooks.status.reset' })
    })
  }, [api, applyDocument, openItemId, runWithBusy, t])

  const restart = useCallback(() => {
    void api.restart().catch(() => {
      // Main owns the lifecycle: a failed restart still pushes STATUS_CHANGED.
    })
  }, [api])

  const visibleCards = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (query.length === 0) return cards
    return cards.filter((card) =>
      [card.title, card.vendor, card.id].some((field) => field.toLowerCase().includes(query)),
    )
  }, [cards, filter])

  /**
   * Wave 9: «Скачать .ipynb». The renderer assembles the notebook from what the
   * copy holds right now — edited sources, session counters and run outputs —
   * through the shared pure builder, and main owns the save dialog. A cancelled
   * dialog is an outcome (`saved:false`), a failed write is the only error.
   */
  const exportNotebook = useCallback(async () => {
    if (!doc || !openItemId) return
    if (!(doc.kind === 'ipynb' && doc.supported)) return
    const content = buildNotebookExport({
      title: doc.title,
      cells: doc.cells.map((cell, index) => ({
        cellType: cell.cellType,
        source: sources[index] ?? cell.source,
        executionCount: runs[index] ?? null,
        stdout: outputs[index]?.stdout,
        error: outputs[index]?.error ?? undefined,
      })),
    })
    const filename = `${doc.title.replace(/[^\w\d\-.]+/g, '-')}.ipynb`
    await runWithBusy('export', async () => {
      try {
        const result = await api.export({ itemId: openItemId, filename, content })
        setNotice(
          result.saved
            ? { source: 'key', key: 'cookbooks.export.saved', params: { path: result.path ?? '' } }
            : { source: 'key', key: 'cookbooks.export.cancelled' },
        )
      } catch {
        setNotice({ source: 'key', key: 'cookbooks.export.failed' })
      }
    })
  }, [api, doc, openItemId, outputs, runWithBusy, runs, sources])

  /**
   * Wave 9: the outline of the open document — the H1–H3 headings of its
   * markdown cells in document order, or of the playbook body, which has no
   * cells and scrolls to its own block. An edited source is what the outline
   * lists, exactly as the document pane renders it.
   */
  const outline = useMemo<CookbooksOutlineEntry[]>(() => {
    if (!doc) return []
    if (doc.kind === 'md') {
      return headingsOf(playbookText).map((title) => ({ title, testId: 'cookbooks-playbook-markdown' }))
    }
    const entries: CookbooksOutlineEntry[] = []
    doc.cells.forEach((cell, index) => {
      if (cell.cellType !== 'markdown') return
      for (const title of headingsOf(sources[index] ?? cell.source)) {
        entries.push({ title, testId: `cookbooks-cell-${index}` })
      }
    })
    return entries
  }, [doc, playbookText, sources])

  /** R-C: «Очистить все выводы» is offered exactly while one cell has a result. */
  const hasAnyOutput = Object.keys(outputs).length > 0

  const ui = toPageUi(status)

  if (ui !== 'ready') {
    const titleKey =
      ui === 'starting'
        ? 'cookbooks.starting.title'
        : ui === 'unavailable'
          ? 'cookbooks.pythonMissing.title'
          : 'cookbooks.failed.title'
    const hintKey =
      ui === 'starting'
        ? 'cookbooks.starting.hint'
        : ui === 'unavailable'
          ? 'cookbooks.pythonMissing.hint'
          : 'cookbooks.failed.hint'
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center text-muted-foreground"
        data-testid="cookbooks-surface"
        data-state={ui}
        data-reason={ui === 'unavailable' ? 'python-missing' : undefined}
        role="status"
      >
        {ui === 'starting' ? (
          <span data-testid="cookbooks-spinner" role="progressbar" aria-label={t('cookbooks.starting.title')}>
            <Loader2 className="icon-empty animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span className="sr-only">{t('cookbooks.starting.title')}</span>
          </span>
        ) : null}
        <h1 className="text-sm font-medium text-foreground">{t(titleKey)}</h1>
        <p className="max-w-md text-sm">{t(hintKey)}</p>
        {ui === 'starting' ? null : (
          <button type="button" className={ACTION_CLASS} data-testid="cookbooks-retry" onClick={restart}>
            {t('cookbooks.action.retry')}
          </button>
        )}
      </div>
    )
  }

  const renderDocument = () => {
    if (!doc || !openItemId) return null
    // R6: a playbook is a single markdown block; a notebook counts its cells.
    const cellCount = doc.kind === 'md' ? 1 : doc.cells.length
    // Wave 9: the code cells, in document order — the outline and the
    // «выполнить выше/ниже» subsets are both derived from them.
    const codeIndices = doc.cells.flatMap((cell, index) => (cell.cellType === 'code' ? [index] : []))
    // «Запустить всё» and its subsets exist only where the sidecar runs batches.
    const canRunAll = doc.kind === 'ipynb' && doc.supported
    return (
      <>
        <header className="sticky top-0 z-sticky flex flex-wrap items-center gap-2 border-b border-border/40 bg-background/95 px-3 py-2 backdrop-blur">
          <h2 data-testid="cookbooks-document-title" className="text-title-sm font-semibold text-foreground">
            {doc.title}
          </h2>
          <span className="shrink-0 rounded-full border border-border-subtle px-1.5 text-caption text-text-secondary">
            {t(KIND_LABEL_KEY[doc.kind])}
          </span>
          {copyId ? (
            <span data-testid="cookbooks-copy-id" className="shrink-0 font-mono text-caption text-muted-foreground">
              {copyId}
            </span>
          ) : null}
          <span data-testid="cookbooks-header-cells" className="shrink-0 text-caption numeric text-text-secondary">
            {t('cookbooks.header.cells', { count: cellCount })}
          </span>
          <span className="flex-1" />
          {/* «Запустить всё» is offered only where the sidecar says it is supported. */}
          {canRunAll ? (
            <button
              type="button"
              data-testid="cookbooks-run-all"
              title={formatHotkeyDisplay('mod+shift+enter')}
              disabled={busy !== null}
              onClick={() => void runAllCells()}
              className={ACTION_CLASS}
            >
              {t('cookbooks.actions.runAll')}
            </button>
          ) : null}
          {/* Wave 9: while a batch runs, the header is where it is stopped. */}
          {busy === 'run-all' ? (
            <button type="button" data-testid="cookbooks-stop-all" onClick={() => void cancelRun()} className={ACTION_CLASS}>
              {t('cookbooks.actions.stop')}
            </button>
          ) : null}
          {/* Wave 9: the notebook as it stands right now, saved by main. */}
          {canRunAll ? (
            <button
              type="button"
              data-testid="cookbooks-export"
              disabled={busy !== null}
              onClick={() => void exportNotebook()}
              className={ACTION_CLASS}
            >
              {t('cookbooks.actions.export')}
            </button>
          ) : null}
          {/* R-C: the whole-document clear appears only while something ran. */}
          {hasAnyOutput ? (
            <button
              type="button"
              data-testid="cookbooks-clear-all-outputs"
              onClick={clearAllOutputs}
              className={ACTION_CLASS}
            >
              {t('cookbooks.actions.clearAllOutputs')}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="cookbooks-reset"
            disabled={busy !== null}
            onClick={() => void resetToOriginal()}
            className={ACTION_CLASS}
          >
            {t('cookbooks.actions.reset')}
          </button>
          <button
            type="button"
            data-testid="cookbooks-new-copy"
            disabled={busy !== null}
            onClick={() => void openItem(openItemId, true)}
            className={ACTION_CLASS}
          >
            {t('cookbooks.actions.newCopy')}
          </button>
        </header>

        {doc.missing.length > 0 ? (
          <p
            data-testid="cookbooks-missing-keys"
            role="alert"
            className="mx-3 mt-2 rounded-[var(--radius-card)] bg-surface-hover px-3 py-2 text-small text-status-warning"
          >
            {t('cookbooks.missingKeys', { keys: doc.missing.join(', ') })}
          </p>
        ) : null}

        {doc.kind === 'md' ? (
          <div className="flex flex-col gap-2 px-3 py-3">
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="cookbooks-playbook-toggle"
                aria-pressed={playbookEditing}
                onClick={() => setPlaybookEditing((editing) => !editing)}
                className={ACTION_CLASS}
              >
                {playbookEditing ? t('cookbooks.cell.readMode') : t('cookbooks.cell.editMode')}
              </button>
            </div>
            {playbookEditing ? (
              <textarea
                data-testid="cookbooks-playbook-text"
                aria-label={t('cookbooks.playbook.textLabel')}
                value={playbookText}
                onChange={(event) => setPlaybookText(event.target.value)}
                spellCheck={false}
                className={cn(SOURCE_CLASS, 'min-h-[240px]')}
              />
            ) : (
              // R1: the playbook reads as a document until «Изменить» is pressed.
              <CellMarkdown mode="full" source={playbookText} testId="cookbooks-playbook-markdown" />
            )}
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="cookbooks-playbook-save"
                disabled={busy !== null}
                onClick={() => void savePlaybook()}
                className={ACTION_CLASS}
              >
                {t('cookbooks.actions.save')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-3 py-3">
            {doc.cells.map((cell, index) => {
              const isMarkdown = cell.cellType === 'markdown'
              const editing = isMarkdown && (editingCells[index] ?? false)
              const source = sources[index] ?? cell.source
              const output = outputs[index]
              const runCount = runs[index] ?? 0
              // R-B: only a real result can be long; the pre-run hint never is.
              // The length is the one on screen — `\r` frames are already gone.
              const outputLong =
                output !== undefined && normalizeOutputText(outputText(output)).length > OUTPUT_COLLAPSE_THRESHOLD
              const outputExpanded = outputLong && (expandedOutputs[index] ?? false)
              // R4: a single-run cell spins for itself; a batch spins every
              // executable cell. Both reserve the gutter slot, so nothing jumps.
              const cellBusy = busy === `cell:${index}:run` || (busy === 'run-all' && cell.cellType === 'code')
              // Wave 9: «выполнить выше/ниже» runs the code cells on that side
              // of this one — empty means there is nothing to run over there.
              const above = codeIndices.filter((codeIndex) => codeIndex < index)
              const below = codeIndices.filter((codeIndex) => codeIndex > index)
              return (
                <article
                  key={index}
                  data-testid={`cookbooks-cell-${index}`}
                  data-cell-type={cell.cellType}
                  data-status={output?.status ?? 'idle'}
                  className="flex gap-2 rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated px-2.5 py-2"
                >
                  <div
                    data-testid={`cookbooks-gutter-${index}`}
                    className="flex w-10 shrink-0 flex-col items-center gap-1"
                  >
                    {/* R2: session-local run counter — `[ ]` until the first run. */}
                    <span
                      data-testid={`cookbooks-runs-${index}`}
                      aria-label={t('cookbooks.cell.runs', { count: runCount })}
                      className="font-mono text-caption numeric text-text-secondary"
                    >
                      {runCount > 0 ? `[${runCount}]` : '[ ]'}
                    </span>
                    <span className="inline-flex size-[var(--icon-empty)] items-center justify-center">
                      {cellBusy ? (
                        <Loader2
                          data-testid={`cookbooks-busy-${index}`}
                          className="icon-empty animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded-full border border-border-subtle px-1.5 text-caption text-text-secondary">
                        {cell.cellType}
                      </span>
                      <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                        {isMarkdown ? (
                          <button
                            type="button"
                            data-testid={`cookbooks-mode-${index}`}
                            aria-pressed={editing}
                            onClick={() => toggleCellMode(index)}
                            className={ACTION_CLASS}
                          >
                            {editing ? t('cookbooks.cell.readMode') : t('cookbooks.cell.editMode')}
                          </button>
                        ) : null}
                        {/* A markdown cell has nothing to execute: its toggle,
                            and — in edit mode — the save it needs. */}
                        {cell.cellType === 'code' ? (
                          <>
                            <button
                              type="button"
                              data-testid={`cookbooks-run-${index}`}
                              title={`${t('cookbooks.actions.run')} — ${formatHotkeyDisplay('shift+enter')}`}
                              disabled={busy !== null}
                              onClick={() => void runCell(index)}
                              className={ACTION_CLASS}
                            >
                              {t('cookbooks.actions.run')}
                            </button>
                            {/* Wave 9: the batch neighbours of this cell — the
                                sidecar runs them as one batch, in order. */}
                            <button
                              type="button"
                              data-testid={`cookbooks-run-above-${index}`}
                              disabled={busy !== null || !canRunAll || above.length === 0}
                              onClick={() => void runAllCells(above)}
                              className={ACTION_CLASS}
                            >
                              {t('cookbooks.actions.runAbove')}
                            </button>
                            <button
                              type="button"
                              data-testid={`cookbooks-run-below-${index}`}
                              disabled={busy !== null || !canRunAll || below.length === 0}
                              onClick={() => void runAllCells(below)}
                              className={ACTION_CLASS}
                            >
                              {t('cookbooks.actions.runBelow')}
                            </button>
                          </>
                        ) : null}
                        {/* Wave 9: while this cell runs, this is where it stops. */}
                        {cellBusy ? (
                          <button
                            type="button"
                            data-testid={`cookbooks-stop-${index}`}
                            aria-label={t('cookbooks.cell.stopLabel', { index })}
                            onClick={() => void cancelRun()}
                            className={ACTION_CLASS}
                          >
                            {t('cookbooks.actions.stop')}
                          </button>
                        ) : null}
                        {/* Wave 9: the source as shown — an unsaved edit included. */}
                        <button
                          type="button"
                          data-testid={`cookbooks-copy-source-${index}`}
                          onClick={() => void copySource(index)}
                          className={ACTION_CLASS}
                        >
                          {t('cookbooks.actions.copySource')}
                        </button>
                        {isMarkdown && !editing ? null : (
                          <button
                            type="button"
                            data-testid={`cookbooks-save-${index}`}
                            disabled={busy !== null}
                            onClick={() => void saveCell(index)}
                            className={ACTION_CLASS}
                          >
                            {t('cookbooks.actions.save')}
                          </button>
                        )}
                      </span>
                    </div>
                    {isMarkdown && !editing ? (
                      <CellMarkdown mode="minimal" source={source} testId={`cookbooks-markdown-${index}`} />
                    ) : (
                      <textarea
                        data-testid={`cookbooks-source-${index}`}
                        data-cell-index={index}
                        aria-label={t('cookbooks.cell.sourceLabel', { index })}
                        value={source}
                        onChange={(event) => setSource(index, event.target.value)}
                        spellCheck={false}
                        className={cn(SOURCE_CLASS, 'min-h-[var(--control-lg)]')}
                      />
                    )}
                    <CellOutput
                      index={index}
                      cell={output}
                      outputText={outputText}
                      long={outputLong}
                      expanded={outputExpanded}
                    />
                    {output ? (
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {/* R-B: the toggle exists only where the block is long. */}
                        {outputLong ? (
                          <button
                            type="button"
                            data-testid={`cookbooks-output-toggle-${index}`}
                            aria-expanded={outputExpanded}
                            onClick={() => toggleOutputExpanded(index)}
                            className={ACTION_CLASS}
                          >
                            {outputExpanded ? t('cookbooks.cell.collapseOutput') : t('cookbooks.cell.expandOutput')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          data-testid={`cookbooks-copy-output-${index}`}
                          onClick={() => void copyOutput(index)}
                          className={ACTION_CLASS}
                        >
                          {t('cookbooks.cell.copyOutput')}
                        </button>
                        <button
                          type="button"
                          data-testid={`cookbooks-clear-output-${index}`}
                          onClick={() => clearOutput(index)}
                          className={ACTION_CLASS}
                        >
                          {t('cookbooks.cell.clearOutput')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </>
    )
  }

  return (
    <div
      className="flex h-full w-full min-h-0 flex-col bg-background"
      data-testid="cookbooks-surface"
      data-state="ready"
    >
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <h1 className="text-title-sm font-semibold text-foreground">{t('cookbooks.title')}</h1>
        <span
          data-testid="cookbooks-status"
          role="status"
          aria-live="polite"
          className="ml-auto inline-flex items-center gap-1.5 text-small text-muted-foreground numeric"
        >
          {busy ? (
            <>
              <Loader2 className="icon-status animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {/* R3: only a run ticks; every other action keeps the static copy. */}
              {runStartedAt === null
                ? t('cookbooks.status.running')
                : t('cookbooks.status.runningElapsed', { duration: formatDuration(elapsedMs) })}
            </>
          ) : notice ? (
            notice.source === 'key' ? (
              t(notice.key, notice.params)
            ) : (
              notice.text
            )
          ) : null}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          data-testid="cookbooks-catalog"
          className="flex w-[320px] shrink-0 flex-col border-r border-border-subtle"
        >
          <div className="px-3 pt-3 pb-2">
            <h2 data-testid="cookbooks-catalog-count" className="text-small font-medium text-foreground">
              {t('cookbooks.catalog.count', { count: visibleCards.length })}
            </h2>
          </div>
          <div className="px-3 pb-2">
            <input
              data-testid="cookbooks-filter"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('cookbooks.catalog.filterPlaceholder')}
              aria-label={t('cookbooks.catalog.filterPlaceholder')}
              className="h-[var(--control-md)] w-full rounded-[var(--radius-control)] border border-border-subtle bg-surface-input px-2 text-small text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
            />
          </div>
          <ul className="min-h-0 flex-1 list-none overflow-y-auto px-2 pb-2">
            {visibleCards.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  data-testid={`cookbooks-card-${card.id}`}
                  data-kind={card.kind}
                  disabled={card.disabled}
                  aria-pressed={card.id === openItemId}
                  onClick={() => void openItem(card.id)}
                  className={cn(
                    'mb-1.5 flex w-full flex-col gap-1 rounded-[var(--radius-card)] border border-border-subtle px-2.5 py-2 text-left transition-colors',
                    'hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground',
                    card.id === openItemId && 'bg-surface-selected',
                    card.disabled && 'cursor-default opacity-60 hover:bg-transparent',
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-small font-medium text-foreground">
                      {card.title}
                    </span>
                    <span className="shrink-0 rounded-full border border-border-subtle px-1.5 text-caption text-text-secondary">
                      {t(KIND_LABEL_KEY[card.kind])}
                    </span>
                  </span>
                  <span className="w-full truncate text-caption text-muted-foreground">{card.vendor}</span>
                  <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
                    {card.secretsHave.length > 0 ? (
                      <span
                        data-testid={`cookbooks-keys-have-${card.id}`}
                        className="inline-flex items-center gap-1 text-caption text-text-secondary"
                      >
                        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
                        {t('cookbooks.card.keysHave')}
                        <span className="font-mono">{card.secretsHave.join(', ')}</span>
                      </span>
                    ) : null}
                    {card.secretsMissing.length > 0 ? (
                      <span
                        data-testid={`cookbooks-keys-missing-${card.id}`}
                        className="inline-flex items-center gap-1 text-caption text-text-secondary"
                      >
                        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-destructive" />
                        {t('cookbooks.card.keysMissing')}
                        <span className="font-mono">{card.secretsMissing.join(', ')}</span>
                      </span>
                    ) : null}
                    {card.disabled ? (
                      <span
                        data-testid={`cookbooks-reason-${card.id}`}
                        className="text-caption text-status-warning"
                      >
                        {card.disabledReason === FILE_MISSING_REASON
                          ? t('cookbooks.card.fileMissing')
                          : card.disabledReason}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* Wave 9: the document's own table of contents — a click scrolls the
              heading's block into view. Hidden while there is nothing to list. */}
          {outline.length > 0 ? (
            <details data-testid="cookbooks-outline" className="shrink-0 border-t border-border-subtle px-3 py-2">
              <summary className="cursor-pointer text-small font-medium text-foreground">
                {t('cookbooks.outline.title')}
              </summary>
              <ul className="mt-2 flex list-none flex-col gap-1.5 text-caption text-muted-foreground">
                {/* `${n}` is the entry's zero-based position in this list —
                    the same convention as `cookbooks-cell-${index}`. */}
                {outline.map((entry, n) => (
                  <li key={`${n}:${entry.title}`}>
                    <button
                      type="button"
                      data-testid={`cookbooks-outline-item-${n}`}
                      aria-label={t('cookbooks.outline.itemLabel', { title: entry.title })}
                      onClick={() => scrollToBlock(entry.testId)}
                      className="block w-full truncate text-left hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
                    >
                      {entry.title}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <details data-testid="cookbooks-help" className="shrink-0 border-t border-border-subtle px-3 py-2">
            <summary className="cursor-pointer text-small font-medium text-foreground">
              {t('cookbooks.help.title')}
            </summary>
            <ul className="mt-2 flex list-none flex-col gap-1.5 text-caption text-muted-foreground">
              {HELP_KEYS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
            {/* R7: the keyboard cheatsheet mirrors exactly what R5 binds. */}
            <div className="mt-2 flex flex-col gap-1.5 border-t border-border-subtle pt-2">
              <h3 className="text-caption font-medium text-foreground">{t('cookbooks.help.shortcutsTitle')}</h3>
              <ul
                data-testid="cookbooks-help-shortcuts"
                className="flex list-none flex-col gap-1.5 text-caption text-muted-foreground"
              >
                {SHORTCUT_KEYS.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
            </div>
          </details>
        </aside>

        <section
          ref={documentRef}
          data-testid="cookbooks-document"
          data-kind={doc?.kind}
          onKeyDown={handleDocumentKeyDown}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {renderDocument()}
        </section>
      </div>
    </div>
  )
}

export default CookbooksSurfacePage
