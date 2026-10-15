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
 * Wave 10 («Cell Structure») adds Colab's structural editing: a hover insert row
 * before every cell (and after the last one), a per-cell «⋯» disclosure with
 * move/duplicate/delete, `Ctrl+M` to insert a code cell below, and focus +
 * autoscroll onto the cell a mutation lands on. Everything routes through the
 * one `cookbooks-lab:mutate` channel: unsaved edits are flushed first, and the
 * fresh document the sidecar answers with replaces the surface wholesale.
 *
 * Wave 11 («Rich Output & Persistence») renders the cell's `display_data`: every
 * rich record the copy or the sidecar carries is drawn after the cell's own text
 * — an image as a `data:`-URL, HTML in a sandboxed frame (`allow-scripts`, never
 * `allow-same-origin`, and always led by the record's own `default-src 'none'`
 * policy), JSON pretty-printed, markdown through the product renderer — while an
 * unrendered mime falls back to its plain text. The block reads as one text: what
 * the cell printed plus the plain-text record of every display it emitted.
 * Opening a document seeds the surface from the outputs the copy already persists
 * (`status: 'saved'`) and from nbformat `execution_count`, so a reopened notebook
 * shows its saved results and its `[N]` counters before anything runs.
 *
 * Wave 13 («Colab Convenience & Informativity») completes the parity work in two
 * passes over this file. The first (F1–F4) adds the keyboard half: command mode
 * with `j`/`k`/`a`/`b`/`dd`/`y`/`m`, find & replace behind `Ctrl/Cmd+F`
 * (`find-replace.ts`) and markdown cells that open on a double click. The second
 * (F5–F9) adds the informational half: autosave on a one-second debounce with a
 * status-bar indicator, `Ctrl/Cmd+S` through the same save core, the surface
 * status bar (save state, document sizes, the last run), per-cell run durations
 * — the sidecar's own measurement where the batch carries one, this session's
 * clock for a single run — the outline scroll-spy (`scroll-spy.ts`) and
 * «Перезапустить и выполнить» (clear every output, then run the batch again).
 *
 * Wave 14 («Cell Manipulation & Focus», slice A) adds the manipulation half of
 * Colab parity: native HTML5 drag & drop of a cell (the gutter handle, the
 * existing insert rows and a cell's own midline as drop zones), a multi-cell
 * selection with a range anchor (`cell-selection.ts`, `Shift+click`/`Shift+↑↓`),
 * an in-renderer cell buffer (`Ctrl+C`/`Ctrl+X`/`Ctrl+V` and the per-cell menu),
 * `Alt+Enter` (run the focused cell, then insert a fresh code cell below) and a
 * run-all progress counter in the header. The command-mode selection stays the
 * surface's one `selectedCell` — the anchor is a sibling, so every existing
 * gesture keeps its meaning.
 *
 * Wave 14 (slice E) adds the focus half of the same parity: structural undo/redo
 * (`cell-history.ts`) over every gesture the surface performs, per-cell folding
 * (a `Set` of collapsed indices, session-only), the «Скачать» menu with its
 * `.py` entry, two-space Tab indentation in a code editor, `text/latex` outputs
 * rendered as display math through the product `<Markdown>`, numbered outline
 * entries (`numberHeadings`) and the batch's own size while it runs.
 *
 * Every string comes from `cookbooks.*` through `t()` and every colour, radius,
 * type size and control height is a ROX token, so the surface follows the app
 * theme in all twelve locales and never drifts into ad-hoc styling.
 */
import { PanelHeading } from '@/components/app-shell/ShellSidebarPortal'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePlatform } from '@rox/ui'
import { formatDuration } from '@rox/ui/chat/turn-utils'
import { Markdown, type RenderMode } from '@/components/markdown'
import { useAction } from '@/actions/useAction'
import { formatHotkeyDisplay } from '@/lib/platform'
import { prefersReducedMotionNow } from '@/lib/render-profile-motion'
import { cn } from '@/lib/utils'
import {
  buildNotebookExport,
  buildPythonScript,
  type CookbooksCard,
  type CookbooksCellMutation,
  type CookbooksDisplay,
  type CookbooksDocument,
  type CookbooksRunCell,
  type CookbooksStatus,
} from '../../../shared/cookbooks'
import { normalizeOutputText } from './output-text'
import { computeMatches, replaceAllInSources, replaceMatch, type CookbooksFindMatch } from './find-replace'
import { numberHeadings, pickActiveEntry } from './scroll-spy'
import {
  canRedo,
  canUndo,
  createHistory,
  invertOp,
  pushEntry,
  redoStep,
  undoStep,
  type History,
  type HistoryEntry,
  type HistoryOp,
} from './cell-history'
import {
  clampIndex,
  extendSelection,
  selectedIndices,
  type CellSelection,
} from './cell-selection'

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
 * exactly what is bound. Wave 10 adds the `Ctrl+M` insert key. Wave 13 adds the
 * command-mode keys (find/select/edit/type) and `Ctrl+S`.
 */
const SHORTCUT_KEYS: readonly string[] = [
  'cookbooks.help.shortcutRun',
  'cookbooks.help.shortcutRunStay',
  'cookbooks.help.shortcutRunAll',
  'cookbooks.help.shortcutNav',
  'cookbooks.help.shortcutStop',
  'cookbooks.help.shortcutInsert',
  'cookbooks.help.shortcutFind',
  'cookbooks.help.shortcutSelect',
  'cookbooks.help.shortcutEdit',
  'cookbooks.help.shortcutType',
  'cookbooks.help.shortcutSave',
  // Wave 14 (F1–F3): the manipulation keys this slice binds.
  'cookbooks.shortcuts.altEnter',
  'cookbooks.shortcuts.multi',
  'cookbooks.shortcuts.cellBuffer',
  // Wave 14 (F6/F9): structural undo/redo and the code-editor indent.
  'cookbooks.shortcuts.undo',
  'cookbooks.shortcuts.tab',
  'cookbooks.shortcuts.drag',
]

/**
 * Wave 9 outline: ATX heading, H1–H3 only, no trailing `#` run. Setext
 * headings are not part of the contract — the outline lists what the document
 * writes as a heading line.
 */
const HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*#*$/

/** One heading as the outline reads it — its level and its title. */
interface CookbooksHeading {
  /** The `#` count, 1–3 (wave 14 F11 numbers the outline by it). */
  level: number
  title: string
}

/** The H1–H3 headings of one markdown block, in the order it writes them. */
function headingsOf(source: string): CookbooksHeading[] {
  const headings: CookbooksHeading[] = []
  for (const line of source.split('\n')) {
    const match = HEADING_PATTERN.exec(line)
    if (match) headings.push({ level: match[1].length, title: match[2].trim() })
  }
  return headings
}

/** One outline entry: its title and the element its click scrolls to. */
interface CookbooksOutlineEntry extends CookbooksHeading {
  /** Wave 14 (F11): the dotted numeral `numberHeadings` gave this entry. */
  number: string
  /** `data-testid` of the block the heading belongs to. */
  testId: string
}

/**
 * Wave 14 (F11): the outline indent of a heading level — one step per level
 * below the first, so an H1 sits flush, an H2 one step in and an H3 two. A
 * record (not an inline style) keeps the spacing a token choice the theme owns.
 */
const OUTLINE_INDENT_CLASS: Record<number, string> = {
  1: '',
  2: 'pl-2',
  3: 'pl-4',
}

/** The only `disabledReason` the contract names; anything else is shown raw. */
const FILE_MISSING_REASON = 'file missing'

/**
 * R-B: an output longer than this starts collapsed, so a chatty cell («print
 * everything») cannot push the rest of the document off screen. One named
 * constant — the copy block and «Копировать вывод» always keep the full text.
 */
const OUTPUT_COLLAPSE_THRESHOLD = 600

/**
 * Wave 14 (F1): the `dataTransfer` type a cell drag carries. A custom type (plus
 * a `text/plain` twin) keeps the gesture from colliding with a text drag the
 * user may start inside an editor — the drop zones only ever accept this one.
 */
const DRAG_MIME = 'application/x-rox-cookbooks-cell'

/**
 * Wave 14 (F2): the in-renderer cell buffer — the type and on-screen source of
 * every cell a copy/cut captured. Deliberately NOT the system clipboard (SPEC
 * §4): the surface never has to ask the OS for permission and a rich cell keeps
 * its type, while `Ctrl+C`/`Ctrl+X`/`Ctrl+V` inside a text field stay native.
 */
type CellBuffer = { cellType: 'code' | 'markdown'; source: string }[]

/** Wave 14 (F1): which side of a drop target the indicator line marks. */
type DropPosition = 'above' | 'below'

/**
 * Wave 14 (F6): the `HistoryOp` one structural mutation records.
 *
 * A `delete` and a `duplicate` name only an index, so the cell's type — and, for
 * a delete, its on-screen source — has to come from the document as it stands:
 * that state is what an undo has to put back. Returns `null` for an op whose
 * cell is gone, which the caller reads as «nothing to record» (the mutation is
 * still sent; only the stack is left alone).
 */
function historyOpForMutation(
  mutation: CookbooksCellMutation,
  cells: CookbooksDocument['cells'],
  sources: Record<number, string>,
): HistoryOp | null {
  switch (mutation.op) {
    case 'add':
      // An insert that carried no source (the insert rows, `Ctrl+M`,
      // `Alt+Enter`) records an empty one, so its redo rebuilds the same cell.
      return { kind: 'add', index: mutation.index, cellType: mutation.cellType, source: mutation.source ?? '' }
    case 'delete': {
      const cell = cells[mutation.index]
      if (!cell) return null
      return {
        kind: 'delete',
        index: mutation.index,
        cellType: cell.cellType,
        source: sources[mutation.index] ?? cell.source,
      }
    }
    case 'move':
      return { kind: 'move', from: mutation.from, to: mutation.to }
    case 'duplicate':
      return cells[mutation.index] ? { kind: 'duplicate', index: mutation.index } : null
    case 'convert': {
      const cell = cells[mutation.index]
      return {
        kind: 'convert',
        index: mutation.index,
        fromType: cell?.cellType ?? (mutation.cellType === 'code' ? 'markdown' : 'code'),
        toType: mutation.cellType,
      }
    }
  }
}

/**
 * Wave 14 (F6): the history entry one gesture records — `mutations` exactly as
 * the surface performs them (`redo`), plus their inverses in REVERSE gesture
 * order (`undo`).
 *
 * The order is what makes a group replayable: the sidecar refuses an `add`
 * index above the document's length, so a delete group — recorded in descending
 * index order, the order the deletes themselves need — has to be undone with its
 * adds ASCENDING. `duplicate` has no positional inverse (`invertOp` answers
 * `null`), so the page builds that one pair itself: the sidecar copies a cell
 * into `index + 1`, which is exactly the index an undo deletes.
 */
function historyEntryFor(
  mutations: readonly CookbooksCellMutation[],
  labelKey: string,
  cells: CookbooksDocument['cells'],
  sources: Record<number, string>,
): HistoryEntry | null {
  const redo: HistoryOp[] = []
  for (const mutation of mutations) {
    const op = historyOpForMutation(mutation, cells, sources)
    if (!op) return null
    redo.push(op)
  }
  const undo: HistoryOp[] = []
  for (const op of [...redo].reverse()) {
    if (op.kind === 'duplicate') {
      const cell = cells[op.index]
      if (!cell) return null
      undo.push({
        kind: 'delete',
        index: op.index + 1,
        cellType: cell.cellType,
        source: sources[op.index] ?? cell.source,
      })
      continue
    }
    const inverse = invertOp(op)
    if (!inverse) return null
    undo.push(inverse)
  }
  return { labelKey, undo, redo }
}

/** Wave 14 (F6): the wire mutation that replays one history op. */
function mutationOfHistoryOp(op: HistoryOp): CookbooksCellMutation {
  switch (op.kind) {
    case 'add':
      return { op: 'add', cellType: op.cellType, index: op.index, source: op.source }
    case 'delete':
      return { op: 'delete', index: op.index }
    case 'move':
      return { op: 'move', from: op.from, to: op.to }
    case 'duplicate':
      return { op: 'duplicate', index: op.index }
    case 'convert':
      return { op: 'convert', index: op.index, cellType: op.toType }
  }
}

/**
 * Wave 14 (F9): the two spaces one Tab press (and one Shift+Tab) moves a line by
 * — the Colab/Python convention, and the reason `\t` never reaches the file.
 */
const INDENT_UNIT = '  '

/** Wave 14 (F9): the value and the caret/selection an indent gesture lands on. */
interface IndentResult {
  value: string
  start: number
  end: number
}

/**
 * Wave 14 (F9): Tab / Shift+Tab inside a code editor.
 *
 * A collapsed caret inserts `INDENT_UNIT` (Shift+Tab removes up to two leading
 * spaces, or one tab, from its own line); a selection indents or dedents EVERY
 * line it touches, and the selection travels with them. A selection that ends
 * exactly at the start of a line does not touch that line — the standard
 * editor rule, and what keeps a repeated Tab from indenting one line too many.
 */
function indentCode(value: string, start: number, end: number, outdent: boolean): IndentResult {
  const lines = value.split('\n')
  const lineStarts: number[] = [0]
  for (let at = 0; at < value.length; at += 1) {
    if (value[at] === '\n') lineStarts.push(at + 1)
  }
  const lineOf = (position: number): number => {
    let index = 0
    for (let at = 0; at < lineStarts.length; at += 1) {
      if (lineStarts[at] <= position) index = at
    }
    return index
  }

  if (start === end) {
    const line = lineOf(start)
    if (!outdent) {
      return {
        value: `${value.slice(0, start)}${INDENT_UNIT}${value.slice(end)}`,
        start: start + INDENT_UNIT.length,
        end: end + INDENT_UNIT.length,
      }
    }
    const match = /^( {1,2}|\t)/.exec(lines[line])
    if (!match) return { value, start, end }
    const removed = match[0].length
    lines[line] = lines[line].slice(removed)
    const caret = Math.max(lineStarts[line], start - removed)
    return { value: lines.join('\n'), start: caret, end: caret }
  }

  const firstLine = lineOf(start)
  const endLine = lineOf(end)
  const lastLine = endLine > firstLine && end === lineStarts[endLine] ? endLine - 1 : endLine
  const deltas: number[] = []
  for (let line = firstLine; line <= lastLine; line += 1) {
    if (outdent) {
      const match = /^( {1,2}|\t)/.exec(lines[line])
      const removed = match ? match[0].length : 0
      lines[line] = lines[line].slice(removed)
      deltas.push(-removed)
    } else {
      lines[line] = `${INDENT_UNIT}${lines[line]}`
      deltas.push(INDENT_UNIT.length)
    }
  }
  const shift = deltas.reduce((total, delta) => total + delta, 0)
  return { value: lines.join('\n'), start: start + deltas[0], end: end + shift }
}

/**
 * Wave 14 (F9, slice F): the index of the CODE cell editor that holds focus at
 * THIS instant, or `null` when the focus is anywhere else.
 *
 * Read at event time from the DOM — the same ref-at-event shape the
 * `app.search` takeover uses — because the action registry decides whether to
 * swallow the key before React renders anything. A markdown cell's editor is
 * deliberately excluded: it keeps the platform's own `Tab` (SPEC §9).
 */
function focusedCodeCellIndex(
  surface: HTMLElement | null,
  doc: CookbooksDocument | null,
): number | null {
  if (doc?.kind !== 'ipynb') return null
  const active = document.activeElement
  if (!(active instanceof HTMLTextAreaElement)) return null
  if (surface?.contains(active) !== true) return null
  const raw = active.dataset.cellIndex
  if (raw === undefined) return null
  const index = Number(raw)
  if (!Number.isInteger(index) || index < 0) return null
  if (doc.cells[index]?.cellType !== 'code') return null
  return index
}

/** Shared control chrome: ROX hit target, radius, hover and focus tokens. */
const ACTION_CLASS =
  'inline-flex h-[var(--control-md)] items-center justify-center rounded-[var(--radius-control)] border border-border-subtle bg-surface-hover px-2.5 text-small text-foreground transition-colors hover:bg-surface-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:cursor-default disabled:opacity-50'

/** Shared editable-source chrome: the cell editor and the playbook editor. */
const SOURCE_CLASS =
  'w-full resize-y rounded-[var(--radius-control)] border border-border-subtle bg-surface-input px-2 py-1.5 font-mono text-small text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground'

/**
 * Wave 13 (F5): how long the surface waits after the last edit before it writes
 * the dirty cells itself. One named constant — the debounce is the contract, not
 * a tuning knob, and `Ctrl/Cmd+S` is the explicit way to skip the wait.
 */
const SAVE_DEBOUNCE_MS = 1000

/**
 * Wave 13 (F5/F6): the four states the status bar reports. `saved` is the
 * resting state, `dirty` means edits are waiting on the debounce, `saving` a
 * flush in flight, and `error` the last flush's failure — which only a later
 * success clears.
 */
type CookbooksSaveState = 'saved' | 'dirty' | 'saving' | 'error'

/** F6: the indicator dot of each save state — shape is shared, colour is the state. */
const SAVE_DOT_CLASS: Record<CookbooksSaveState, string> = {
  saved: 'bg-success',
  dirty: 'bg-status-warning',
  saving: 'bg-muted-foreground',
  error: 'bg-destructive',
}

/**
 * F6: the last run the surface witnessed — its wall-clock time, the two
 * outcome counts and how long it took. A single run always reports `1`/`0` or
 * `0`/`1`; a batch counts its own cells.
 */
interface CookbooksLastRun {
  at: number
  ok: number
  failed: number
  durationMs: number
}

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
 *
 * Wave 11: `saved` is the fourth local value — a result that came from the copy
 * when the document was opened, not from a run of this session.
 */
type CookbooksCellStatus = CookbooksRunCell['status'] | 'cancelled' | 'saved'

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
  onActivate,
}: {
  mode: RenderMode
  source: string
  testId: string
  /**
   * Wave 13 (F4): double-click to edit. Passed ONLY for a cell's markdown
   * surface (never a rich display), and its presence is what reveals the
   * «Двойной клик — редактировать» hint on the wrapper.
   */
  onActivate?: () => void
}) {
  // G4-CB-001: route markdown links through the app's platform handlers — the
  // canonical <a> then preventDefaults both target kinds instead of letting the
  // click fall through to native window navigation.
  const { onOpenUrl, onOpenFile } = usePlatform()
  const { t } = useTranslation()
  return (
    <div
      data-testid={testId}
      data-mode={mode}
      className={MARKDOWN_CLASS}
      onDoubleClick={onActivate}
      title={onActivate ? t('cookbooks.cell.editHint') : undefined}
    >
      <Markdown mode={mode} onUrlClick={onOpenUrl} onFileClick={onOpenFile}>
        {source}
      </Markdown>
    </div>
  )
})

/**
 * Wave 11: the chrome a text-shaped block wears — the cell's own text and a
 * JSON display — so the two are scrollable, wrapped and clamped the same way.
 */
const OUTPUT_PRE_CLASS =
  'overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[var(--radius-control)] bg-surface-hover px-2.5 py-1.5 font-mono text-small'

/**
 * Wave 11: the mimes this surface draws. The emitter picks exactly ONE
 * widget-mime per display event in this same order (the canon `REPR_MIMES`), so
 * one event can never carry two of them; the renderer draws every record it
 * receives, in emission order. `text/plain` is deliberately absent — it is not a
 * widget: it is the plain-text fallback the block itself shows (`outputText`) —
 * and a mime outside this list (yaml, …) is carried by the document and the
 * export but not rendered.
 *
 * Wave 14 (F10): `text/latex` joins the list. It is no longer «carried but not
 * rendered»: a record that was already persisted by an earlier copy draws as
 * display math, through the same product `<Markdown>` a `$$` block in a
 * markdown cell takes (`MarkdownLatexBlock` / the lazy KaTeX plugin) — the
 * surface still imports no math library of its own.
 */
const RENDERABLE_MIMES: readonly string[] = [
  'text/html',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'text/markdown',
  'text/latex',
  'application/json',
]

/** Wave 11: JSON displays are pretty-printed; a payload that is not JSON shows verbatim. */
function prettyJson(data: string): string {
  try {
    return JSON.stringify(JSON.parse(data), null, 2)
  } catch {
    return data
  }
}

/**
 * Wave 11: the policy a rich HTML record is framed with — its OWN
 * `default-src 'none'` document policy, the `WidgetFrame.tsx` / `mail-sanitize`
 * precedent, so the embedding application's CSP (`script-src 'unsafe-inline'`,
 * `connect-src https:` and loopback) never reaches the record and a record can
 * never phone home or post a form. Inline scripts and styles keep working; this
 * is a phishing/exfil fence, not a renderer restriction.
 *
 * It travels FIRST in the document, where the HTML parser hoists a `<meta>` into
 * the frame's `<head>` whatever the record itself starts with.
 */
const FRAME_POLICY_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; form-action \'none\'; base-uri \'none\'">'

/**
 * Wave 11: one rich display record, drawn after the cell's own text. The mime
 * picks the widget. The HTML frame follows the `WidgetFrame.tsx` precedent:
 * scripts are allowed, but NEVER `allow-same-origin` — same-origin plus scripts
 * would hand the record this application's origin and its preload bridge.
 */
function DisplayRecord({ index, display }: { index: number; display: CookbooksDisplay }) {
  const { t } = useTranslation()
  if (display.mime === 'text/html') {
    return (
      <iframe
        data-testid={`cookbooks-display-frame-${index}`}
        title={t('cookbooks.output.frameTitle')}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        // The record's own policy leads its document, so the frame is fenced
        // against network, forms and a base URI no matter what it contains.
        srcDoc={`${FRAME_POLICY_META}${display.data}`}
        className="w-full min-h-[120px] rounded-[var(--radius-control)] border border-border-subtle bg-white"
      />
    )
  }
  if (display.mime === 'image/svg+xml' || display.mime === 'image/png' || display.mime === 'image/jpeg') {
    return (
      // The record's own mime rides in the URL, so svg/png/jpeg all decode.
      <img
        data-testid={`cookbooks-display-image-${index}`}
        src={`data:${display.mime};base64,${display.data}`}
        alt={t('cookbooks.output.imageAlt')}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="max-w-full rounded-[var(--radius-control)] border border-border-subtle"
      />
    )
  }
  if (display.mime === 'application/json') {
    return (
      <pre
        data-testid={`cookbooks-display-json-${index}`}
        className={cn(OUTPUT_PRE_CLASS, 'max-h-[320px] text-muted-foreground')}
      >
        {prettyJson(display.data)}
      </pre>
    )
  }
  if (display.mime === 'text/latex') {
    // Wave 14 (F10): the record's LaTeX travels into the product renderer as a
    // `$$` display-math block — the wrapper is what makes KaTeX draw it, and an
    // empty payload is skipped rather than rendered as an empty formula.
    if (display.data.trim().length === 0) return null
    return (
      <CellMarkdown
        mode="minimal"
        source={`$$\n${display.data}\n$$`}
        testId={`cookbooks-display-latex-${index}`}
      />
    )
  }
  // `text/markdown` — the only remaining mime of the priority list.
  return <CellMarkdown mode="minimal" source={display.data} testId={`cookbooks-display-markdown-${index}`} />
}

/**
 * The per-cell output block: pill-free, `data-status`-tagged, honest about
 * emptiness. R-B: `long` marks an output past the collapse threshold and
 * `expanded` its per-cell toggle — a collapsed block is height-clamped with a
 * scrollbar while its full text stays in the DOM for «Копировать вывод».
 *
 * Wave 9: the text goes through `normalizeOutputText`, so a progress bar that
 * rewrites one line with `\r` shows its final frame instead of every frame.
 *
 * Wave 11: the block is a column — the text `<pre>` first, then one widget per
 * rich display record the cell carries. The wrapper keeps the test id, status,
 * collapse flag and label the surface has always published.
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
  // Wave 11: the rich records the cell carries, in emission order — one widget
  // per event, text/plain excluded (it is the block's own fallback text) and so
  // is every mime this surface does not draw.
  const displays = (cell?.displays ?? []).filter((display) => RENDERABLE_MIMES.includes(display.mime))

  return (
    <div
      data-testid={`cookbooks-output-${index}`}
      data-status={cell?.status ?? 'idle'}
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label={t('cookbooks.cell.outputLabel', { index })}
      className="flex flex-col gap-1.5"
    >
      <pre
        className={cn(
          OUTPUT_PRE_CLASS,
          // A short block keeps the wave-7 cap; a long one is clamped while
          // collapsed and shown in full once expanded.
          long ? (expanded ? '' : 'max-h-[120px]') : 'max-h-[320px]',
          cell?.status === 'error' ? 'text-destructive-text' : 'text-muted-foreground',
        )}
      >
        {normalizeOutputText(outputText(cell))}
      </pre>
      {displays.map((display, position) => (
        <DisplayRecord key={`${position}:${display.mime}`} index={index} display={display} />
      ))}
    </div>
  )
}

/**
 * Wave 10: the Colab hover-insert row — «+ Код» / «+ Текст» drawn before every
 * cell and once after the last one, so `index` is the document position the new
 * cell lands at. The row reveals itself on hover/focus, except in an empty
 * notebook where it is the only thing on screen and stays visible.
 */
function InsertRow({
  index,
  alwaysVisible,
  disabled,
  busyHint,
  dropActive = false,
  onDragOver,
  onDragLeave,
  onDrop,
  onInsert,
}: {
  index: number
  /** `true` in an empty notebook: the lone row never hides. */
  alwaysVisible: boolean
  disabled: boolean
  /** Hint shown while an action is in flight; omitted when the row is idle. */
  busyHint?: string
  /** Wave 14 (F1): the drag in flight would land at this very gap. */
  dropActive?: boolean
  onDragOver?: (event: ReactDragEvent<HTMLElement>) => void
  onDragLeave?: (event: ReactDragEvent<HTMLElement>) => void
  onDrop?: (event: ReactDragEvent<HTMLElement>) => void
  onInsert: (cellType: 'code' | 'markdown') => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid={`cookbooks-insert-${index}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'group/insert flex h-6 items-center justify-center gap-2 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none',
        alwaysVisible && 'opacity-100',
        // Wave 14 (F1): the indicator line the drop would land on.
        dropActive && 'opacity-100 outline outline-2 outline-foreground',
      )}
    >
      <button
        type="button"
        data-testid={`cookbooks-insert-code-${index}`}
        title={busyHint}
        disabled={disabled}
        onClick={() => onInsert('code')}
        className={ACTION_CLASS}
      >
        {t('cookbooks.insert.code')}
      </button>
      <button
        type="button"
        data-testid={`cookbooks-insert-text-${index}`}
        title={busyHint}
        disabled={disabled}
        onClick={() => onInsert('markdown')}
        className={ACTION_CLASS}
      >
        {t('cookbooks.insert.text')}
      </button>
    </div>
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
  /** Wave 10: the one cell whose «⋯» actions row is disclosed, or null. */
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [playbookText, setPlaybookText] = useState('')
  const [playbookEditing, setPlaybookEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<CookbooksNotice | null>(null)
  /** R3: start of the active run, or null when no run is in flight. */
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  /** Wave 13 (F5): what the status bar says about the document on disk. */
  const [saveState, setSaveState] = useState<CookbooksSaveState>('saved')
  /** F5: wall-clock time (`Date.now()`) of the last successful write, or null before one. */
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  /** F7: session-local run duration per document index, in milliseconds. */
  const [durations, setDurations] = useState<Record<number, number>>({})
  /** F6: the most recent run this surface watched, or null before the first. */
  const [lastRun, setLastRun] = useState<CookbooksLastRun | null>(null)
  /** F8: the outline entry the scroll position is currently inside. */
  const [activeEntry, setActiveEntry] = useState<number | null>(null)
  /** Wave 13 (F1): the command-mode selection — any cell (code or markdown), or null. */
  const [selectedCell, setSelectedCell] = useState<number | null>(null)
  /** Wave 14 (F2): the range anchor that turns the focus into a multi-cell selection. */
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null)
  /** Wave 14 (F2): the internal cell buffer a copy/cut filled, or null when empty. */
  const [cellBuffer, setCellBuffer] = useState<CellBuffer | null>(null)
  /** Wave 14 (F1): the gap a drag in flight would drop into, or null when none. */
  const [dropGap, setDropGap] = useState<number | null>(null)
  /**
   * Wave 14 (F4): the batch's own size, shown next to «Запустить всё» while it
   * runs. The sidecar answers a whole batch in ONE response, so a monotone
   * «N of M» counter is not something this surface can honestly claim — what it
   * does know is how many cells it asked for, and that is what it shows. The
   * element is gone the moment the batch lands (the summary notice takes over).
   */
  const [runProgress, setRunProgress] = useState<number | null>(null)
  /** Wave 14 (F6): the structural undo/redo stack (`cell-history.ts`). */
  const [history, setHistory] = useState<History>(() => createHistory())
  /**
   * Wave 14 (F7): the folded cells, by document index. Session-only — the
   * `.ipynb` carries no fold state (SPEC §7, a recorded limitation).
   */
  const [collapsedCells, setCollapsedCells] = useState<ReadonlySet<number>>(() => new Set<number>())
  /** Wave 14 (F8): the «Скачать» menu's own disclosure state. */
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  /** Wave 13 (F2): the find & replace panel — visible only for an `ipynb`. */
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findReplacement, setFindReplacement] = useState('')
  const [findCase, setFindCase] = useState(false)
  /** The index of the current match within `findMatches` (clamped to the list). */
  const [findCurrent, setFindCurrent] = useState(0)
  const documentRef = useRef<HTMLElement | null>(null)
  /** Wave 13 (F2): the surface the `app.search` takeover is scoped to. */
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  /** Wave 13 (F2): the `kind` the `app.search` takeover gates on, read at event time. */
  const docRef = useRef<CookbooksDocument | null>(null)
  /** Wave 13 (F2): the find input, focused on open and after a jump. */
  const findInputRef = useRef<HTMLInputElement | null>(null)
  /** Wave 13 (F2): the selection a jump must paint once its cell editor exists. */
  const pendingSelectionRef = useRef<{ index: number; start: number; end: number } | null>(null)
  /** Wave 13 (F1): the timestamp of the first `d` of a `dd` delete (0 = disarmed). */
  const ddRef = useRef(0)
  /** Wave 14 (F1): the document index a drag started from, or null when idle. */
  const dragIndexRef = useRef<number | null>(null)
  /** Wave 13 (F5): single-flight latch — one flush at a time, whoever asked. */
  const flushingRef = useRef(false)
  /** F5: one `toast.error` per failure episode; a success re-arms the report. */
  const saveErrorNotifiedRef = useRef(false)
  /** Wave 13 (F8): the pending scroll-spy frame, so a scroll storm costs one layout. */
  const scrollSpyFrameRef = useRef<number | null>(null)
  /** Wave 10: the document index a structural mutation lands on, focused next pass. */
  const pendingFocusRef = useRef<number | null>(null)

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
    // Wave 11: a copy that already holds outputs opens with them on screen
    // (SPEC §15) — the text the cell printed, its first traceback as the cell's
    // error, every rich record it kept, and the `[N]` counter its own
    // `execution_count` stands for.
    const nextOutputs: Record<number, CookbooksCellResult> = {}
    const nextRuns: Record<number, number> = {}
    next.cells.forEach((cell, index) => {
      nextSources[index] = cell.source
      if (cell.outputs.length > 0) {
        nextOutputs[index] = {
          index,
          status: 'saved',
          stdout: cell.outputs
            .map((output) => output.text)
            .filter((text) => text.trim().length > 0)
            .join('\n'),
          error: cell.outputs.find((output) => output.traceback !== null)?.traceback ?? null,
          displays: cell.outputs.flatMap((output) => output.displays),
        }
      }
      if (typeof cell.executionCount === 'number' && cell.executionCount >= 1) {
        nextRuns[index] = cell.executionCount
      }
    })
    setSources(nextSources)
    setOutputs(nextOutputs)
    setExpandedOutputs({})
    // Wave 10: a re-read document invalidates the cell the menu pointed at.
    setMenuOpen(null)
    // Counters and edit modes belong to the document that was opened, not to the
    // surface: a freshly opened copy starts from the `execution_count`s its own
    // file holds.
    setRuns(nextRuns)
    setEditingCells({})
    setPlaybookEditing(false)
    setPlaybookText(next.text ?? '')
    // Wave 13 (F7): a run duration and a run summary belong to the document that
    // produced them, so a re-read document starts with neither.
    setDurations({})
    setLastRun(null)
    // Wave 13 (F8): the outline of the document that just arrived has not been
    // scrolled through yet.
    setActiveEntry(null)
    // Wave 13 (F5): a freshly read document is exactly what is on disk — the
    // autosave indicator starts honest, with no timestamp of its own.
    setSaveState('saved')
    setLastSavedAt(null)
    // Wave 13 (F2): a re-read document closes the find panel and clears its
    // query — a match offset belongs to the document it was found in.
    setFindOpen(false)
    setFindQuery('')
    setFindReplacement('')
    setFindCurrent(0)
    // Wave 13 (F1): keep a selection inside the new document's bounds.
    setSelectedCell((current) => {
      if (current === null) return null
      if (next.cells.length === 0) return null
      return Math.min(current, next.cells.length - 1)
    })
    // Wave 14 (F2): the range anchor follows the same clamp — a re-read document
    // can never leave the selection address a cell that no longer exists.
    setSelectionAnchor((current) => {
      if (current === null) return null
      if (next.cells.length === 0) return null
      return Math.min(current, next.cells.length - 1)
    })
    // Wave 14 (F1): a drag whose target just vanished has no gap to mark.
    setDropGap(null)
    // Wave 14 (F7): a fold is a statement about the cells this document was
    // read with — and an op that inserted or deleted one shifts every index
    // below it, so a re-read document starts unfolded rather than folding the
    // wrong cell. Wave 14 (F8): and the download menu closes with it.
    setCollapsedCells(new Set<number>())
    setExportMenuOpen(false)
  }, [])

  const openItem = useCallback(
    async (itemId: string, newCopy = false) => {
      await runWithBusy(newCopy ? `${itemId}:copy` : `${itemId}:open`, async () => {
        const result = await api.open(newCopy ? { itemId, newCopy: true } : { itemId })
        setCopyId(result.copyId)
        applyDocument(result.document)
        // Wave 13 (F1): a freshly opened document starts with no selection.
        setSelectedCell(null)
        // Wave 14 (F2): and no range anchor either.
        setSelectionAnchor(null)
        // Wave 14 (F6): a freshly opened document has no gestures behind it —
        // the stack describes the copy that was open, not this one.
        setHistory(createHistory())
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

  /**
   * Wave 10: land focus on the cell a structural mutation points at. The effect
   * keys off `doc` and `editingCells`, so a markdown cell — which only grows a
   * `<textarea>` once its edit mode is on — is focused on the second pass;
   * `-1` (a delete that emptied the notebook) clears the request without focus.
   */
  useEffect(() => {
    const target = pendingFocusRef.current
    if (target === null) return
    if (target === -1) {
      pendingFocusRef.current = null
      return
    }
    const field = documentRef.current?.querySelector<HTMLTextAreaElement>(
      `[data-testid="cookbooks-source-${target}"]`,
    )
    // Markdown in read mode has no field yet: wait for the edit-mode pass.
    if (!field) return
    pendingFocusRef.current = null
    scrollToCell(target)
    field.focus()
  }, [doc, editingCells, scrollToCell])

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
              // Wave 11: the rich records this run emitted travel with its text.
              displays: result.displays,
            },
          }))
          setRuns((previous) => ({ ...previous, [index]: (previous[index] ?? 0) + 1 }))
          // Wave 13 (F6): the status bar's run summary — for a single run the
          // outcome counts are its own, and the duration is the clock this
          // surface started above (`/run` answers no duration of its own).
          setLastRun({
            at: Date.now(),
            ok: cancelled || !result.ok ? 0 : 1,
            failed: cancelled || result.ok ? 0 : 1,
            durationMs: performance.now() - started,
          })
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
        // Wave 13 (F7): the client-side measurement of one run — recorded even
        // when the run was stopped or failed, because it did take that long.
        setDurations((previous) => ({ ...previous, [index]: performance.now() - started }))
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
      // Wave 14 (F4): the batch's own size — subsets «выше/ниже» count only their
      // own cells. The sidecar answers the whole batch in one response, so this
      // is the run's SIZE, shown for as long as the run lasts.
      setRunProgress(cells.length)
      try {
        await runWithBusy('run-all', async () => {
          // Wave 9: a stopped batch answers `cancelled` and omits the cells it
          // never reached.
          const result = await api.runAll({ itemId: openItemId, cells })
          const nextOutputs: Record<number, CookbooksCellResult> = {}
          for (const cell of result.cells) nextOutputs[cell.index] = cell
          if (result.cancelled === true) {
            // The sidecar answers one record per requested cell; the cells a
            // stop cut short come back as `skipped` (a natural error-stop keeps
            // `cancelled:false`, so during a cancellation those are exactly the
            // cells that never ran). They are stopped, not skipped.
            for (const cell of result.cells) {
              if (cell.status !== 'skipped') continue
              nextOutputs[cell.index] = { ...cell, status: 'cancelled' }
            }
            // Defence in depth: a cell the response never mentioned was stopped
            // just the same.
            for (const cell of cells) {
              if (nextOutputs[cell.index]) continue
              nextOutputs[cell.index] = {
                index: cell.index,
                status: 'cancelled',
                stdout: '',
                error: null,
                displays: [],
              }
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
          // Wave 13 (F7): the batch carries the sidecar's own per-cell timing —
          // the surface draws it as it arrived and leaves a session-only cell
          // (one with no `durationMs`) with whatever it already showed.
          setDurations((previous) => {
            const next = { ...previous }
            for (const cell of result.cells) {
              if (typeof cell.durationMs === 'number') next[cell.index] = cell.durationMs
            }
            return next
          })
          // Wave 13 (F6): the summary of the whole batch, wall clock included.
          setLastRun({
            at: Date.now(),
            ok: result.cells.filter((cell) => cell.status === 'ok').length,
            failed: result.cells.filter((cell) => cell.status === 'error').length,
            durationMs: performance.now() - started,
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
        // Wave 14 (F4): the progress counter lives exactly as long as the batch.
        setRunProgress(null)
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
   * Wave 14 (F6): flush every cell the surface holds an edit for, in ascending
   * document order, so the sidecar shifts a document that already holds the
   * edits on screen. Shared by every structural path — a fresh gesture, a
   * buffer paste and a history replay — because all three mutate the same file.
   */
  const flushSourceEdits = useCallback(async () => {
    if (!openItemId || !doc) return
    for (let index = 0; index < doc.cells.length; index += 1) {
      const edited = sources[index] ?? doc.cells[index].source
      if (edited === doc.cells[index].source) continue
      await api.save({ itemId: openItemId, index, source: sources[index] ?? '' })
    }
  }, [api, doc, openItemId, sources])

  /**
   * Wave 10: the one structural-mutation path (add/delete/move/duplicate).
   * Anything unsaved is flushed first, in ascending document order, so the
   * sidecar shifts a document that already holds the edits on screen; a failed
   * save aborts the mutation before the sidecar is ever asked. The fresh
   * document the sidecar answers with replaces the surface wholesale and the
   * returned `index` becomes the next focus target.
   *
   * Wave 14 (F6): the gesture is recorded on the undo stack — once, and only
   * after the sidecar accepted it — so every caller (the insert rows, the ⋯
   * menu, `Ctrl+M`, `Alt+Enter`, `y`/`m`, a drag and a drop) is undoable
   * without repeating the bookkeeping.
   */
  const mutateCell = useCallback(
    async (mutation: CookbooksCellMutation) => {
      if (!openItemId || !doc || busy !== null) return
      const entry = historyEntryFor([mutation], `cookbooks.op.${mutation.op}`, doc.cells, sources)
      await runWithBusy('mutate', async () => {
        await flushSourceEdits()
        const result = await api.mutate({ itemId: openItemId, ...mutation })
        applyDocument(result.document)
        pendingFocusRef.current = result.index
        if (entry) setHistory((current) => pushEntry(current, entry))
        // Wave 10: only an insert opens the markdown editor — delete/move/
        // duplicate must not steal into edit. Wave 13 (F3): a conversion to
        // markdown does open it, since the cell just became text.
        const target = result.document.cells[result.index]
        if ((mutation.op === 'add' || mutation.op === 'convert') && target?.cellType === 'markdown') {
          setEditingCells((previous) => ({ ...previous, [result.index]: true }))
        }
      })
    },
    [api, applyDocument, busy, doc, flushSourceEdits, openItemId, runWithBusy, sources],
  )

  // -------------------------------------------------------------------------
  // Wave 14 (slice A) — multi-selection (F2), the cell buffer (F2), drag & drop
  // (F1) and Alt+Enter (F3)
  // -------------------------------------------------------------------------

  /** The cell count the selection arithmetic clamps against (a playbook has none). */
  const cellCount = doc?.kind === 'ipynb' ? doc.cells.length : 0
  /** Wave 14 (F2): the focus+anchor pair the pure `cell-selection` module reads. */
  const selection = useMemo<CellSelection | null>(
    () => (selectedCell === null ? null : { focus: selectedCell, anchor: selectionAnchor }),
    [selectedCell, selectionAnchor],
  )
  /** Wave 14 (F2): every selected index, ascending — the one read path. */
  const selectedAll = useMemo(() => selectedIndices(selection, cellCount), [cellCount, selection])

  /** Wave 14 (F2): land a single-cell selection (the anchor always drops). */
  const selectSingle = useCallback((index: number) => {
    setSelectedCell(index)
    setSelectionAnchor(null)
  }, [])

  /** Wave 14 (F2): extend the range to `index` (anchor = current focus if unset). */
  const selectRange = useCallback(
    (index: number) => {
      if (cellCount === 0) return
      if (selectedCell === null) {
        setSelectedCell(clampIndex(index, cellCount))
        setSelectionAnchor(null)
        return
      }
      const next = extendSelection(
        { focus: selectedCell, anchor: selectionAnchor },
        clampIndex(index, cellCount),
      )
      setSelectedCell(next.focus)
      setSelectionAnchor(next.anchor)
    },
    [cellCount, selectedCell, selectionAnchor],
  )

  /** Wave 14 (F2): `Shift+↑/↓` — move the focus, keeping the range anchor. */
  const extendByArrow = useCallback(
    (direction: -1 | 1) => {
      if (cellCount === 0) return
      if (selectedCell === null) {
        setSelectedCell(direction === 1 ? 0 : cellCount - 1)
        setSelectionAnchor(null)
        return
      }
      const next = extendSelection(
        { focus: selectedCell, anchor: selectionAnchor },
        clampIndex(selectedCell + direction, cellCount),
      )
      setSelectedCell(next.focus)
      setSelectionAnchor(next.anchor)
    },
    [cellCount, selectedCell, selectionAnchor],
  )

  /** Wave 14 (F2): drop the whole selection (Esc). */
  const clearSelection = useCallback(() => {
    setSelectedCell(null)
    setSelectionAnchor(null)
  }, [])

  /**
   * Wave 14 (F2): apply a group of structural ops as one gesture. The sidecar is
   * asked once per op, in the order given — a delete group is passed in
   * descending index order by its caller, so every op still names the cell it
   * means once its predecessors are gone. Unsaved edits are flushed first,
   * exactly like a single mutation, and the document re-read after the last op
   * is the one on screen.
   *
   * Wave 14 (F6): the whole group is ONE history entry. `labelKey` names the
   * gesture for the toast — a paste is not an insert, even though it is sent as
   * a run of `add` ops.
   */
  const mutateMany = useCallback(
    async (mutations: CookbooksCellMutation[], labelKey?: string) => {
      if (mutations.length === 0) return
      if (!openItemId || !doc || busy !== null) return
      const entry = historyEntryFor(
        mutations,
        labelKey ?? `cookbooks.op.${mutations[0].op}`,
        doc.cells,
        sources,
      )
      await runWithBusy('mutate', async () => {
        await flushSourceEdits()
        let landed = 0
        for (const mutation of mutations) {
          const result = await api.mutate({ itemId: openItemId, ...mutation })
          applyDocument(result.document)
          landed = result.index
        }
        pendingFocusRef.current = landed
        if (entry) setHistory((current) => pushEntry(current, entry))
      })
    },
    [api, applyDocument, busy, doc, flushSourceEdits, openItemId, runWithBusy, sources],
  )

  /** Wave 14 (F2): the on-screen type+source of each named cell, in order. */
  const snapshotCells = useCallback(
    (indices: number[]): CellBuffer =>
      indices.flatMap((index) => {
        const cell = doc?.cells[index]
        if (!cell) return []
        return [{ cellType: cell.cellType, source: sources[index] ?? cell.source }]
      }),
    [doc, sources],
  )

  /** Wave 14 (F2): `Ctrl+C` / «Копировать ячейку» — capture, never touch the doc. */
  const copyCells = useCallback(
    (indices: number[] = selectedAll) => {
      const buffer = snapshotCells(indices)
      if (buffer.length === 0) return
      setCellBuffer(buffer)
      setNotice({ source: 'key', key: 'cookbooks.buffer.copied', params: { count: buffer.length } })
    },
    [selectedAll, snapshotCells],
  )

  /** Wave 14 (F2): `Ctrl+X` / «Вырезать ячейку» — capture, then delete the block. */
  const cutCells = useCallback(
    (indices: number[] = selectedAll) => {
      const buffer = snapshotCells(indices)
      if (buffer.length === 0) return
      setCellBuffer(buffer)
      setNotice({ source: 'key', key: 'cookbooks.buffer.cut', params: { count: buffer.length } })
      const descending = [...indices].sort((left, right) => right - left)
      clearSelection()
      void mutateMany(descending.map((index) => ({ op: 'delete', index })))
    },
    [clearSelection, mutateMany, selectedAll, snapshotCells],
  )

  /** Wave 14 (F2): `Ctrl+V` / «Вставить после» — append the buffer after the focus. */
  const pasteCells = useCallback(
    async (after?: number) => {
      if (!doc || doc.kind !== 'ipynb') return
      if (!cellBuffer || cellBuffer.length === 0) {
        setNotice({ source: 'key', key: 'cookbooks.buffer.empty' })
        return
      }
      // Paste lands after the explicit anchor (the menu's own cell) or after the
      // selection block; with neither it appends.
      const at = after ?? (selectedAll.length > 0 ? selectedAll[selectedAll.length - 1] : doc.cells.length - 1)
      const mutations: CookbooksCellMutation[] = cellBuffer.map((cell, offset) => ({
        op: 'add',
        cellType: cell.cellType,
        index: at + 1 + offset,
        source: cell.source,
      }))
      setNotice({ source: 'key', key: 'cookbooks.buffer.pasted', params: { count: cellBuffer.length } })
      // Wave 14 (F6): the block is one entry, and the toast names it «вставка
      // из буфера» rather than the `add` ops it is sent as.
      await mutateMany(mutations, 'cookbooks.op.paste')
      // Selection becomes the pasted block: its first cell is the focus, its last
      // the anchor, so the range reads as the block that just landed.
      const first = at + 1
      setSelectedCell(first)
      setSelectionAnchor(cellBuffer.length > 1 ? first + cellBuffer.length - 1 : null)
    },
    [cellBuffer, doc, mutateMany, selectedAll],
  )

  /** Wave 14 (F1): the drag start — the handle hands its index to the drop zones. */
  const handleDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>, index: number) => {
      // A busy surface has no legal drop: the handle never starts a drag.
      if (busy !== null) {
        event.preventDefault()
        return
      }
      dragIndexRef.current = index
      const transfer = event.dataTransfer
      if (transfer) {
        transfer.effectAllowed = 'move'
        transfer.setData(DRAG_MIME, String(index))
        transfer.setData('text/plain', String(index))
      }
    },
    [busy],
  )

  /** Wave 14 (F1): dragend always runs — a cancelled drag (Esc) drops its gap. */
  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null
    setDropGap(null)
  }, [])

  /** Wave 14 (F1): a hovered insert row is the gap at its own index. */
  const handleGapDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>, gap: number) => {
      if (dragIndexRef.current === null || busy !== null) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      setDropGap(gap)
    },
    [busy],
  )

  /** Wave 14 (F1): a hovered cell splits at its midline — above or below. */
  const handleArticleDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>, index: number) => {
      if (dragIndexRef.current === null || busy !== null) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      setDropGap(event.clientY < rect.top + rect.height / 2 ? index : index + 1)
    },
    [busy],
  )

  /** Wave 14 (F1): leaving a zone for anything outside it clears the indicator. */
  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) return
    setDropGap(null)
  }, [])

  /** Wave 14 (F1): the drop translates a gap into the `move` op's target index. */
  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      const from = dragIndexRef.current
      const gap = dropGap
      dragIndexRef.current = null
      setDropGap(null)
      if (from === null || gap === null || busy !== null) return
      // A gap above the dragged cell shifts that cell down by one; a gap at or
      // below it is already the destination index.
      const to = gap > from ? gap - 1 : gap
      if (to === from || to < 0) return
      void mutateCell({ op: 'move', from, to })
    },
    [busy, dropGap, mutateCell],
  )

  // -------------------------------------------------------------------------
  // Wave 14 (slice E) — undo/redo (F6), fold (F7), the download menu (F8),
  // Tab indentation (F9)
  // -------------------------------------------------------------------------

  /**
   * Wave 14 (F6): replay a history entry's ops — consecutive `api.mutate` calls
   * in the order the entry carries, exactly like a fresh group gesture. The
   * entry's own order is the contract (`historyEntryFor`), so nothing is sorted
   * here; the document re-read after the last op is the one on screen, and the
   * last landing index becomes the focus target.
   */
  const replayHistoryOps = useCallback(
    async (ops: HistoryOp[]) => {
      if (!openItemId) return
      await flushSourceEdits()
      let landed = 0
      for (const op of ops) {
        const result = await api.mutate({ itemId: openItemId, ...mutationOfHistoryOp(op) })
        applyDocument(result.document)
        landed = result.index
      }
      pendingFocusRef.current = landed
    },
    [api, applyDocument, flushSourceEdits, openItemId],
  )

  /**
   * Wave 14 (F6): the two directions, behind one core.
   *
   * The stack moves FIRST — the gesture is what the user asked for — and a
   * replay that fails drops the whole history rather than leaving a stack that
   * no longer describes the document on screen (a later undo would then replay
   * the wrong ops). The `{{action}}` of the toast is the recorded gesture's own
   * label, and the busy gate is the caller's: while `busy` is set the buttons
   * are disabled and this is never reached.
   */
  const stepHistory = useCallback(
    async (direction: 'undo' | 'redo') => {
      if (busy !== null) return
      const step = direction === 'undo' ? undoStep(history) : redoStep(history)
      if (!step) return
      setHistory(step.history)
      await runWithBusy('history', async () => {
        try {
          await replayHistoryOps(direction === 'undo' ? step.entry.undo : step.entry.redo)
          toast.success(
            t(direction === 'undo' ? 'cookbooks.undo.done' : 'cookbooks.redo.done', {
              action: t(step.entry.labelKey),
            }),
          )
        } catch (cause: unknown) {
          setHistory(createHistory())
          setNotice({ source: 'text', text: describeFailure(cause) })
        }
      })
    },
    [busy, history, replayHistoryOps, runWithBusy, t],
  )

  const undo = useCallback(() => stepHistory('undo'), [stepHistory])
  const redo = useCallback(() => stepHistory('redo'), [stepHistory])

  /** Wave 14 (F7): hide/show one cell's editor and rendering. */
  const toggleCellFold = useCallback((index: number) => {
    setCollapsedCells((previous) => {
      const next = new Set(previous)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  /**
   * Wave 14 (F9): the caret an indent gesture must paint once React has
   * committed the new source — a controlled `<textarea>` moves its caret to the
   * end on every re-render, so the range is restored here, after the value.
   */
  const pendingCaretRef = useRef<{ index: number; start: number; end: number } | null>(null)

  useEffect(() => {
    const pending = pendingCaretRef.current
    if (!pending) return
    const field = documentRef.current?.querySelector<HTMLTextAreaElement>(
      `[data-testid="cookbooks-source-${pending.index}"]`,
    )
    if (!field) return
    pendingCaretRef.current = null
    field.setSelectionRange(pending.start, pending.end)
  }, [sources])

  /**
   * Wave 14 (F9): `Tab`/`Shift+Tab` inside a CODE editor indents or dedents by
   * `INDENT_UNIT`. Bound on the code textarea only (a markdown editor keeps the
   * browser's own Tab), and the key is always swallowed there — a Tab that moved
   * focus out of the editor would be a trap. `preventDefault` therefore happens
   * for every Tab this handler sees, and only for the code editor's own events.
   */
  const handleCodeTab = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>, index: number) => {
      if (event.key !== 'Tab') return
      event.preventDefault()
      const field = event.currentTarget
      const result = indentCode(
        field.value,
        field.selectionStart ?? field.value.length,
        field.selectionEnd ?? field.value.length,
        event.shiftKey,
      )
      if (result.value === field.value) return
      pendingCaretRef.current = { index, start: result.start, end: result.end }
      setSource(index, result.value)
    },
    [setSource],
  )

  // -------------------------------------------------------------------------
  // Wave 13 — command mode (F1), find & replace (F2), md-micro (F4), the
  // autosave core and its indicator (F5), run durations (F7)
  // -------------------------------------------------------------------------

  /** Keep the event-time `doc` snapshot the `app.search` takeover gates on. */
  useEffect(() => {
    docRef.current = doc
  }, [doc])

  /** The matches of the current query over the open notebook's sources. */
  const findMatches = useMemo<CookbooksFindMatch[]>(() => {
    if (doc?.kind !== 'ipynb') return []
    return computeMatches(
      doc.cells.map((cell, index) => sources[index] ?? cell.source),
      findQuery,
      findCase,
    )
  }, [doc, sources, findQuery, findCase])

  /** The current match index follows the list: clamped, and 0 when empty. */
  useEffect(() => {
    setFindCurrent((current) => (findMatches.length === 0 ? 0 : Math.min(current, findMatches.length - 1)))
  }, [findMatches.length])

  /** Focus the query field the moment the panel opens (a repeated `Ctrl+F`). */
  useEffect(() => {
    if (!findOpen) return
    findInputRef.current?.focus()
  }, [findOpen])

  /**
   * Wave 13 (F2): show the current match — its cell is scrolled into view, a
   * markdown cell is switched into edit, and the span is painted inside the
   * cell editor WITHOUT moving focus off the query field. A markdown cell has
   * no editor until the edit-mode pass, so the span is queued for the effect
   * below.
   */
  useEffect(() => {
    if (!findOpen) return
    const match = findMatches[findCurrent]
    if (!match) {
      // No current match — drop any selection a previous jump left queued.
      pendingSelectionRef.current = null
      return
    }
    if (docRef.current?.cells[match.cell]?.cellType === 'markdown') {
      setEditingCells((previous) => (previous[match.cell] ? previous : { ...previous, [match.cell]: true }))
    }
    scrollToCell(match.cell)
    pendingSelectionRef.current = { index: match.cell, start: match.start, end: match.end }
  }, [findOpen, findMatches, findCurrent, scrollToCell])

  /** Paint a queued selection once its cell editor exists in the DOM. */
  useEffect(() => {
    const pending = pendingSelectionRef.current
    if (!pending) return
    const field = documentRef.current?.querySelector<HTMLTextAreaElement>(
      `[data-testid="cookbooks-source-${pending.index}"]`,
    )
    if (!field) return
    pendingSelectionRef.current = null
    field.setSelectionRange(pending.start, pending.end)
  }, [doc, editingCells, findMatches, findCurrent])

  /** Wrap-around move over the match list. */
  const goToMatch = useCallback(
    (direction: 1 | -1) => {
      if (findMatches.length === 0) return
      setFindCurrent((current) => (current + direction + findMatches.length) % findMatches.length)
    },
    [findMatches.length],
  )

  /** Replace the current match in its own cell; the matches recompute after. */
  const replaceCurrent = useCallback(() => {
    const match = findMatches[findCurrent]
    if (!match || !doc) return
    const source = sources[match.cell] ?? doc.cells[match.cell]?.source ?? ''
    setSource(match.cell, replaceMatch(source, match.start, match.end, findReplacement))
  }, [doc, findCurrent, findMatches, findReplacement, setSource, sources])

  /** «Заменить всё» over every cell; a zero count is a genuine no-op. */
  const replaceAll = useCallback(() => {
    if (!doc) return
    const { updates, count } = replaceAllInSources(
      doc.cells.map((cell, index) => sources[index] ?? cell.source),
      findQuery,
      findReplacement,
      findCase,
    )
    if (count === 0) return
    setSources((previous) => ({ ...previous, ...updates }))
    setNotice({ source: 'key', key: 'cookbooks.find.replaced', params: { count } })
  }, [doc, findCase, findQuery, findReplacement, sources])

  /**
   * The find panel's own keys. It sits outside the document `<section>`, so its
   * `Enter`/`Esc` never reach `handleDocumentKeyDown`: `Enter`/`Shift+Enter`
   * step through the matches (wrapping) and `Esc` closes the panel.
   */
  const handleFindKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setFindOpen(false)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        goToMatch(event.shiftKey ? -1 : 1)
      }
    },
    [goToMatch],
  )

  /** Keep the caret in the query field — the panel's buttons never steal it. */
  const refocusFind = useCallback(() => findInputRef.current?.focus(), [])

  /** Move the command-mode selection by one cell, clamping at both ends. */
  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      if (!doc || doc.cells.length === 0) return
      // Wave 14 (F2): a plain move is a single-cell selection — the range anchor drops.
      setSelectionAnchor(null)
      setSelectedCell((current) => {
        if (current === null) return direction === 1 ? 0 : doc.cells.length - 1
        return Math.min(Math.max(current + direction, 0), doc.cells.length - 1)
      })
    },
    [doc],
  )

  /** Land DOM focus on the selected cell (a structural mutation points it away). */
  useEffect(() => {
    if (selectedCell === null || pendingFocusRef.current !== null) return
    documentRef.current?.querySelector<HTMLElement>(`[data-testid="cookbooks-cell-${selectedCell}"]`)?.focus()
  }, [selectedCell])

  /**
   * Wave 13 (F5): stamp a successful save's fingerprint into `doc`. This is the
   * only writer of a cell's `source` outside `applyDocument`, and it is what
   * keeps «грязно» meaning exactly `sources[i] !== doc.cells[i].source` — the
   * autosave flush and every manual «Сохранить» go through it, so the indicator
   * is honest whichever one wrote the file.
   */
  const stampCellSaved = useCallback((index: number, source: string) => {
    setDoc((previous) =>
      previous
        ? { ...previous, cells: previous.cells.map((cell, at) => (at === index ? { ...cell, source } : cell)) }
        : previous,
    )
  }, [])

  /** F5: the playbook's twin — the document's own text is its server fingerprint. */
  const stampPlaybookSaved = useCallback((text: string) => {
    setDoc((previous) => (previous ? { ...previous, text } : previous))
  }, [])

  /** F4: save the markdown cell and drop back to read mode; a failure stays in edit. */
  const saveMarkdownAndClose = useCallback(
    async (index: number) => {
      if (!openItemId) return
      const source = sources[index] ?? ''
      await runWithBusy(`cell:${index}:save`, async () => {
        await api.save({ itemId: openItemId, index, source })
        stampCellSaved(index, source)
        setNotice({ source: 'key', key: 'cookbooks.status.cellSaved', params: { index } })
        setEditingCells((previous) => ({ ...previous, [index]: false }))
      })
    },
    [api, openItemId, runWithBusy, sources, stampCellSaved],
  )

  /** F4: the playbook's twin — save its text and leave the editor. */
  const savePlaybookAndClose = useCallback(async () => {
    if (!openItemId) return
    await runWithBusy('playbook:save', async () => {
      await api.save({ itemId: openItemId, text: playbookText })
      stampPlaybookSaved(playbookText)
      setNotice({ source: 'key', key: 'cookbooks.status.saved' })
      setPlaybookEditing(false)
    })
  }, [api, openItemId, playbookText, runWithBusy, stampPlaybookSaved])

  /**
   * Wave 13 (F5): the one save core — the autosave debounce and `Ctrl/Cmd+S`
   * both land here, so there is a single definition of «save what is dirty».
   *
   * Every dirty cell goes to the sidecar as its own `api.save`, in ascending
   * document order, and the playbook is written last; each success stamps the
   * server fingerprint into `doc` (see `stampCellSaved`). Single-flight: a flush
   * already in flight swallows the next request — the newer edits are still
   * dirty afterwards, so the debounce picks them up. A clean document is a
   * genuine no-op: no call, no notice. A failure leaves `saveState: 'error'`
   * and reports once per episode, re-arming on the next success.
   */
  const flushChanges = useCallback(async () => {
    if (!doc || !openItemId || flushingRef.current) return
    const dirtyIndices =
      doc.kind === 'ipynb'
        ? doc.cells.flatMap((cell, index) => ((sources[index] ?? cell.source) !== cell.source ? [index] : []))
        : []
    const playbookDirty = doc.kind === 'md' && playbookText !== (doc.text ?? '')
    if (dirtyIndices.length === 0 && !playbookDirty) return
    flushingRef.current = true
    setSaveState('saving')
    try {
      for (const index of dirtyIndices) {
        const source = sources[index] ?? doc.cells[index].source
        await api.save({ itemId: openItemId, index, source })
        stampCellSaved(index, source)
      }
      if (playbookDirty) {
        await api.save({ itemId: openItemId, text: playbookText })
        stampPlaybookSaved(playbookText)
      }
      saveErrorNotifiedRef.current = false
      // A wall-clock stamp, because both places that read it — the status bar's
      // copy and its `title` — print a time of day (`toLocaleTimeString`); a
      // `performance.now()` reading would render as an epoch-shaped “01:00:00”.
      setLastSavedAt(Date.now())
      setSaveState('saved')
    } catch {
      setSaveState('error')
      if (!saveErrorNotifiedRef.current) {
        saveErrorNotifiedRef.current = true
        toast.error(t('cookbooks.save.error'))
      }
    } finally {
      flushingRef.current = false
    }
  }, [api, doc, openItemId, playbookText, sources, stampCellSaved, stampPlaybookSaved, t])

  /**
   * F5: what is still unsaved, as one number — a notebook counts its dirty
   * cells, a playbook its (single) dirty text. The status bar reports it
   * verbatim, and the autosave effect keys off «is there anything at all».
   */
  const dirtyCount =
    doc === null
      ? 0
      : doc.kind === 'md'
        ? playbookText === (doc.text ?? '')
          ? 0
          : 1
        : doc.cells.reduce((count, cell, index) => count + ((sources[index] ?? cell.source) === cell.source ? 0 : 1), 0)
  const isDirty = dirtyCount > 0

  /**
   * F5: the autosave debounce. Any change to the sources, the playbook or the
   * document re-arms a one-second timer; `Ctrl/Cmd+S` calls the same core
   * without waiting. While another action is in flight the timer is not armed at
   * all — the action's own flush must not be raced — and the effect re-arms the
   * moment `busy` clears again.
   */
  useEffect(() => {
    if (!doc || !openItemId) return
    if (!isDirty) {
      // Nothing to write: the indicator rests on «saved», unless a flush is
      // still in flight or the last one failed — only the core may leave those.
      setSaveState((current) => (current === 'saving' || current === 'error' ? current : 'saved'))
      return
    }
    if (busy !== null) return
    setSaveState((current) => (current === 'saving' ? current : 'dirty'))
    // The global timer, not `window.setTimeout`: identical inside the renderer
    // (where `globalThis` IS `window`), but this is the timer a test can fake.
    const timer = setTimeout(() => {
      void flushChanges()
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [busy, doc, flushChanges, isDirty, openItemId])

  /**
   * Wave 13 (F2): `Ctrl/Cmd+F` is bound THROUGH THE ACTION REGISTRY, never a
   * local handler. The registry listens to `keydown` in the CAPTURE phase on
   * `window` (actions/registry.tsx) and `app.search` (`mod+f`, no flag) is
   * intercepted there before React ever sees the event — a section-local `f`
   * handler could not run. Priority 20 raises this takeover above the app's
   * other `app.search` handlers while the surface is focused on a notebook;
   * `enabled` keeps the key inert everywhere else (no notebook focused).
   */
  useAction(
    'app.search',
    () => {
      setFindOpen(true)
      // A repeat `Ctrl+F` while the panel is already open must re-focus the query
      // field; on the first open the panel is not mounted yet, so the effect
      // above lands the focus instead.
      findInputRef.current?.focus()
    },
    {
      enabled: () =>
        surfaceRef.current?.contains(document.activeElement) === true && docRef.current?.kind === 'ipynb',
      priority: 20,
    },
    [],
  )

  /**
   * Wave 14 (F9, slice F): `Shift+Tab` inside a CODE editor DEDENTS — and the
   * key never reaches the textarea's own React handler.
   *
   * It cannot: `chat.cyclePermissionMode` owns `shift+tab` and the registry
   * binds it on `window` in the CAPTURE phase (actions/registry.tsx), so the
   * registry swallows the chord before React dispatches it — left alone, the
   * editor's `Shift+Tab` flipped the chat's permission mode instead. This is the
   * `app.search` takeover above applied to the second key the surface needs for
   * itself: registered at priority 20, and `enabled` keeps it inert unless the
   * focused element is THIS surface's code-cell editor, so everywhere else the
   * chat action behaves exactly as before. The dedent reuses `indentCode` and
   * the pending-caret pass of `handleCodeTab`; forward `Tab` stays on
   * `handleCodeTab` untouched.
   */
  useAction(
    'chat.cyclePermissionMode',
    () => {
      const index = focusedCodeCellIndex(surfaceRef.current, docRef.current)
      if (index === null) return
      const field = documentRef.current?.querySelector<HTMLTextAreaElement>(
        `[data-testid="cookbooks-source-${index}"]`,
      )
      if (!field) return
      const result = indentCode(
        field.value,
        field.selectionStart ?? field.value.length,
        field.selectionEnd ?? field.value.length,
        true,
      )
      if (result.value === field.value) return
      pendingCaretRef.current = { index, start: result.start, end: result.end }
      setSource(index, result.value)
    },
    {
      enabled: () => focusedCodeCellIndex(surfaceRef.current, docRef.current) !== null,
      priority: 20,
    },
    [],
  )

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
   *
   * Wave 10: `Ctrl+M` inserts a code cell below the focused one, or appends it
   * to the notebook.
   *
   * Wave 13 (F1): the command mode. Esc unwinds in priority order (find panel →
   * open menu → the running action → the focused editor, which blurs back into
   * command mode); `↑`/`j` and `↓`/`k` move the selection; `Enter` edits it;
   * `Shift+Enter` runs it and steps to the next code cell without focusing an
   * editor; `Ctrl/Cmd+Enter` runs it in place; the bare letters `a`/`b`/`dd`/
   * `y`/`m` act on the selection and are strictly modifier-free; `Ctrl/Cmd+S`
   * flushes every dirty cell.
   */
  const handleDocumentKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const inField = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT'
      const mod = event.metaKey || event.ctrlKey
      const noMod = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

      if (event.key === 'Escape') {
        // Wave 13 (F1): the find panel is the outermost Esc target, then the
        // open cell menu (wave 10), then the running action (wave 9), and only
        // then the focused editor — which blurs back into command mode.
        if (findOpen) {
          event.preventDefault()
          setFindOpen(false)
          return
        }
        if (menuOpen !== null) {
          event.preventDefault()
          setMenuOpen(null)
          return
        }
        // Wave 14 (F8): the download menu unwinds exactly like the cell menu.
        if (exportMenuOpen) {
          event.preventDefault()
          setExportMenuOpen(false)
          return
        }
        if (busy !== null) {
          event.preventDefault()
          void cancelRun()
          return
        }
        if (inField) {
          event.preventDefault()
          const rawIndex = target?.getAttribute('data-cell-index')
          const index = rawIndex === null || rawIndex === undefined ? Number.NaN : Number(rawIndex)
          const article = Number.isInteger(index)
            ? documentRef.current?.querySelector<HTMLElement>(`[data-testid="cookbooks-cell-${index}"]`)
            : null
          target?.blur()
          if (Number.isInteger(index)) setSelectedCell(index)
          // Wave 13 smoke fix: land DOM focus on the cell even when it was
          // already the selection — otherwise the selection-change effect never
          // re-runs and command-mode keys stop reaching the document handler.
          article?.focus()
          return
        }
        // Wave 14 (F2): the lowest-priority Esc target — a bare Esc drops the
        // whole selection (both the focus and the range anchor).
        if (selectedCell !== null) {
          event.preventDefault()
          clearSelection()
        }
        return
      }
      // Wave 14 (F3): Alt+Enter runs the focused cell, then inserts a fresh
      // (empty) code cell right below it — Colab's own «run and advance». The
      // new cell becomes the selection, exactly like a plain `b` insert.
      if (event.altKey && event.key === 'Enter') {
        if (doc?.kind !== 'ipynb' || busy !== null) return
        const rawIndex = target?.tagName === 'TEXTAREA' ? target.getAttribute('data-cell-index') : null
        const current = rawIndex === null ? Number.NaN : Number(rawIndex)
        const focusIndex = Number.isInteger(current) ? current : selectedCell
        if (focusIndex === null || doc.cells[focusIndex]?.cellType !== 'code') return
        event.preventDefault()
        void (async () => {
          await runCell(focusIndex)
          await mutateCell({ op: 'add', cellType: 'code', index: focusIndex + 1 })
        })()
        return
      }
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        if (!doc || doc.cells.length === 0) return
        event.preventDefault()
        const direction: -1 | 1 = event.key === 'ArrowDown' ? 1 : -1
        const rawIndex = target?.tagName === 'TEXTAREA' ? target.getAttribute('data-cell-index') : null
        const current = rawIndex === null ? Number.NaN : Number(rawIndex)
        // With no cell focused the chord enters the document from its nearest
        // end: ↓ lands on the first code cell, ↑ on the last one.
        focusAdjacentCodeCell(Number.isInteger(current) ? current : direction === 1 ? -1 : doc.cells.length, direction)
        return
      }
      // Wave 10: Ctrl+M inserts a code cell below the focused one (Colab's own
      // binding); with nothing focused it appends to the end of the notebook.
      // A structural edit is not a run, so it needs no kernel support — same
      // gate as the insert/menu controls.
      if (event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'm') {
        if (doc?.kind !== 'ipynb' || busy !== null) return
        event.preventDefault()
        const rawIndex = target?.tagName === 'TEXTAREA' ? target.getAttribute('data-cell-index') : null
        const current = rawIndex === null ? Number.NaN : Number(rawIndex)
        void mutateCell({
          op: 'add',
          cellType: 'code',
          index: Number.isInteger(current) ? current + 1 : doc.cells.length,
        })
        return
      }
      // Wave 14 (F2): the cell buffer. `Ctrl+C`/`Ctrl+X`/`Ctrl+V` act on the
      // selection in command mode only — inside a text field they stay NATIVE
      // (the browser's own cut/copy/paste of the caret's text), which is what
      // `inField` guards here. Copy/cut of an empty selection is a no-op.
      if (
        mod &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key.toLowerCase() === 'c' || event.key.toLowerCase() === 'x' || event.key.toLowerCase() === 'v')
      ) {
        if (inField) return
        if (doc?.kind !== 'ipynb' || busy !== null) return
        event.preventDefault()
        const key = event.key.toLowerCase()
        if (key === 'c') copyCells()
        else if (key === 'x') cutCells()
        else void pasteCells()
        return
      }
      // Wave 14 (F6): structural undo/redo. Like the buffer keys it acts in
      // command mode only — inside a text field `Ctrl+Z` stays the browser's own
      // character undo (SPEC §5: content edits are not on this stack). The keys
      // are swallowed even with an empty stack, so the platform never treats the
      // chord as something else.
      if (mod && !event.altKey && event.key.toLowerCase() === 'z') {
        if (inField) return
        if (doc?.kind !== 'ipynb') return
        event.preventDefault()
        if (busy !== null) return
        void (event.shiftKey ? redo() : undo())
        return
      }
      // Wave 13 (F5): Ctrl/Cmd+S is the explicit flush — the same core the
      // autosave debounce calls, only without the wait. While another action
      // owns the sidecar the key is a no-op: the pending edits stay dirty and
      // the debounce writes them once that action lands.
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (busy !== null) return
        void flushChanges()
        return
      }
      if (event.key === 'Enter') {
        if (mod && event.shiftKey) {
          if (!(doc?.kind === 'ipynb' && doc.supported)) return
          if (busy !== null) return
          event.preventDefault()
          void runAllCells()
          return
        }
        if (inField) {
          // Editor context: the cell (or playbook) the caret sits in.
          const rawIndex = target?.getAttribute('data-cell-index')
          if (rawIndex === null || rawIndex === undefined) {
            // The playbook editor carries no cell index — Shift/Ctrl+Enter saves.
            if (event.shiftKey || mod) {
              event.preventDefault()
              void savePlaybookAndClose()
            }
            return
          }
          const index = Number(rawIndex)
          if (!Number.isInteger(index)) return
          if (busy !== null) return
          const cellType = doc?.cells[index]?.cellType
          if ((event.shiftKey && !mod) || (mod && !event.shiftKey)) {
            event.preventDefault()
            if (cellType === 'code') void runCell(index, { focusNext: event.shiftKey })
            else if (cellType === 'markdown') void saveMarkdownAndClose(index)
          }
          return
        }
        // Command context: Enter edits the selection; Shift/Ctrl+Enter run it.
        if (doc?.kind !== 'ipynb' || selectedCell === null) return
        const selectedType = doc.cells[selectedCell]?.cellType
        if (event.shiftKey && !mod) {
          if (selectedType !== 'code' || busy !== null) return
          event.preventDefault()
          void runCell(selectedCell)
          // Step onto the next code cell — the editor never takes focus.
          for (let index = selectedCell + 1; index < doc.cells.length; index += 1) {
            if (doc.cells[index].cellType !== 'code') continue
            // Wave 14 (F2): a single-cell step collapses any range onto it.
            setSelectionAnchor(null)
            setSelectedCell(index)
            break
          }
          return
        }
        if (mod && !event.shiftKey) {
          if (selectedType !== 'code' || busy !== null) return
          event.preventDefault()
          void runCell(selectedCell)
          return
        }
        if (event.shiftKey || mod) return
        event.preventDefault()
        if (selectedType === 'markdown') {
          // The editor only exists once edit mode renders — queue the focus.
          setEditingCells((previous) => ({ ...previous, [selectedCell]: true }))
          pendingFocusRef.current = selectedCell
          return
        }
        // A code cell already has its editor — focus it in place.
        documentRef.current
          ?.querySelector<HTMLTextAreaElement>(`[data-testid="cookbooks-source-${selectedCell}"]`)
          ?.focus()
        return
      }
      // Wave 14 (F2): `Shift+↑/↓` extends the selection range; a bare ↑/↓/j/k
      // (below) collapses back to a single cell.
      if (event.shiftKey && !mod && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        if (inField || findOpen || menuOpen !== null) return
        event.preventDefault()
        extendByArrow(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      // Wave 13 (F1): command-mode selection keys — modifier-free only, and only
      // while no text field, the find panel or the cell menu owns the keyboard.
      if (!noMod || inField || findOpen || menuOpen !== null) return
      if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        moveSelection(-1)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        moveSelection(1)
        return
      }
      // The mutating commands share one gate: a notebook, nothing in flight.
      if (doc?.kind !== 'ipynb' || busy !== null) return
      if (event.key === 'a' || event.key === 'b') {
        event.preventDefault()
        // Wave 14 (F2): a single-cell action collapses the range onto its focus.
        setSelectionAnchor(null)
        const at = selectedCell === null ? doc.cells.length : event.key === 'a' ? selectedCell : selectedCell + 1
        void mutateCell({ op: 'add', cellType: 'code', index: at })
        return
      }
      if (event.key === 'd') {
        if (selectedCell === null) return
        const now = Date.now()
        if (now - ddRef.current <= 900) {
          ddRef.current = 0
          event.preventDefault()
          if (!window.confirm(t('cookbooks.cell.deleteConfirm'))) return
          // Wave 14 (F2): `dd` deletes every selected cell as one gesture, in
          // descending index order so each op still names its own cell.
          const descending = [...selectedAll].sort((left, right) => right - left)
          clearSelection()
          void mutateMany(descending.map((index) => ({ op: 'delete', index })))
          return
        }
        // The first `d` arms the 900 ms window; the second is the delete.
        ddRef.current = now
        return
      }
      if (event.key === 'y' || event.key === 'm') {
        if (selectedCell === null) return
        const cellType = event.key === 'y' ? 'code' : 'markdown'
        if (doc.cells[selectedCell]?.cellType === cellType) return
        event.preventDefault()
        // Wave 14 (F2): a conversion is a single-cell action — drop the anchor.
        setSelectionAnchor(null)
        void mutateCell({ op: 'convert', index: selectedCell, cellType })
      }
    },
    [
      busy,
      cancelRun,
      clearSelection,
      copyCells,
      cutCells,
      doc,
      exportMenuOpen,
      extendByArrow,
      findOpen,
      flushChanges,
      focusAdjacentCodeCell,
      menuOpen,
      moveSelection,
      mutateCell,
      mutateMany,
      pasteCells,
      redo,
      runAllCells,
      runCell,
      saveMarkdownAndClose,
      savePlaybookAndClose,
      selectedAll,
      selectedCell,
      t,
      undo,
    ],
  )

  const saveCell = useCallback(
    async (index: number) => {
      if (!openItemId) return
      const source = sources[index] ?? ''
      await runWithBusy(`cell:${index}:save`, async () => {
        await api.save({ itemId: openItemId, index, source })
        // F5: a manual save clears the cell's dirtiness exactly like autosave.
        stampCellSaved(index, source)
        setNotice({ source: 'key', key: 'cookbooks.status.cellSaved', params: { index } })
      })
    },
    [api, openItemId, runWithBusy, sources, stampCellSaved],
  )

  const savePlaybook = useCallback(async () => {
    if (!openItemId) return
    await runWithBusy('playbook:save', async () => {
      await api.save({ itemId: openItemId, text: playbookText })
      stampPlaybookSaved(playbookText)
      setNotice({ source: 'key', key: 'cookbooks.status.saved' })
    })
  }, [api, openItemId, playbookText, runWithBusy, stampPlaybookSaved])

  /** The exact text a cell shows — the output block and «Копировать вывод» share it. */
  const outputText = useCallback<OutputTextReader>(
    (cell) => {
      if (!cell) return t('cookbooks.output.hint')
      // Wave 9: a stopped cell says so — it has no stdout to fall back on.
      if (cell.status === 'cancelled') return t('cookbooks.cell.cancelled')
      if (cell.status === 'skipped') return t('cookbooks.output.skipped')
      // Wave 11: the block reads as one text — what the cell printed plus the
      // plain-text record of every display it emitted, in that order, so a
      // `display("Подпись")` next to a `print("x")` and a trailing value all
      // show up, while a lone `1+1` still reads as the single line `2`.
      const parts = [cell.stdout, cell.error]
        .filter((part): part is string => part !== null && part.trim().length > 0)
        .concat(
          cell.displays
            .filter((display) => display.mime === 'text/plain')
            .map((display) => display.data)
            .filter((text) => text.trim().length > 0),
        )
      if (parts.length > 0) return parts.join('\n')
      // A rich result with no text at all shows the frozen «graphical output»
      // marker (SPEC §14); a cell with no displays keeps the wave-7 copy.
      if (cell.displays.length > 0) return t('cookbooks.output.richPlaceholder')
      return t('cookbooks.output.empty')
    },
    [t],
  )

  /** R6: copy the output the cell is showing right now — exactly as shown. */
  const copyOutput = useCallback(
    async (index: number) => {
      const cell = outputs[index]
      if (!cell) return
      try {
        await writeClipboard(normalizeOutputText(outputText(cell)))
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
      // Wave 14 (F6): the copy is back to the catalog original — the gestures
      // recorded against the edited one no longer describe it.
      setHistory(createHistory())
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

  /** Wave 14 (F8): the file-name stem both exports share — the `.ipynb` name minus its suffix. */
  const exportStem = doc === null ? '' : doc.title.replace(/[^\w\d\-.]+/g, '-')

  /**
   * The cells both exports are assembled from, as they stand on screen right
   * now: an edited source, this session's counter and this session's results.
   */
  const exportCells = useCallback(
    () =>
      doc === null
        ? []
        : doc.cells.map((cell, index) => ({
            cellType: cell.cellType,
            source: sources[index] ?? cell.source,
            executionCount: runs[index] ?? null,
            stdout: outputs[index]?.stdout,
            error: outputs[index]?.error ?? undefined,
            // Wave 11: the rich records of this session travel into the file as
            // `display_data` outputs, after the cell's stream records (SPEC §16).
            displays: outputs[index]?.displays,
          })),
    [doc, outputs, runs, sources],
  )

  /**
   * Wave 9: one download. Main owns the save dialog, so the surface only has to
   * name the file and hand over the bytes; a cancelled dialog is an outcome
   * (`saved:false`), a failed write is the only error.
   *
   * Wave 14 (F8): both menu entries land here — the extension of `filename` is
   * what main turns into the dialog's filter.
   */
  const saveExport = useCallback(
    async (filename: string, content: string) => {
      if (!openItemId) return
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
    },
    [api, openItemId, runWithBusy],
  )

  /**
   * Wave 9: «Ноутбук (.ipynb)». The renderer assembles the notebook from what
   * the copy holds right now, through the shared pure builder.
   */
  const exportNotebook = useCallback(async () => {
    if (!doc || !openItemId) return
    if (!(doc.kind === 'ipynb' && doc.supported)) return
    const content = buildNotebookExport({ title: doc.title, cells: exportCells() })
    await saveExport(`${exportStem}.ipynb`, content)
  }, [doc, exportCells, exportStem, openItemId, saveExport])

  /**
   * Wave 14 (F8): «Скрипт Python (.py)» — the same cells, written by the shared
   * `.py` builder: code verbatim, markdown as comments, `# %%` cell markers.
   */
  const exportPython = useCallback(async () => {
    if (!doc || !openItemId) return
    if (!(doc.kind === 'ipynb' && doc.supported)) return
    const content = buildPythonScript({ title: doc.title, cells: exportCells() })
    await saveExport(`${exportStem}.py`, content)
  }, [doc, exportCells, exportStem, openItemId, saveExport])

  /**
   * Wave 9: the outline of the open document — the H1–H3 headings of its
   * markdown cells in document order, or of the playbook body, which has no
   * cells and scrolls to its own block. An edited source is what the outline
   * lists, exactly as the document pane renders it.
   *
   * Wave 14 (F11): every entry carries the dotted numeral its level earns
   * (`numberHeadings`), numbered over the whole document — not per cell.
   */
  const outline = useMemo<CookbooksOutlineEntry[]>(() => {
    if (!doc) return []
    const found: { level: number; title: string; testId: string }[] =
      doc.kind === 'md'
        ? headingsOf(playbookText).map((heading) => ({ ...heading, testId: 'cookbooks-playbook-markdown' }))
        : doc.cells.flatMap((cell, index) =>
            cell.cellType !== 'markdown'
              ? []
              : headingsOf(sources[index] ?? cell.source).map((heading) => ({
                  ...heading,
                  testId: `cookbooks-cell-${index}`,
                })),
          )
    const numbers = numberHeadings(found.map((entry) => entry.level))
    return found.map((entry, position) => ({ ...entry, number: numbers[position] }))
  }, [doc, playbookText, sources])

  /**
   * Wave 13 (F8): ask the outline which entry the scroll position is inside.
   * Every entry's offset is measured against the scroll container itself
   * (`rect.top - sectionRect.top + scrollTop`), so it stays valid wherever the
   * pane sits on the page and however the document reflows. An entry whose
   * block is missing from the DOM keeps its predecessor's offset — the outline
   * is derived from those very cells, so this only guards a mid-render read.
   */
  const measureOutline = useCallback(() => {
    const section = documentRef.current
    if (!section || outline.length === 0) {
      setActiveEntry(null)
      return
    }
    const sectionTop = section.getBoundingClientRect().top
    let carried = 0
    const offsets = outline.map((entry) => {
      const element = section.querySelector<HTMLElement>(`[data-testid="${entry.testId}"]`)
      if (element) carried = element.getBoundingClientRect().top - sectionTop + section.scrollTop
      return carried
    })
    setActiveEntry(pickActiveEntry(offsets, section.scrollTop))
  }, [outline])

  /**
   * F8: the scroll listener is rAF-throttled — a fast scroll costs one layout
   * per frame instead of one per event. Only the frame id is held, so the
   * unmount below always has something to cancel.
   */
  const scheduleOutlineMeasure = useCallback(() => {
    if (scrollSpyFrameRef.current !== null) return
    scrollSpyFrameRef.current = window.requestAnimationFrame(() => {
      scrollSpyFrameRef.current = null
      measureOutline()
    })
  }, [measureOutline])

  /** F8: never leave a frame behind — it would run into an unmounted surface. */
  useEffect(
    () => () => {
      if (scrollSpyFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollSpyFrameRef.current)
        scrollSpyFrameRef.current = null
      }
    },
    [],
  )

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
        data-glass-slot="empty"
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
        <header data-glass-slot="toolbar" className="sticky top-0 z-sticky flex flex-wrap items-center gap-2 border-b border-border/40 bg-background/95 px-3 py-2 backdrop-blur">
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
          {/* Wave 14 (F6): structural undo/redo, next to the document's other
              structural controls. A notebook only — a playbook has no cells to
              insert, move or delete — and disabled while the stack is empty or
              an action is in flight. */}
          {doc.kind === 'ipynb' ? (
            <>
              <button
                type="button"
                data-testid="cookbooks-undo"
                title={formatHotkeyDisplay('mod+z')}
                disabled={busy !== null || !canUndo(history)}
                onClick={() => void undo()}
                className={ACTION_CLASS}
              >
                {t('cookbooks.undo')}
              </button>
              <button
                type="button"
                data-testid="cookbooks-redo"
                title={formatHotkeyDisplay('mod+shift+z')}
                disabled={busy !== null || !canRedo(history)}
                onClick={() => void redo()}
                className={ACTION_CLASS}
              >
                {t('cookbooks.redo')}
              </button>
            </>
          ) : null}
          {/* Wave 13 (F9): «Перезапустить и выполнить» — there is no kernel to
              restart, so the honest reading is «drop every result, run again». */}
          {canRunAll ? (
            <button
              type="button"
              data-testid="cookbooks-restart-run-all"
              disabled={busy !== null}
              onClick={() => {
                clearAllOutputs()
                setRuns({})
                void runAllCells()
              }}
              className={ACTION_CLASS}
            >
              {t('cookbooks.actions.restartRunAll')}
            </button>
          ) : null}
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
          {/* Wave 14 (F4): the batch's own size, right next to «Запустить всё».
              It exists only while a batch is in flight — a single run shows
              nothing — and reports how many cells the run covers, not a count
              of what has landed: the sidecar answers the batch in one response,
              so «done» is not a number this surface can honestly show. */}
          {runProgress !== null ? (
            <span
              data-testid="cookbooks-run-progress"
              role="progressbar"
              aria-label={t('cookbooks.run.progressAria')}
              className="shrink-0 text-caption numeric text-text-secondary"
            >
              {t('cookbooks.run.batch', { total: runProgress })}
            </span>
          ) : null}
          {/* Wave 9: while a batch runs, the header is where it is stopped. */}
          {busy === 'run-all' ? (
            <button type="button" data-testid="cookbooks-stop-all" onClick={() => void cancelRun()} className={ACTION_CLASS}>
              {t('cookbooks.actions.stop')}
            </button>
          ) : null}
          {/* Wave 9 + wave 14 (F8): the download menu — the trigger keeps its
              testid and opens the two write paths, the notebook and the script.
              A playbook has neither. */}
          {canRunAll ? (
            <>
              <button
                type="button"
                data-testid="cookbooks-export"
                aria-expanded={exportMenuOpen}
                aria-haspopup="true"
                disabled={busy !== null}
                onClick={() => setExportMenuOpen((open) => !open)}
                className={ACTION_CLASS}
              >
                {t('cookbooks.export.menu')}
              </button>
              {exportMenuOpen ? (
                <span
                  data-testid="cookbooks-export-menu"
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <button
                    type="button"
                    data-testid="cookbooks-export-ipynb"
                    disabled={busy !== null}
                    onClick={() => {
                      setExportMenuOpen(false)
                      void exportNotebook()
                    }}
                    className={ACTION_CLASS}
                  >
                    {t('cookbooks.export.ipynb')}
                  </button>
                  <button
                    type="button"
                    data-testid="cookbooks-export-py"
                    disabled={busy !== null}
                    onClick={() => {
                      setExportMenuOpen(false)
                      void exportPython()
                    }}
                    className={ACTION_CLASS}
                  >
                    {t('cookbooks.export.py')}
                  </button>
                </span>
              ) : null}
            </>
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
              // Wave 14 (F1): the drop indicator — the gap lands above this cell,
              // below it, or nowhere near it.
              const dropPosition: DropPosition | undefined =
                dropGap === index ? 'above' : dropGap === index + 1 ? 'below' : undefined
              // Wave 14 (F7): a folded cell hides its editor/rendering behind one
              // line of copy — its controls, its gutter and its output stay.
              const folded = collapsedCells.has(index)
              return [
                // Wave 10: the insert row sits above each cell, at its index.
                // Wave 14 (F1): it is also the drop zone for that gap.
                <InsertRow
                  key={`insert-${index}`}
                  index={index}
                  alwaysVisible={false}
                  disabled={busy !== null}
                  busyHint={busy !== null ? t('cookbooks.actions.busyHint') : undefined}
                  dropActive={dropGap === index}
                  onDragOver={(event) => handleGapDragOver(event, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onInsert={(cellType) => void mutateCell({ op: 'add', cellType, index })}
                />,
                <article
                  key={index}
                  data-testid={`cookbooks-cell-${index}`}
                  data-cell-type={cell.cellType}
                  data-status={output?.status ?? 'idle'}
                  data-glass-slot="editor"
                  // Wave 14 (F2): every selected cell (the whole range) is marked;
                  // the focus alone carries `data-anchor`/`aria-current`.
                  data-selected={selectedAll.includes(index) ? 'true' : undefined}
                  data-anchor={selectedCell === index ? 'true' : undefined}
                  aria-current={selectedCell === index ? 'true' : undefined}
                  // Wave 14 (F1): the drop indicator — the line above or below.
                  data-drop-position={dropPosition}
                  // Wave 14 (F7): a folded cell says so on its own article.
                  data-collapsed={folded ? 'true' : undefined}
                  tabIndex={-1}
                  onDragOver={(event) => handleArticleDragOver(event, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={(event) => {
                    // Wave 13 (F1): a click on the cell body selects it; a click
                    // on any control inside it stays a control click.
                    if ((event.target as HTMLElement).closest('button,textarea,input,a,select')) return
                    // Wave 14 (F2): Shift+click extends the range; a plain click
                    // (or a Ctrl/Cmd+click, which the range model folds into a
                    // single select) resets the anchor.
                    if (event.shiftKey) selectRange(index)
                    else selectSingle(index)
                    event.currentTarget.focus()
                  }}
                  className={cn(
                    'flex gap-2 rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated px-2.5 py-2 outline-none',
                    selectedAll.includes(index) && 'outline outline-2 outline-foreground',
                    // Wave 14 (F1): the line the drop would land on.
                    dropGap === index && 'border-t-2 border-t-foreground',
                    dropGap === index + 1 && 'border-b-2 border-b-foreground',
                  )}
                >
                  <div
                    data-testid={`cookbooks-gutter-${index}`}
                    className="flex w-10 shrink-0 flex-col items-center gap-1"
                  >
                    {/* Wave 14 (F1): the drag handle — the gutter is where a cell
                        is grabbed. Native HTML5 drag; a busy surface refuses it. */}
                    <span
                      data-testid={`cookbooks-drag-handle-${index}`}
                      draggable={busy === null}
                      aria-disabled={busy !== null ? 'true' : undefined}
                      aria-label={t('cookbooks.cell.dragHandle')}
                      title={busy !== null ? t('cookbooks.actions.busyHint') : t('cookbooks.cell.dragHandle')}
                      onDragStart={(event) => handleDragStart(event, index)}
                      onDragEnd={handleDragEnd}
                      className={cn(
                        'select-none text-caption leading-none text-text-secondary',
                        busy === null ? 'cursor-grab' : 'cursor-default opacity-50',
                      )}
                    >
                      ⠿
                    </span>
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
                    {/* Wave 13 (F7): how long this cell's last run took — the
                        sidecar's own measurement after a batch, this session's
                        clock after a single run. The slot is reserved by the
                        column's own gap, so nothing jumps when it appears. */}
                    {durations[index] === undefined ? null : (
                      <span
                        data-testid={`cookbooks-duration-${index}`}
                        title={t('cookbooks.cell.lastDuration', { duration: formatDuration(durations[index]) })}
                        className="font-mono text-caption numeric text-text-secondary"
                      >
                        {formatDuration(durations[index])}
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded-full border border-border-subtle px-1.5 text-caption text-text-secondary">
                        {cell.cellType}
                      </span>
                      <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                        {/* Wave 14 (F7): «Свернуть код» — the fold toggle of this
                            cell. It never disables: hiding a cell is a view
                            gesture, legal while a run is in flight. */}
                        <button
                          type="button"
                          data-testid={`cookbooks-fold-${index}`}
                          aria-pressed={folded}
                          onClick={() => toggleCellFold(index)}
                          className={ACTION_CLASS}
                        >
                          {folded ? t('cookbooks.cell.unfold') : t('cookbooks.cell.fold')}
                        </button>
                        {/* Wave 10: the per-cell «⋯» disclosure — up/down/
                            duplicate/delete, revealed inside the cell. */}
                        <button
                          type="button"
                          data-testid={`cookbooks-menu-${index}`}
                          aria-label={t('cookbooks.actions.menu')}
                          aria-expanded={menuOpen === index}
                          title={busy !== null ? t('cookbooks.actions.busyHint') : undefined}
                          disabled={busy !== null}
                          onClick={() => setMenuOpen((current) => (current === index ? null : index))}
                          className={ACTION_CLASS}
                        >
                          ⋯
                        </button>
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
                    {/* Wave 10: the disclosed actions row — up/down at the
                        document edges, duplicate, and a confirmed delete. */}
                    {menuOpen === index ? (
                      <div data-testid={`cookbooks-menu-row-${index}`} className="flex flex-wrap items-center gap-1.5">
                        {/* Wave 14 (F2): the buffer commands, keyed to this cell
                            when it is not already part of a multi-cell selection. */}
                        <button
                          type="button"
                          data-testid={`cookbooks-cellmenu-copy-${index}`}
                          onClick={() => {
                            setMenuOpen(null)
                            copyCells(selectedAll.includes(index) ? selectedAll : [index])
                          }}
                          className={ACTION_CLASS}
                        >
                          {t('cookbooks.cellmenu.copy')}
                        </button>
                        <button
                          type="button"
                          data-testid={`cookbooks-cellmenu-cut-${index}`}
                          title={busy !== null ? t('cookbooks.actions.busyHint') : undefined}
                          disabled={busy !== null}
                          onClick={() => {
                            setMenuOpen(null)
                            cutCells(selectedAll.includes(index) ? selectedAll : [index])
                          }}
                          className={ACTION_CLASS}
                        >
                          {t('cookbooks.cellmenu.cut')}
                        </button>
                        <button
                          type="button"
                          data-testid={`cookbooks-cellmenu-paste-${index}`}
                          title={busy !== null ? t('cookbooks.actions.busyHint') : undefined}
                          disabled={busy !== null}
                          onClick={() => {
                            setMenuOpen(null)
                            void pasteCells(index)
                          }}
                          className={ACTION_CLASS}
                        >
                          {t('cookbooks.cellmenu.paste')}
                        </button>
                        <button
                          type="button"
                          data-testid={`cookbooks-move-up-${index}`}
                          title={busy !== null ? t('cookbooks.actions.busyHint') : undefined}
                          disabled={busy !== null || index === 0}
                          onClick={() => {
                            setMenuOpen(null)
                            void mutateCell({ op: 'move', from: index, to: index - 1 })
                          }}
                          className={ACTION_CLASS}
                        >
                          {t('cookbooks.actions.moveUp')}
                        </button>
                        <button
                          type="button"
                          data-testid={`cookbooks-move-down-${index}`}
                          title={busy !== null ? t('cookbooks.actions.busyHint') : undefined}
                          disabled={busy !== null || index === doc.cells.length - 1}
                          onClick={() => {
                            setMenuOpen(null)
                            void mutateCell({ op: 'move', from: index, to: index + 1 })
                          }}
                          className={ACTION_CLASS}
                        >
                          {t('cookbooks.actions.moveDown')}
                        </button>
                        <button
                          type="button"
                          data-testid={`cookbooks-duplicate-${index}`}
                          title={busy !== null ? t('cookbooks.actions.busyHint') : undefined}
                          disabled={busy !== null}
                          onClick={() => {
                            setMenuOpen(null)
                            void mutateCell({ op: 'duplicate', index })
                          }}
                          className={ACTION_CLASS}
                        >
                          {t('cookbooks.actions.duplicate')}
                        </button>
                        {/* Wave 13 (F3): turn the cell into the other type — a
                            label that names the target, gated like every other
                            structural edit. */}
                        <button
                          type="button"
                          data-testid={`cookbooks-convert-${index}`}
                          title={busy !== null ? t('cookbooks.actions.busyHint') : undefined}
                          disabled={busy !== null}
                          onClick={() => {
                            setMenuOpen(null)
                            const cellType = cell.cellType === 'code' ? 'markdown' : 'code'
                            void mutateCell({ op: 'convert', index, cellType })
                          }}
                          className={ACTION_CLASS}
                        >
                          {cell.cellType === 'code' ? t('cookbooks.actions.toText') : t('cookbooks.actions.toCode')}
                        </button>
                        <button
                          type="button"
                          data-testid={`cookbooks-delete-${index}`}
                          title={busy !== null ? t('cookbooks.actions.busyHint') : undefined}
                          disabled={busy !== null}
                          onClick={() => {
                            setMenuOpen(null)
                            if (!window.confirm(t('cookbooks.cell.deleteConfirm'))) return
                            void mutateCell({ op: 'delete', index })
                          }}
                          className={ACTION_CLASS}
                        >
                          {t('cookbooks.actions.delete')}
                        </button>
                      </div>
                    ) : null}
                    {folded ? (
                      // Wave 14 (F7): one line in place of the editor — the
                      // cell's text is hidden, its output below is not.
                      <p className="rounded-[var(--radius-control)] border border-dashed border-border-subtle px-2.5 py-1.5 text-caption text-muted-foreground">
                        {t('cookbooks.cell.folded')}
                      </p>
                    ) : isMarkdown && !editing ? (
                      <CellMarkdown
                        mode="minimal"
                        source={source}
                        testId={`cookbooks-markdown-${index}`}
                        onActivate={() => {
                          // Wave 13 (F4): a double-click opens the editor and lands focus in it.
                          setEditingCells((previous) => ({ ...previous, [index]: true }))
                          pendingFocusRef.current = index
                        }}
                      />
                    ) : (
                      <textarea
                        data-testid={`cookbooks-source-${index}`}
                        data-cell-index={index}
                        aria-label={t('cookbooks.cell.sourceLabel', { index })}
                        value={source}
                        onChange={(event) => setSource(index, event.target.value)}
                        // Wave 14 (F9): Tab indents a code cell only — a markdown
                        // editor keeps the browser's own Tab (SPEC §9).
                        onKeyDown={isMarkdown ? undefined : (event) => handleCodeTab(event, index)}
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
                </article>,
              ]
            })}
            {/* Wave 10: the tail insert row — appends to the end of the
                notebook, and is the lone row of an empty one. */}
            <InsertRow
              index={doc.cells.length}
              alwaysVisible={doc.cells.length === 0}
              disabled={busy !== null}
              busyHint={busy !== null ? t('cookbooks.actions.busyHint') : undefined}
              dropActive={dropGap === doc.cells.length}
              onDragOver={(event) => handleGapDragOver(event, doc.cells.length)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onInsert={(cellType) => void mutateCell({ op: 'add', cellType, index: doc.cells.length })}
            />
          </div>
        )}
      </>
    )
  }

  return (
    <div
      ref={surfaceRef}
      className="flex h-full w-full min-h-0 flex-col bg-background"
      data-testid="cookbooks-surface"
      data-state="ready"
    >
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <PanelHeading className="text-title-sm font-semibold text-foreground" titleKey="cookbooks.title">{t('cookbooks.title')}</PanelHeading>
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
          data-glass-slot="panel"
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
                  data-glass-slot="row"
                  data-state={card.id === openItemId ? 'selected' : undefined}
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
                  <li key={`${n}:${entry.title}`} className={OUTLINE_INDENT_CLASS[entry.level] ?? ''}>
                    <button
                      type="button"
                      data-testid={`cookbooks-outline-item-${n}`}
                      aria-label={t('cookbooks.outline.itemLabel', { title: entry.title })}
                      // Wave 13 (F8): the entry the scroll position is inside —
                      // the same `aria-current` the selected cell wears.
                      aria-current={activeEntry === n ? 'true' : undefined}
                      onClick={() => scrollToBlock(entry.testId)}
                      className={cn(
                        'block w-full truncate text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground',
                        activeEntry === n
                          ? 'text-foreground font-medium hover:text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {/* Wave 14 (F11): the entry's own numeral, then its title.
                          The number is decoration — the entry's accessible name
                          stays the heading itself. */}
                      <span aria-hidden="true" className="numeric text-text-secondary">
                        {entry.number}{' '}
                      </span>
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

        {/* Wave 13 (F2): the document column — a non-scrolling find panel sits
            above the scrolling <section>, which keeps its testid/ref/onKeyDown. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {doc?.kind === 'ipynb' && findOpen ? (
            <div
              data-testid="cookbooks-find"
              onKeyDown={handleFindKeyDown}
              className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle bg-surface-hover px-3 py-1.5"
            >
              <input
                ref={findInputRef}
                data-testid="cookbooks-find-input"
                type="text"
                value={findQuery}
                onChange={(event) => setFindQuery(event.target.value)}
                placeholder={t('cookbooks.find.placeholder')}
                aria-label={t('cookbooks.find.placeholder')}
                className="h-[var(--control-md)] min-w-[160px] rounded-[var(--radius-control)] border border-border-subtle bg-surface-input px-2 text-small text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
              />
              <span
                data-testid="cookbooks-find-count"
                aria-live="polite"
                className="shrink-0 text-caption numeric text-muted-foreground"
              >
                {findQuery.length === 0
                  ? ''
                  : findMatches.length === 0
                    ? t('cookbooks.find.noMatches')
                    : t('cookbooks.find.count', { current: findCurrent + 1, total: findMatches.length })}
              </span>
              <button
                type="button"
                data-testid="cookbooks-find-prev"
                aria-label={t('cookbooks.find.previous')}
                onClick={() => {
                  goToMatch(-1)
                  refocusFind()
                }}
                className={ACTION_CLASS}
              >
                ▲
              </button>
              <button
                type="button"
                data-testid="cookbooks-find-next"
                aria-label={t('cookbooks.find.next')}
                onClick={() => {
                  goToMatch(1)
                  refocusFind()
                }}
                className={ACTION_CLASS}
              >
                ▼
              </button>
              <button
                type="button"
                data-testid="cookbooks-find-case"
                aria-pressed={findCase}
                aria-label={t('cookbooks.find.caseSensitive')}
                onClick={() => {
                  setFindCase((value) => !value)
                  refocusFind()
                }}
                className={ACTION_CLASS}
              >
                Aa
              </button>
              <span className="flex-1" />
              <input
                data-testid="cookbooks-find-replace-input"
                type="text"
                value={findReplacement}
                onChange={(event) => setFindReplacement(event.target.value)}
                placeholder={t('cookbooks.find.replacePlaceholder')}
                aria-label={t('cookbooks.find.replacePlaceholder')}
                className="h-[var(--control-md)] min-w-[160px] rounded-[var(--radius-control)] border border-border-subtle bg-surface-input px-2 text-small text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
              />
              <button
                type="button"
                data-testid="cookbooks-find-replace"
                onClick={() => {
                  replaceCurrent()
                  refocusFind()
                }}
                className={ACTION_CLASS}
              >
                {t('cookbooks.find.replace')}
              </button>
              <button
                type="button"
                data-testid="cookbooks-find-replace-all"
                onClick={() => {
                  replaceAll()
                  refocusFind()
                }}
                className={ACTION_CLASS}
              >
                {t('cookbooks.find.replaceAll')}
              </button>
              <button
                type="button"
                data-testid="cookbooks-find-close"
                aria-label={t('cookbooks.find.close')}
                onClick={() => setFindOpen(false)}
                className={ACTION_CLASS}
              >
                ✕
              </button>
            </div>
          ) : null}
          <section
            ref={documentRef}
            data-testid="cookbooks-document"
            data-kind={doc?.kind}
            tabIndex={-1}
            onKeyDown={handleDocumentKeyDown}
            onScroll={scheduleOutlineMeasure}
            className="min-h-0 flex-1 overflow-y-auto outline-none"
          >
            {renderDocument()}
          </section>
        </div>
      </div>

      {/* Wave 13 (F6): the surface status bar — one line under the panes, and
          only while a document is open (the early return above owns every
          other state). It reports the save state, what the document holds and
          what the last run did. */}
      {doc && openItemId ? (
        <footer
          data-testid="cookbooks-statusbar"
          className="flex items-center gap-3 border-t border-border-subtle px-3 py-1 text-caption text-muted-foreground numeric"
        >
          <span
            data-testid="cookbooks-save-state"
            title={lastSavedAt === null ? undefined : new Date(lastSavedAt).toLocaleTimeString()}
            className="inline-flex items-center gap-1.5"
          >
            <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', SAVE_DOT_CLASS[saveState])} />
            {saveState === 'saving'
              ? t('cookbooks.save.saving')
              : saveState === 'error'
                ? t('cookbooks.save.error')
                : saveState === 'dirty'
                  ? t('cookbooks.save.dirty', { count: dirtyCount })
                  : t('cookbooks.save.saved', {
                      time: lastSavedAt === null ? '—' : new Date(lastSavedAt).toLocaleTimeString(),
                    })}
          </span>
          <span className="flex-1" />
          {doc.kind === 'ipynb' ? (
            <span data-testid="cookbooks-statusbar-cells">
              {t('cookbooks.statusbar.cells', {
                total: doc.cells.length,
                code: doc.cells.filter((cell) => cell.cellType === 'code').length,
              })}
            </span>
          ) : null}
          {lastRun === null ? null : (
            <span data-testid="cookbooks-last-run">
              {t('cookbooks.statusbar.lastRun', {
                time: new Date(lastRun.at).toLocaleTimeString(),
                ok: lastRun.ok,
                failed: lastRun.failed,
                duration: formatDuration(lastRun.durationMs),
              })}
            </span>
          )}
        </footer>
      ) : null}
    </div>
  )
}

export default CookbooksSurfacePage
