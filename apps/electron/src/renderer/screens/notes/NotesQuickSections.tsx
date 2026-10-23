import { memo, useCallback, useMemo } from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { SidebarSection } from '@/components/shell/SidebarSection'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'
import type { SidebarTarget } from '../sidebar-section'
import {
  buildNotesSidebarSections,
  dropPinnedNotes,
  dropRecentOpenedNotes,
  rekeyPinnedNotes,
  rekeyRecentOpenedNotes,
  togglePinnedNote,
  type NotesSidebarNote,
} from './notes-sidebar-sections'
import { notesPinnedByWorkspaceAtom } from './notes-pins'
import { notesRecentOpenedByWorkspaceAtom } from './notes-recents'
import { touchRecentOpened } from '@/pages/notes/note-library'

const ICONS = { 'file-text': FileText } as const
const NONE: string[] = []

/** Pinned / move a note's pin — shared by the quick sections and the tree's context menu. */
export function useNotePins(workspaceId: string | null | undefined) {
  const [byWs, setByWs] = useAtom(notesPinnedByWorkspaceAtom)
  const pinned = (workspaceId && byWs[workspaceId]) || NONE
  const toggle = useCallback((noteId: string) => {
    if (!workspaceId) return
    setByWs((prev) => ({ ...prev, [workspaceId]: togglePinnedNote(prev[workspaceId] ?? [], noteId) }))
  }, [setByWs, workspaceId])
  const rekey = useCallback((from: string, to: string, folder = false) => {
    if (!workspaceId) return
    setByWs((prev) => {
      const cur = prev[workspaceId] ?? []
      const next = rekeyPinnedNotes(cur, from, to, folder)
      return next === cur ? prev : { ...prev, [workspaceId]: next }
    })
  }, [setByWs, workspaceId])
  const drop = useCallback((target: string, folder = false) => {
    if (!workspaceId) return
    setByWs((prev) => {
      const cur = prev[workspaceId] ?? []
      const next = dropPinnedNotes(cur, target, folder)
      return next === cur ? prev : { ...prev, [workspaceId]: next }
    })
  }, [setByWs, workspaceId])
  return { pinned, toggle, rekey, drop }
}

/** Most-recently-opened ids — drives «Недавнее» when present. */
export function useNoteRecents(workspaceId: string | null | undefined) {
  const [byWs, setByWs] = useAtom(notesRecentOpenedByWorkspaceAtom)
  const opened = (workspaceId && byWs[workspaceId]) || NONE
  const touch = useCallback((noteId: string) => {
    if (!workspaceId) return
    setByWs((prev) => {
      const cur = prev[workspaceId] ?? []
      const next = touchRecentOpened(cur, noteId)
      if (next.length === cur.length && next.every((item, index) => item === cur[index])) return prev
      return { ...prev, [workspaceId]: next }
    })
  }, [setByWs, workspaceId])
  const rekey = useCallback((from: string, to: string, folder = false) => {
    if (!workspaceId) return
    setByWs((prev) => {
      const cur = prev[workspaceId] ?? []
      const next = rekeyRecentOpenedNotes(cur, from, to, folder)
      return next === cur ? prev : { ...prev, [workspaceId]: next }
    })
  }, [setByWs, workspaceId])
  const drop = useCallback((target: string, folder = false) => {
    if (!workspaceId) return
    setByWs((prev) => {
      const cur = prev[workspaceId] ?? []
      const next = dropRecentOpenedNotes(cur, target, folder)
      return next === cur ? prev : { ...prev, [workspaceId]: next }
    })
  }, [setByWs, workspaceId])
  return { opened, touch, rekey, drop }
}

/** «Закреплённое» + «Недавнее» above the Notes folder tree (shell SidebarSection markup). */
export const NotesQuickSections = memo(function NotesQuickSections({ notes, activeNoteId, pinned, opened, onTogglePin, onOpenNote }: {
  notes: readonly NotesSidebarNote[]
  activeNoteId: string | null | undefined
  pinned: readonly string[]
  opened?: readonly string[]
  onTogglePin(noteId: string): void
  onOpenNote(noteId: string): void
}) {
  const { t } = useTranslation()
  const sections = useMemo(() => buildNotesSidebarSections(notes, pinned, opened ?? NONE), [notes, pinned, opened])
  const onTarget = useCallback((target: SidebarTarget) => { if (target.kind === 'note') onOpenNote(target.path) }, [onOpenNote])
  const onMenu = useCallback((target: SidebarTarget) => { if (target.kind === 'note') onTogglePin(target.path) }, [onTogglePin])
  const groups = useMemo(
    () => toScreenSidebarGroups(sections, { t, icons: ICONS, onTarget, onMenu, activeKey: activeNoteId ? `note:${activeNoteId}` : null }),
    [sections, t, onTarget, onMenu, activeNoteId],
  )
  if (groups.length === 0) return null
  return (
    <div className="shrink-0 px-1 pb-1" data-notes-quick-sections="">
      {groups.map((g) => <SidebarSection key={g.id} screenId="docs" group={g} mode="expanded" />)}
    </div>
  )
})
