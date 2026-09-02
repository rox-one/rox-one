/**
 * Pure helpers for Cmd+N / File→New Chat in Knowledge mode:
 * pick an open notebook and build knowledge.userCreate document args.
 *
 * Local Markdown is deliberately a single synthetic notebook. Keeping this
 * provider decision here means callers do not accidentally probe the legacy
 * SiYuan notebook endpoint before creating a local note.
 */

import type { KnowledgeRef } from '@craft-agent/core/knowledge'
import { isSiyuanIntegrationEnabled } from '@craft-agent/shared/feature-flags'
import { routes, type Route } from '@/lib/navigate'

export const LOCAL_MARKDOWN_PROVIDER = 'local-markdown'
export const LOCAL_MARKDOWN_NOTEBOOK_ID = 'local-notes'

export interface KnowledgeConnectionPick {
  id: string
  provider?: string
}

export interface NotebookPickInput {
  id: string
  closed?: boolean
}

export function pickOpenNotebook<T extends NotebookPickInput>(notebooks: T[]): T | undefined {
  if (notebooks.length === 0) return undefined
  return notebooks.find((notebook) => notebook.closed !== true) ?? notebooks[0]
}

/** Local Markdown has one workspace-scoped notebook; SiYuan stays legacy-only. */
export function isLocalMarkdownConnection(
  connection: Pick<KnowledgeConnectionPick, 'provider'> | null | undefined,
): boolean {
  return connection?.provider === LOCAL_MARKDOWN_PROVIDER
}

/** Prefer the local-first connection even if a legacy row was returned first. */
export function selectPreferredKnowledgeConnection<T extends KnowledgeConnectionPick>(
  connections: T[],
): T | undefined {
  // A missing local provider is an unavailable local vault, not permission to
  // create a document in whichever legacy provider happened to be first.
  return connections.find(isLocalMarkdownConnection)
}

/**
 * Resolves the notebook ID used by navigator-created documents without
 * consulting legacy notebooks for a local Markdown connection.
 */
export function notebookIdForNewDocument(
  connection: KnowledgeConnectionPick | null | undefined,
  notebooks: NotebookPickInput[],
): string | undefined {
  if (isLocalMarkdownConnection(connection)) return LOCAL_MARKDOWN_NOTEBOOK_ID
  return undefined
}

/** Provider-aware open route for a newly created document. */
export function documentRouteForConnection(
  connection: Pick<KnowledgeConnectionPick, 'provider'> | null | undefined,
  documentId: string,
): Route {
  return knowledgeRouteForConnection(connection, { kind: 'document', id: documentId })
}

/** Provider-aware route for an item resolved through a selected connection. */
export function knowledgeRouteForConnection(
  connection: Pick<KnowledgeConnectionPick, 'provider'> | null | undefined,
  ref: Pick<KnowledgeRef, 'kind' | 'id'>,
): Route {
  if (isLocalMarkdownConnection(connection)) return routes.view.notesLegacy(ref.id)
  return isSiyuanIntegrationEnabled()
    ? routes.view.siyuan({ kind: ref.kind, id: ref.id })
    : routes.view.notesLegacy()
}

/** Provider-aware route for a stored knowledge ref. */
export function knowledgeRefRoute(ref: Pick<KnowledgeRef, 'scheme' | 'kind' | 'id'>): Route {
  return knowledgeRouteForConnection(ref.scheme === 'local-note' ? { provider: LOCAL_MARKDOWN_PROVIDER } : null, ref)
}

export function buildNewDocumentCreateArgs(input: {
  connectionId: string
  notebookId: string
  title: string
}): {
  connectionId: string
  source: 'navigator'
  op: 'document'
  notebookId: string
  title: string
  path: '/'
} {
  return {
    connectionId: input.connectionId,
    source: 'navigator',
    op: 'document',
    notebookId: input.notebookId,
    title: input.title,
    path: '/',
  }
}
