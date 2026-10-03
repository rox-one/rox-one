import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@rox/ui'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { StepFormLayout } from './primitives'

export interface RoxConnectCodes {
  userCode: string
  verificationUri: string
  verificationUriComplete: string
}

interface RoxConnectStepProps {
  codes: RoxConnectCodes | null
  status: 'idle' | 'starting' | 'waiting' | 'success' | 'error'
  errorMessage?: string
  onStart: () => void
  onOpenBrowser: () => void
  authBaseUrl: string
}

/**
 * Rox cloud Connect — required gate before provider setup.
 * Device flow against rox.one (BETTER_AUTH / marketing website).
 */
export function RoxConnectStep({
  codes,
  status,
  errorMessage,
  onStart,
  onOpenBrowser,
  authBaseUrl,
}: RoxConnectStepProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [cancelError, setCancelError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setCopied(false)
    setCancelled(false)
    setCancelError(false)
    if (codes?.userCode && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(codes.userCode).then(() => {
        if (cancelled) return
        setCopied(true)
        timer = setTimeout(() => setCopied(false), 2000)
      }).catch(() => { if (!cancelled) setCopied(false) })
    }
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [codes?.userCode])

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      }
      title={t('onboarding.roxConnect.title')}
      description={
        <>
          {t('onboarding.roxConnect.description')}
          <br />
          <span className="text-muted-foreground/70 text-xs mt-2 block">
            {t('onboarding.roxConnect.authHost', { host: authBaseUrl })}
          </span>
        </>
      }
      actions={
        <div className="flex flex-col gap-3 w-full max-w-[360px]">
          {status === 'idle' || status === 'error' || status === 'starting' || cancelled ? (
            <Button
              onClick={() => { setCancelled(false); onStart() }}
              disabled={status === 'starting'}
              className="w-full"
              size="lg"
            >
              {status === 'starting' ? (
                <>
                  <Spinner className="mr-2" />
                  {t('onboarding.roxConnect.starting')}
                </>
              ) : (
                t('onboarding.roxConnect.connect')
              )}
            </Button>
          ) : null}

          {codes && status === 'waiting' && !cancelled ? (
            <>
              <div className="rounded-lg border bg-background p-4 text-center">
                <p className="text-xs text-muted-foreground mb-2">
                  {t('onboarding.roxConnect.enterCode')}
                  {copied ? ` (${t('onboarding.roxConnect.copied')})` : ''}
                </p>
                <p className="font-mono text-2xl tracking-widest font-semibold">
                  {codes.userCode}
                </p>
              </div>
              <Button onClick={onOpenBrowser} className="w-full" size="lg" variant="default">
                <ExternalLink className="mr-2 size-4" />
                {t('onboarding.roxConnect.openBrowser')}
              </Button>
              <p className="select-all break-all rounded-lg border bg-background/70 p-3 text-center text-xs text-muted-foreground">
                {codes.verificationUriComplete}
              </p>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                {t('onboarding.roxConnect.waiting')}
              </div>
              <Button onClick={onStart} variant="ghost" size="sm" className="w-full">
                <RefreshCw className="mr-2 size-3" />
                {t('onboarding.roxConnect.restart')}
              </Button>
            </>
          ) : null}

          {codes && status === 'waiting' && !cancelled ? <Button variant="ghost" onClick={() => { setCancelled(true); setCancelError(false); void window.electronAPI.clearRoxCloud().catch(() => setCancelError(true)) }}>{t('common.cancel')}</Button> : null}
          {cancelError ? <p className="text-sm text-destructive">{t('settings.account.cloud.logoutFailed')}</p> : null}
          {cancelled ? <p className="text-sm text-muted-foreground">{t('onboarding.roxConnect.cancelled')}</p> : null}
          {status === 'success' ? (
            <div className="text-sm text-emerald-600 text-center">{t('onboarding.roxConnect.success')}</div>
          ) : null}

          {errorMessage ? (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{errorMessage}</p>
            </div>
          ) : null}
        </div>
      }
    />
  )
}
