/**
 * DriveActionTiles — the three fixed tiles at the top of the Drive surface.
 *
 * (a) full-width «Настроить бэкап устройства» → the backup chooser.
 * (b) «Импортировать мои файлы из Google Drive» → the import dialog on the
 *     Google Drive provider.
 * (c) «Импортировать из других хранилищ» with three provider logos → the same
 *     dialog at its provider picker.
 */
import { useTranslation } from 'react-i18next'
import { CloudDownload, HardDriveDownload, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'

function OneDriveLogo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="var(--accent)" d="M9.5 6.5a5 5 0 0 1 8.9 2.6A4.2 4.2 0 0 1 22 13.2 4.3 4.3 0 0 1 17.7 17H7.4A4.9 4.9 0 0 1 9.5 6.5Z" />
      <path fill="var(--accent-text)" d="M9.9 9.9a4 4 0 0 1 6.6-.6 4.9 4.9 0 0 0-7.9 4.4A4 4 0 0 1 9.9 9.9Z" opacity=".7" />
    </svg>
  )
}

function ICloudLogo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="var(--text-secondary)" d="M7 17a4 4 0 0 1 .4-8A5.5 5.5 0 0 1 17.8 10.4 3.6 3.6 0 0 1 17 17H7Z" />
    </svg>
  )
}

function YandexDiskLogo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="var(--status-warning)" />
      <path fill="var(--foreground)" d="M6.8 12.2h10.4M12 6.8v10.8" stroke="var(--foreground)" strokeWidth="0" />
      <path fill="var(--foreground)" d="M11 7h2.1c1.7 0 2.9 1 2.9 2.6 0 1.2-.6 2-1.6 2.4l2 3.9h-1.7l-1.8-3.6H12v3.6h-1V7Zm2 4c1.1 0 1.8-.5 1.8-1.4S14.1 8 13 8h-1v3h1Z" />
    </svg>
  )
}

export interface DriveActionTilesProps {
  onOpenBackup: () => void
  onGoogleImport: () => void
  onOtherImport: () => void
}

function Tile({
  title, description, icon, onClick, children, testId, className,
}: {
  title: string
  description: string
  icon: ReactNode
  onClick: () => void
  children?: ReactNode
  testId: string
  className?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`group flex flex-col justify-between gap-3 rounded-lg border border-border/60 bg-card/60 p-4 text-left transition-colors hover:border-primary/50 hover:bg-card ${className ?? ''}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-primary">{icon}</span>
        <span className="space-y-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{description}</span>
        </span>
      </div>
      {children}
    </button>
  )
}

export function DriveActionTiles({ onOpenBackup, onGoogleImport, onOtherImport }: DriveActionTilesProps) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="drive-action-tiles">
      <Tile
        testId="drive-tile-backup"
        className="sm:col-span-2"
        icon={<HardDriveDownload className="icon-rail" />}
        title={t('drive.tiles.backup.title')}
        description={t('drive.tiles.backup.description')}
        onClick={onOpenBackup}
      />
      <Tile
        testId="drive-tile-google"
        className="sm:row-span-1"
        icon={<CloudDownload className="icon-rail" />}
        title={t('drive.tiles.google.title')}
        description={t('drive.tiles.google.description')}
        onClick={onGoogleImport}
      />
      <Tile
        testId="drive-tile-other"
        icon={<ShieldCheck className="icon-rail" />}
        title={t('drive.tiles.other.title')}
        description={t('drive.tiles.other.description')}
        onClick={onOtherImport}
      >
        <span className="flex items-center gap-3" aria-label={t('drive.tiles.other.providers')}>
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground"><OneDriveLogo />OneDrive</span>
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground"><ICloudLogo />iCloud</span>
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground"><YandexDiskLogo />Яндекс Диск</span>
        </span>
      </Tile>
    </div>
  )
}