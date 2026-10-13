/**
 * DriveQuotaMeter — header meter for «1 ТБ».
 *
 * Thresholds follow the owner spec: amber at ≥80%, red at ≥95%. The bar width
 * and the level come from the shared `meterLevel` / `meterFraction` helpers so
 * tests and the engine agree with the UI.
 */
import { useTranslation } from 'react-i18next'
import { DRIVE_DEFAULT_QUOTA_BYTES, meterFraction, meterLevel, type DriveQuota } from '@rox/shared/drive'
import { formatBytes } from './format'

const FILL_BY_LEVEL: Record<'ok' | 'warn' | 'critical', string> = {
  ok: 'bg-status-success',
  warn: 'bg-status-warning',
  critical: 'bg-status-danger',
}

const TEXT_BY_LEVEL: Record<'ok' | 'warn' | 'critical', string> = {
  ok: 'text-muted-foreground',
  warn: 'text-status-warning',
  critical: 'text-status-danger',
}

export function DriveQuotaMeter({ quota }: { quota: DriveQuota | null }) {
  const { t } = useTranslation()
  const totalBytes = quota?.totalBytes ?? DRIVE_DEFAULT_QUOTA_BYTES
  const usedBytes = (quota?.usedBytes ?? 0) + (quota?.reservedBytes ?? 0)
  const level = meterLevel(usedBytes, totalBytes)
  const fraction = meterFraction(usedBytes, totalBytes)

  return (
    <section
      data-testid="drive-quota-meter"
      data-level={level}
      aria-label={t('drive.quota.label')}
      className="rounded-lg border border-border/60 bg-card/60 px-4 py-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-display font-semibold numeric">{t('drive.quota.title')}</span>
          <span className="text-xs text-muted-foreground">{t('drive.quota.total', { total: formatBytes(totalBytes, 0) })}</span>
        </div>
        <div className={`text-xs numeric ${TEXT_BY_LEVEL[level]}`} data-testid="drive-quota-used">
          {t('drive.quota.usedOf', { used: formatBytes(usedBytes), total: formatBytes(totalBytes, 0) })}
        </div>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          data-testid="drive-quota-fill"
          className={`h-full rounded-full transition-[width] ${FILL_BY_LEVEL[level]}`}
          style={{ width: `${Math.max(fraction > 0 ? 2 : 0, fraction * 100)}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-caption text-muted-foreground">
        <span>{t('drive.quota.free', { free: formatBytes(quota?.freeBytes ?? totalBytes) })}</span>
        {level !== 'ok' && (
          <span className={TEXT_BY_LEVEL[level]} data-testid="drive-quota-warning">
            {t(level === 'critical' ? 'drive.quota.critical' : 'drive.quota.warn')}
          </span>
        )}
      </div>
    </section>
  )
}