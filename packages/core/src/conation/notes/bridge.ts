import type {
  NotesBridge,
  NotesBridgeOptions,
  NotesDocument,
  NotesListQuery,
  NotesPage,
  NotesSoupClient,
} from './types.ts'

const DOCUMENT_TYPENAMES = new Set([
  'GraphqlSoupDocument',
  'document',
  'Document',
  'note',
  'Note',
  'notes',
])

const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 100
const MAX_GET_PAGES = 20

export class NotesBridgeUnavailableError extends Error {
  readonly code = 'NOTES_UNAVAILABLE' as const
  constructor(message = 'Notes soup unavailable') {
    super(message)
    this.name = 'NotesBridgeUnavailableError'
  }
}

export class NotesBridgeIncompleteError extends Error {
  readonly code = 'NOTES_INCOMPLETE' as const
  constructor(message = 'Notes lookup stopped before the last page') {
    super(message)
    this.name = 'NotesBridgeIncompleteError'
  }
}

function isNotesEntity(entity: {
  entityType?: string | null
  __typename?: string | null
}): boolean {
  const tn = entity.__typename ?? ''
  const et = entity.entityType ?? ''
  if (DOCUMENT_TYPENAMES.has(tn) || DOCUMENT_TYPENAMES.has(et)) return true
  return tn.toLowerCase().includes('document') || et.toLowerCase() === 'document' || et.toLowerCase() === 'note'
}

function propertyBody(
  properties: ReadonlyArray<{ name?: string; value?: unknown }> | undefined,
): string | null {
  if (!properties?.length) return null
  const hit = properties.find((p) => {
    const n = (p.name ?? '').toLowerCase()
    return n === 'body' || n === 'content' || n === 'markdown' || n === 'text'
  })
  if (hit == null) return null
  return typeof hit.value === 'string' ? hit.value : null
}

function toDocument(entity: {
  id: string
  entityType?: string | null
  displayName?: string | null
  __typename?: string | null
  viewerPermission?: string | null
  properties?: ReadonlyArray<{ name?: string; value?: unknown }>
}): NotesDocument {
  return {
    id: entity.id,
    title: entity.displayName?.trim() || entity.id,
    entityType: entity.entityType ?? 'document',
    typename: entity.__typename ?? undefined,
    body: propertyBody(entity.properties),
    viewerPermission: entity.viewerPermission ?? null,
  }
}

async function allowed(
  id: string,
  claimLocker: NotesBridgeOptions['claimLocker'],
  importsAcl: NotesBridgeOptions['importsAcl'],
): Promise<boolean> {
  if (!claimLocker) return false
  try {
    const claim = await claimLocker.canRead(id)
    if (claim !== 'allow') return false
  } catch {
    return false
  }
  if (!importsAcl) return false
  try {
    return (await importsAcl.canView(id)) === true
  } catch {
    return false
  }
}

async function loadDocuments(
  soup: NotesSoupClient,
  query: NotesListQuery = {},
): Promise<NotesPage> {
  const limit = Math.min(
    Math.max(1, query.limit ?? DEFAULT_PAGE_LIMIT),
    MAX_PAGE_LIMIT,
  )
  const input: Record<string, unknown> = { entityType: 'document', limit }
  if (query.cursor) input.cursor = query.cursor
  let page: Awaited<ReturnType<NotesSoupClient['queryUserSoupPage']>>
  try {
    page = await soup.queryUserSoupPage({ input })
  } catch (error) {
    throw new NotesBridgeUnavailableError(
      error instanceof Error ? error.message : 'Notes soup unavailable',
    )
  }
  const items = page.items.filter(isNotesEntity).map(toDocument)
  return { items, nextCursor: page.nextCursor ?? null }
}

/**
 * Flag-gated factory. Returns null when notesBridge is off or Soup client is missing.
 * Read-only: no mutation helpers. Claim locker + Imports ACL fail closed.
 */
export function createNotesBridge(options: NotesBridgeOptions): NotesBridge | null {
  if (!options.enabled) return null
  if (!options.soup) return null
  const soup = options.soup
  const claimLocker = options.claimLocker
  const importsAcl = options.importsAcl

  return {
    async listNotes(query) {
      const page = await loadDocuments(soup, query)
      const items: NotesDocument[] = []
      for (const doc of page.items) {
        if (await allowed(doc.id, claimLocker, importsAcl)) items.push(doc)
      }
      return { items, nextCursor: page.nextCursor }
    },
    async getNote(id) {
      if (!(await allowed(id, claimLocker, importsAcl))) return null
      let cursor: string | null | undefined
      for (let page = 0; page < MAX_GET_PAGES; page++) {
        const result = await loadDocuments(soup, { cursor, limit: DEFAULT_PAGE_LIMIT })
        const found = result.items.find((doc) => doc.id === id)
        if (found) return found
        if (!result.nextCursor) return null
        if (result.nextCursor === cursor) {
          throw new NotesBridgeIncompleteError('Notes soup cursor did not advance')
        }
        cursor = result.nextCursor
      }
      throw new NotesBridgeIncompleteError()
    },
  }
}
