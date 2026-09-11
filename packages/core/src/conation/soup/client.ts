import {
  SOUP_GRAPHQL_DEFAULT_ENDPOINT,
  type SoupClientOptions,
  type SoupGraphQlResponse,
  type SoupPage,
  type SoupPageQueryArgs,
  type SoupUser,
} from './types.ts'
import {
  SOUP_TYPENAME_QUERY,
  SOUP_USER_GROUPED_QUERY,
  SOUP_USER_PAGE_QUERY,
} from './queries.ts'

export type SoupClient = {
  readonly endpoint: string
  /** Live probe: expects data.__typename === 'SoupQueryRoot'. */
  ping: () => Promise<'SoupQueryRoot' | string>
  queryUserSoupPage: (args?: SoupPageQueryArgs) => Promise<SoupPage>
  queryUserGroupedSoup: (input?: Record<string, unknown>) => Promise<SoupUser['groupSoup']>
}

async function postGraphQl<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown> | undefined,
  getHeaders: SoupClientOptions['getHeaders'],
  fetchImpl: typeof fetch,
): Promise<T> {
  const extra = getHeaders ? await getHeaders() : undefined
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(extra ?? {}),
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    throw new Error(`Soup GraphQL HTTP ${res.status}`)
  }
  const body = (await res.json()) as SoupGraphQlResponse<T>
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '))
  }
  if (body.data == null) {
    throw new Error('Soup GraphQL empty data')
  }
  return body.data
}

/**
 * Flag-gated factory. Returns null when `enabled` is false (default flag path).
 * Read-only: no mutation helpers.
 */
export function createSoupClient(options: SoupClientOptions): SoupClient | null {
  if (!options.enabled) return null
  const endpoint = options.endpoint ?? SOUP_GRAPHQL_DEFAULT_ENDPOINT
  const fetchImpl = options.fetch ?? fetch
  const getHeaders = options.getHeaders

  return {
    endpoint,
    async ping() {
      const data = await postGraphQl<{ __typename: string }>(
        endpoint,
        SOUP_TYPENAME_QUERY,
        undefined,
        getHeaders,
        fetchImpl,
      )
      return data.__typename
    },
    async queryUserSoupPage(args) {
      const data = await postGraphQl<{ user: SoupUser }>(
        endpoint,
        SOUP_USER_PAGE_QUERY,
        args?.input != null ? { soup: args.input } : {},
        getHeaders,
        fetchImpl,
      )
      return data.user.soup ?? { items: [], nextCursor: null }
    },
    async queryUserGroupedSoup(input) {
      const data = await postGraphQl<{ user: SoupUser }>(
        endpoint,
        SOUP_USER_GROUPED_QUERY,
        input != null ? { groupSoup: input } : {},
        getHeaders,
        fetchImpl,
      )
      return data.user.groupSoup
    },
  }
}
