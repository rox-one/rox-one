import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Folder, MessageSquare, Search, SquarePen, Tag } from 'lucide-react'
import { useScreenSidebar, type ScreenSidebarConfig, type SidebarAction } from '@/components/shell/screen-sidebar'
import { requestRevealChatFolder } from '@/components/app-shell/chat-folders/chat-folders-model'
import { useAppShellContext } from '@/context/AppShellContext'
import { isSessionsNavigation, routes, useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { useChatFolders } from '@/hooks/useChatFolders'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'
import type { SidebarTarget } from '../sidebar-section'
import { useSessionsSidebarSections } from './useSessionsSidebarSections'
import { useSideSession } from '@/hooks/useSideSession'
import { defaultShareProvider } from '@/lib/session-share-provider'
import { copySessionLink, presentSessionLink } from '@/lib/session-sharing'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useStore } from 'jotai'
import { toast } from 'sonner'

const ICONS = { 'message-square': MessageSquare, folder: Folder, tag: Tag } as const

/** Publishes the Sessions second sidebar (renders nothing itself). */
export function SessionsScreenSidebar() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const { state: chatFolders, error: chatFoldersError, retry: retryChatFolders } = useChatFolders(activeWorkspaceId ?? undefined)
  const sections = useSessionsSidebarSections(chatFolders)

  const onTarget = useCallback((target: SidebarTarget) => {
    switch (target.kind) {
      case 'session': navigate(routes.view.allSessions(target.sessionId)); break
      case 'label': navigate(routes.view.label(target.label)); break
      case 'folder':
        requestRevealChatFolder(target.folderId)
        navigate(routes.view.allSessions())
        break
      default: break
    }
  }, [navigate])

  const openSide = useSideSession()
  const store = useStore()
  const onMenu = useCallback((target: SidebarTarget, actionId: string) => {
    if (target.kind !== 'session') return
    const id = target.sessionId
    if (actionId === 'open-side') { void openSide({ sessionId: id }); return }
    const write = (text: string) => navigator.clipboard.writeText(text)
    if (actionId === 'copy-link') {
      const url = store.get(sessionMetaMapAtom).get(id)?.sharedUrl
      if (url) void copySessionLink(url, write).then((copied) => presentSessionLink({ kind: 'share', url, copied }))
      return
    }
    const provider = defaultShareProvider()
    if (!provider) { toast.error(t('sessionShare.unavailable')); return }
    if (actionId === 'share') {
      void provider.create(id)
        .then(async (link) => presentSessionLink({ kind: 'share', url: link.url, expiresAt: link.expiresAt, copied: await copySessionLink(link.url, write) }))
        .catch(() => toast.error(t('toast.failedToShare')))
    } else if (actionId === 'stop-sharing') {
      void provider.revoke(id)
        .then(() => toast.success(t('sessionShare.stopped')))
        .catch(() => toast.error(t('sessionShare.stopFailed')))
    }
  }, [openSide, store, t])

  const activeKey = isSessionsNavigation(navState) && navState.details ? `session:${navState.details.sessionId}` : null

  const config = useMemo<ScreenSidebarConfig>(() => {
    const newSession: SidebarAction = {
      id: 'new-session',
      label: t('screens.sessions.new'),
      icon: SquarePen,
      shortcut: '⌘N',
      onSelect: () => navigate(routes.action.newSession()),
    }
    const groups = toScreenSidebarGroups(sections, { t, icons: ICONS, onTarget, onMenu, activeKey })
    if (chatFoldersError && !groups.some((g) => g.id === 'folders')) {
      const at = groups.findIndex((g) => g.id === 'recent' || g.id === 'labels')
      groups.splice(at < 0 ? groups.length : at, 0, {
        id: 'folders',
        title: t('screens.sessions.groups.folders'),
        items: [],
        state: { kind: 'error', label: t('screens.sessions.foldersError'), onRetry: retryChatFolders },
      })
    }
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
  }, [t, sections, onTarget, onMenu, activeKey, navigate, chatFoldersError, retryChatFolders])

  useScreenSidebar(config)
  return null
}
