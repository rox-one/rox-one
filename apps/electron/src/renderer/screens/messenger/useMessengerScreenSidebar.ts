import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { useTranslation } from 'react-i18next'
import { Hash, MessageCircle, MessagesSquare, Plug, Settings } from 'lucide-react'
import { useScreenSidebar, type ScreenSidebarConfig, type SidebarGroup } from '@/components/shell/screen-sidebar'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/AppShellContext'
import { routes, useNavigation } from '@/contexts/NavigationContext'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'
import type { SidebarTarget } from '../sidebar-section'
import { buildMessengerSidebarSections, projectMessengerSessions, sameMessengerSessions, type MessengerBindingInput } from './messenger-sidebar-sections'

const messengerSessionsAtom = selectAtom(sessionMetaMapAtom, (map) => projectMessengerSessions(map.values()), sameMessengerSessions)

const PLATFORMS = ['telegram', 'whatsapp', 'lark', 'discord', 'wechat'] as const
const ICONS = Object.fromEntries([...PLATFORMS.map((p) => [`platform:${p}`, MessageCircle]), ['hash', Hash]])

type LoadState = { kind: 'loading' } | { kind: 'ready'; bindings: MessengerBindingInput[] } | { kind: 'error' }

/** Messaging bindings for the active workspace, following live changes. */
function useMessagingBindings(workspaceId: string | null): [LoadState, () => void] {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    const api = window.electronAPI
    if (!workspaceId || typeof api?.getMessagingBindings !== 'function') { setState({ kind: 'ready', bindings: [] }); return }
    let cancelled = false
    const load = () => {
      api.getMessagingBindings().then(
        (rows) => { if (!cancelled) setState({ kind: 'ready', bindings: rows as MessengerBindingInput[] }) },
        () => { if (!cancelled) setState({ kind: 'error' }) },
      )
    }
    setState({ kind: 'loading' })
    load()
    const off = api.onMessagingBindingChanged?.((wsId: string) => { if (wsId === workspaceId) load() })
    return () => { cancelled = true; off?.() }
  }, [workspaceId, nonce])
  const retry = useCallback(() => setNonce((n) => n + 1), [])
  return [state, retry]
}

/** Publishes the Мессенджер second sidebar: chats bound to Rox sessions. */
export function useMessengerScreenSidebar(): void {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const { navigate } = useNavigation()
  const projected = useAtomValue(messengerSessionsAtom)
  const sessionsById = useMemo(() => new Map(projected.map((s) => [s.id, s])), [projected])
  const [load, retry] = useMessagingBindings(activeWorkspaceId)

  const sections = useMemo(
    () => (load.kind === 'ready' ? buildMessengerSidebarSections(load.bindings, sessionsById) : []),
    [load, sessionsById],
  )
  const onTarget = useCallback((target: SidebarTarget) => {
    if (target.kind === 'session') navigate(routes.view.allSessions(target.sessionId))
  }, [navigate])

  const config = useMemo<ScreenSidebarConfig>(() => {
    const connect = { id: 'connect', label: t('screens.messenger.connect'), icon: Plug, onSelect: () => navigate(routes.view.settings('messaging')) }
    let groups: SidebarGroup[] = toScreenSidebarGroups(sections, { t, icons: ICONS, onTarget })
    if (load.kind === 'loading') groups = [{ id: 'chats', title: t('screens.messenger.groups.chats'), items: [], state: { kind: 'loading' } }]
    else if (load.kind === 'error') groups = [{ id: 'chats', title: t('screens.messenger.groups.chats'), items: [], state: { kind: 'error', label: t('screens.messenger.loadError'), onRetry: retry } }]
    else if (groups.length === 0) groups = [{ id: 'empty', items: [], state: { kind: 'empty', label: t('screens.messenger.empty'), action: connect } }]
    return {
      screenId: 'messenger',
      title: t('workbench.mode.messenger'),
      headerActions: [{ id: 'settings', label: t('screens.messenger.settings'), icon: Settings, onSelect: () => navigate(routes.view.settings('messaging')) }],
      primaryAction: { ...connect, icon: MessagesSquare },
      groups,
    }
  }, [t, sections, onTarget, load.kind, retry, navigate])

  useScreenSidebar(config)
}
