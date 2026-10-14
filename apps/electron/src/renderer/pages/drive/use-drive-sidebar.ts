import * as React from 'react'
import { FolderPlus, RefreshCw, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DriveListing, DriveQuota } from '@rox/shared/drive'
import { useScreenSidebar } from '@/components/shell/screen-sidebar'
import { buildDriveSidebarGroups } from './drive-sidebar'
import { formatBytes } from './format'

export interface DriveSidebarBindings {
  listing: DriveListing | null
  quota: DriveQuota | null
  currentFolderId: string | null
  loading: boolean
  error: string | null
  openFolder(id: string | null): void
  openBackup(): void
  openImport(provider: 'google-drive' | undefined): void
  createFolder(): void
  pickFiles(): void
  refresh(): void
}

/** Publishes the Диск second sidebar from the page's live state. */
export function useDriveSidebar(b: DriveSidebarBindings): void {
  const { t } = useTranslation()
  const { listing, quota, currentFolderId, loading, error, openFolder, openBackup, openImport, createFolder, pickFiles, refresh } = b
  const config = React.useMemo(() => ({
    screenId: 'drive',
    title: t('screenSidebar.drive.title'),
    headerActions: [
      { id: 'new-folder', label: t('drive.list.newFolder'), icon: FolderPlus, onSelect: createFolder },
      { id: 'refresh', label: t('screenSidebar.drive.refresh'), icon: RefreshCw, onSelect: refresh },
    ],
    primaryAction: { id: 'upload', label: t('drive.list.upload'), icon: Upload, onSelect: pickFiles },
    groups: buildDriveSidebarGroups({
      listing, quota, currentFolderId, loading, error,
      labels: {
        quick: t('screenSidebar.drive.quick'), myDrive: t('screenSidebar.drive.myDrive'), backup: t('screenSidebar.drive.backup'),
        importGoogle: t('screenSidebar.drive.importGoogle'), importOther: t('screenSidebar.drive.importOther'),
        folders: t('screenSidebar.drive.folders'), up: t('screenSidebar.drive.up'), storage: t('screenSidebar.drive.storage'),
        usage: (q) => ({
          label: t('screenSidebar.drive.storageUsed', { used: formatBytes(q.usedBytes), total: formatBytes(q.totalBytes) }),
          secondary: t('screenSidebar.drive.storageFree', { free: formatBytes(q.freeBytes) }),
        }),
        emptyFolders: t('screenSidebar.drive.emptyFolders'), newFolder: t('drive.list.newFolder'), error: t('screenSidebar.drive.error'),
      },
      onOpenFolder: openFolder, onBackup: openBackup, onImport: openImport, onCreateFolder: createFolder, onRetry: refresh,
    }),
  }), [listing, quota, currentFolderId, loading, error, openFolder, openBackup, openImport, createFolder, pickFiles, refresh, t])
  useScreenSidebar(config)
}
