/**
 * MarkdownRoversCardBlock — renders a ```rovers-card fence as a compact,
 * read-only Rovers service card.
 *
 * The fence body is a self-contained `RoversEntryFull` JSON (contract §3), so
 * the card needs no RPC at render time. It shows the monogram/category icon,
 * the service name (Rox Mono), the localized category, tagline and description
 * in the active locale (ru is the product default), a verified badge and a
 * homepage link labelled via i18n («Инструкция» in ru). There is deliberately
 * NO deploy button or any other action — Slice A is info-only.
 *
 * A partial JSON (mid-stream) or an unreadable payload falls back to the plain
 * code block, mirroring MarkdownMermaidBlock/MarkdownOpenUIBlock.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, ExternalLink } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import {
  isDirectIconUrl,
  parseRoversCardPayload,
  pickLocalized,
  roversCategoryColor,
  roversLanguage,
  roversMonogram,
  type RoversEntryFull,
} from './rovers-card'

export interface MarkdownRoversCardBlockProps {
  /** Fence body — one `RoversEntryFull` JSON object. */
  code: string
  className?: string
  /**
   * Optional mapping from a catalog `icon` path to a URL the renderer can load
   * (data/http only). Without it, or when the icon is a bare repo-relative
   * path, the card draws the inline monogram that the catalog uses as its
   * placeholder icon.
   */
  resolveIcon?: (icon: string) => string | undefined
}

const CONTAINER_CLASS =
  'relative rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated/40 overflow-hidden'

function RoversCardIcon({
  entry,
  iconUrl,
}: {
  entry: RoversEntryFull
  iconUrl: string | undefined
}) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden="true"
        className="size-9 shrink-0 rounded-[var(--radius-control)] object-contain"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] font-mono text-base font-semibold text-white"
      style={{ backgroundColor: roversCategoryColor(entry.category) }}
    >
      {roversMonogram(entry.name)}
    </span>
  )
}

function RoversCard({ entry, lang, t, resolveIcon }: {
  entry: RoversEntryFull
  lang: 'ru' | 'en'
  t: (key: string, options?: Record<string, unknown>) => string
  resolveIcon?: (icon: string) => string | undefined
}) {
  const tagline = pickLocalized(entry.tagline, lang)
  const description = pickLocalized(entry.description, lang)
  const categoryLabel = t(`rovers.category.${entry.category}`, { defaultValue: entry.category })
  const iconUrl = resolveIcon?.(entry.icon) ?? (isDirectIconUrl(entry.icon) ? entry.icon : undefined)
  const hasHomepage = /^https?:\/\//i.test(entry.homepage)

  return (
    <div className={cn(CONTAINER_CLASS, 'transition-colors duration-200 motion-safe:transition-shadow hover:border-border')}>
      <div className="flex items-start gap-3 p-3">
        <RoversCardIcon entry={entry} iconUrl={iconUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-base font-semibold text-foreground">{entry.name}</span>
            {entry.verified && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/40 bg-success/10 px-1.5 py-0.5 text-caption font-medium text-success"
                title={t('rovers.card.verified')}
              >
                <BadgeCheck className="icon-status" aria-hidden="true" />
                {t('rovers.card.verified')}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-caption uppercase tracking-wide text-text-muted">{categoryLabel}</div>
          {tagline && <div className="mt-1 text-sm text-foreground">{tagline}</div>}
          {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-muted">
            {entry.spdx && (
              <span className="font-mono">
                {t('rovers.card.license')}: {entry.spdx}
              </span>
            )}
            {hasHomepage && (
              <a
                href={entry.homepage}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline motion-safe:transition-colors"
              >
                <ExternalLink className="icon-status" aria-hidden="true" />
                {t('rovers.card.instruction')}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MarkdownRoversCardBlock({ code, className, resolveIcon }: MarkdownRoversCardBlockProps) {
  const { t, i18n } = useTranslation()
  const parsed = React.useMemo(() => parseRoversCardPayload(code), [code])
  const lang = roversLanguage(i18n.language)

  if (!parsed.ok) {
    return (
      <div className={cn(CONTAINER_CLASS, className)} role="group" aria-label={t('rovers.card.label')}>
        <p className="px-3 py-2 text-base text-text-muted" data-ca-rovers-notice="invalid-payload">
          {t('rovers.card.invalid')}
        </p>
        <CodeBlock code={code} language="json" mode="full" />
      </div>
    )
  }

  return (
    <div className={cn('my-2', className)} role="group" aria-label={t('rovers.card.label')}>
      <RoversCard entry={parsed.entry} lang={lang} t={t} resolveIcon={resolveIcon} />
    </div>
  )
}