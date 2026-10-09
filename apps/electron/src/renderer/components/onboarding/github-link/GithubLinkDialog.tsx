/**
 * GitHub account-linking dialog («Привязать GitHub»).
 *
 * Standalone: the onboarding host mounts it and injects the link client +
 * workspace id + an `openExternal` seam; with no client the dialog falls back
 * to the Electron bridge and states an honest "unavailable" when neither
 * exists. The device-flow token never reaches this component — the client only
 * ever returns the public code and, once linked, the profile.
 *
 * Flow: «Открыть GitHub» → verification page via `openExternal` → waiting
 * (user code + copy + re-open, polled on the device-flow interval) → linked
 * (green, avatar/login, fires `onLinked` once) or expired/unavailable (retry).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { GithubLinkClient, GithubLinkProfile } from '@rox/shared/identity'
import { useGithubLink } from './useGithubLink'

export interface GithubLinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired once when the profile is linked. */
  onLinked?: (profile: GithubLinkProfile) => void
  /** Link client; omit to use the Electron bridge. */
  client?: GithubLinkClient
  /** Workspace the link is scoped to. */
  workspaceId?: string
  /** Opens the verification page (shell.openExternal). */
  openExternal?: (url: string) => void | Promise<void>
  /** Fallback poll cadence; the flow's interval wins when present. */
  pollMs?: number
  /** Clock seam. */
  now?: () => number
  className?: string
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function GithubLinkDialog({
  open,
  onOpenChange,
  onLinked,
  client,
  workspaceId,
  openExternal,
  pollMs,
  now,
  className,
}: GithubLinkDialogProps) {
  const { t } = useTranslation()
  const { status, start, reopen, profile, userCode, remainingMs, error } = useGithubLink({
    open,
    client,
    workspaceId,
    openExternal,
    onLinked,
    ...(pollMs !== undefined ? { pollMs } : {}),
    ...(now !== undefined ? { now } : {}),
  })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])

  useEffect(() => {
    if (status !== 'waiting') setCopied(false)
  }, [status])

  const copyCode = useCallback(async () => {
    if (!userCode) return
    try {
      await navigator.clipboard?.writeText(userCode)
      setCopied(true)
    } catch {
      // Clipboard access is optional; the code stays visible for manual typing.
    }
  }, [userCode])

  const countdown = useMemo(() => (remainingMs > 0 ? formatCountdown(remainingMs) : null), [remainingMs])
  const failure = error && status !== 'unavailable' ? t('onboarding.github.errorHint') : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-md', className)} data-testid="github-link-dialog">
        <DialogHeader>
          <DialogTitle>{t('onboarding.github.title')}</DialogTitle>
          <DialogDescription>{t('onboarding.github.description')}</DialogDescription>
        </DialogHeader>

        {status === 'idle' && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>{t('onboarding.github.idleHint')}</p>
            <Button data-testid="github-link-open" onClick={() => void start()}>
              <ExternalLink className="icon-toolbar" />
              {t('onboarding.github.open')}
            </Button>
          </div>
        )}

        {status === 'waiting' && (
          <div className="space-y-3 text-sm text-muted-foreground" data-testid="github-link-waiting">
            <p>{t('onboarding.github.waitingHint')}</p>
            <div className="flex items-center gap-2">
              <code
                data-testid="github-link-usercode"
                className="rounded-md border border-border-subtle bg-background/50 px-3 py-1.5 font-mono text-base tracking-widest text-foreground"
              >
                {userCode}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="github-link-copy"
                onClick={() => void copyCode()}
              >
                <Copy className="icon-toolbar" />
                {copied ? t('onboarding.github.copied') : t('onboarding.github.copy')}
              </Button>
            </div>
            <Button variant="outline" data-testid="github-link-reopen" onClick={reopen}>
              <ExternalLink className="icon-toolbar" />
              {t('onboarding.github.openDevice')}
            </Button>
            {countdown ? (
              <p className="text-xs">
                {t('onboarding.github.remaining')}{' '}
                <span data-testid="github-link-countdown">{countdown}</span>
              </p>
            ) : null}
          </div>
        )}

        {status === 'linked' && (
          <div className="flex items-start gap-3 text-sm" data-testid="github-link-confirmed">
            <CheckCircle2 className="mt-0.5 icon-rail shrink-0 text-success" aria-hidden="true" />
            <div className="flex items-center gap-3">
              {profile ? (
                <img
                  src={profile.avatarUrl}
                  alt=""
                  data-testid="github-link-avatar"
                  className="size-10 rounded-full"
                />
              ) : null}
              <div className="space-y-1">
                <p className="font-medium text-success">{t('onboarding.github.confirmedTitle')}</p>
                {profile ? (
                  <p className="text-muted-foreground" data-testid="github-link-login">
                    {profile.githubLogin}
                  </p>
                ) : null}
                <p className="text-muted-foreground">{t('onboarding.github.confirmedHint')}</p>
              </div>
            </div>
          </div>
        )}

        {status === 'expired' && (
          <div className="space-y-3 text-sm" data-testid="github-link-expired">
            <p className="font-medium text-foreground">{t('onboarding.github.expiredTitle')}</p>
            <p className="text-muted-foreground">{t('onboarding.github.expiredHint')}</p>
            <Button data-testid="github-link-restart" onClick={() => void start()}>
              <ExternalLink className="icon-toolbar" />
              {t('onboarding.github.restart')}
            </Button>
          </div>
        )}

        {status === 'unavailable' && (
          <div className="space-y-3 text-sm" data-testid="github-link-unavailable">
            <p className="font-medium text-foreground">{t('onboarding.github.unavailableTitle')}</p>
            <p className="text-muted-foreground">{t('onboarding.github.unavailableHint')}</p>
            <Button variant="outline" data-testid="github-link-retry" onClick={() => void start()}>
              {t('onboarding.github.retry')}
            </Button>
          </div>
        )}

        {failure ? (
          <p role="alert" className="text-sm text-destructive" data-testid="github-link-error">
            {failure}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('onboarding.github.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}