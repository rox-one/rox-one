import { useCallback } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { sideSessionByWorkspaceAtom } from '@/atoms/side-session'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { openOrFocusPanelRouteAtom } from '@/atoms/panel-stack'
import { useAppShellContext } from '@/context/AppShellContext'
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
 * Open the workspace's side session in a panel next to whatever screen is
 * current; creates (and remembers) one when there is none.
 */
export function useSideSession() {
  const { t } = useTranslation()
  const { activeWorkspaceId, onCreateSession } = useAppShellContext()
  const metas = useAtomValue(sessionMetaMapAtom)
  const [byWs, setByWs] = useAtom(sideSessionByWorkspaceAtom)
  const openOrFocus = useSetAtom(openOrFocusPanelRouteAtom)

  return useCallback(async (opts?: { fresh?: boolean; sessionId?: string }) => {
    if (!activeWorkspaceId) return
    let id = opts?.sessionId ?? (opts?.fresh ? null : usableSideSession(byWs[activeWorkspaceId], metas))
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
  }, [activeWorkspaceId, byWs, metas, onCreateSession, openOrFocus, setByWs, t])
}
