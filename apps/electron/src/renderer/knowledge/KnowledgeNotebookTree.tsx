/**
 * KnowledgeNotebookTree (W2, spec S-01 §Режим Знания) — left-nav section tree
 * for the Knowledge mode.
 *
 * Data-mode (this slice wires the supported concepts; the rest stay honest
 * dynamic-empty rows):
 * - Notebooks: live via `knowledge.listNotebooks` RPC (kernel lsNotebooks).
 *   States: loading / ok / empty / unavailable (offline kernel, missing
 *   connection, or a preload that predates the channel — never a raw throw).
 * - Recent: work envelopes (S-08) sorted by updatedAt desc (top 10).
 * - Favorites: flagged work envelopes, newest first.
 * - Saved views: workspace views.json via `knowledge.viewsList` (knowledge
 *   domain only) — clicking a view deep-links to `knowledge/view/{id}`.
 * - Inbox / Daily / Databases / Tags: no provider surface exists (no contract
 *   endpoint). Empty chrome is hidden (not a load-failure row) so the tree
 *   does not look broken. See uncontractedNavSectionPresentation.
 *
 * Envelope rows resolve document titles best-effort through `knowledge.get`
 * (Promise.all in the loader, fail-soft per row to the short id).
 *
 * i18n: agreed knowledge.* keys are used verbatim; new copy lands in all 10
 * locales in the same change (knowledge.nav.notebooksUnavailable, updated
 * knowledge.nav.notebooksEmpty).
 */
import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Book,
  Clock,
  Database,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  LayoutGrid,
  Star,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import type {
  KnowledgeNotebookInfo,
  KnowledgeNode,
  KnowledgeRef,
  KnowledgeViewConfig,
  KnowledgeWorkEnvelope,
} from '../../shared/types'
import { buildNewDocumentCreateArgs, pickOpenNotebook } from './knowledge-new-note'
import { filterTree, mergeFolderChildren, type NavFilter, type SiyuanDocTreeNode } from './knowledge-tree'

// ---------------------------------------------------------------------------
// Data plumbing (exported for logic-level tests — KnowledgeHome precedent)
// ---------------------------------------------------------------------------

/** Subset of ElectronAPI.knowledge the navigator consumes (structural for tests). */
export interface KnowledgeNavigatorApi {
  listConnections(): Promise<Array<{ id: string }>>
  listNotebooks?(args: { connectionId: string }): Promise<KnowledgeNotebookInfo[]>
  listTree?(args: {
    connectionId: string
    notebookId: string
    path?: string
  }): Promise<{ notebookId: string; nodes: SiyuanDocTreeNode[] }>
  userCreate?(args: Record<string, unknown>): Promise<{ id?: string; path?: string }>
  viewsList?(args?: { connectionId?: string }): Promise<KnowledgeViewConfig[]>
  envelopeList?(args?: { connectionId?: string }): Promise<KnowledgeWorkEnvelope[]>
  get?(args: { workspaceId?: string; connectionId: string; ref: KnowledgeRef }): Promise<KnowledgeNode>
}

export interface NotebookSectionState {
  status: 'ok' | 'empty' | 'unavailable'
  items: KnowledgeNotebookInfo[]
}

export interface NavigatorEnvelopeRow {
  envelope: KnowledgeWorkEnvelope
  /** Resolved document title when the kernel answered; rows fall back to the ref id. */
  title?: string
}

export interface KnowledgeNavigatorData {
  notebooks: NotebookSectionState
  views: KnowledgeViewConfig[]
  recent: NavigatorEnvelopeRow[]
  favorites: NavigatorEnvelopeRow[]
}

export const RECENT_SECTION_LIMIT = 10
export const FAVORITES_SECTION_LIMIT = 10

/** Sections with no provider/contract surface — hide when empty. */
export const UNCONTRACTED_NAV_SECTION_IDS = ['inbox', 'daily', 'databases', 'tags'] as const

export type UncontractedNavSectionId = (typeof UNCONTRACTED_NAV_SECTION_IDS)[number]

export type UncontractedNavPresentation = 'hidden' | 'items'

/**
 * Inbox/Daily/Tags (and Databases) have no list endpoint. Empty chrome must
 * disappear — never look like a load failure / unavailable kernel.
 */
export function uncontractedNavSectionPresentation(itemCount: number): UncontractedNavPresentation {
  return itemCount > 0 ? 'items' : 'hidden'
}

/** Recently touched work items: non-archived envelopes, updatedAt desc, capped. */
export function selectRecentEnvelopes(
  envelopes: KnowledgeWorkEnvelope[],
  limit: number = RECENT_SECTION_LIMIT,
): KnowledgeWorkEnvelope[] {
  return envelopes
    .filter((entry) => entry.archived !== true)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.knowledgeRef.id.localeCompare(b.knowledgeRef.id))
    .slice(0, Math.max(limit, 0))
}

/** Pinned work items: flagged, non-archived envelopes, newest first. */
export function selectFavoriteEnvelopes(
  envelopes: KnowledgeWorkEnvelope[],
  limit: number = FAVORITES_SECTION_LIMIT,
): KnowledgeWorkEnvelope[] {
  return envelopes
    .filter((entry) => entry.flagged === true && entry.archived !== true)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.knowledgeRef.id.localeCompare(b.knowledgeRef.id))
    .slice(0, Math.max(limit, 0))
}

/**
 * Loads all navigator sections. Honest fallbacks: notebooks report
 * 'unavailable' on a typed RPC failure / missing channel / no connection;
 * views and envelopes fail soft to empty lists (workspace-local stores).
 */
export async function loadKnowledgeNavigatorData(
  api: KnowledgeNavigatorApi,
): Promise<KnowledgeNavigatorData> {
  const connections = await api.listConnections().catch(() => [] as Array<{ id: string }>)
  const connectionId = connections[0]?.id

  const notebooksPromise = (async (): Promise<NotebookSectionState> => {
    if (!connectionId || typeof api.listNotebooks !== 'function') {
      return { status: 'unavailable', items: [] }
    }
    try {
      const items = await api.listNotebooks({ connectionId })
      return items.length === 0 ? { status: 'empty', items } : { status: 'ok', items }
    } catch {
      return { status: 'unavailable', items: [] }
    }
  })()

  const viewsPromise = (async (): Promise<KnowledgeViewConfig[]> => {
    if (typeof api.viewsList !== 'function') return []
    try {
      const views = await api.viewsList(connectionId ? { connectionId } : undefined)
      return views.filter((view) => !view.domain || view.domain === 'knowledge')
    } catch {
      return []
    }
  })()

  const rowsPromise = (async (): Promise<{ recent: NavigatorEnvelopeRow[]; favorites: NavigatorEnvelopeRow[] }> => {
    if (typeof api.envelopeList !== 'function') return { recent: [], favorites: [] }
    let envelopes: KnowledgeWorkEnvelope[]
    try {
      envelopes = await api.envelopeList(connectionId ? { connectionId } : undefined)
    } catch {
      return { recent: [], favorites: [] }
    }
    const recentEnvelopes = selectRecentEnvelopes(envelopes)
    const favoriteEnvelopes = selectFavoriteEnvelopes(envelopes)

    // Best-effort title resolution in parallel; per-row failure keeps the row
    // (label falls back to the ref id) rather than poisoning the section.
    const titles = new Map<string, string>()
    if (typeof api.get === 'function' && connectionId) {
      const uniqueRefs = new Map<string, KnowledgeRef>()
      for (const entry of [...recentEnvelopes, ...favoriteEnvelopes]) {
        uniqueRefs.set(`${entry.knowledgeRef.kind}:${entry.knowledgeRef.id}`, entry.knowledgeRef)
      }
      await Promise.all(
        [...uniqueRefs.values()].map(async (ref) => {
          try {
            const node = await api.get!({ connectionId, ref })
            if (typeof node?.title === 'string' && node.title) {
              titles.set(`${ref.kind}:${ref.id}`, node.title)
            }
          } catch {
            /* row keeps its ref-id label */
          }
        }),
      )
    }

    const toRow = (entry: KnowledgeWorkEnvelope): NavigatorEnvelopeRow => {
      const title = titles.get(`${entry.knowledgeRef.kind}:${entry.knowledgeRef.id}`)
      return title === undefined ? { envelope: entry } : { envelope: entry, title }
    }
    return { recent: recentEnvelopes.map(toRow), favorites: favoriteEnvelopes.map(toRow) }
  })()

  const [notebooks, views, rows] = await Promise.all([notebooksPromise, viewsPromise, rowsPromise])
  return { notebooks, views, recent: rows.recent, favorites: rows.favorites }
}

/** Compact row label: resolved title, else the ref id (long SiYuan ids shorten to the suffix). */
export function navigatorRowLabel(row: NavigatorEnvelopeRow): string {
  if (row.title) return row.title
  const id = row.envelope.knowledgeRef.id
  const dash = id.indexOf('-')
  return dash > 0 && dash < id.length - 1 ? id.slice(dash + 1) : id
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function SectionHeader({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-foreground/80">
      <Icon className="size-3.5 shrink-0 text-foreground/50" aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  )
}

function EmptyRow({ children }: { children: string }) {
  return (
    <div className={cn('mx-3 mb-2 rounded-md px-2.5 py-2', 'bg-muted/40 text-[12px] leading-snug text-muted-foreground')}>
      {children}
    </div>
  )
}

function NavRow({
  icon: Icon,
  label,
  title,
  onClick,
}: {
  icon: LucideIcon
  label: string
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={cn(
        'mx-3 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-md px-2.5 py-1.5 text-left',
        'text-[12px] font-medium text-foreground/80',
        'hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      )}
    >
      <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

export function KnowledgeNotebookTree() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const [data, setData] = React.useState<KnowledgeNavigatorData | null>(null)

  React.useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI?.knowledge
    if (!api) return
    let cancelled = false
    void loadKnowledgeNavigatorData(api).then((result) => {
      if (!cancelled) setData(result)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return (
    <nav aria-label={t('knowledge.nav.title')} className="flex flex-col gap-0.5 py-1">
      <SectionHeader icon={Book} label={t('knowledge.nav.notebooks')} />
      {data === null ? (
        <EmptyRow>{t('knowledge.surface.loading')}</EmptyRow>
      ) : data.notebooks.status === 'unavailable' ? (
        <EmptyRow>{t('knowledge.nav.notebooksUnavailable')}</EmptyRow>
      ) : data.notebooks.status === 'empty' ? (
        <EmptyRow>{t('knowledge.nav.notebooksEmpty')}</EmptyRow>
      ) : (
        <NotebookList notebooks={data.notebooks.items} />
      )}

      <SectionHeader icon={Clock} label={t('knowledge.nav.recent')} />
      {data === null ? (
        <EmptyRow>{t('knowledge.surface.loading')}</EmptyRow>
      ) : data.recent.length === 0 ? (
        <EmptyRow>{t('knowledge.nav.sectionEmpty')}</EmptyRow>
      ) : (
        <div className="mb-2 flex flex-col gap-0.5">
          {data.recent.map((row) => (
            <NavRow
              key={`${row.envelope.knowledgeRef.kind}:${row.envelope.knowledgeRef.id}`}
              icon={Clock}
              label={navigatorRowLabel(row)}
              title={row.envelope.knowledgeRef.id}
              onClick={() =>
                navigate(routes.view.siyuan({ kind: row.envelope.knowledgeRef.kind, id: row.envelope.knowledgeRef.id }))
              }
            />
          ))}
        </div>
      )}

      <SectionHeader icon={Star} label={t('knowledge.nav.favorites')} />
      {data === null ? (
        <EmptyRow>{t('knowledge.surface.loading')}</EmptyRow>
      ) : data.favorites.length === 0 ? (
        <EmptyRow>{t('knowledge.nav.sectionEmpty')}</EmptyRow>
      ) : (
        <div className="mb-2 flex flex-col gap-0.5">
          {data.favorites.map((row) => (
            <NavRow
              key={`${row.envelope.knowledgeRef.kind}:${row.envelope.knowledgeRef.id}`}
              icon={Star}
              label={navigatorRowLabel(row)}
              title={row.envelope.knowledgeRef.id}
              onClick={() =>
                navigate(routes.view.siyuan({ kind: row.envelope.knowledgeRef.kind, id: row.envelope.knowledgeRef.id }))
              }
            />
          ))}
        </div>
      )}

      <SectionHeader icon={LayoutGrid} label={t('knowledge.nav.savedViews')} />
      {data === null ? (
        <EmptyRow>{t('knowledge.surface.loading')}</EmptyRow>
      ) : data.views.length === 0 ? (
        <EmptyRow>{t('knowledge.nav.sectionEmpty')}</EmptyRow>
      ) : (
        <div className="mb-2 flex flex-col gap-0.5">
          {data.views.map((view) => (
            <NavRow
              key={view.id}
              icon={LayoutGrid}
              label={view.name}
              title={view.description || view.name}
              onClick={() => navigate(routes.view.knowledgeView(view.id))}
            />
          ))}
        </div>
      )}
    </nav>
  )
}


function nodeIcon(kind: SiyuanDocTreeNode['kind']): LucideIcon {
  if (kind === 'database') return Database
  if (kind === 'folder') return Folder
  return FileText
}

function NotebookList({ notebooks }: { notebooks: KnowledgeNotebookInfo[] }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const [filter, setFilter] = React.useState<NavFilter>('all')
  const [expanded, setExpanded] = React.useState<Record<string, SiyuanDocTreeNode[] | 'loading' | 'error'>>({})
  const [lastNotebookId, setLastNotebookId] = React.useState<string | null>(null)
  const api = typeof window === 'undefined' ? undefined : window.electronAPI?.knowledge

  const connectionIdOf = async (): Promise<string | undefined> => {
    const connections = await api?.listConnections?.().catch(() => [])
    return connections?.[0]?.id
  }

  const targetNotebook = () =>
    notebooks.find((notebook) => notebook.id === lastNotebookId) ?? pickOpenNotebook(notebooks)

  const createInNavigator = async (op: 'document' | 'folder') => {
    const notebook = targetNotebook()
    const connectionId = await connectionIdOf()
    if (!notebook || !connectionId || typeof api?.userCreate !== 'function') return
    if (op === 'document') {
      const result = await api.userCreate(
        buildNewDocumentCreateArgs({
          connectionId,
          notebookId: notebook.id,
          title: t('knowledge.nav.newNote'),
        }),
      )
      if (result?.id) navigate(routes.view.siyuan({ kind: 'document', id: result.id }))
      return
    }
    await api.userCreate({
      connectionId,
      source: 'navigator',
      op: 'folder',
      notebookId: notebook.id,
      name: t('knowledge.nav.newFolder'),
    })
    if (expanded[notebook.id] && typeof api.listTree === 'function') {
      const tree = await api.listTree({ connectionId, notebookId: notebook.id }).catch(() => null)
      if (tree) setExpanded((prev) => ({ ...prev, [notebook.id]: tree.nodes }))
    }
  }

  const toggle = async (notebookId: string) => {
    if (expanded[notebookId]) {
      setExpanded((prev) => {
        const next = { ...prev }
        delete next[notebookId]
        return next
      })
      return
    }
    setLastNotebookId(notebookId)
    setExpanded((prev) => ({ ...prev, [notebookId]: 'loading' }))
    const connectionId = await connectionIdOf()
    if (!connectionId || typeof api?.listTree !== 'function') {
      setExpanded((prev) => ({ ...prev, [notebookId]: 'error' }))
      return
    }
    try {
      const tree = await api.listTree({ connectionId, notebookId })
      setExpanded((prev) => ({ ...prev, [notebookId]: tree.nodes }))
    } catch {
      setExpanded((prev) => ({ ...prev, [notebookId]: 'error' }))
    }
  }

  const loadFolderChildren = async (notebookId: string, folder: SiyuanDocTreeNode) => {
    const connectionId = await connectionIdOf()
    if (!connectionId || typeof api?.listTree !== 'function') return
    try {
      const tree = await api.listTree({ connectionId, notebookId, path: folder.path })
      setExpanded((prev) => {
        const current = prev[notebookId]
        if (!Array.isArray(current)) return prev
        return { ...prev, [notebookId]: mergeFolderChildren(current, folder.path, tree.nodes) }
      })
    } catch {
      /* keep existing children */
    }
  }

  const renderNodes = (notebookId: string, nodes: SiyuanDocTreeNode[], depth: number) =>
    filterTree(nodes, filter).map((node) => (
      <div key={node.id} style={{ paddingLeft: depth * 8 }} className="flex flex-col">
        <NavRow
          icon={nodeIcon(node.kind)}
          label={node.name || node.id}
          onClick={() => {
            if (node.kind === 'database') navigate(routes.view.siyuan({ kind: 'database', id: node.id }))
            else if (node.kind === 'document') navigate(routes.view.siyuan({ kind: 'document', id: node.id }))
            else if (node.kind === 'folder') void loadFolderChildren(notebookId, node)
          }}
        />
        {node.children && node.children.length > 0 ? renderNodes(notebookId, node.children, depth + 1) : null}
      </div>
    ))

  const filterLabel = (id: NavFilter) =>
    id === 'all'
      ? t('knowledge.nav.filterAll')
      : id === 'notes'
        ? t('knowledge.nav.filterNotes')
        : t('knowledge.nav.filterDatabases')

  return (
    <div className="mb-2 flex flex-col gap-0.5">
      <div className="mx-3 mb-1 flex gap-1 text-[11px] text-muted-foreground">
        {(['all', 'notes', 'databases'] as NavFilter[]).map((id) => (
          <button
            key={id}
            type="button"
            className={cn('rounded px-1.5 py-0.5', filter === id && 'bg-accent text-foreground')}
            onClick={() => setFilter(id)}
          >
            {filterLabel(id)}
          </button>
        ))}
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-accent" aria-label={t('knowledge.nav.newNote')} onClick={() => void createInNavigator('document')}>
          <FilePlus className="size-3" aria-hidden />
        </button>
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-accent" aria-label={t('knowledge.nav.newFolder')} onClick={() => void createInNavigator('folder')}>
          <FolderPlus className="size-3" aria-hidden />
        </button>
      </div>
      {notebooks.map((notebook) => (
        <div key={notebook.id}>
          <NavRow
            icon={Book}
            label={notebook.name || notebook.id}
            onClick={() => void toggle(notebook.id)}
          />
          {expanded[notebook.id] === 'loading' ? (
            <EmptyRow>…</EmptyRow>
          ) : Array.isArray(expanded[notebook.id]) ? (
            renderNodes(notebook.id, expanded[notebook.id] as SiyuanDocTreeNode[], 1)
          ) : null}
        </div>
      ))}
    </div>
  )
}
