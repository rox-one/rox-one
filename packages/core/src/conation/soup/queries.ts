/** Minimal read-only GraphQL documents for Soup (WP-Soup). */

export const SOUP_TYPENAME_QUERY = /* GraphQL */ `
  query SoupTypename {
    __typename
  }
`

/** Small selection set — expand behind later WPs, not here. */
export const SOUP_USER_PAGE_QUERY = /* GraphQL */ `
  query SoupUserPage($soup: SoupInput) {
    user {
      id
      soup(input: $soup) {
        nextCursor
        items {
          id
          entityType
          displayName
          isFavorited
          __typename
        }
      }
    }
  }
`

export const SOUP_USER_GROUPED_QUERY = /* GraphQL */ `
  query SoupUserGrouped($groupSoup: GroupedSoupInput) {
    user {
      id
      groupSoup(input: $groupSoup) {
        bins {
          key
          label
        }
      }
    }
  }
`
