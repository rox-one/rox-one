import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { FOCUS_RING, HOVER_TINT } from '@rox/ui/primitives'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui/tooltip'
import { EntityChip } from '@/components/entities/EntityChip'
import { cn } from '@/lib/utils'
import type { MessageObject } from './message-objects'

export interface MessageObjectChipsProps {
  objects: readonly MessageObject[]
  workspaceId?: string | null
  /** «Поручить агенту» for one object; hidden when absent. */
  onDelegate?: (object: MessageObject) => void
}

/** Objects referenced by an answer (#21), each with a «Поручить агенту» action (#22). */
export function MessageObjectChips({ objects, workspaceId, onDelegate }: MessageObjectChipsProps) {
  const { t } = useTranslation()
  if (objects.length === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label={t('chat.objects.label')} data-testid="message-object-chips">
      {objects.map((object) => (
        <li key={object.ref} className="inline-flex items-center gap-0.5">
          <EntityChip entityRef={object.ref} label={object.label ?? undefined} workspaceId={workspaceId} />
          {onDelegate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn('inline-flex min-h-[var(--control-hit-min)] min-w-[var(--control-hit-min)] items-center justify-center rounded-[var(--radius-card)] text-muted-foreground hover:text-foreground', HOVER_TINT, FOCUS_RING)}
                  aria-label={t('chat.objects.delegate', { name: object.label ?? object.ref })}
                  onClick={() => onDelegate(object)}
                >
                  <Bot className="icon-caption" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('chat.objects.delegateShort')}</TooltipContent>
            </Tooltip>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
