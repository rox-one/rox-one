/**
 * Web-only entry-mode landing (R16).
 *
 * Rendered by the Web UI before the shared renderer mounts (apps/webui/App.tsx).
 * The desktop app never imports this file, so the desktop flow is unchanged.
 *
 * Both modes read their real availability from the host: the chat mode is
 * always available, and the cloud-VM mode reflects the host's cloud-runs
 * provider state (available → open, otherwise the concrete reason — never a
 * fabricated success and never a dead button).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  cloudVmStateMessageKey,
  probeCloudVmState,
  type CloudRunsProbeHost,
  type CloudVmState,
  type WebEntryModeId,
} from './web-modes'

export interface WebModesLandingProps {
  /** Host RPC surface for cloud-runs availability (the web adapter's `electronAPI`). */
  host?: CloudRunsProbeHost
  /** Enter the shared workspace surface. */
  onEnter: (mode: WebEntryModeId) => void
}

const CARD_CLASS =
  'flex flex-col gap-3 rounded-lg border border-border/60 bg-background p-5 shadow-minimal'
const PRIMARY_BUTTON_CLASS =
  'self-start rounded-md bg-foreground px-4 py-1.5 text-body font-medium text-background hover:opacity-90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY_BUTTON_CLASS =
  'self-start rounded-md bg-background px-4 py-1.5 text-body text-text-secondary shadow-minimal hover:text-foreground cursor-pointer'

export function WebModesLanding({ host, onEnter }: WebModesLandingProps) {
  const { t } = useTranslation()
  const [cloud, setCloud] = React.useState<CloudVmState>({ status: 'loading' })

  const refreshCloud = React.useCallback(() => {
    setCloud({ status: 'loading' })
    void probeCloudVmState(host).then(setCloud)
  }, [host])

  React.useEffect(() => {
    refreshCloud()
  }, [refreshCloud])

  // Only the available provider is shown next to its state text; the
  // key-missing reason interpolates the provider id it names.
  const cloudProvider =
    cloud.status === 'available' || cloud.status === 'unavailable' ? cloud.provider : undefined

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10 font-sans text-foreground">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2 text-center">
          <h1 className="text-xl font-semibold">{t('webui.modes.title')}</h1>
          <p className="text-body text-text-secondary">{t('webui.modes.subtitle')}</p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className={CARD_CLASS} aria-label={t('webui.modes.chatTitle')}>
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium">{t('webui.modes.chatTitle')}</h2>
              <p className="text-xs text-text-secondary">{t('webui.modes.chatDescription')}</p>
            </div>
            <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={() => onEnter('chat')}>
              {t('webui.modes.chatAction')}
            </button>
          </section>

          <section className={CARD_CLASS} aria-label={t('webui.modes.cloudTitle')}>
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium">{t('webui.modes.cloudTitle')}</h2>
              <p className="text-xs text-text-secondary">{t('webui.modes.cloudDescription')}</p>
            </div>

            {cloud.status === 'loading' && (
              <p role="status" className="text-xs text-text-muted">
                {t('webui.modes.cloudChecking')}
              </p>
            )}

            {cloud.status === 'available' && (
              <>
                <p className="text-xs text-text-secondary">
                  {t('webui.modes.cloudAvailable', { provider: cloud.provider })}
                </p>
                <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={() => onEnter('cloud-vm')}>
                  {t('webui.modes.cloudAction')}
                </button>
              </>
            )}

            {(cloud.status === 'unavailable' || cloud.status === 'error') && (
              <>
                <p role="alert" className="text-xs text-destructive/90">
                  {t(cloudVmStateMessageKey(cloud), { provider: cloudProvider ?? '' })}
                </p>
                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={refreshCloud}>
                  {t('common.retry')}
                </button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}