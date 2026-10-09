/**
 * G5 «Инлайн-одобрения» — credential request deck for the chat continuum.
 *
 * Kit chrome (header + footer) wrapped around the *existing*
 * `CredentialRequest` rendered in `unstyled` mode, so every input mode
 * (bearer / basic / header / query / multi-header), the validation rules and
 * the password-manager wiring are reused verbatim. Only the outer deck is
 * restyled here; the inner form keeps the legacy styling for now (see NOTES).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Key } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CredentialRequest } from '../input/structured/CredentialRequest'
import type {
  CredentialRequest as CredentialRequestType,
  CredentialResponse,
} from '../../../../shared/types'

export interface InlineCredentialCardProps {
  request: CredentialRequestType
  onResponse: (r: CredentialResponse) => void
  disabled?: boolean
}

/** Flat mono chip used for the source / mode metadata in the deck header. */
function InlineChip({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-[var(--radius-xs)] border border-border-subtle bg-surface-input px-1.5 py-0.5 font-mono text-caption text-text-secondary">
      {children}
    </code>
  )
}

export function InlineCredentialCard({
  request,
  onResponse,
  disabled = false,
}: InlineCredentialCardProps) {
  const { t } = useTranslation()
  const headingId = React.useId()

  return (
    <section
      data-g05-credential={disabled ? 'disabled' : 'ready'}
      aria-labelledby={headingId}
      aria-disabled={disabled || undefined}
      className={cn(
        'my-3 w-full overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated',
        'motion-safe:transition-[opacity,transform] motion-safe:duration-[var(--motion-base)] motion-reduce:transition-none',
        disabled && 'opacity-45',
      )}
    >
      <header className="flex items-start gap-2.5 px-3 pt-3">
        <span aria-hidden className="mt-px shrink-0 text-text-secondary">
          <Key className="icon-toolbar" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={headingId} className="text-body font-medium text-text-primary">
              {t('auth.authenticationRequired', { defaultValue: 'Требуется вход' })}
            </h3>
            <InlineChip>{request.sourceName}</InlineChip>
            <InlineChip>{request.mode}</InlineChip>
          </div>
          {request.description && (
            <p className="mt-1 max-w-[62ch] text-small text-text-secondary">{request.description}</p>
          )}
        </div>
      </header>

      {/* Existing structured form, unstyled. `disabled` is enforced on the deck
          because CredentialRequest has no disabled prop of its own. */}
      <div className={cn('min-h-0', disabled && 'pointer-events-none')}>
        <CredentialRequest request={request} onResponse={onResponse} unstyled />
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-2">
        {request.sourceUrl ? (
          <span className="text-caption text-text-secondary">
            {t('chat.approval.scopeLabel', { defaultValue: 'Область' })}:{' '}
            <span className="font-mono">{request.sourceUrl}</span>
          </span>
        ) : (
          <span className="text-caption text-text-secondary">{t('chat.credentialsEncrypted')}</span>
        )}
      </footer>
    </section>
  )
}