/**
 * KnowledgeHome's atoms and pure helpers, split from the component (WP7) so the
 * shell (MainContentPanel, KnowledgeNavigator, the omnibox) can read them
 * without pulling the KnowledgeHome screen into index.html's startup closure.
 * KnowledgeHome.tsx re-exports everything here.
 */
import { atom } from 'jotai'
import type { KnowledgeRef, SearchHit } from '@rox/core/knowledge'
import { routes } from '@/lib/navigate'
import type { ViewConfig as KnowledgeViewConfig } from '@rox/shared/views'

/**
 * Which body KnowledgeHome renders. Module-level atom so other column hosts
 * (KnowledgeNavigator link) can surface the proposals list explicitly; the
 * section entry below search toggles it in place. `view` is a saved-knowledge
 * view result surface (P5).
 */
export const knowledgeHomeViewAtom = atom<'search' | 'proposals' | 'view'>('search')

/** Active saved knowledge view id (deep-linkable via knowledge/view/{id}). */
export const knowledgeActiveViewIdAtom = atom<string | null>(null)

// ---------------------------------------------------------------------------
// Search / views logic (exported for tests — see header).
// ---------------------------------------------------------------------------

export interface KnowledgeSearchApi {
  listConnections(): Promise<Array<{ id: string }>>
  search(args: {
    workspaceId: string
    connectionId: string
    input: { query: string }
  }): Promise<{ items: SearchHit[] }>
}

/** P5 views + set_attribute subset of ElectronAPI.knowledge. */
export interface KnowledgeViewHit extends SearchHit {
  attributes?: Record<string, string>
  topic?: string
}

export interface KnowledgeViewsApi {
  listConnections(): Promise<Array<{ id: string }>>
  viewsList(args?: { connectionId?: string }): Promise<KnowledgeViewConfig[]>
  viewRun(args: {
    connectionId: string
    viewId: string
    workspaceId?: string
  }): Promise<{ items: KnowledgeViewHit[]; view: KnowledgeViewConfig }>
  viewSetAttribute(args: {
    connectionId: string
    ref: KnowledgeRef
    name: string
    value: string
  }): Promise<{ proposalId: string }>
}

/** Reads the P1 knowledge surface off the preload-injected ElectronAPI. */
export function resolveKnowledgeApi(): KnowledgeSearchApi | null {
  if (typeof window === 'undefined' || !window.electronAPI?.knowledge) return null
  return window.electronAPI.knowledge
}

/** Reads the P5 views surface; null when preload predates the channels. */
export function resolveKnowledgeViewsApi(): KnowledgeViewsApi | null {
  if (typeof window === 'undefined' || !window.electronAPI?.knowledge) return null
  const api = window.electronAPI.knowledge
  if (typeof api.viewsList !== 'function' || typeof api.viewRun !== 'function') return null
  return api as KnowledgeViewsApi
}

/**
 * Runs a knowledge search against the first configured connection.
 * Returns `null` when there is no usable API or zero connections.
 */
export async function searchKnowledge(
  api: KnowledgeSearchApi | null,
  workspaceId: string,
  query: string,
): Promise<SearchHit[] | null> {
  if (!api) return null
  const connections = await api.listConnections()
  const primary = connections[0]
  if (!primary) return null
  const page = await api.search({
    workspaceId,
    connectionId: primary.id,
    input: { query },
  })
  return page.items
}

/**
 * Sync note-id resolution for a knowledge search hit.
 * Prefer explicit Rox attributes; accept path-like local ids. Opaque legacy
 * document/block ids return null here — callers may async-lookup the import map.
 */
export function resolveSearchHitNoteId(
  hit: Pick<SearchHit, 'ref'> & { attributes?: Record<string, string> },
): string | null {
  const attrs = hit.attributes ?? {}
  for (const key of ['rox-note-id', 'noteId', 'note_id', 'destinationNoteId', 'notePath', 'path'] as const) {
    const raw = attrs[key]
    if (typeof raw === 'string' && raw.trim()) {
      let cleaned = raw.trim().replace(/\\/g, '/')
      if (cleaned.toLowerCase().startsWith('notes/')) cleaned = cleaned.slice('notes/'.length)
      if (cleaned.toLowerCase().endsWith('.md')) cleaned = cleaned.slice(0, -3)
      if (cleaned) return cleaned
    }
  }
  const id = hit.ref?.id?.trim()
  if (!id) return null
  // Path-like / daily ids are treated as local Rox Notes ids.
  if (id.includes('/') || id.startsWith('daily')) return id
  return null
}

/** Route for a search hit — Rox Notes deep link when resolvable, else Notes home. */
export function searchHitRoute(
  hit: Pick<SearchHit, 'ref'> & { attributes?: Record<string, string> },
) {
  const noteId = resolveSearchHitNoteId(hit)
  return noteId ? routes.view.notes(noteId) : routes.view.notes()
}

/** Route for a saved knowledge view deep-link. */
export function knowledgeViewRoute(viewId: string) {
  return routes.view.knowledgeView(viewId)
}

/** Lists domain=knowledge views (server filters; client keeps only knowledge). */
export async function listKnowledgeViews(
  api: KnowledgeViewsApi | null,
  connectionId?: string,
): Promise<KnowledgeViewConfig[] | null> {
  if (!api) return null
  const views = await api.viewsList(connectionId ? { connectionId } : undefined)
  return views.filter((v) => !v.domain || v.domain === 'knowledge')
}

/**
 * Resolves the primary connection and runs a saved view.
 * Returns null when there is no API / no connection.
 */
export async function runKnowledgeView(
  api: KnowledgeViewsApi | null,
  viewId: string,
  workspaceId?: string,
): Promise<{ items: KnowledgeViewHit[]; view: KnowledgeViewConfig; connectionId: string } | null> {
  if (!api) return null
  const connections = await api.listConnections()
  const primary = connections[0]
  if (!primary) return null
  const result = await api.viewRun({
    connectionId: primary.id,
    viewId,
    workspaceId,
  })
  return { ...result, connectionId: primary.id }
}

/** Propose set_attribute via viewSetAttribute (never direct write). */
export async function setViewAttribute(
  api: KnowledgeViewsApi | null,
  args: {
    connectionId: string
    ref: KnowledgeRef
    name: string
    value: string
  },
): Promise<{ proposalId: string } | null> {
  if (!api || typeof api.viewSetAttribute !== 'function') return null
  return api.viewSetAttribute(args)
}

/**
 * Pure selection helper: pick a view by id from a list (or null).
 * Used by the component and logic-level tests.
 */
export function selectKnowledgeView(
  views: KnowledgeViewConfig[],
  viewId: string | null | undefined,
): KnowledgeViewConfig | null {
  if (!viewId) return null
  return views.find((v) => v.id === viewId) ?? null
}

/** Group key for a hit: topic/status use enriched attributes when present. */
export function groupKeyForHit(hit: KnowledgeViewHit, groupBy?: string): string {
  if (!groupBy) return ''
  if (groupBy === 'notebook') {
    const path = hit.notebookPath || ''
    const parts = path.split('/').filter(Boolean)
    return parts[0] || path || 'ungrouped'
  }
  if (groupBy === 'topic') {
    const topic =
      hit.topic ||
      hit.attributes?.topic ||
      hit.attributes?.['knowledge-topic']
    if (topic) return topic
  }
  if (groupBy === 'status') {
    const status =
      hit.attributes?.['knowledge-workflow_status'] ||
      hit.attributes?.workflow_status ||
      hit.attributes?.status ||
      hit.attributes?.['knowledge-status']
    if (status) return status
  }
  // Fallback: notebook path leaf
  const path = hit.notebookPath || ''
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || 'ungrouped'
}

export interface ViewHitGroup {
  key: string
  items: KnowledgeViewHit[]
}

/** Client-side groupBy for view results (flat list + headers). */
export function groupViewHits(items: KnowledgeViewHit[], groupBy?: string): ViewHitGroup[] {
  if (!groupBy) return [{ key: '', items }]
  const map = new Map<string, KnowledgeViewHit[]>()
  for (const hit of items) {
    const key = groupKeyForHit(hit, groupBy)
    const bucket = map.get(key)
    if (bucket) bucket.push(hit)
    else map.set(key, [hit])
  }
  return [...map.entries()].map(([key, groupItems]) => ({ key, items: groupItems }))
}

/** First set_attribute preset on a view, if any. */
export function firstSetAttributeAction(
  view: KnowledgeViewConfig | null | undefined,
): { name: string; value: string } | null {
  if (!view?.presetActions) return null
  for (const action of view.presetActions) {
    if (action.type === 'set_attribute') {
      return { name: action.name, value: action.value }
    }
  }
  return null
}

export type KnowledgeEnvelopeLike = {
  knowledgeRef: { kind: string; id: string }
  updatedAt: number
}

/** Most recently updated document envelope, or null when none exist. */
export function pickDefaultKnowledgeDocument(
  envelopes: readonly KnowledgeEnvelopeLike[],
): { kind: 'document'; id: string } | null {
  let best: KnowledgeEnvelopeLike | null = null
  for (const envelope of envelopes) {
    if (envelope.knowledgeRef.kind !== 'document') continue
    if (!best || envelope.updatedAt > best.updatedAt) best = envelope
  }
  if (!best) return null
  return { kind: 'document', id: best.knowledgeRef.id }
}

/** In-app editor route for the default document, else Rox Notes home. */
export function defaultKnowledgeEditorRoute(
  envelopes: readonly KnowledgeEnvelopeLike[],
): string {
  const doc = pickDefaultKnowledgeDocument(envelopes)
  if (!doc) return routes.view.notes()
  return routes.view.notes(doc.id)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

