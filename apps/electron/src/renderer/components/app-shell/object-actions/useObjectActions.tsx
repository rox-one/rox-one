import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ListPlus } from 'lucide-react'
import type { ResponseExtraAction } from '@rox/ui/chat'
import { toast } from 'sonner'
import { useAppShellContext } from '@/context/AppShellContext'
import { createPersonalTaskConfirmed } from '@/lib/extra-screens/personal-task-bridge'
import { navigate, routes } from '@/lib/navigate'
import { MessageObjectChips } from './MessageObjectChips'
import { delegationPromptFor, extractMessageObjects, taskDraftFromAnswer, type MessageObject } from './message-objects'

interface SessionLike { id: string; name?: string | null; workspaceId?: string | null }

/**
 * Chat wiring for #21 (object chips + «Создать задачу» from an answer) and
 * #22 («Поручить агенту»: a new todo session whose composer is prefilled with
 * the object/answer; the user confirms and sends).
 */
export function useObjectActions(session: SessionLike | null | undefined) {
  const { t } = useTranslation()
  const shell = useAppShellContext()
  const busy = React.useRef(false)
  const sessionRef = React.useRef(session)
  sessionRef.current = session

  // «Поручить агенту» never starts a run by itself: it opens a new todo session
  // with the prompt prefilled in the composer so the user reviews and sends it.
  const delegate = React.useCallback(async (title: string, prompt: string) => {
    const workspaceId = sessionRef.current?.workspaceId ?? shell.activeWorkspaceId
    if (!workspaceId || busy.current) return
    busy.current = true
    let createdId: string | null = null
    try {
      const created = await shell.onCreateSession(workspaceId, { sessionStatus: 'todo' })
      createdId = created.id
      await window.electronAPI.sessionCommand(created.id, { type: 'rename', name: title })
      shell.onInputChange(created.id, prompt)
      navigate(routes.view.allSessions(created.id))
      toast.success(t('chat.objects.delegateDraftReady'))
    } catch {
      // Don't leave an empty orphan session behind on a partial failure.
      if (createdId) await shell.onDeleteSession(createdId, true).catch(() => false)
      toast.error(t('chat.objects.delegateFailed'))
    } finally {
      busy.current = false
    }
  }, [shell, t])

  const delegateObject = React.useCallback((object: MessageObject) => {
    void delegate(object.label ?? object.ref, delegationPromptFor(object, t('chat.objects.promptHeading')))
  }, [delegate, t])

  const responseActions = React.useMemo<ResponseExtraAction[]>(() => [
    {
      id: 'create-task',
      label: t('chat.objects.createTask'),
      icon: <ListPlus />,
      onSelect: (text) => {
        const s = sessionRef.current
        const draft = taskDraftFromAnswer(text, s ? { id: s.id, name: s.name } : null, t('chat.objects.taskFallbackTitle'))
        createPersonalTaskConfirmed(draft).then(
          (task) => toast.success(t('chat.objects.taskCreated'), { action: { label: t('chat.objects.open'), onClick: () => navigate(routes.view.tasks(task.id)) } }),
          () => toast.error(t('chat.objects.taskFailed')),
        )
      },
    },
    {
      id: 'delegate',
      label: t('chat.objects.delegateShort'),
      icon: <Bot />,
      onSelect: (text) => {
        const draft = taskDraftFromAnswer(text, null, t('chat.objects.taskFallbackTitle'))
        void delegate(draft.title, delegationPromptFor(null, t('chat.objects.promptHeading'), text))
      },
    },
  ], [delegate, t])

  const workspaceId = session?.workspaceId ?? shell.activeWorkspaceId
  const renderResponseFooter = React.useCallback((text: string) => {
    const objects = extractMessageObjects(text)
    return objects.length ? <MessageObjectChips objects={objects} workspaceId={workspaceId} onDelegate={delegateObject} /> : null
  }, [delegateObject, workspaceId])

  return { responseActions, renderResponseFooter }
}
