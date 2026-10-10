import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import { DEV_SPACE_WATCH_DEFAULT_INTERVAL_MS } from '@rox/shared/dev-space'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

/** Offered cadences in hours; the server accepts 15 min…24 h, the UI stays on whole hours. */
const INTERVAL_HOUR_OPTIONS = [1, 3, 6, 12, 24] as const

export interface RepoWatchControlsProps {
  record: DevSpaceRepositoryRecord
  /** Fired with the updated record after a successful `devSpace:setWatch`. */
  onChanged: (record: DevSpaceRepositoryRecord) => void
}

interface WatchPatch {
  watchEnabled?: boolean
  watchAutoPull?: boolean
  watchIntervalMs?: number
}

/**
 * v1.x O10 auto-watch controls (rendered only while `devspace.autoWatch.v1` is
 * on): the switch is the per-repo consent for background network git work, the
 * checkbox opts into fast-forwarding the working copy, and the select picks the
 * cadence. Any failure surfaces one inline key; a failed save never invents a
 * local state change.
 */
export function RepoWatchControls({ record, onChanged }: RepoWatchControlsProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const enabled = record.watchEnabled === true
  const autoPull = record.watchAutoPull === true
  const intervalHours = Math.round((record.watchIntervalMs ?? DEV_SPACE_WATCH_DEFAULT_INTERVAL_MS) / 3_600_000)
  // Keep the record's cadence selectable even if it is not one of the presets.
  const hourOptions = [...new Set([...INTERVAL_HOUR_OPTIONS, intervalHours])].sort((left, right) => left - right)

  const save = useCallback(async (patch: WatchPatch) => {
    setBusy(true)
    setErrorKey(null)
    try {
      const next = await window.electronAPI.setDevSpaceWatch({
        workspaceId: record.workspaceId,
        repositoryId: record.id,
        requestId: crypto.randomUUID(),
        watchEnabled: patch.watchEnabled ?? enabled,
        watchAutoPull: patch.watchAutoPull ?? autoPull,
        watchIntervalMs: patch.watchIntervalMs ?? record.watchIntervalMs ?? DEV_SPACE_WATCH_DEFAULT_INTERVAL_MS,
      })
      onChanged(next)
    } catch {
      setErrorKey('devSpace.watch.networkError')
    } finally {
      setBusy(false)
    }
  }, [record, enabled, autoPull, onChanged])

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="dev-space-watch-controls">
      <label className="flex items-center gap-1.5 text-xs text-text-secondary" title={t('devSpace.watch.toggleHint')}>
        <Switch
          checked={enabled}
          disabled={busy}
          onCheckedChange={(checked) => void save({ watchEnabled: checked })}
          aria-label={t('devSpace.watch.toggle')}
          data-testid="dev-space-watch-toggle"
        />
        {t('devSpace.watch.toggle')}
      </label>
      {enabled ? (
        <>
          <label className="flex items-center gap-1 text-xs text-text-secondary" title={t('devSpace.watch.autoPullHint')}>
            <input
              type="checkbox"
              checked={autoPull}
              disabled={busy}
              onChange={(event) => void save({ watchEnabled: true, watchAutoPull: event.target.checked })}
              data-testid="dev-space-watch-autopull"
              className="accent-[var(--accent)]"
            />
            {t('devSpace.watch.autoPull')}
          </label>
          <Select
            value={String(intervalHours)}
            disabled={busy}
            onValueChange={(value) => void save({ watchEnabled: true, watchIntervalMs: Number(value) * 3_600_000 })}
          >
            <SelectTrigger className="h-7 w-[96px] text-xs" aria-label={t('devSpace.watch.interval')} data-testid="dev-space-watch-interval">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hourOptions.map((hours) => (
                <SelectItem key={hours} value={String(hours)}>
                  {t('devSpace.watch.intervalHours', { hours })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      ) : null}
      {busy ? <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {errorKey ? <span role="alert" className="text-xs text-destructive">{t(errorKey)}</span> : null}
    </div>
  )
}