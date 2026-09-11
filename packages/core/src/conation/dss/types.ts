/**
 * Read-only Conation DSS / Drive HTTP contract types (WP-DSS).
 * Evidence: /dss + /document-storage-service proxy; GET /dss/projects → 401 unauth.
 * Writes and Apple FileProvider are intentionally omitted (signing BLOCKED).
 */

export const DSS_DEFAULT_BASE_URL = 'https://conation.dev/dss' as const

/** Alternate Caddy/alias path — same operator origin. */
export const DSS_ALIAS_BASE_URL = 'https://conation.dev/document-storage-service' as const

export type DssProject = {
  id: string
  name?: string | null
  /** Opaque extras from DSS — keep loose for v1. */
  [key: string]: unknown
}

export type DssEntryKind = 'file' | 'folder' | 'unknown' | string

export type DssEntry = {
  id?: string
  path: string
  name?: string | null
  kind?: DssEntryKind
  size?: number | null
  updatedAt?: string | null
  [key: string]: unknown
}

export type DssEntryMeta = {
  path: string
  kind?: DssEntryKind
  size?: number | null
  contentType?: string | null
  updatedAt?: string | null
  [key: string]: unknown
}

export type DssListProjectsResult = {
  projects: DssProject[]
}

export type DssListEntriesResult = {
  entries: DssEntry[]
  nextCursor?: string | null
}

export type DssSignRequestInput = {
  method: string
  path: string
  body?: string | Uint8Array | null
}

export type DssClientOptions = {
  /** When false / omitted falsey from flag, factory returns null. */
  enabled: boolean
  baseUrl?: string
  /** Optional auth/cookie/HMAC headers for operator origin. */
  getHeaders?: () => HeadersInit | Promise<HeadersInit>
  /**
   * Optional request signer (SessionApply / HMAC inject).
   * Exact scheme is owned outside this pack — never guess secrets here.
   */
  signRequest?: (
    input: DssSignRequestInput,
  ) => HeadersInit | Promise<HeadersInit>
  fetch?: typeof fetch
}

export type DssListEntriesArgs = {
  projectId: string
  path?: string
  cursor?: string
}

export type DssEntryPathArgs = {
  projectId: string
  path: string
}
