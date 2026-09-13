/**
 * Right-side session chrome: left working surface stays mounted; this shell
 * takes focus when a contextual session opens.
 */
import * as React from 'react'
import { FileText, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Rox2Context } from '@craft-agent/core/rox2'
import { Button } from '@/components/ui/button'
import {
  RIGHT_SESSION_PROMPT_TEST_ID,
  RIGHT_SESSION_SHELL_TEST_ID,
} from './right-session-shell'

export type RightSessionChip = {
  id: string
  title: string
  detail?: string
}

export function RightSessionShell({
  context,
  prompt,
  onPromptChange,
  onSend,
  onClose,
  chips,
  focusToken,
}: {
  context: Rox2Context
  prompt: string
  onPromptChange: (value: string) => void
  onSend: () => void
  onClose: () => void
  chips?: readonly RightSessionChip[]
  focusToken?: number
}) {
  const { t } = useTranslation()
  const promptRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    promptRef.current?.focus()
  }, [context.sessionId, focusToken])

  return (
    <aside
      className="w-[380px] shrink-0 border-l border-border/60 bg-muted/[0.10] flex flex-col min-h-0"
      data-testid={RIGHT_SESSION_SHELL_TEST_ID}
      data-session-id={context.sessionId}
      data-surface-id={context.surfaceId}
      tabIndex={-1}
    >
      <div className="h-[42px] shrink-0 border-b border-border/60 px-3 flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{t('notes.sideSession.title')}</div>
        <button
          type="button"
          className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
          onClick={onClose}
          title={t('notes.sideSession.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
        {chips?.map((chip) => (
          <div
            key={chip.id}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px]"
          >
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{chip.title}</span>
            {chip.detail ? <span className="truncate text-muted-foreground">{chip.detail}</span> : null}
          </div>
        ))}
        <div className="text-[11px] text-muted-foreground">{t('notes.sideSession.hint')}</div>
      </div>
      <div className="flex-1 min-h-0 px-3 pb-3 flex flex-col gap-2">
        <textarea
          ref={promptRef}
          data-testid={RIGHT_SESSION_PROMPT_TEST_ID}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          className="min-h-0 flex-1 w-full resize-none rounded-[8px] border border-border/60 bg-background p-2.5 text-xs leading-relaxed outline-none focus:border-foreground/30"
          placeholder={t('notes.sideSession.promptPlaceholder')}
        />
        <div className="flex items-center justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('notes.sideSession.cancel')}
          </Button>
          <Button size="sm" onClick={onSend} disabled={!prompt.trim()}>
            {t('notes.sideSession.send')}
          </Button>
        </div>
      </div>
    </aside>
  )
}
