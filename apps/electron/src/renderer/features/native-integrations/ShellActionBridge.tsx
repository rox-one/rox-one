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
 *   search         → open the unified command palette
 *   toggle-meeting-recording → start a meeting recording / stop the running one
 *   open-session   → open one session (deepLink.id)
 *   switch-workspace → switch this window to deepLink.workspaceId
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
import { useActionRegistry } from '@/actions'
import { isRecorderBusy, startRecording, stopRecording } from '@/lib/meetings/recorder'

/** Map a route family + optional id onto a typed route. */
function routeWithId(route: string, id?: string): Route {
  if (!id) return route as Route
  if (route === 'inbox') return routes.view.inbox(id)
  if (route === 'tasks') return routes.view.tasks(id)
  if (route === 'notes') return routes.view.notes(id)
  return route as Route
}

export function ShellActionBridge() {
  const { t, i18n } = useTranslation()
  const { execute } = useActionRegistry()

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

    const toggleMeetingRecording = async () => {
      try {
        if (isRecorderBusy()) {
          const stopped = await stopRecording()
          if (!stopped.ok) toast.error(t('nativeIntegrations.actionFailed'))
          return
        }
        const date = new Intl.DateTimeFormat(i18n.resolvedLanguage || 'ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(Date.now())
        const started = await startRecording({ title: t('meetings.local.defaultTitle', { date }), workspaceId: await currentWorkspace() })
        if (!started.ok) toast.error(t('nativeIntegrations.actionFailed'))
      } catch {
        toast.error(t('nativeIntegrations.actionFailed'))
      }
    }

    const switchWorkspace = async (workspaceId: string | undefined) => {
      if (!workspaceId) return
      if (workspaceId === await currentWorkspace()) return
      try {
        await window.electronAPI.switchWorkspace(workspaceId)
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
        case 'search':
          execute('app.omnibox')
          return
        case 'toggle-meeting-recording':
          void toggleMeetingRecording()
          return
        case 'open-session':
          if (event.deepLink?.id) navigate(routes.view.allSessions(event.deepLink.id))
          return
        case 'switch-workspace':
          void switchWorkspace(event.deepLink?.workspaceId)
          return
        default:
          return
      }
    }

    return api.onShellAction(handle)
  }, [t, i18n, execute])

  return null
}