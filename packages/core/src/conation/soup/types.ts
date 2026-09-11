/**
 * Read-only Conation Soup / GraphQL contract types (WP-Soup).
 * Derived from live introspection of https://conation.dev/graphql (2026-09-11).
 * Writes (CompleteMutationRoot) are intentionally omitted.
 */

export const SOUP_GRAPHQL_DEFAULT_ENDPOINT = 'https://conation.dev/graphql' as const

/** GraphQL query root name verified live: SoupQueryRoot */
export type SoupQueryRootName = 'SoupQueryRoot'

export type SoupEntityConcreteType =
  | 'GraphqlSoupDocument'
  | 'GraphqlSoupChat'
  | 'GraphqlSoupProject'
  | 'GraphqlSoupEmailThread'
  | 'GraphqlSoupChannel'
  | 'GraphqlSoupChannelMessage'
  | 'GraphqlSoupCall'
  | 'GraphqlSoupCalendarEvent'
  | 'GraphqlSoupCrmCompany'
  | 'GraphqlSoupForeignEntity'
  | 'GraphqlSoupReminder'

/** Minimal property value bag — opaque until domain panes need more. */
export type SoupProperty = {
  id?: string
  name?: string
  // GraphQL property unions are large; keep opaque for read bridge v1.
  value?: unknown
}

export type SoupEntityMetadata = {
  // Opaque metadata envelope from GraphqlEntityMetadata
  [key: string]: unknown
}

/** GraphqlSoupEntity interface (read fields used by the client). */
export type SoupEntity = {
  __typename?: SoupEntityConcreteType | string
  id: string
  entityType: string
  displayName?: string | null
  metadata?: SoupEntityMetadata
  properties?: SoupProperty[]
  isFavorited?: boolean
  viewerPermission?: string | null
  frecencyScore?: number | null
  cacheProjection?: unknown
}

export type SoupPage = {
  items: SoupEntity[]
  nextCursor?: string | null
}

export type SoupBin = {
  key?: string
  label?: string | null
  page?: SoupPage | null
  [key: string]: unknown
}

export type GroupedSoup = {
  bins: SoupBin[]
}

export type SoupUser = {
  id: string
  soup?: SoupPage
  groupSoup?: GroupedSoup
}

export type SoupUpdated = {
  __typename?: 'SoupUpdated'
  item?: SoupEntity | null
}

export type SoupCacheDeletion = {
  __typename?: 'GraphqlCacheDeletion'
  [key: string]: unknown
}

/** CompleteSubscriptionRoot.soupUpdates members (types only in v1). */
export type SoupPatch = SoupUpdated | SoupCacheDeletion

export type SoupGraphQlError = {
  message: string
  path?: ReadonlyArray<string | number>
  extensions?: Record<string, unknown>
}

export type SoupGraphQlResponse<T> = {
  data?: T
  errors?: SoupGraphQlError[]
}

export type SoupClientOptions = {
  /** When false / omitted falsey from flag, factory returns null. */
  enabled: boolean
  endpoint?: string
  /** Optional auth/cookie headers for operator origin. */
  getHeaders?: () => HeadersInit | Promise<HeadersInit>
  fetch?: typeof fetch
}

export type SoupPageQueryArgs = {
  /** Pass-through to SoupInput / initial input — kept loose for v1. */
  input?: Record<string, unknown>
}
