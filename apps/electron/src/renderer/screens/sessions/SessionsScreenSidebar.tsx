import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Folder, MessageSquare, Search, SquarePen, Tag } from 'lucide-react'
import { useScreenSidebar, type ScreenSidebarConfig, type SidebarAction } from '@/components/shell/screen-sidebar'
import { REVEAL_CHAT_FOLDER_EVENT } from '@/components/app-shell/chat-folders/chat-folders-model'
import { useAppShellContext } from '@/context/AppShellContext'
import { isSessionsNavigation, routes, useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { useChatFolders } from '@/hooks/useChatFolders'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'
import type { SidebarTarget } from '../sidebar-section'
import { useSessionsSidebarSections } from './useSessionsSidebarSections'

const ICONS = { 'message-square': MessageSquare, folder: Folder, tag: Tag } as const

/** Publishes the Sessions second sidebar (renders nothing itself). */
export function SessionsScreenSidebar() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const { state: chatFolders } = useChatFolders(activeWorkspaceId ?? undefined)
  const sections = useSessionsSidebarSections(chatFolders)

  const onTarget = useCallback((target: SidebarTarget) => {
    switch (target.kind) {
      case 'session': navigate(routes.view.allSessions(target.sessionId)); break
      case 'label': navigate(routes.view.label(target.label)); break
      case 'folder':
        navigate(routes.view.allSessions())
        window.dispatchEvent(new CustomEvent(REVEAL_CHAT_FOLDER_EVENT, { detail: { folderId: target.folderId } }))
        break
      default: break
    }
  }, [navigate])

  const activeKey = isSessionsNavigation(navState) && navState.details ? `session:${navState.details.sessionId}` : null

  const config = useMemo<ScreenSidebarConfig>(() => {
    const newSession: SidebarAction = {
      id: 'new-session',
      label: t('screens.sessions.new'),
      icon: SquarePen,
      shortcut: '⌘N',
      onSelect: () => navigate(routes.action.newSession()),
    }
    const groups = toScreenSidebarGroups(sections, { t, icons: ICONS, onTarget, activeKey })
    return {
      screenId: 'sessions',
      title: t('screens.sessions.title'),
      headerActions: [
        { id: 'search', label: t('screens.sessions.search'), icon: Search, onSelect: () => navigate(routes.view.search()) },
        { id: 'archived', label: t('screens.sessions.archived'), icon: Archive, onSelect: () => navigate(routes.view.archived()) },
      ],
      primaryAction: newSession,
      groups: groups.length > 0
        ? groups
        : [{ id: 'empty', items: [], state: { kind: 'empty', label: t('screens.sessions.empty'), action: newSession } }],
    }
  }, [t, sections, onTarget, activeKey, navigate])

  useScreenSidebar(config)
  return null
}
