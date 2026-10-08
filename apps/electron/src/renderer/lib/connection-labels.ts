/**
 * Human-readable labels for connection rows (settings → Accounts and the
 * Connections overview).
 *
 * Provider ids and the free-form `accountLabel` captured at connect time are
 * stored verbatim, so the UI can end up showing machine values: slugs, host
 * names, endpoint URLs or debug dumps (e.g. `rox.reply.withexactly.pong`).
 * These helpers resolve a provider id to a friendly name and turn an account
 * label into something a person can read, falling back to a localized caption.
 */

import { getProviderDisplayName } from './provider-icons'

/** Translate signature shared by react-i18next and `@rox/shared/i18n`. */
export type ConnectionLabelTranslate = (key: string) => string

/** Longest account subtitle before it is trimmed with an ellipsis. */
const ACCOUNT_LABEL_MAX = 64

/**
 * Friendly names for provider ids that have no localized label key.
 * Brand names are proper nouns, so they stay language-neutral.
 */
const FRIENDLY_PROVIDER_NAMES: Record<string, string> = {
  rox: 'Rox',
  omp: 'Rox',
  pi: 'Rox Backend',
  pi_compat: 'Rox Backend',
}

/** Slug / id shape: single token built from letters, digits and separators. */
const ID_LIKE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i

/** Scheme-less endpoint or prefixed machine id (`127.0.0.1:6806`, `llm:gpt-5`). */
const ENDPOINT_LIKE = /^[a-z0-9._-]+:[a-z0-9._@-]+$/i

/**
 * True when a stored label is a machine value rather than something a person
 * typed — empty, a URL/endpoint, a debug dump, or a slug/id.
 */
function isTechnicalLabel(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  // URLs and other schemes (http://, ws://, file://)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return true
  // Scheme-less endpoints and prefixed machine ids
  if (ENDPOINT_LIKE.test(trimmed)) return true
  // Debug dumps: JSON-ish, shell snippets, literal booleans/nulls
  if (/[{}<>]|=>|::|\btrue\b|\bfalse\b|\bnull\b/.test(trimmed)) return true
  // Slugs, ids and dotted host names
  if (ID_LIKE.test(trimmed)) {
    const separators = (trimmed.match(/[._-]/g) ?? []).length
    if (separators >= 2 || /\d/.test(trimmed) || trimmed.length >= 24) return true
  }
  return false
}

/**
 * Resolve a provider id to a friendly, localized label. Never returns a raw
 * technical id: unknown providers fall back to a humanized token.
 */
export function connectionProviderLabel(provider: string, t: ConnectionLabelTranslate): string {
  const key = `settings.accounts.provider.${provider}`
  const translated = t(key)
  if (translated !== key) return translated

  const friendly = FRIENDLY_PROVIDER_NAMES[provider]
  if (friendly) return friendly

  const known = getProviderDisplayName(provider)
  if (known && known !== provider) return known

  return humanizeToken(provider)
}

/**
 * Resolve the subtitle for a connection: the stored `accountLabel` when it is
 * meaningful, otherwise the supplied caption (identity or "Connected").
 */
export function connectionAccountSubtitle(
  rawAccountLabel: string | null | undefined,
  fallback: string,
): string {
  const trimmed = (rawAccountLabel ?? '').trim()
  const label = trimmed && !isTechnicalLabel(trimmed) ? trimmed : fallback
  // Keep a single row tidy without letting a long value bleed the layout.
  return label.length <= ACCOUNT_LABEL_MAX
    ? label
    : `${label.slice(0, ACCOUNT_LABEL_MAX - 1).trimEnd()}…`
}

/** `openai_compat` → `Openai compat`; keeps the first letter capitalized. */
function humanizeToken(value: string): string {
  const spaced = value.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!spaced) return value
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}