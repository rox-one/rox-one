/**
 * Rovers service-card payload — the self-contained JSON carried by a
 * ```rovers-card markdown fence (Rovers Slice A, info-only).
 *
 * The fence body is one `RoversEntryFull` object (contract §3): name, category,
 * localized tagline/description, icon path, licence id, homepage, verified flag
 * and a `deploy.kind` that is always `"none"` for this info-only slice. Nothing
 * here performs RPC at render time — the block paints straight from the JSON.
 *
 * The category vocabulary mirrors the rovers catalog schema
 * (`catalog/schema/catalogapp.schema.json` → `$defs.Category`); each slug has a
 * matching `rovers.category.<slug>` message in every locale.
 */

export const ROVERS_CATEGORIES = [
  'llm-runtime',
  'gateway',
  'chat-ui',
  'vector-db',
  'database',
  'object-storage',
  'automation',
  'observability',
  'dev-env',
  'media',
  'comms',
  'agent-tooling',
  'rox-ecosystem',
] as const

export type RoversCategory = (typeof ROVERS_CATEGORIES)[number]

/** A localized string pair carried by catalog entries (ru is the product default). */
export interface RoversLocalizedText {
  ru: string
  en: string
}

/** Deploy descriptor; Slice A only ever carries `{ kind: 'none' }`. */
export interface RoversDeploy {
  kind: 'none'
}

/** The full entry shape: the fence payload and the `rovers:list` row shape. */
export interface RoversEntryFull {
  id: string
  name: string
  category: string
  tagline: RoversLocalizedText
  description: RoversLocalizedText
  icon: string
  spdx: string
  homepage: string
  verified: boolean
  deploy: RoversDeploy
}

/** The compact shape used by `rovers_list` / `rovers_search` results. */
export interface RoversCardSummary {
  id: string
  name: string
  category: string
  tagline: RoversLocalizedText
  icon: string
  verified: boolean
}

export type RoversCardParseResult =
  | { ok: true; entry: RoversEntryFull }
  | { ok: false; reason: string }

/** Which side of a localized pair to show; ru is the product default. */
export type RoversLanguage = 'ru' | 'en'

/** Map an i18n language tag (e.g. `ru`, `ru-RU`, `zh-Hans`) to a card side. */
export function roversLanguage(tag: string | undefined): RoversLanguage {
  return tag?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

/** Pick a localized string with a cross-side fallback (never returns empty). */
export function pickLocalized(text: RoversLocalizedText | undefined, lang: RoversLanguage): string {
  if (!text) return ''
  const primary = text[lang]
  if (typeof primary === 'string' && primary.length > 0) return primary
  const fallback = lang === 'ru' ? text.en : text.ru
  return typeof fallback === 'string' ? fallback : ''
}

const isLocalized = (value: unknown): value is RoversLocalizedText => {
  if (value == null || typeof value !== 'object') return false
  const { ru, en } = value as Record<string, unknown>
  return typeof ru === 'string' && typeof en === 'string'
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * Defensively parse a ```rovers-card fence body into a `RoversEntryFull`.
 *
 * A streaming message hands the block a growing string, so a partial JSON must
 * fail cleanly (the block then falls back to the plain code block) rather than
 * throw. Unknown extra fields are ignored; a missing required field is a
 * failure.
 */
export function parseRoversCardPayload(code: string): RoversCardParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(code)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { ok: false, reason }
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'payload is not an object' }
  }
  const obj = raw as Record<string, unknown>
  const id = asString(obj.id)
  const name = asString(obj.name)
  const category = asString(obj.category)
  if (!id || !name || !category) {
    return { ok: false, reason: 'missing id/name/category' }
  }
  if (!isLocalized(obj.tagline)) {
    return { ok: false, reason: 'tagline must be {ru,en}' }
  }
  if (!isLocalized(obj.description)) {
    return { ok: false, reason: 'description must be {ru,en}' }
  }
  // Slice A is info-only: `deploy.kind` is always `none`, whether the fence
  // supplied the field (any value) or omitted it entirely.
  const deploy: RoversDeploy = { kind: 'none' }
  return {
    ok: true,
    entry: {
      id,
      name,
      category,
      tagline: { ru: obj.tagline.ru, en: obj.tagline.en },
      description: { ru: obj.description.ru, en: obj.description.en },
      icon: asString(obj.icon),
      spdx: asString(obj.spdx),
      homepage: asString(obj.homepage),
      verified: obj.verified === true,
      deploy,
    },
  }
}

// ── Monogram fallback ────────────────────────────────────────────────────────
//
// Catalog icons are monogram SVGs (`icons/<id>.svg`, first letter + category
// palette colour, contract §8) and are honest placeholders for official logos.
// A markdown card carries the repo-relative path only and has no asset base at
// render time, so when a caller has no `resolveIcon` we draw the same monogram
// inline instead of requesting an unresolvable URL.

const CATEGORY_PALETTE: Record<string, string> = {
  'llm-runtime': '#6366f1',
  gateway: '#0ea5e9',
  'chat-ui': '#8b5cf6',
  'vector-db': '#14b8a6',
  database: '#2563eb',
  'object-storage': '#0891b2',
  automation: '#f59e0b',
  observability: '#ef4444',
  'dev-env': '#22c55e',
  media: '#ec4899',
  comms: '#06b6d4',
  'agent-tooling': '#a855f7',
  'rox-ecosystem': '#f97316',
}

const FALLBACK_PALETTE = '#64748b'

/** Deterministic monogram colour for a category slug. */
export function roversCategoryColor(category: string): string {
  return CATEGORY_PALETTE[category] ?? FALLBACK_PALETTE
}

/** First visible character of a service name, upper-cased — the monogram glyph. */
export function roversMonogram(name: string): string {
  const first = [...name.trim()][0]
  return first ? first.toUpperCase() : '?'
}

/** A data/http icon URL is renderable directly; a repo-relative path is not. */
export function isDirectIconUrl(icon: string): boolean {
  return /^(?:data:|https?:\/\/)/i.test(icon)
}