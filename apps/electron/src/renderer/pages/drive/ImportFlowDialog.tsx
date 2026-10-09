/**
 * ImportFlowDialog — «Импорт из облака» (wave 4).
 *
 * Provider picker → authorization → the host `drive:import*` job with live
 * progress and pause/resume. Every state is real: device codes come from the
 * provider, job status from `drive:importStatus`, and errors are shown exactly
 * as the host or provider reported them. iCloud renders the shared
 * `ICLOUD_UNSUPPORTED_MESSAGE` — there is no dead button.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Copy, ExternalLink, Info, Loader2, Pause, Play, X } from 'lucide-react'
import type { ImportProviderId } from '@rox/shared/drive/importers/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatBytes } from './format'
import { IMPORT_PROVIDERS, createDriveImportAuthClient, type DriveImportAuthClient } from './import-flow'
import { createDriveImportController, type DriveImportApi } from './import-controller'

export interface ImportFlowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `drive:import*` RPC surface (usually `window.electronAPI`). */
  api: DriveImportApi
  /** Authorization client; omit to use the default host-env client. */
  auth?: DriveImportAuthClient
  /** Provider to start immediately when the dialog opens (Google tile). */
  initialProvider?: ImportProviderId
  /** Poll cadence for `drive:importStatus` (tests shrink it). */
  pollMs?: number
  className?: string
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function openExternal(url: string): void {
  const api = window.electronAPI
  if (api && typeof api.openUrl === 'function') {
    void Promise.resolve(api.openUrl(url)).catch(() => {})
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function ImportFlowDialog({ open, onOpenChange, api, auth, initialProvider, pollMs, className }: ImportFlowDialogProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [yandexCode, setYandexCode] = useState('')

  const controller = useMemo(() => {
    if (!open) return null
    return createDriveImportController({
      auth: auth ?? createDriveImportAuthClient(),
      api,
      ...(pollMs !== undefined ? { pollMs } : {}),
    })
  }, [open, auth, api, pollMs])

  useEffect(() => () => controller?.dispose(), [controller])

  const subscribe = useCallback(
    (listener: () => void) => (controller ? controller.subscribe(listener) : () => {}),
    [controller],
  )
  const getSnapshot = useCallback(() => (controller ? controller.getState() : null), [controller])
  const state = useSyncExternalStore(subscribe, getSnapshot)

  // 1 s tick only while a device code is on screen, so the countdown moves.
  const [, setClock] = useState(0)
  const waitingDevice = state?.phase === 'authorizing' && (state?.deviceCode ?? null) !== null
  useEffect(() => {
    if (!open || !waitingDevice) return
    const id = setInterval(() => setClock(value => value + 1), 1000)
    return () => clearInterval(id)
  }, [open, waitingDevice])

  useEffect(() => {
    if (!open) {
      setCopied(false)
      setYandexCode('')
    }
  }, [open])

  // The Google tile jumps straight into the Google Drive flow.
  useEffect(() => {
    if (open && controller && initialProvider) controller.start(initialProvider)
  }, [open, controller, initialProvider])

  const copyCode = useCallback(async () => {
    const code = controller?.getState().deviceCode?.userCode
    if (!code) return
    try {
      await navigator.clipboard?.writeText(code)
      setCopied(true)
    } catch {
      /* Clipboard is optional; the code stays visible for manual typing. */
    }
  }, [controller])

  const back = useCallback(() => {
    controller?.reset()
    setYandexCode('')
  }, [controller])

  const remainingMs = state?.expiresAt ? Math.max(0, state.expiresAt - Date.now()) : 0
  const phase = state?.phase ?? 'choose'
  const job = state?.job ?? null
  const progress = job?.progress
  const retryProvider = state?.phase === 'error' && state.retryable ? state.provider : null
  const yandexUrl = state?.yandexUrl ?? null
  const deviceCode = state?.deviceCode ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className} data-testid="drive-import-dialog">
        <DialogHeader>
          <DialogTitle>{t('drive.import.title')}</DialogTitle>
          <DialogDescription>{t('drive.import.description')}</DialogDescription>
        </DialogHeader>

        {state?.phase === 'choose' && (
          <div className="space-y-3" data-testid="drive-import-providers">
            <p className="text-sm text-muted-foreground">{t('drive.import.provider.hint')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {IMPORT_PROVIDERS.map(provider => (
                <button
                  key={provider.id}
                  type="button"
                  data-testid={`drive-import-provider-${provider.id}`}
                  onClick={() => controller?.start(provider.id)}
                  className="rounded-lg border border-border/60 px-3 py-2 text-left text-sm hover:border-primary/50"
                >
                  {t(provider.labelKey)}
                </button>
              ))}
            </div>
          </div>
        )}

        {state?.phase === 'unsupported' && (
          <div className="space-y-3" data-testid="drive-import-unsupported">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 icon-toolbar text-status-warning" />
              <p className="text-sm text-muted-foreground">{state.error}</p>
            </div>
            <Button variant="ghost" size="sm" data-testid="drive-import-back" onClick={back}>
              <ArrowLeft className="icon-toolbar" />
              {t('drive.import.back')}
            </Button>
          </div>
        )}

        {state?.phase === 'error' && (
          <div className="space-y-3" data-testid="drive-import-error">
            <p className="text-sm font-medium">{t('drive.import.error.title')}</p>
            <p role="alert" className="text-sm text-destructive">{state.error}</p>
            <div className="flex gap-2">
              {retryProvider && (
                <Button size="sm" data-testid="drive-import-retry" onClick={() => controller?.start(retryProvider)}>
                  {t('drive.import.error.retry')}
                </Button>
              )}
              <Button variant="ghost" size="sm" data-testid="drive-import-back" onClick={back}>
                <ArrowLeft className="icon-toolbar" />
                {t('drive.import.back')}
              </Button>
            </div>
          </div>
        )}

        {state?.phase === 'authorizing' && (
          <div className="space-y-3 text-sm text-muted-foreground" data-testid="drive-import-authorizing">
            {deviceCode ? (
              <>
                <p>{t('drive.import.device.waiting')}</p>
                <p className="text-xs">{t('drive.import.device.codeHint')}</p>
                <code
                  data-testid="drive-import-usercode"
                  className="inline-block rounded-md border border-border-subtle bg-background/50 px-3 py-1.5 font-mono text-base tracking-widest text-foreground"
                >
                  {deviceCode.userCode}
                </code>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" data-testid="drive-import-copy" onClick={() => void copyCode()}>
                    <Copy className="icon-toolbar" />
                    {copied ? t('drive.import.device.copied') : t('drive.import.device.copy')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="drive-import-open"
                    onClick={() => openExternal(deviceCode.verificationUri)}
                  >
                    <ExternalLink className="icon-toolbar" />
                    {t('drive.import.device.open')}
                  </Button>
                </div>
                {remainingMs > 0 && (
                  <p className="text-xs">
                    {t('drive.import.device.remaining')}{' '}
                    <span data-testid="drive-import-countdown">{formatCountdown(remainingMs)}</span>
                  </p>
                )}
              </>
            ) : (
              <p className="flex items-center gap-2">
                <Loader2 className="icon-toolbar animate-spin" />
                {t('drive.import.authorizing')}
              </p>
            )}
            <Button variant="ghost" size="sm" data-testid="drive-import-cancel" onClick={back}>
              <X className="icon-toolbar" />
              {t('drive.import.device.cancel')}
            </Button>
          </div>
        )}

        {state?.phase === 'yandex-code' && (
          <div className="space-y-3" data-testid="drive-import-yandex">
            <p className="text-sm text-muted-foreground">{t('drive.import.yandex.hint')}</p>
            {yandexUrl && (
              <Button
                variant="outline"
                size="sm"
                data-testid="drive-import-yandex-open"
                onClick={() => openExternal(yandexUrl)}
              >
                <ExternalLink className="icon-toolbar" />
                {t('drive.import.yandex.open')}
              </Button>
            )}
            <div className="flex gap-2">
              <Input
                data-testid="drive-import-yandex-code"
                value={yandexCode}
                onChange={event => setYandexCode(event.target.value)}
                placeholder={t('drive.import.yandex.codePlaceholder')}
              />
              <Button
                size="sm"
                data-testid="drive-import-yandex-submit"
                disabled={yandexCode.trim().length === 0}
                onClick={() => controller?.submitYandexCode(yandexCode.trim())}
              >
                {t('drive.import.yandex.submit')}
              </Button>
            </div>
            <Button variant="ghost" size="sm" data-testid="drive-import-back" onClick={back}>
              <ArrowLeft className="icon-toolbar" />
              {t('drive.import.back')}
            </Button>
          </div>
        )}

        {state?.phase === 'planning' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" data-testid="drive-import-planning">
            <Loader2 className="icon-toolbar animate-spin" />
            {t('drive.import.planning')}
          </p>
        )}

        {(phase === 'job' || phase === 'done') && job && (
          <div className="space-y-3" data-testid="drive-import-progress">
            <p className="text-sm font-medium">
              {t('drive.import.status.' + job.status)}
            </p>
            {progress && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('drive.import.progress.files', { done: progress.filesDone, total: progress.filesTotal })}
                  {' · '}
                  {t('drive.import.progress.bytes', { done: formatBytes(progress.bytesDone), total: formatBytes(progress.bytesTotal) })}
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${progress.filesTotal ? (progress.filesDone / progress.filesTotal) * 100 : 0}%` }}
                  />
                </div>
                {progress.currentPath && (
                  <p className="truncate text-xs text-muted-foreground" data-testid="drive-import-current">
                    {t('drive.import.progress.current', { path: progress.currentPath })}
                  </p>
                )}
              </>
            )}
            {phase === 'done' && (
              <p className="text-sm text-success" data-testid="drive-import-done">
                {t('drive.import.done.summary', { done: progress?.filesDone ?? 0, total: progress?.filesTotal ?? 0 })}
              </p>
            )}
            {phase === 'job' && (
              <div className="flex gap-2">
                {job.status === 'paused' || job.status === 'error' ? (
                  <Button size="sm" data-testid="drive-import-resume" onClick={() => controller?.resume()}>
                    <Play className="icon-toolbar" />
                    {t('drive.import.control.resume')}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" data-testid="drive-import-pause" onClick={() => controller?.pause()}>
                    <Pause className="icon-toolbar" />
                    {t('drive.import.control.pause')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" data-testid="drive-import-cancel-job" onClick={() => controller?.cancel()}>
                  <X className="icon-toolbar" />
                  {t('drive.import.control.cancel')}
                </Button>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('drive.import.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}