import { useCallback } from 'react'
import { useAtom, useSetAtom, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { sideSessionByWorkspaceAtom } from '@/atoms/side-session'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { openOrFocusPanelRouteAtom } from '@/atoms/panel-stack'
import type { AppShellContextType } from '@/context/AppShellContext'
import { routes } from '@/lib/navigate'

/** Pure: which remembered side session is still usable. */
export function usableSideSession(
  remembered: string | undefined,
  metas: ReadonlyMap<string, { isArchived?: boolean; hidden?: boolean }>,
): string | null {
  if (!remembered) return null
  const meta = metas.get(remembered)
  return meta && !meta.isArchived && !meta.hidden ? remembered : null
}

/**
 * The shell values this hook acts through. They arrive as an argument instead
 * of through `useAppShellContext()` because React reads context at the CALL
 * SITE: the shell's own `AppShellContent` renders the `AppShellProvider` in its
 * return value, so a hook it calls in its own body cannot see that provider.
 */
export type SideSessionScope = Pick<AppShellContextType, 'activeWorkspaceId' | 'onCreateSession'>

/**
 * Open the workspace's side session in a panel next to whatever screen is
 * current; creates (and remembers) one when there is none.
 */
export function useSideSession({ activeWorkspaceId, onCreateSession }: SideSessionScope) {
  const { t } = useTranslation()
  // Read metas at call time: no re-render on every streaming meta tick.
  const store = useStore()
  const [byWs, setByWs] = useAtom(sideSessionByWorkspaceAtom)
  const openOrFocus = useSetAtom(openOrFocusPanelRouteAtom)

  return useCallback(async (opts?: { fresh?: boolean; sessionId?: string }) => {
    if (!activeWorkspaceId) return
    const metas = store.get(sessionMetaMapAtom)
    const remembered = byWs[activeWorkspaceId]
    // Metas not loaded yet (startup): trust the remembered id instead of creating a duplicate.
    let id = opts?.sessionId ?? (opts?.fresh ? null : metas.size === 0 && remembered ? remembered : usableSideSession(remembered, metas))
    try {
      if (!id) {
        const session = await onCreateSession(activeWorkspaceId, { name: t('sideSession.defaultName') })
        id = session.id
      }
      setByWs((prev) => ({ ...prev, [activeWorkspaceId]: id! }))
      openOrFocus({ route: routes.view.allSessions(id) })
    } catch (error) {
      toast.error(t('sideSession.openFailed'), { description: error instanceof Error ? error.message : undefined })
    }
  }, [activeWorkspaceId, byWs, store, onCreateSession, openOrFocus, setByWs, t])
}
