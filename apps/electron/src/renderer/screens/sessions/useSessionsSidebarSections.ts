import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { flattenLabels, extractLabelId } from '@rox/shared/labels'
import type { ChatFoldersState } from '@rox/shared/chat-folders'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/AppShellContext'
import { effectiveFolderAssignments } from '@/components/app-shell/chat-folders/chat-folders-model'
import type { SidebarSection } from '../sidebar-section'
import { buildSessionsSidebarSections } from './sessions-sidebar-sections'
import { projectSessionsSidebarInput, sameSessionsProjection } from './sessions-projection'

const sessionsSidebarProjectionAtom = selectAtom(
  sessionMetaMapAtom,
  (map) => projectSessionsSidebarInput(map.values()),
  sameSessionsProjection,
)

/**
 * Live second-sidebar groups for the Sessions screen: session metadata,
 * permission queue, chat folders and label config. All inputs are stable
 * store/context references, so the memo only recomputes on real changes.
 */
export function useSessionsSidebarSections(chatFolders: ChatFoldersState): SidebarSection[] {
  const projection = useAtomValue(sessionsSidebarProjectionAtom)
  const { pendingPermissions, labels } = useAppShellContext()
  const labelNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of flattenLabels(labels ?? [])) m.set(l.id, l.name)
    return m
  }, [labels])
  return useMemo(() => {
    const pendingIds = new Set<string>()
    for (const [id, queue] of pendingPermissions) if (queue.length > 0) pendingIds.add(id)
    return buildSessionsSidebarSections(projection, {
      pendingPermissionIds: pendingIds,
      folders: chatFolders.folders,
      folderAssignments: effectiveFolderAssignments(chatFolders),
      labelIdOf: extractLabelId,
      labelNameOf: (id) => labelNames.get(id) ?? id,
    })
  }, [projection, pendingPermissions, chatFolders, labelNames])
}
