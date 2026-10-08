import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { ArrowUpRight, FileText, Send, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAppShellContext, useSession } from '@/context/AppShellContext'
import { resolveStatusDisplayLabel } from '@/config/session-status-config'
import { navigate, routes } from '@/lib/navigate'
import { VoiceDictationControl } from './input/VoiceDictationControl'

/** Compact native-minimize surface; it stays in the existing renderer/session. */
export function MiniSessionSurface() {
  const { t } = useTranslation()
  const sessionId = useAtomValue(focusedSessionIdAtom)
  const context = useAppShellContext()
  const sessionMeta = useAtomValue(sessionMetaMapAtom)
  const session = sessionId ? sessionMeta.get(sessionId) : undefined
  const sessionDetails = useSession(sessionId ?? '')
  const statusConfig = session?.sessionStatus
    ? context.sessionStatuses?.find((candidate) => candidate.id === session.sessionStatus)
    : undefined
  const [draft, setDraft] = useState(() => sessionId ? context.getDraft(sessionId) : '')
  const [sending, setSending] = useState(false)
  const [creatingNote, setCreatingNote] = useState(false)

  useEffect(() => {
    setDraft(sessionId ? context.getDraft(sessionId) : '')
  }, [sessionId])

  const send = async () => {
    if (!sessionId || !draft.trim() || sending) return
    setSending(true)
    try {
      const attachments = await context.hydrateDraftAttachments(sessionId)
      context.onSendMessage(sessionId, draft, attachments)
      context.onInputChange(sessionId, '')
      context.onAttachmentsChange(sessionId, [])
      setDraft('')
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSending(false)
    }
  }

  const updateDraft = (value: string) => {
    setDraft(value)
    if (sessionId) context.onInputChange(sessionId, value)
  }

  const createNote = async () => {
    const workspaceId = session?.workspaceId ?? context.activeWorkspaceId
    if (!workspaceId || creatingNote) return
    setCreatingNote(true)
    try {
      const note = await window.electronAPI.createNote(workspaceId, t('notes.untitled'))
      if (draft.trim()) {
        const initial = note.content?.trimEnd() || `# ${t('notes.untitled')}`
        await window.electronAPI.saveNote(workspaceId, note.id, `${initial}\n\n${draft.trim()}\n`)
      }
      navigate(routes.view.notes(note.id))
      await window.electronAPI.exitMiniWindow()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('notes.editor.wikiCreateFailed'))
    } finally {
      setCreatingNote(false)
    }
  }

  return (
    <main className="h-screen w-screen overflow-hidden border border-border bg-background text-foreground shadow-strong" aria-label={t('window.mini.appTitle')}>
      <header className="flex h-10 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{session?.name || session?.preview || t('window.mini.appTitle')}</span>
        <span className="max-w-[45%] truncate text-xs text-muted-foreground" role="status" aria-live="polite" title={sessionDetails?.currentStatus?.message || undefined}>
          {sessionDetails?.currentStatus?.message || (session?.isProcessing
            ? t('window.mini.working')
            : statusConfig
              ? resolveStatusDisplayLabel(statusConfig, t)
              : t('window.mini.ready'))}
        </span>
        <button className="rounded p-1 hover:bg-muted" aria-label={t('window.mini.expand')} title={t('window.mini.expand')} onClick={() => void window.electronAPI.exitMiniWindow()}>
          <ArrowUpRight size={16} />
        </button>
      </header>
      <div className="flex h-[calc(100%-2.5rem)] items-center gap-2 px-3 py-2">
        {session?.isProcessing && sessionId ? (
          <button className="rounded-md border border-border p-2 hover:bg-muted" aria-label={t('window.mini.stop')} onClick={() => void window.electronAPI.cancelProcessing(sessionId, false)}>
            <Square size={15} />
          </button>
        ) : null}
        <VoiceDictationControl compactMode inputValue={draft} onInputChange={updateDraft} />
        <input
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          aria-label={t('window.mini.message')}
          placeholder={sessionId ? t('window.mini.continueSession') : t('window.mini.noActiveSession')}
          value={draft}
          disabled={!sessionId || sending}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <button className="rounded-md border border-border p-2 hover:bg-muted disabled:opacity-50" aria-label={t('window.mini.createNote')} title={t('window.mini.createNote')} disabled={creatingNote || (!session?.workspaceId && !context.activeWorkspaceId)} onClick={() => void createNote()}>
          <FileText size={15} />
        </button>
        <button className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-50" aria-label={t('window.mini.send')} disabled={!sessionId || !draft.trim() || sending} onClick={() => void send()}>
          <Send size={15} />
        </button>
      </div>
    </main>
  )
}
