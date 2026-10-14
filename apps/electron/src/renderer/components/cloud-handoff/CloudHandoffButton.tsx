/**
 * «В облако» — move this chat (messages, attachments, referenced files) into a
 * Daytona cloud session and show a link to continue in the browser (Rox ID SSO).
 * Hidden unless `cloudHandoff.enabled` is on. See docs/cloud-handoff-design.md.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CloudUpload, ExternalLink, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CloudHandoffConfig, CloudHandoffStatus } from '../../../shared/types'
import {
  HANDOFF_POLL_MS,
  failureLabelKey,
  isHandoffInFlight,
  needsUserKey,
  phaseLabelKey,
  safeSessionUrl,
} from './handoff-state'

export function CloudHandoffButton({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const api = window.electronAPI
  const [config, setConfig] = React.useState<CloudHandoffConfig | null>(null)
  const [status, setStatus] = React.useState<CloudHandoffStatus | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [keyDraft, setKeyDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const refreshConfig = React.useCallback(async () => {
    try {
      setConfig((await api?.getCloudHandoffConfig?.()) ?? null)
    } catch {
      setConfig(null)
    }
  }, [api])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      await refreshConfig()
      const prior = await api?.getCloudHandoffStatus?.({ sessionId }).catch(() => null)
      if (!cancelled) setStatus(prior ?? null)
    })()
    return () => { cancelled = true }
  }, [api, refreshConfig, sessionId])

  const inFlight = isHandoffInFlight(status)
  React.useEffect(() => {
    if (!inFlight || !status) return
    const timer = window.setInterval(async () => {
      const next = await api?.getCloudHandoffStatus?.({ handoffId: status.handoffId }).catch(() => null)
      if (!next) return
      setStatus(next)
      if (next.phase === 'failed') toast.error(t(failureLabelKey(next.failure?.code)))
      if (next.phase === 'ready') toast.success(t('cloudHandoff.readyToast'))
    }, HANDOFF_POLL_MS)
    return () => window.clearInterval(timer)
  }, [api, inFlight, status, t])

  if (!config?.enabled) return null

  const start = async () => {
    if (needsUserKey(config)) {
      setDialogOpen(true)
      return
    }
    setBusy(true)
    try {
      const next = await api.startCloudHandoff({ sessionId })
      setStatus(next)
      if (next.phase === 'failed') toast.error(t(failureLabelKey(next.failure?.code)))
    } catch {
      toast.error(t('cloudHandoff.error.provider_error'))
    } finally {
      setBusy(false)
    }
  }

  const saveKey = async () => {
    setBusy(true)
    try {
      await api.setCloudHandoffKey({ key: keyDraft })
      setKeyDraft('')
      await refreshConfig()
      toast.success(t('cloudHandoff.keySaved'))
      setDialogOpen(false)
    } catch {
      toast.error(t('cloudHandoff.keyInvalid'))
    } finally {
      setBusy(false)
    }
  }

  const clearKey = async () => {
    await api.clearCloudHandoffKey().catch(() => undefined)
    await refreshConfig()
  }

  const url = safeSessionUrl(status)

  return (
    <>
      {url ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => void api.openUrl(url)}
          title={url}
        >
          <ExternalLink className="h-4 w-4" />
          {t('cloudHandoff.openInBrowser')}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={busy || inFlight}
          onClick={() => void start()}
          onContextMenu={(e) => { e.preventDefault(); setDialogOpen(true) }}
          aria-label={t('cloudHandoff.button')}
        >
          {inFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
          {inFlight && status
            ? t(phaseLabelKey(status.phase), { uploaded: status.uploaded ?? 0, total: status.total ?? 0 })
            : t('cloudHandoff.button')}
        </Button>
      )}
      {inFlight && status && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => void api.cancelCloudHandoff({ handoffId: status.handoffId })}
        >
          {t('cloudHandoff.cancel')}
        </Button>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('cloudHandoff.keyTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('cloudHandoff.keyHint')}</p>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={keyDraft}
            placeholder={config.userKeyConfigured ? t('cloudHandoff.keyConfigured') : 'dtn_…'}
            onChange={(e) => setKeyDraft(e.target.value)}
          />
          <DialogFooter>
            {config.userKeyConfigured && (
              <Button type="button" variant="ghost" onClick={() => void clearKey()}>
                {t('cloudHandoff.keyRemove')}
              </Button>
            )}
            <Button type="button" disabled={busy || keyDraft.trim().length === 0} onClick={() => void saveKey()}>
              {t('cloudHandoff.keySave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
