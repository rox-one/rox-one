import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { FreeFormInput } from '@/components/app-shell/input'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { readAgentRun } from '@/lib/extra-screens/agent-run'
import { toErrorMessage } from '@/lib/errors'
import type { FileAttachment } from '../../../../shared/types'

export interface AskQuestionComposerProps {
  workspaceId: string
  /** Workspace project the repo belongs to; the session is bound to it (D11). */
  projectId: string
  projectSlug: string
  repoLabel: string
  /** The repo answered with at least one generated tour, so «Показать на экранах» can run. */
  canShowOnScreens: boolean
  onShowOnScreens: (answer: string) => void
}

type Phase = 'idle' | 'sending' | 'waiting' | 'ready' | 'error'

/** Poll interval and total wait for one repo-bound answer. */
const POLL_INTERVAL_MS = 1000
const POLL_ATTEMPTS = 180

/**
 * D11 «свой вопрос»: the standard ROX composer (model/connection picker +
 * attachments) whose question goes into an ordinary session bound to the repo
 * project — visible in Sessions, continuable, tools available. No second chat
 * engine: `createSession` + `sendMessage` is the same seam the chat and the
 * extra-screen agent runs use.
 */
export function AskQuestionComposer({ workspaceId, projectId, projectSlug, repoLabel, canShowOnScreens, onShowOnScreens }: AskQuestionComposerProps) {
  const { t } = useTranslation()
  const appShell = useOptionalAppShellContext()
  const navigate = useNavigation()
  const runtimeSummary = appShell?.runtimeSummary ?? null
  const [model, setModel] = useState('')
  const [connection, setConnection] = useState('')
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [answer, setAnswer] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const cancelled = useRef(false)

  useEffect(() => () => { cancelled.current = true }, [])

  const sessionLabel = `devspace-ask:${projectSlug}`

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId
    const sessions = await window.electronAPI.getSessions()
    const existing = sessions.find((session) => session.labels?.includes(sessionLabel))
    if (existing) { setSessionId(existing.id); return existing.id }
    const created = await window.electronAPI.createSession(workspaceId, {
      name: t('devSpace.ask.sessionName', { repo: repoLabel }),
      permissionMode: 'ask',
      projectId,
      labels: [sessionLabel],
      ...(model ? { model } : {}),
      ...(connection ? { llmConnection: connection } : {}),
    })
    setSessionId(created.id)
    return created.id
  }, [sessionId, sessionLabel, workspaceId, t, repoLabel, projectId, model, connection])

  const awaitAnswer = useCallback(async (id: string, baselineText: string | null, baselineAt: number | null, attempt: number): Promise<void> => {
    const snapshot = await readAgentRun(id)
    if (cancelled.current) return
    // A reused repo session already has an older final message; only a strictly
    // newer one (different text or later timestamp) is this question's answer.
    const fresh = snapshot.text !== baselineText || (snapshot.updatedAt ?? 0) > (baselineAt ?? 0)
    if (snapshot.text && !snapshot.processing && fresh) { setAnswer(snapshot.text); setPhase('ready'); return }
    if (attempt >= POLL_ATTEMPTS) { setPhase('error'); setErrorMessage(t('devSpace.ask.noAnswer')); return }
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, POLL_INTERVAL_MS)
    await promise
    if (!cancelled.current) await awaitAnswer(id, baselineText, baselineAt, attempt + 1)
  }, [t])

  const submit = useCallback(async (message: string, files?: FileAttachment[]) => {
    if (!message.trim() || phase === 'sending' || phase === 'waiting') return
    setPhase('sending'); setErrorMessage(null); setAnswer(null)
    try {
      const id = await ensureSession()
      const baseline = await readAgentRun(id)
      await window.electronAPI.sendMessage(id, message, files?.length ? files : undefined)
      setText(''); setAttachments([])
      setPhase('waiting')
      await awaitAnswer(id, baseline.text, baseline.updatedAt, 0)
    } catch (error) {
      setPhase('error')
      setErrorMessage(toErrorMessage(error))
    }
  }, [phase, ensureSession, awaitAnswer])

  const connected = !!runtimeSummary
  const busy = phase === 'sending' || phase === 'waiting'

  return (
    <section className="space-y-3 border-t border-border-subtle pt-4" aria-labelledby="dev-space-ask-title" data-testid="dev-space-ask">
      <h3 id="dev-space-ask-title" className="text-sm font-semibold">{t('devSpace.ask.title')}</h3>
      {!connected ? <p className="text-sm text-muted-foreground" role="status" data-testid="dev-space-ask-offline">{t('devSpace.ask.offline')}</p> : null}
      <FreeFormInput
        onSubmit={(message, files) => void submit(message, files)}
        currentModel={model || runtimeSummary?.defaultModel || ''}
        onModelChange={(nextModel, nextConnection) => { setModel(nextModel); if (nextConnection) setConnection(nextConnection) }}
        currentConnection={connection || runtimeSummary?.slug}
        onConnectionChange={setConnection}
        inputValue={text}
        onInputChange={setText}
        attachmentsValue={attachments}
        onAttachmentsChange={setAttachments}
        placeholder={t('devSpace.ask.placeholder')}
        disabled={busy || !connected}
        isProcessing={phase === 'waiting'}
        sessionId={sessionId ?? undefined}
        workspaceId={workspaceId}
      />
      {busy ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite" data-testid="dev-space-ask-progress">
          <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden />{t('devSpace.ask.thinking')}
        </p>
      ) : null}
      {errorMessage ? <p className="text-sm text-destructive" role="alert" data-testid="dev-space-ask-error">{errorMessage}</p> : null}
      {answer ? (
        <div className="space-y-2 rounded-[var(--radius-card)] border border-border-subtle p-3" data-testid="dev-space-ask-answer">
          <div className="dev-space-markdown text-sm"><Markdown mode="full">{answer}</Markdown></div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!canShowOnScreens} title={canShowOnScreens ? undefined : t('devSpace.ask.noTours')} onClick={() => onShowOnScreens(answer)} data-testid="dev-space-ask-show-on-screens">
              {t('devSpace.ask.showOnScreens')}
            </Button>
            {sessionId ? <Button type="button" size="sm" variant="ghost" onClick={() => navigate.navigateToSession(sessionId)} data-testid="dev-space-ask-open-session">{t('devSpace.ask.openSession')}</Button> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}