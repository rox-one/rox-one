/**
 * Telegram account-linking dialog.
 *
 * Standalone: the wizard (or any host) mounts it and injects the link-service
 * client + an `openExternal` seam; with no client the dialog falls back to the
 * Electron bridge, and states an honest "unavailable" when neither exists.
 *
 * Flow: «Открыть Telegram» → deep link via `openExternal` → waiting → the bot
 * issues an 8-char code → manual entry with auto-verify on the 8th character
 * and a 30-minute countdown → confirmed (green, fires `onLinked`) or expired
 * (start again).
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { TelegramLinkClient } from '@rox/shared/telegram-link/client'
import { useTelegramLink } from './useTelegramLink'

export interface TelegramLinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired once when the pairing is confirmed. */
  onLinked?: () => void
  /** Link-service client; omit to use the Electron bridge. */
  client?: TelegramLinkClient
  /** Account id sent to `/api/link/start`. */
  accountId?: string
  /** Opens the Telegram deep link (shell.openExternal). */
  openExternal?: (url: string) => void | Promise<void>
  /** Poll cadence while waiting for the code. */
  pollMs?: number
  /** Countdown tick cadence. */
  tickMs?: number
  /** Clock seam. */
  now?: () => number
  className?: string
}

const CODE_LENGTH = 8

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function TelegramLinkDialog({
  open,
  onOpenChange,
  onLinked,
  client,
  accountId,
  openExternal,
  pollMs,
  tickMs,
  now,
  className,
}: TelegramLinkDialogProps) {
  const { t } = useTranslation()
  const { status, start, submitCode, remainingMs, error, deliveredCode, phoneMasked } = useTelegramLink({
    open,
    client,
    accountId,
    openExternal,
    onLinked,
    pollMs,
    tickMs,
    now,
  })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  // Pre-fill the manual field when the service auto-returns the code.
  useEffect(() => {
    if (status === 'code' && deliveredCode) setCode(deliveredCode)
  }, [status, deliveredCode])

  useEffect(() => {
    if (open) return
    setCode('')
    setBusy(false)
  }, [open])

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }, [])

  // Auto-verify on the 8th character (owner spec: «автопроверка»).
  const handleCodeChange = useCallback(
    (value: string) => {
      const next = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
      setCode(next)
      if (next.length === CODE_LENGTH) void run(() => submitCode(next))
    },
    [run, submitCode],
  )

  const countdown = formatCountdown(remainingMs)
  const invalidCode = error === 'invalid_code'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-md', className)} data-testid="telegram-link-dialog">
        <DialogHeader>
          <DialogTitle>{t('onboarding.telegram.title')}</DialogTitle>
          <DialogDescription>{t('onboarding.telegram.description')}</DialogDescription>
        </DialogHeader>

        {status === 'idle' && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>{t('onboarding.telegram.idleHint')}</p>
            <Button data-testid="telegram-link-open" disabled={busy} onClick={() => void run(start)}>
              {busy ? <Loader2 className="icon-toolbar animate-spin" /> : <ExternalLink className="icon-toolbar" />}
              {t('onboarding.telegram.open')}
            </Button>
          </div>
        )}

        {status === 'waiting' && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>{t('onboarding.telegram.waitingHint')}</p>
            <p className="font-medium text-foreground">
              {t('onboarding.telegram.remaining')}{' '}
              <span data-testid="telegram-link-countdown">{countdown}</span>
            </p>
            <Button
              variant="outline"
              data-testid="telegram-link-reopen"
              disabled={busy}
              onClick={() => void run(start)}
            >
              <ExternalLink className="icon-toolbar" />
              {t('onboarding.telegram.reopen')}
            </Button>
          </div>
        )}

        {status === 'code' && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="telegram-link-code">{t('onboarding.telegram.codeLabel')}</Label>
              <Input
                id="telegram-link-code"
                data-testid="telegram-link-code"
                value={code}
                onChange={(event) => handleCodeChange(event.target.value)}
                placeholder={t('onboarding.telegram.codePlaceholder')}
                autoComplete="one-time-code"
                inputMode="text"
                maxLength={CODE_LENGTH}
                aria-invalid={invalidCode}
                disabled={busy}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('onboarding.telegram.codeHint')}</p>
            {phoneMasked ? (
              <p className="text-xs text-muted-foreground">
                {t('onboarding.telegram.codeSentTo', { phone: phoneMasked })}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {t('onboarding.telegram.remaining')}{' '}
              <span data-testid="telegram-link-countdown">{countdown}</span>
            </p>
            <Button
              data-testid="telegram-link-submit"
              disabled={busy || code.length !== CODE_LENGTH}
              onClick={() => void run(() => submitCode(code))}
            >
              {busy ? <Loader2 className="icon-toolbar animate-spin" /> : null}
              {t('onboarding.telegram.verify')}
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-destructive" data-testid="telegram-link-error">
                {error === 'invalid_code'
                  ? t('onboarding.telegram.invalidCode')
                  : t('onboarding.telegram.checkFailed')}
              </p>
            ) : null}
          </div>
        )}

        {status === 'confirmed' && (
          <div className="flex items-start gap-3 text-sm" data-testid="telegram-link-confirmed">
            <CheckCircle2 className="mt-0.5 icon-rail shrink-0 text-success" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium text-success">
                {t('onboarding.telegram.confirmedTitle')}
              </p>
              <p className="text-muted-foreground">{t('onboarding.telegram.confirmedHint')}</p>
            </div>
          </div>
        )}

        {status === 'expired' && (
          <div className="space-y-3 text-sm" data-testid="telegram-link-expired">
            <p className="font-medium text-foreground">{t('onboarding.telegram.expiredTitle')}</p>
            <p className="text-muted-foreground">{t('onboarding.telegram.expiredHint')}</p>
            <Button data-testid="telegram-link-restart" disabled={busy} onClick={() => void run(start)}>
              {busy ? <Loader2 className="icon-toolbar animate-spin" /> : <ExternalLink className="icon-toolbar" />}
              {t('onboarding.telegram.restart')}
            </Button>
          </div>
        )}

        {status === 'unavailable' && (
          <div className="space-y-3 text-sm" data-testid="telegram-link-unavailable">
            <p className="font-medium text-foreground">{t('onboarding.telegram.unavailableTitle')}</p>
            <p className="text-muted-foreground">{t('onboarding.telegram.unavailableHint')}</p>
            <Button variant="outline" data-testid="telegram-link-retry" disabled={busy} onClick={() => void run(start)}>
              {t('onboarding.telegram.retry')}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('onboarding.telegram.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}