export {
  SOUP_GRAPHQL_DEFAULT_ENDPOINT,
  type SoupClientOptions,
  type SoupEntity,
  type SoupEntityConcreteType,
  type SoupPage,
  type SoupPatch,
  type SoupUser,
} from './types.ts'
export { createSoupClient, type SoupClient } from './client.ts'
export {
  SOUP_TYPENAME_QUERY,
  SOUP_USER_PAGE_QUERY,
  SOUP_USER_GROUPED_QUERY,
} from './queries.ts'
