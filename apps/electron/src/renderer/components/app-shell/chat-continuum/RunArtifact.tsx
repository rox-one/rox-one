/**
 * Run artifact: a tool invocation rendered as a first-class object inside the
 * turn — command, live status and captured output. Uses the real tool input
 * (`command`) and the real tool result (`output`); nothing is synthesised.
 */
import * as React from 'react'
import { Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ActivityStatus } from '@rox/ui'
import { ArtifactShell } from './ArtifactShell'
import { type ContinuumTone } from './primitives'

export interface RunArtifactProps {
  /** Human command line, e.g. the Bash `command` input. */
  command: string
  /** Captured output; may be empty while running. */
  output?: string
  status: ActivityStatus
  /** Optional label override for the artifact title. */
  title?: string
}

export function runArtifactTone(status: ActivityStatus): ContinuumTone {
  switch (status) {
    case 'completed':
      return 'success'
    case 'error':
      return 'danger'
    case 'running':
    case 'backgrounded':
      return 'running'
    default:
      return 'neutral'
  }
}

export function RunArtifact({ command, output, status, title }: RunArtifactProps) {
  const { t } = useTranslation()
  const headingId = React.useId()
  const tone = runArtifactTone(status)
  const statusLabel = {
    completed: t('chat.continuum.run.statusDone', { defaultValue: 'завершено' }),
    error: t('chat.continuum.run.statusError', { defaultValue: 'ошибка' }),
    running: t('chat.continuum.run.statusRunning', { defaultValue: 'выполняется' }),
    backgrounded: t('chat.continuum.run.statusBackground', { defaultValue: 'в фоне' }),
    pending: t('chat.continuum.run.statusPending', { defaultValue: 'ожидает' }),
  }[status]

  return (
    <ArtifactShell
      labelledBy={headingId}
      icon={<Terminal className="icon-toolbar" />}
      title={title ?? t('chat.continuum.run.title', { defaultValue: 'Запуск' })}
      status={statusLabel}
      statusTone={tone}
    >
      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all border-b border-border-subtle px-3 py-2 font-mono text-caption leading-[var(--text-body-leading)] text-text-primary">
        <span aria-hidden className="mr-1.5 select-none text-text-muted">
          $
        </span>
        {command}
      </pre>
      {output && output.trim().length > 0 && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-caption leading-[var(--text-body-leading)] text-text-secondary">
          {output}
        </pre>
      )}
    </ArtifactShell>
  )
}