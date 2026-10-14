import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/AppShellContext'
import type { SidebarSection } from '../sidebar-section'
import { buildSessionsSidebarSections, type SessionsSidebarFolder } from './sessions-sidebar-sections'

/** Live second-sidebar groups for the Sessions screen (real session metadata + permission queue). */
export function useSessionsSidebarSections(folders?: readonly SessionsSidebarFolder[]): SidebarSection[] {
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const { pendingPermissions } = useAppShellContext()
  return useMemo(() => {
    const pendingIds = new Set<string>()
    for (const [id, queue] of pendingPermissions) if (queue.length > 0) pendingIds.add(id)
    return buildSessionsSidebarSections([...metaMap.values()], { pendingPermissionIds: pendingIds, folders })
  }, [metaMap, pendingPermissions, folders])
}
