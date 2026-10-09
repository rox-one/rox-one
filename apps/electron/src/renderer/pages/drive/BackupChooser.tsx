/**
 * BackupChooser — device-backup consent flow.
 *
 * Offers the five default folders only (Загрузки / Документы / Изображения /
 * Рабочий стол / Скриншоты). Picking one walks it on the host
 * (`drive:scanSource`) and shows exactly what would be uploaded before a single
 * byte moves. Queued files reuse the upload pipeline with
 * `source: 'device-backup'`; the host reads each slice from disk.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FolderLock, HardDriveDownload, Loader2 } from 'lucide-react'
import {
  DRIVE_BACKUP_SOURCE_KINDS,
  type DriveBackupSourceKind,
  type DriveScanResult,
} from '@rox/shared/drive'
import { Button } from '@/components/ui/button'
import { formatBytes } from './format'
import { isRetryableUploadError, runRendererUpload, type DriveUploadApi } from './upload-client'

type BackupApi = DriveUploadApi & {
  driveScanSource: (workspaceId: string, sourceKind: DriveBackupSourceKind) => Promise<DriveScanResult>
}

export interface BackupChooserProps {
  workspaceId: string
  api: BackupApi
  onClose: () => void
  onUploaded: () => void
}

type Phase =
  | { kind: 'choose' }
  | { kind: 'scanning'; sourceKind: DriveBackupSourceKind }
  | { kind: 'consent'; scan: DriveScanResult }
  | { kind: 'uploading'; scan: DriveScanResult; doneFiles: number; doneBytes: number; failed: Array<{ name: string; code?: string }> }
  | { kind: 'done'; scan: DriveScanResult; failed: Array<{ name: string; code?: string }> }

const CONSENT_PREVIEW_COUNT = 8

export function BackupChooser({ workspaceId, api, onClose, onUploaded }: BackupChooserProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' })

  async function pickSource(sourceKind: DriveBackupSourceKind) {
    setPhase({ kind: 'scanning', sourceKind })
    try {
      const scan = await api.driveScanSource(workspaceId, sourceKind)
      setPhase({ kind: 'consent', scan })
    } catch {
      setPhase({ kind: 'choose' })
    }
  }

  async function queueUpload(scan: DriveScanResult) {
    const failed: Array<{ name: string; code?: string }> = []
    let doneFiles = 0
    let doneBytes = 0
    setPhase({ kind: 'uploading', scan, doneFiles, doneBytes, failed })
    for (const file of scan.files) {
      try {
        await runRendererUpload(api, {
          workspaceId,
          name: file.name,
          size: file.size,
          source: 'device-backup',
          sourceKind: scan.sourceKind,
          relativePath: file.relativePath,
        })
        doneFiles += 1
        doneBytes += file.size
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code
        failed.push({ name: file.name, code: typeof code === 'string' ? code : undefined })
        if (!isRetryableUploadError(error)) continue // skip a permanently broken file, keep the queue moving
      }
      setPhase({ kind: 'uploading', scan, doneFiles, doneBytes, failed: [...failed] })
    }
    onUploaded()
    setPhase({ kind: 'done', scan, failed })
  }

  return (
    <section data-testid="drive-backup-chooser" className="rounded-lg border border-border/60 bg-card/60 p-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDriveDownload className="icon-toolbar text-primary" />
          <h2 className="text-sm font-medium">{t('drive.backup.title')}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={phase.kind === 'uploading'}>
          <ArrowLeft className="icon-toolbar" />
          {t('drive.backup.close')}
        </Button>
      </header>

      {phase.kind === 'choose' && (
        <div className="space-y-2" data-testid="drive-backup-sources">
          <p className="text-xs text-muted-foreground">{t('drive.backup.chooseHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {DRIVE_BACKUP_SOURCE_KINDS.map(kind => (
              <button
                key={kind}
                type="button"
                data-testid={`drive-backup-source-${kind}`}
                onClick={() => void pickSource(kind)}
                className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-left text-sm hover:border-primary/50"
              >
                <FolderLock className="icon-toolbar text-muted-foreground" />
                {t(`drive.backup.source.${kind}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase.kind === 'scanning' && (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="icon-toolbar animate-spin" />
          {t('drive.backup.scanning')}
        </div>
      )}

      {phase.kind === 'consent' && (
        <div className="space-y-3" data-testid="drive-backup-consent">
          <p className="text-sm">
            {t('drive.backup.consentSummary', {
              count: phase.scan.files.length,
              size: formatBytes(phase.scan.totalBytes),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('drive.backup.consentScope', { path: phase.scan.rootPath })}
          </p>
          {phase.scan.skippedSymlinks > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="drive-backup-skipped-symlinks">
              {t('drive.backup.skippedSymlinks', { count: phase.scan.skippedSymlinks })}
            </p>
          )}
          {phase.scan.truncated && (
            <p className="text-xs text-status-warning">{t('drive.backup.truncated')}</p>
          )}
          <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border/60 p-2 text-xs text-muted-foreground">
            {phase.scan.files.slice(0, CONSENT_PREVIEW_COUNT).map(file => (
              <li key={file.relativePath} className="flex justify-between gap-2">
                <span className="truncate">{file.relativePath}</span>
                <span className="tabular-nums">{formatBytes(file.size, 0)}</span>
              </li>
            ))}
            {phase.scan.files.length > CONSENT_PREVIEW_COUNT && (
              <li className="pt-1">{t('drive.backup.moreFiles', { count: phase.scan.files.length - CONSENT_PREVIEW_COUNT })}</li>
            )}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" disabled={phase.scan.files.length === 0} onClick={() => void queueUpload(phase.scan)}>
              {t('drive.backup.start', { count: phase.scan.files.length })}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPhase({ kind: 'choose' })}>{t('drive.backup.back')}</Button>
          </div>
        </div>
      )}

      {phase.kind === 'uploading' && (
        <div role="status" className="space-y-2" data-testid="drive-backup-progress">
          <p className="text-sm">
            {t('drive.backup.progress', { done: phase.doneFiles, total: phase.scan.files.length, size: formatBytes(phase.doneBytes) })}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${phase.scan.files.length ? (phase.doneFiles / phase.scan.files.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {phase.kind === 'done' && (
        <div className="space-y-2" data-testid="drive-backup-done">
          <p className="text-sm">{t('drive.backup.done', { done: phase.scan.files.length - phase.failed.length, total: phase.scan.files.length })}</p>
          {phase.failed.length > 0 && (
            <ul className="space-y-0.5 text-xs text-status-warning">
              {phase.failed.map(file => (
                <li key={file.name}>{t('drive.backup.failedFile', { name: file.name, code: file.code ?? '—' })}</li>
              ))}
            </ul>
          )}
          <Button size="sm" onClick={onClose}>{t('drive.backup.finish')}</Button>
        </div>
      )}
    </section>
  )
}