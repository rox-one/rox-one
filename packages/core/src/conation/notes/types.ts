/**
 * Read-only Conation Notes bridge types (WP-Notes).
 * Consumes Soup Document entities. Writes omitted on purpose.
 */

export type NotesClaimDecision = 'allow' | 'deny'

/** Rox claim locker adapter. Fail closed if missing or deny. */
export type NotesClaimLocker = {
  canRead: (entityId: string) => NotesClaimDecision | Promise<NotesClaimDecision>
}

/** Imports ACL adapter. Fail closed if missing or false. */
export type NotesImportsAcl = {
  canView: (entityId: string) => boolean | Promise<boolean>
}

export type NotesDocument = {
  id: string
  title: string
  entityType: string
  typename?: string
  /** Best-effort body from Soup properties; may be empty in v1. */
  body?: string | null
  viewerPermission?: string | null
}

export type NotesPage = {
  items: NotesDocument[]
  nextCursor?: string | null
}

/** Minimal Soup page client Notes needs (WP-Soup createSoupClient). */
export type NotesSoupClient = {
  queryUserSoupPage: (args?: { input?: Record<string, unknown> }) => Promise<{
    items: ReadonlyArray<{
      id: string
      entityType?: string | null
      displayName?: string | null
      __typename?: string | null
      viewerPermission?: string | null
      properties?: ReadonlyArray<{ name?: string; value?: unknown }>
    }>
    nextCursor?: string | null
  }>
}

export type NotesBridgeOptions = {
  /** workbench.conation.notesBridge — factory returns null when false. */
  enabled: boolean
  soup: NotesSoupClient | null
  claimLocker?: NotesClaimLocker
  importsAcl?: NotesImportsAcl
}

export type NotesBridge = {
  listNotes: () => Promise<NotesPage>
  getNote: (id: string) => Promise<NotesDocument | null>
}
