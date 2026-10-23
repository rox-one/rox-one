import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, FilePlus2, FileText, FolderPlus, Hash, Tags } from 'lucide-react'
import { useScreenSidebar, type ScreenSidebarConfig, type SidebarGroup } from '@/components/shell/screen-sidebar'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'
import type { SidebarTarget } from '../sidebar-section'
import { usePortalSlot } from '../content-slot'
import { buildNotesSidebarSections, type NotesSidebarNote } from './notes-sidebar-sections'

const ICONS = { 'file-text': FileText } as const

export interface NotesScreenSidebarInput {
  /** Publish only while this surface owns the shell sidebar. */
  enabled: boolean
  title: string
  query: string
  onQuery(value: string): void
  onDaily(): void
  onNewFolder(): void
  onNewNote(): void
  tags: readonly string[]
  selectedTag: string | null
  onTag(tag: string | null): void
  notes: readonly NotesSidebarNote[]
  pinned: readonly string[]
  onTogglePin(noteId: string): void
  onOpenNote(noteId: string): void
  activeNoteId: string | null | undefined
}

export interface NotesScreenSidebarSlots {
  /** Outlet nodes for the folder tree (group content) and the footer; portal into them. */
  treeTarget: HTMLElement | null
  footerTarget: HTMLElement | null
}

/**
 * Заметки second sidebar through the shared ScreenSidebar mechanism:
 * search, daily / new folder / new note, Теги, «Закреплённое», «Недавнее» and
 * the folder tree (content slot) — so collapse / icons mode applies.
 */
export function useNotesScreenSidebar(input: NotesScreenSidebarInput): NotesScreenSidebarSlots {
  const { t } = useTranslation()
  const latest = React.useRef(input)
  latest.current = input
  const { enabled, title, query, tags, selectedTag, notes, pinned, activeNoteId } = input
  const [treeSlot, treeTarget] = usePortalSlot()
  const [footerSlot, footerTarget] = usePortalSlot()

  const sections = React.useMemo(() => buildNotesSidebarSections(notes, pinned), [notes, pinned])
  const onTarget = React.useCallback((target: SidebarTarget) => {
    if (target.kind === 'note') latest.current.onOpenNote(target.path)
    else if (target.kind === 'label') latest.current.onTag(target.label || null)
  }, [])
  const onMenu = React.useCallback((target: SidebarTarget) => { if (target.kind === 'note') latest.current.onTogglePin(target.path) }, [])
  const onQuery = React.useCallback((v: string) => latest.current.onQuery(v), [])
  const tagsKey = tags.join('\u0000')

  const config = React.useMemo<ScreenSidebarConfig | null>(() => {
    if (!enabled) return null
    const quick = toScreenSidebarGroups(sections, { t, icons: ICONS, onTarget, onMenu, activeKey: activeNoteId ? `note:${activeNoteId}` : null })
    const tagList = tagsKey ? tagsKey.split('\u0000') : []
    const tagGroup: SidebarGroup[] = tagList.length === 0 ? [] : [{
      id: 'tags',
      title: t('notes.inspector.tags'),
      collapsible: true,
      initialVisible: 8,
      items: [
        { id: 'tag:*', label: t('notes.tags.all'), icon: Tags, ariaKind: 'pressed', active: !selectedTag, onSelect: () => onTarget({ kind: 'label', label: '' }) },
        ...tagList.map((tag) => ({ id: `tag:${tag}`, label: `#${tag}`, icon: Hash, ariaKind: 'pressed' as const, active: selectedTag === tag, onSelect: () => onTarget({ kind: 'label', label: selectedTag === tag ? '' : tag }) })),
      ],
    }]
    return {
      screenId: 'docs',
      title,
      headerActions: [
        { id: 'daily', label: t('notes.toolbar.daily'), icon: CalendarDays, onSelect: () => latest.current.onDaily() },
        { id: 'new-folder', label: t('notes.toolbar.newFolder'), icon: FolderPlus, onSelect: () => latest.current.onNewFolder() },
      ],
      primaryAction: { id: 'new-note', label: t('notes.toolbar.newNote'), icon: FilePlus2, onSelect: () => latest.current.onNewNote() },
      search: { placeholder: t('notes.search.placeholder'), value: query, onChange: onQuery },
      groups: [...quick, ...tagGroup, { id: 'tree', title: t('screens.notes.groups.folders'), items: [], collapsible: true, content: <treeSlot.Outlet /> }],
      footer: <footerSlot.Outlet />,
    }
  }, [enabled, sections, t, onTarget, onMenu, activeNoteId, tagsKey, selectedTag, title, query, onQuery, treeSlot, footerSlot])

  useScreenSidebar(config)
  return { treeTarget: enabled ? treeTarget : null, footerTarget: enabled ? footerTarget : null }
}
