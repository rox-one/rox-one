/**
 * Rovers catalog v1 — list / search / show query API.
 *
 * Pure and deterministic: it reads a validated {@link RoversCatalog} and never
 * touches the filesystem, the network, or the clock. The session tools and the
 * `rovers:list` RPC both build a {@link RoversCatalogQuery} from the same
 * loaded catalog, so filtering behaves identically on every surface.
 */

import type {
  RoversCardSummary,
  RoversCatalog,
  RoversCatalogListQuery,
  RoversCatalogListResult,
  RoversEntryFull,
} from './types.ts'

/** Default page size for `rovers_list`. */
export const ROVERS_LIST_DEFAULT_LIMIT = 20
/** Hard cap on requested page size — a card list is always bounded. */
export const ROVERS_LIST_MAX_LIMIT = 100

/** Typed, code-bearing error raised by the query handlers. */
export type RoversCatalogErrorCode =
  | 'ENTRY_NOT_FOUND'
  | 'INVALID_JSON'
  | 'INVALID_CATALOG'
  | 'NO_BUNDLED_CATALOG'
  | 'UNSIGNED_BUNDLED_CATALOG'
  | 'SIGNATURE_INVALID'
  | 'DIGEST_MISMATCH'

/** Error thrown by the loader and the query handlers. */
export class RoversCatalogError extends Error {
  readonly code: RoversCatalogErrorCode
  readonly issues?: string[]

  constructor(code: RoversCatalogErrorCode, message: string, options?: { issues?: string[] }) {
    super(message)
    this.name = 'RoversCatalogError'
    this.code = code
    if (options?.issues) this.issues = options.issues
  }
}

/** Project a full entry down to the card summary shape. */
export function toRoversCardSummary(entry: RoversEntryFull): RoversCardSummary {
  const { id, name, category, tagline, icon, verified } = entry
  return { id, name, category, tagline, icon, verified }
}

function queryTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

/** Case-insensitive haystack: ids, names, categories, both locales, and SPDX. */
function entryHaystack(entry: RoversEntryFull): string {
  return [
    entry.id,
    entry.name,
    entry.category,
    entry.tagline.ru,
    entry.tagline.en,
    entry.description.ru,
    entry.description.en,
    entry.spdx,
  ]
    .join('\n')
    .toLowerCase()
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return ROVERS_LIST_DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit), 1), ROVERS_LIST_MAX_LIMIT)
}

/** Read-only view over one loaded catalog. */
export interface RoversCatalogQuery {
  /** The validated catalog this view was built from. */
  readonly catalog: RoversCatalog
  list(query?: RoversCatalogListQuery): RoversCatalogListResult
  search(query: string, limit?: number): RoversCatalogListResult
  show(id: string): RoversEntryFull | null
}

/**
 * Build a query view. `category` is an exact match; `query` is an AND of
 * case-insensitive substring tokens (a single token is a plain substring);
 * `total` counts every match before `limit` is applied.
 */
export function createRoversCatalogQuery(catalog: RoversCatalog): RoversCatalogQuery {
  const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]))

  const list = (query: RoversCatalogListQuery = {}): RoversCatalogListResult => {
    const category = typeof query.category === 'string' && query.category.trim() ? query.category.trim() : undefined
    const tokens = typeof query.query === 'string' ? queryTokens(query.query) : []
    const limit = clampLimit(query.limit)

    let total = 0
    const entries: RoversCardSummary[] = []
    for (const entry of catalog.entries) {
      if (category !== undefined && entry.category !== category) continue
      if (tokens.length > 0) {
        const haystack = entryHaystack(entry)
        if (!tokens.every((token) => haystack.includes(token))) continue
      }
      total += 1
      if (entries.length < limit) entries.push(toRoversCardSummary(entry))
    }
    return { entries, total }
  }

  return {
    catalog,
    list,
    search: (query, limit) => list({ query, limit }),
    show: (id) => (typeof id === 'string' ? byId.get(id) ?? null : null),
  }
}

/** `rovers_list` handler body: list with optional category/keyword/limit. */
export function roversList(query: RoversCatalogQuery, args: RoversCatalogListQuery = {}): RoversCatalogListResult {
  return query.list(args)
}

/** `rovers_search` handler body: keyword search over the same view. */
export function roversSearch(
  query: RoversCatalogQuery,
  args: { query: string; limit?: number },
): RoversCatalogListResult {
  return query.search(args.query, args.limit)
}

/**
 * `rovers_show` handler body: the full entry for an id. Throws
 * {@link RoversCatalogError} `ENTRY_NOT_FOUND` for an unknown id so the caller
 * can answer with a typed error rather than an empty card.
 */
export function roversShow(query: RoversCatalogQuery, args: { id: string }): RoversEntryFull {
  const entry = query.show(args.id)
  if (!entry) throw new RoversCatalogError('ENTRY_NOT_FOUND', `no Rovers catalog entry with id "${args.id}"`)
  return entry
}