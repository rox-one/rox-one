import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
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
}: RoxConnectStepProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (codes?.userCode) {
      void navigator.clipboard.writeText(codes.userCode).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }, [codes?.userCode])

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      }
      title={t('onboarding.roxConnect.title')}
      description={t('onboarding.roxConnect.description')}
      actions={
        <div className="flex flex-col gap-3 w-full max-w-[360px]">
          {status === 'idle' || status === 'error' || status === 'starting' ? (
            <Button
              onClick={onStart}
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

          {codes && status === 'waiting' ? (
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
