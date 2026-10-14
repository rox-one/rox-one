/**
 * CookbooksSurfacePage — the native «Кукбуки» surface (cookbooks-surface program).
 *
 * SPEC Amendment 1: the surface is native React in the ROX design system. There
 * is no `WebContentsView`, no `mount`/`setBounds` plumbing and no bounds math —
 * main owns the vendored Python sidecar and is the only process that ever sees
 * the bearer token, while this page renders a typed two-pane catalog + document
 * UI over the `cookbooksLab` IPC.
 *
 * Every string comes from `cookbooks.*` through `t()` and every colour, radius,
 * type size and control height is a ROX token, so the surface follows the app
 * theme in all twelve locales and never drifts into ad-hoc styling.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  CookbooksCard,
  CookbooksDocument,
  CookbooksRunCell,
  CookbooksStatus,
} from '../../../shared/cookbooks'

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

/** The only `disabledReason` the contract names; anything else is shown raw. */
const FILE_MISSING_REASON = 'file missing'

/** Shared control chrome: ROX hit target, radius, hover and focus tokens. */
const ACTION_CLASS =
  'inline-flex h-[var(--control-md)] items-center justify-center rounded-[var(--radius-control)] border border-border-subtle bg-surface-hover px-2.5 text-small text-foreground transition-colors hover:bg-surface-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:cursor-default disabled:opacity-50'

/** Surface UI states, projected from the main-process runtime status. */
type CookbooksPageUi = 'starting' | 'ready' | 'unavailable' | 'failed' | 'stopped'

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

/** The per-cell output block: pill-free, `data-status`-tagged, honest about emptiness. */
function CellOutput({ index, cell }: { index: number; cell: CookbooksRunCell | undefined }) {
  const { t } = useTranslation()
  const printed = cell
    ? [cell.stdout, cell.error].filter((part): part is string => part !== null && part.trim().length > 0)
    : []
  const text = !cell
    ? t('cookbooks.output.hint')
    : cell.status === 'skipped'
      ? t('cookbooks.output.skipped')
      : printed.length > 0
        ? printed.join('\n')
        : t('cookbooks.output.empty')

  return (
    <pre
      data-testid={`cookbooks-output-${index}`}
      data-status={cell?.status ?? 'idle'}
      aria-label={t('cookbooks.cell.outputLabel', { index })}
      className={cn(
        'max-h-[320px] overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[var(--radius-control)] bg-surface-hover px-2.5 py-1.5 font-mono text-small',
        cell?.status === 'error' ? 'text-destructive-text' : 'text-muted-foreground',
      )}
    >
      {text}
    </pre>
  )
}

export function CookbooksSurfacePage() {
  const { t } = useTranslation()
  const api = window.electronAPI.cookbooksLab

  const [status, setStatus] = useState<CookbooksStatus>({ state: 'idle', reason: null, port: null })
  const [cards, setCards] = useState<CookbooksCard[]>([])
  const [filter, setFilter] = useState('')
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [doc, setDoc] = useState<CookbooksDocument | null>(null)
  const [sources, setSources] = useState<Record<number, string>>({})
  const [outputs, setOutputs] = useState<Record<number, CookbooksRunCell>>({})
  const [playbookText, setPlaybookText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<CookbooksNotice | null>(null)

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
    setPlaybookText(next.text ?? '')
  }, [])

  const openItem = useCallback(
    async (itemId: string, newCopy = false) => {
      await runWithBusy(newCopy ? `${itemId}:copy` : `${itemId}:open`, async () => {
        const result = await api.open(newCopy ? { itemId, newCopy: true } : { itemId })
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

  const runCell = useCallback(
    async (index: number) => {
      if (!doc || !openItemId) return
      const code = sources[index] ?? doc.cells[index]?.source ?? ''
      await runWithBusy(`cell:${index}:run`, async () => {
        const result = await api.run({ itemId: openItemId, code, index })
        setOutputs((previous) => ({
          ...previous,
          [index]: { index, status: result.ok ? 'ok' : 'error', stdout: result.stdout, error: result.error },
        }))
        setNotice({
          source: 'key',
          key: result.ok ? 'cookbooks.status.cellOk' : 'cookbooks.status.cellError',
          params: { index },
        })
      })
    },
    [api, doc, openItemId, runWithBusy, sources],
  )

  const runAllCells = useCallback(async () => {
    if (!doc || !openItemId) return
    // The sidecar executes code cells only: a markdown entry makes `POST /run-all`
    // answer 400 «cell is not runnable» and kills the whole run. Indices stay the
    // document's own so per-cell outputs land under the right article.
    const cells = doc.cells
      .map((cell, index) => ({ index, source: sources[index] ?? cell.source, cellType: cell.cellType }))
      .filter((cell) => cell.cellType === 'code')
      .map(({ index, source }) => ({ index, source }))
    await runWithBusy('run-all', async () => {
      const result = await api.runAll({ itemId: openItemId, cells })
      const nextOutputs: Record<number, CookbooksRunCell> = {}
      for (const cell of result.cells) nextOutputs[cell.index] = cell
      setOutputs(nextOutputs)
      setNotice({
        source: 'key',
        key: 'cookbooks.status.runAll',
        params: {
          count: result.cells.length,
          ok: result.cells.filter((cell) => cell.status === 'ok').length,
          failed: result.cells.filter((cell) => cell.status === 'error').length,
          skipped: result.cells.filter((cell) => cell.status === 'skipped').length,
        },
      })
    })
  }, [api, doc, openItemId, runWithBusy, sources])

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
    return (
      <>
        <header className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
          <h2 data-testid="cookbooks-document-title" className="text-title-sm font-semibold text-foreground">
            {doc.title}
          </h2>
          <span className="shrink-0 rounded-full border border-border-subtle px-1.5 text-caption text-text-secondary">
            {t(KIND_LABEL_KEY[doc.kind])}
          </span>
          <span className="flex-1" />
          {/* «Запустить всё» is offered only where the sidecar says it is supported. */}
          {doc.kind === 'ipynb' && doc.supported ? (
            <button
              type="button"
              data-testid="cookbooks-run-all"
              disabled={busy !== null}
              onClick={() => void runAllCells()}
              className={ACTION_CLASS}
            >
              {t('cookbooks.actions.runAll')}
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
            <textarea
              data-testid="cookbooks-playbook-text"
              aria-label={t('cookbooks.playbook.textLabel')}
              value={playbookText}
              onChange={(event) => setPlaybookText(event.target.value)}
              spellCheck={false}
              className="min-h-[240px] w-full resize-y rounded-[var(--radius-control)] border border-border-subtle bg-surface-input px-2.5 py-2 text-reading text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
            />
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
            {doc.cells.map((cell, index) => (
              <article
                key={index}
                data-testid={`cookbooks-cell-${index}`}
                data-cell-type={cell.cellType}
                className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-full border border-border-subtle px-1.5 text-caption text-text-secondary">
                    {cell.cellType}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {/* Markdown cells carry no executable source: save only. */}
                    {cell.cellType === 'code' ? (
                      <button
                        type="button"
                        data-testid={`cookbooks-run-${index}`}
                        disabled={busy !== null}
                        onClick={() => void runCell(index)}
                        className={ACTION_CLASS}
                      >
                        {t('cookbooks.actions.run')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-testid={`cookbooks-save-${index}`}
                      disabled={busy !== null}
                      onClick={() => void saveCell(index)}
                      className={ACTION_CLASS}
                    >
                      {t('cookbooks.actions.save')}
                    </button>
                  </span>
                </div>
                <textarea
                  data-testid={`cookbooks-source-${index}`}
                  aria-label={t('cookbooks.cell.sourceLabel', { index })}
                  value={sources[index] ?? cell.source}
                  onChange={(event) => setSource(index, event.target.value)}
                  spellCheck={false}
                  className="min-h-[var(--control-lg)] w-full resize-y rounded-[var(--radius-control)] border border-border-subtle bg-surface-input px-2 py-1.5 font-mono text-small text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
                />
                <CellOutput index={index} cell={outputs[index]} />
              </article>
            ))}
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
          className="ml-auto inline-flex items-center gap-1.5 text-small text-muted-foreground"
        >
          {busy ? (
            <>
              <Loader2 className="icon-status animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {t('cookbooks.status.running')}
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
          <details data-testid="cookbooks-help" className="shrink-0 border-t border-border-subtle px-3 py-2">
            <summary className="cursor-pointer text-small font-medium text-foreground">
              {t('cookbooks.help.title')}
            </summary>
            <ul className="mt-2 flex list-none flex-col gap-1.5 text-caption text-muted-foreground">
              {HELP_KEYS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </details>
        </aside>

        <section
          data-testid="cookbooks-document"
          data-kind={doc?.kind}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {renderDocument()}
        </section>
      </div>
    </div>
  )
}

export default CookbooksSurfacePage
