/**
 * DriveAppDataSection — the «Данные приложения» block of the Drive surface (R13).
 *
 * It answers one question honestly: which of the app's data already lives in
 * ROX Drive, and which does not. The entries and their statuses come from
 * `@rox/shared/drive` (`DRIVE_APP_DATA_ENTRIES`) — the renderer invents
 * nothing and shows no progress it cannot measure. Device folders are only
 * offered, not claimed: the button reuses the existing `BackupChooser` flow
 * through `onOpenBackup` (the same handler the action tiles use), so there is
 * one backup mechanism, not two.
 */
import { useTranslation } from 'react-i18next'
import { Database, HardDriveDownload } from 'lucide-react'
import {
  DRIVE_APP_DATA_ENTRIES,
  DRIVE_APP_DATA_STATUS_I18N_KEY,
  type DriveAppDataStatus,
} from '@rox/shared/drive'
import { Button } from '@/components/ui/button'
import { DriveMirrorStatus, type DriveMirrorApi } from './DriveMirrorStatus'

const CHIP_BY_STATUS: Record<DriveAppDataStatus, string> = {
  'in-drive': 'border-status-success/40 text-status-success',
  'on-demand': 'border-border/60 text-muted-foreground',
  'not-backed-up': 'border-status-warning/40 text-status-warning',
}

export interface DriveAppDataSectionProps {
  /** Opens the existing device-backup chooser; never a second backup flow. */
  onOpenBackup: () => void
  /** Explicit `drive:mirror*` client (tests); defaults to `window.electronAPI`. */
  mirrorApi?: DriveMirrorApi
}

export function DriveAppDataSection({ onOpenBackup, mirrorApi }: DriveAppDataSectionProps) {
  const { t } = useTranslation()
  return (
    <section
      data-testid="drive-app-data"
      aria-label={t('drive.appData.label')}
      className="rounded-lg border border-border/60 bg-card/60 p-4"
    >
      <header className="mb-3 flex items-center gap-2">
        <Database className="icon-toolbar text-primary" />
        <div>
          <h2 className="text-sm font-medium">{t('drive.appData.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('drive.appData.subtitle')}</p>
        </div>
      </header>

      <ul className="space-y-2">
        {DRIVE_APP_DATA_ENTRIES.map(entry => (
          <li
            key={entry.id}
            data-testid={`drive-app-data-${entry.id}`}
            data-status={entry.status}
            className="rounded-lg border border-border/60 px-3 py-2"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm">{t(entry.titleKey)}</span>
              <span
                data-testid={`drive-app-data-${entry.id}-status`}
                className={`shrink-0 rounded-full border px-2 py-0.5 text-caption ${CHIP_BY_STATUS[entry.status]}`}
              >
                {t(DRIVE_APP_DATA_STATUS_I18N_KEY[entry.status])}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{t(entry.detailKey)}</p>
            {entry.id === 'app-config' && <DriveMirrorStatus api={mirrorApi} />}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={onOpenBackup}>
          <HardDriveDownload className="icon-toolbar" />
          {t('drive.appData.action.backup')}
        </Button>
        <p className="text-caption text-muted-foreground">{t('drive.appData.note')}</p>
      </div>
    </section>
  )
}