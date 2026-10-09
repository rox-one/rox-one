/**
 * SessionTypingIndicator — lightweight "…is typing" line rendered above the
 * composer (a2.4). Purely presentational; actors come from the live
 * `session_typing` event via `useSessionActivityState`.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionTypingActor } from '@rox/shared/protocol'

export interface SessionTypingIndicatorProps {
  actors: readonly SessionTypingActor[]
  className?: string
}

export function SessionTypingIndicator({ actors, className }: SessionTypingIndicatorProps) {
  const { t } = useTranslation()
  if (actors.length === 0) return null

  const names = actors.length === 1
    ? actors[0]!.displayName
    : actors.map(actor => actor.displayName).slice(0, 3).join(', ')

  return (
    <div
      className={className ?? 'px-4 pb-1 text-caption text-muted-foreground'}
      aria-live="polite"
      data-typing-count={actors.length}
    >
      {t('chat.typing', { count: actors.length, names })}
    </div>
  )
}