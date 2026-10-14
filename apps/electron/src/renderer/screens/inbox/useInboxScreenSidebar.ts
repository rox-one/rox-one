import { useCallback, useMemo, useRef } from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { BellRing, CheckCheck, Clock3, Folder, Inbox, Mail, RefreshCw, ShieldCheck, SquarePen, type LucideIcon } from 'lucide-react'
import { useScreenSidebar, type ScreenSidebarConfig, type SidebarGroup } from '@/components/shell/screen-sidebar'
import { inboxPinnedFiltersAtom } from '@/atoms/inbox'
import { FOLDER_ICONS, KIND_ICONS, type InboxPageFilter } from '@/pages/inbox/InboxSidebar'
import type { InboxFilter } from '@/pages/inbox/inbox-model'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'
import type { SidebarTarget } from '../sidebar-section'
import { buildInboxSidebarSections, inboxFilterId, togglePinnedFilter, type InboxSidebarCountsInput, type InboxSidebarMailFolder, type InboxViewId } from './inbox-sidebar-sections'

export interface InboxScreenSidebarInput {
  counts: InboxSidebarCountsInput
  kinds: readonly string[]
  mailFolders: readonly InboxSidebarMailFolder[]
  filter: InboxPageFilter
  onFilter(filter: InboxFilter): void
  onMailFolder(folderId: string): void
  query: string
  onQuery(value: string): void
  /** null when mail is not ready (no compose). */
  onCompose: (() => void) | null
  onRefresh(): void
  loading: boolean
  /** Translated error to show instead of the sources group. */
  error: string | null
}

const BASE_ICONS: Record<string, LucideIcon> = { inbox: Inbox, 'shield-check': ShieldCheck, bell: BellRing, clock: Clock3, 'check-check': CheckCheck }

function iconMap(): Record<string, LucideIcon> {
  const m: Record<string, LucideIcon> = { ...BASE_ICONS, 'mail:folder': Folder }
  for (const [k, v] of Object.entries(KIND_ICONS)) m[`kind:${k}`] = v
  for (const [k, v] of Object.entries(FOLDER_ICONS)) m[`mail:${k}`] = v
  m['kind:mail'] = Mail
  return m
}
const ICONS = iconMap()

/** Publishes the Входящие second sidebar from the queue's live state. */
export function useInboxScreenSidebar(input: InboxScreenSidebarInput): void {
  const { t } = useTranslation()
  const [pinned, setPinned] = useAtom(inboxPinnedFiltersAtom)
  const { counts, kinds, mailFolders, filter, query, loading, error } = input
  // Latest-callback ref: the queue passes fresh closures each render; reading
  // them through a ref keeps the published config stable (no shell re-render
  // per queue render).
  const latest = useRef(input)
  latest.current = input
  const canCompose = input.onCompose !== null
  const onFilter = useCallback((f: InboxFilter) => latest.current.onFilter(f), [])
  const onMailFolder = useCallback((id: string) => latest.current.onMailFolder(id), [])
  const onQuery = useCallback((v: string) => latest.current.onQuery(v), [])
  const onRefresh = useCallback(() => latest.current.onRefresh(), [])
  const onCompose = useCallback(() => latest.current.onCompose?.(), [])

  const sections = useMemo(() => buildInboxSidebarSections({ counts, kinds, mailFolders, pinned }), [counts, kinds, mailFolders, pinned])

  const onTarget = useCallback((target: SidebarTarget) => {
    if (target.kind !== 'filter') return
    const [type, ...rest] = target.filterId.split(':')
    const value = rest.join(':')
    if (type === 'view') onFilter(value as InboxViewId)
    else if (type === 'kind') onFilter({ kind: value } as InboxFilter)
    else if (type === 'mail') onMailFolder(value)
  }, [onFilter, onMailFolder])

  const onMenu = useCallback((target: SidebarTarget, actionId: string) => {
    if (target.kind !== 'filter') return
    setPinned((prev) => togglePinnedFilter(prev, target.filterId, actionId === 'pin'))
  }, [setPinned])

  const activeKey = `filter:${inboxFilterId(filter as never)}`

  const config = useMemo<ScreenSidebarConfig>(() => {
    const groups: SidebarGroup[] = toScreenSidebarGroups(sections, { t, icons: ICONS, onTarget, onMenu, activeKey })
      // Pinned rows mirror a source: mark them active too.
      .map((g) => g.id === 'pinned' ? { ...g, items: g.items.map((i) => ({ ...i, active: `filter:${i.id.slice(4)}` === activeKey })) } : g)
    if (loading && !groups.some((g) => g.id === 'sources')) groups.push({ id: 'sources', title: t('screens.inbox.groups.sources'), items: [], state: { kind: 'loading' } })
    if (error) groups.push({ id: 'sources-error', title: t('screens.inbox.groups.sources'), items: [], state: { kind: 'error', label: error, onRetry: onRefresh } })
    return {
      screenId: 'inbox',
      title: t('inbox.title'),
      headerActions: [{ id: 'refresh', label: t('screens.inbox.refresh'), icon: RefreshCw, onSelect: onRefresh }],
      ...(canCompose ? { primaryAction: { id: 'compose', label: t('screens.inbox.compose'), icon: SquarePen, onSelect: onCompose } } : {}),
      search: { placeholder: t('screens.inbox.search'), value: query, onChange: onQuery },
      groups,
    }
  }, [sections, t, onTarget, onMenu, activeKey, loading, error, onRefresh, onCompose, canCompose, query, onQuery])

  useScreenSidebar(config)
}
