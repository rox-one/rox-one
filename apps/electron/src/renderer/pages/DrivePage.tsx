/**
 * DrivePage — ROX Drive wave 1 host.
 *
 * Layout: quota meter, the three fixed action tiles, and the folder/file list.
 * (b)/(c) open honest «скоро / нужны доступы» states — wave 1 ships no fake
 * OAuth. Uploads run through `runRendererUpload` (8 parallel 16 MiB parts) and
 * device backups reuse the same pipeline with `source: 'device-backup'`.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import type { DriveListing, DriveQuota } from '@rox/shared/drive'
import { navigate, routes } from '@/lib/navigate'
import { toErrorMessage } from '@/lib/errors'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { Button } from '@/components/ui/button'
import { DriveQuotaMeter } from './drive/DriveQuotaMeter'
import { DriveActionTiles } from './drive/DriveActionTiles'
import { BackupChooser } from './drive/BackupChooser'
import { DriveFileList, type DriveFileUploadProgress } from './drive/DriveFileList'
import { isRetryableUploadError, runRendererUpload } from './drive/upload-client'
import { EXTERNAL_IMPORT_NOTICES, type ExternalImportId } from './drive/external-imports'

export interface DrivePageProps {
  workspaceId: string
  folderId?: string
}

type Notice = ExternalImportId

export default function DrivePage({ workspaceId, folderId }: DrivePageProps) {
  const { t } = useTranslation()
  const [quota, setQuota] = useState<DriveQuota | null>(null)
  const [listing, setListing] = useState<DriveListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [uploads, setUploads] = useState<DriveFileUploadProgress[]>([])
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')

  const currentFolderId = folderId ?? null

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false)
      setError(t('drive.errors.noWorkspace'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [nextQuota, nextListing] = await Promise.all([
        window.electronAPI.driveQuota(workspaceId),
        window.electronAPI.driveList(workspaceId, currentFolderId ?? undefined),
      ])
      setQuota(nextQuota)
      setListing(nextListing)
    } catch (cause) {
      setError(toErrorMessage(cause))
      setListing(null)
    } finally {
      setLoading(false)
    }
  }, [workspaceId, currentFolderId, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openFolder = useCallback((nextFolderId: string | null) => {
    navigate(routes.view.drive(nextFolderId ?? undefined))
  }, [])

  async function deleteFile(fileId: string) {
    try {
      await window.electronAPI.driveDelete(workspaceId, fileId)
      await refresh()
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  async function submitNewFolder() {
    const name = folderName.trim()
    if (!name) return
    try {
      await window.electronAPI.driveCreateFolder(workspaceId, currentFolderId ?? 'root', name)
      setFolderDialogOpen(false)
      setFolderName('')
      await refresh()
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  async function uploadBrowserFiles(files: FileList) {
    for (const file of Array.from(files)) {
      setUploads(previous => [...previous, { name: file.name, doneBytes: 0, totalBytes: file.size }])
      try {
        await runRendererUpload(window.electronAPI, {
          workspaceId,
          file,
          name: file.name,
          size: file.size,
          folderId: currentFolderId ?? undefined,
          source: 'upload',
          onProgress: progress => {
            setUploads(previous => previous.map(entry =>
              entry.name === file.name ? { ...entry, doneBytes: progress.doneBytes, totalBytes: file.size } : entry,
            ))
          },
        })
        setUploads(previous => previous.filter(entry => entry.name !== file.name))
      } catch (cause) {
        setUploads(previous => previous.filter(entry => entry.name !== file.name))
        setError(`${file.name}: ${toErrorMessage(cause)}${isRetryableUploadError(cause) ? ` (${t('drive.errors.retryable')})` : ''}`)
      }
    }
    await refresh()
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4" data-testid="drive-page">
      <DriveQuotaMeter quota={quota} />

      <DriveActionTiles
        onOpenBackup={() => setBackupOpen(true)}
        onGoogleImport={() => setNotice('google')}
        onOtherImport={() => setNotice('other')}
      />

      {notice && (
        <div role="status" data-testid={`drive-notice-${notice}`} data-available={String(EXTERNAL_IMPORT_NOTICES[notice].available)} className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 text-amber-500" />
          <div className="space-y-0.5">
            <p className="font-medium">{t(EXTERNAL_IMPORT_NOTICES[notice].titleKey)}</p>
            <p className="text-xs text-muted-foreground">{t(EXTERNAL_IMPORT_NOTICES[notice].bodyKey)}</p>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setNotice(null)}>{t('common.close')}</Button>
        </div>
      )}

      {backupOpen && (
        <BackupChooser
          workspaceId={workspaceId}
          api={window.electronAPI}
          onClose={() => setBackupOpen(false)}
          onUploaded={() => void refresh()}
        />
      )}

      {error && (
        <div role="alert" data-testid="drive-error" className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-500">
          {error}
        </div>
      )}

      <DriveFileList
        listing={listing}
        loading={loading}
        breadcrumb={(listing?.path ?? []).map(folder => ({ id: folder.id, name: folder.name }))}
        activeUploads={uploads}
        onOpenFolder={openFolder}
        onDeleteFile={fileId => void deleteFile(fileId)}
        onCreateFolder={() => setFolderDialogOpen(true)}
        onPickFiles={files => void uploadBrowserFiles(files)}
      />

      <RenameDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        title={t('drive.list.newFolder')}
        value={folderName}
        onValueChange={setFolderName}
        onSubmit={() => void submitNewFolder()}
        placeholder={t('drive.list.folderNamePlaceholder')}
      />
    </div>
  )
}