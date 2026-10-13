/**
 * G5 «Инлайн-одобрения» — permission request rendered inline in the turn it
 * belongs to (chat continuum). Port of the `G5ApprovalCard` prototype from
 * `archive/rox-ui-prototypes-g05/.../proto/g05-kit.tsx` onto the real
 * `PermissionRequestType` contract and the Rox token layer.
 *
 * The visual state machine is five-valued (pending/allowed/denied/error/
 * disabled) while the public `state` prop only carries the three externally
 * driven states — `allowed`/`denied` are committed locally the moment a
 * decision is made (optimistic), so the card can crossfade its footer while
 * the continuum confirms. `error` always wins over a local decision.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ShieldAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PermissionRequest as PermissionRequestType } from '../../../../shared/types'
import type { PermissionResponse } from '../input/structured/types'

/** Externally driven state accepted by {@link InlineApprovalCard}. */
export type InlineApprovalInputState = 'pending' | 'disabled' | 'error'

/** Full visual state, including the two locally committed decision states. */
export type InlineApprovalState = 'pending' | 'allowed' | 'denied' | 'error' | 'disabled'

export interface InlineApprovalCardProps {
  request: PermissionRequestType
  onResponse: (r: PermissionResponse) => void
  state?: InlineApprovalInputState
  errorText?: string
}

/**
 * `PermissionRequestType` has no scope fields today; the continuum may attach
 * them at runtime, so they are read defensively and degrade to just the tool
 * name when absent.
 */
type ScopedPermissionRequest = PermissionRequestType & {
  scopeLabel?: string
  scopeValue?: string
}

/** Caption-sized keyboard hint chip (port of `G5Kbd`). */
function InlineKbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[var(--radius-xs)] border border-border-subtle bg-surface-elevated px-1 font-mono text-caption text-text-secondary">
      {children}
    </kbd>
  )
}

/** Flat status badge (port of the status-tone path of `G5Badge`). */
function InlineBadge({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'danger'
  children: React.ReactNode
}) {
  const toneClass = {
    success: 'text-[var(--success-text)]',
    warning: 'text-[var(--info-text)]',
    danger: 'text-[var(--destructive-text)]',
  }[tone]

  return (
    <span
      data-g05-badge={tone}
      className={cn('inline-flex items-center gap-1.5 text-caption whitespace-nowrap', toneClass)}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  )
}

export function InlineApprovalCard({
  request,
  onResponse,
  state = 'pending',
  errorText,
}: InlineApprovalCardProps) {
  const { t } = useTranslation()
  const headingId = React.useId()
  const [decision, setDecision] = React.useState<'allowed' | 'denied' | null>(null)

  const view: InlineApprovalState = state === 'error' ? 'error' : decision ?? state
  const decided = view === 'allowed' || view === 'denied'
  const blocked = view === 'disabled'

  const decide = React.useCallback(
    (next: 'allowed' | 'denied', response: PermissionResponse) => {
      setDecision(next)
      onResponse(response)
    },
    [onResponse],
  )

  const allow = React.useCallback(
    () => decide('allowed', { type: 'permission', allowed: true, alwaysAllow: false }),
    [decide],
  )
  const alwaysAllow = React.useCallback(
    () => decide('allowed', { type: 'permission', allowed: true, alwaysAllow: true }),
    [decide],
  )
  const deny = React.useCallback(
    () => decide('denied', { type: 'permission', allowed: false, alwaysAllow: false }),
    [decide],
  )

  // Cmd/Ctrl+Enter activates the primary «Разрешить» decision from anywhere
  // inside the card, matching the hint printed on the button.
  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !decided && !blocked) {
        event.preventDefault()
        allow()
      }
    },
    [allow, blocked, decided],
  )

  const scoped = request as ScopedPermissionRequest
  const scopeValue = scoped.scopeValue
  const scopeLabel =
    scoped.scopeLabel ?? t('chat.approval.scopeLabel', { defaultValue: 'Область' })

  const title =
    view === 'allowed'
      ? t('chat.approval.allowedTitle', { defaultValue: 'Разрешено' })
      : view === 'denied'
        ? t('chat.approval.deniedTitle', { defaultValue: 'Запрещено' })
        : t('chat.approval.title', { defaultValue: 'Нужно разрешение' })

  return (
    <section
      data-g05-approval={view}
      aria-labelledby={headingId}
      onKeyDown={handleKeyDown}
      className={cn(
        'my-3 w-full overflow-hidden rounded-[var(--radius-card)] border bg-surface-elevated',
        view === 'error' ? 'border-status-danger/60' : 'border-border-subtle',
        'motion-safe:transition-[opacity,transform] motion-safe:duration-[var(--motion-base)] motion-reduce:transition-none',
        blocked && 'opacity-45',
      )}
    >
      <div className="flex items-start gap-2.5 px-3 pt-3">
        <span
          aria-hidden
          className={cn(
            'mt-px shrink-0',
            view === 'allowed' && 'text-status-success',
            view === 'denied' && 'text-text-muted',
            view === 'error' && 'text-status-danger',
            view === 'pending' && 'text-status-warning',
            view === 'disabled' && 'text-text-muted',
          )}
        >
          {view === 'allowed' ? (
            <Check className="icon-toolbar" />
          ) : view === 'denied' ? (
            <X className="icon-toolbar" />
          ) : (
            <ShieldAlert className="icon-toolbar" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={headingId} className="text-body font-medium text-text-primary">
              {title}
            </h3>
            <code className="rounded-[var(--radius-xs)] border border-border-subtle bg-surface-input px-1.5 py-0.5 font-mono text-caption text-text-secondary">
              {request.toolName}
            </code>
            {view === 'pending' && (
              <InlineBadge tone="warning">
                {t('chat.approval.pending', { defaultValue: 'ожидает решения' })}
              </InlineBadge>
            )}
            {view === 'allowed' && (
              <InlineBadge tone="success">
                {t('chat.approval.running', { defaultValue: 'выполняется' })}
              </InlineBadge>
            )}
            {view === 'error' && (
              <InlineBadge tone="danger">
                {t('chat.approval.error', { defaultValue: 'ошибка решения' })}
              </InlineBadge>
            )}
          </div>
          <p className="mt-1 max-w-[62ch] text-small text-text-secondary">{request.description}</p>
        </div>
      </div>

      {request.command && (
        <div className="px-3 pt-2.5">
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] bg-surface-input px-3 py-2 font-mono text-caption leading-[var(--text-body-leading)] text-text-primary">
            {request.command}
          </pre>
        </div>
      )}

      {errorText && (
        <p className="px-3 pt-2 text-caption text-[var(--destructive-text)]" role="alert">
          {errorText}
        </p>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-2 motion-safe:transition-opacity motion-safe:duration-[var(--motion-base)] motion-reduce:transition-none">
        {decided ? (
          <span className="text-caption text-text-secondary">
            {view === 'allowed'
              ? t('chat.approval.logAllowed', {
                  defaultValue: 'Запись в журнал сессии: разрешение выдано',
                })
              : t('chat.approval.logDenied', {
                  defaultValue: 'Запись в журнал сессии: запрос отклонён',
                })}
          </span>
        ) : (
          <>
            <Button
              size="sm"
              data-focus-order={10}
              disabled={blocked}
              onClick={allow}
            >
              {t('chat.allow')} <InlineKbd>⌘↵</InlineKbd>
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-focus-order={11}
              disabled={blocked}
              onClick={alwaysAllow}
            >
              {t('chat.alwaysAllow')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-focus-order={12}
              disabled={blocked}
              onClick={deny}
              className="text-[var(--destructive-text)] hover:text-[var(--destructive-text)]"
            >
              {t('chat.deny')}
            </Button>
            {scopeValue && (
              <>
                <span className="flex-1" />
                <span className="text-caption text-text-secondary">
                  {scopeLabel}: <span className="font-mono">{scopeValue}</span>
                </span>
              </>
            )}
          </>
        )}
      </footer>
    </section>
  )
}