/**
 * Shell action bridge — listens for `shell:action` events pushed by main
 * (menu / tray / global shortcuts) and turns them into navigation or entity
 * creation in the running app:
 *
 *   quick-composer → open the standalone composer window
 *   open-inbox     → navigate to the inbox (optional item id)
 *   new-note       → create a note and open it
 *   new-task       → create a personal task and open it
 *   navigate       → deep-link navigation (route + optional id/workspace)
 *
 * Rendered once inside the ready app tree; context-free so it can live next to
 * the other window-level bridges.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { navigate, routes, type Route } from '@/lib/navigate'
import { createPersonalTaskConfirmed } from '@/lib/extra-screens/personal-task-bridge'
import { nativeIntegrations, type ShellActionPayload } from '@/platform/native-integrations'

/** Map a route family + optional id onto a typed route. */
function routeWithId(route: string, id?: string): Route {
  if (!id) return route as Route
  if (route === 'inbox') return routes.view.inbox(id)
  if (route === 'tasks') return routes.view.tasks(id)
  if (route === 'notes') return routes.view.notes(id)
  return route as Route
}

export function ShellActionBridge() {
  const { t } = useTranslation()

  React.useEffect(() => {
    const api = nativeIntegrations()
    if (!api.onShellAction) return

    const currentWorkspace = async (): Promise<string | null> => {
      try {
        return await window.electronAPI.getWindowWorkspace()
      } catch {
        return null
      }
    }

    const navigateDeepLink = async (deepLink: ShellActionPayload['deepLink']) => {
      if (!deepLink) {
        navigate(routes.view.inbox())
        return
      }
      const current = await currentWorkspace()
      if (deepLink.workspaceId && current && deepLink.workspaceId !== current) {
        try {
          await window.electronAPI.switchWorkspace(deepLink.workspaceId)
        } catch { /* navigation below still targets the current window */ }
      }
      navigate(routeWithId(deepLink.route ?? 'inbox', deepLink.id))
    }

    const createNoteAndOpen = async () => {
      const workspaceId = await currentWorkspace()
      if (!workspaceId) {
        toast.error(t('nativeIntegrations.actionFailed'))
        return
      }
      try {
        const note = await window.electronAPI.createNote(workspaceId, t('notes.untitled'))
        navigate(routes.view.notes(note.id))
      } catch {
        toast.error(t('nativeIntegrations.actionFailed'))
      }
    }

    const createTaskAndOpen = async () => {
      try {
        const task = await createPersonalTaskConfirmed({ title: t('quickComposer.untitledTask'), list: 'inbox' })
        navigate(routes.view.tasks(task.id))
      } catch {
        toast.error(t('nativeIntegrations.actionFailed'))
      }
    }

    const handle = (event: ShellActionPayload) => {
      switch (event.action) {
        case 'quick-composer':
          void api.quickComposer?.open?.()
          return
        case 'open-inbox':
          navigate(routes.view.inbox(event.deepLink?.id))
          return
        case 'new-note':
          void createNoteAndOpen()
          return
        case 'new-task':
          void createTaskAndOpen()
          return
        case 'navigate':
          void navigateDeepLink(event.deepLink)
          return
        default:
          return
      }
    }

    return api.onShellAction(handle)
  }, [t])

  return null
}