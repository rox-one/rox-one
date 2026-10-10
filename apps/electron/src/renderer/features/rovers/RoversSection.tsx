/**
 * Rovers section — read-only «Роверы» catalog inside the Extension Center.
 *
 * Slice A is info-only: this section lists the curated open-source services from
 * the bundled signed catalog (through the read-only `rovers:list` RPC) with a
 * search box, a category filter, and loading/empty/error states. There is no
 * install/deploy action anywhere; the copy and the help text say so explicitly.
 *
 * RU is the product default; every literal string resolves through the
 * `rovers.*` i18n namespace.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BadgeCheck, ExternalLink, Info, RefreshCw, Search } from 'lucide-react'
import {
  pickLocalized,
  roversCategoryColor,
  roversLanguage,
  roversMonogram,
  Spinner,
  type RoversEntryFull,
} from '@rox/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toErrorMessage } from '@/lib/errors'
import { listRoversEntries } from '@/lib/rovers-client'

function RoversEntryCard({ entry }: { entry: RoversEntryFull }) {
  const { t, i18n } = useTranslation()
  const lang = roversLanguage(i18n.language)
  const tagline = pickLocalized(entry.tagline, lang)
  const description = pickLocalized(entry.description, lang)
  const categoryLabel = t(`rovers.category.${entry.category}`, { defaultValue: entry.category })
  const hasHomepage = /^https?:\/\//i.test(entry.homepage)

  return (
    <article
      className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated/40 p-3 motion-safe:transition-colors motion-safe:duration-200 hover:border-border"
      data-testid="rovers-entry-card"
      data-rovers-id={entry.id}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] font-mono text-base font-semibold text-white"
          style={{ backgroundColor: roversCategoryColor(entry.category) }}
        >
          {roversMonogram(entry.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-base font-semibold text-foreground">{entry.name}</span>
            {entry.verified ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/40 bg-success/10 px-1.5 py-0.5 text-caption font-medium text-success"
                title={t('rovers.section.helpVerified')}
              >
                <BadgeCheck className="icon-status" aria-hidden="true" />
                {t('rovers.card.verified')}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-caption uppercase tracking-wide text-text-muted">{categoryLabel}</div>
          {tagline ? <div className="mt-1 text-sm text-foreground">{tagline}</div> : null}
          {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-muted">
            {entry.spdx ? (
              <span className="font-mono" title={t('rovers.section.helpSpdx')}>
                {t('rovers.card.license')}: {entry.spdx}
              </span>
            ) : null}
            {hasHomepage ? (
              <a
                href={entry.homepage}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline motion-safe:transition-colors"
              >
                <ExternalLink className="icon-status" aria-hidden="true" />
                {t('rovers.card.instruction')}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

export function RoversSection() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<RoversEntryFull[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(await listRoversEntries())
      setError(null)
    } catch (err) {
      setEntries(null)
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const categories = useMemo(() => {
    const present = new Set<string>()
    for (const entry of entries ?? []) present.add(entry.category)
    return [...present].sort()
  }, [entries])

  const filtered = useMemo(() => {
    let list = entries ?? []
    if (category !== 'all') list = list.filter((entry) => entry.category === category)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((entry) =>
        [entry.name, entry.id, entry.category, entry.tagline.ru, entry.tagline.en]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    }
    return list
  }, [entries, category, query])

  return (
    <section className="space-y-4" data-testid="rovers-section">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Info className="icon-caption opacity-70" aria-hidden="true" />
          {t('rovers.section.title')}
        </h2>
        <p className="text-xs opacity-70">{t('rovers.section.description')}</p>
      </header>

      <div
        className="space-y-1 rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated/30 p-3 text-xs opacity-80"
        data-testid="rovers-help"
      >
        <div className="font-medium opacity-100">{t('rovers.section.helpTitle')}</div>
        <p>{t('rovers.section.helpDefinitions')}</p>
        <p>{t('rovers.section.helpVerified')}</p>
        <p>{t('rovers.section.helpSources')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[11rem] text-caption" aria-label={t('rovers.section.filterLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('rovers.section.filterAll')}</SelectItem>
            {categories.map((slug) => (
              <SelectItem key={slug} value={slug}>
                {t(`rovers.category.${slug}`, { defaultValue: slug })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="relative ml-auto flex items-center">
          <Search className="icon-caption absolute left-2 opacity-60" aria-hidden="true" />
          <input
            className="min-w-[12rem] rounded-md border bg-background py-1.5 pl-7 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('rovers.section.searchPlaceholder')}
            aria-label={t('rovers.section.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-caption hover:bg-muted"
        >
          <RefreshCw className="icon-status" aria-hidden="true" />
          {t('rovers.section.retry')}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm opacity-70" data-testid="rovers-loading">
          <Spinner className="icon-caption" />
          {t('rovers.section.loading')}
        </div>
      ) : null}

      {!loading && error ? (
        <div
          className="flex items-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-caption text-destructive"
          data-testid="rovers-error"
        >
          <AlertTriangle className="icon-caption" aria-hidden="true" />
          <span>{t('rovers.section.error')}</span>
          <span className="break-all opacity-70">{error}</span>
        </div>
      ) : null}

      {!loading && !error && filtered.length === 0 ? (
        <p className="text-sm opacity-60" data-testid="rovers-empty">
          {entries && entries.length > 0 ? t('rovers.section.emptyFiltered') : t('rovers.section.empty')}
        </p>
      ) : null}

      {!loading && !error && filtered.length > 0 ? (
        <div className="space-y-2">
          <div className="text-caption opacity-60">{t('rovers.section.count', { count: filtered.length })}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {filtered.map((entry) => (
              <RoversEntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}