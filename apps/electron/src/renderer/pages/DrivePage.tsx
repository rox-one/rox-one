/**
 * DrivePage — ROX Drive host.
 *
 * Layout: quota meter, the three fixed action tiles, and the folder/file list.
 * The two import tiles open `ImportFlowDialog`, which drives the real
 * `drive:import*` pipeline (device-code auth → plan/start → progress). Uploads
 * run through `runRendererUpload` (8 parallel 16 MiB parts) and device backups
 * reuse the same pipeline with `source: 'device-backup'`.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DriveListing, DriveQuota } from '@rox/shared/drive'
import type { ImportProviderId } from '@rox/shared/drive/importers/types'
import { navigate, routes } from '@/lib/navigate'
import { toErrorMessage } from '@/lib/errors'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { DriveQuotaMeter } from './drive/DriveQuotaMeter'
import { DriveActionTiles } from './drive/DriveActionTiles'
import { DriveAppDataSection } from './drive/DriveAppDataSection'
import { BackupChooser } from './drive/BackupChooser'
import { ImportFlowDialog } from './drive/ImportFlowDialog'
import { DriveFileList, type DriveFileUploadProgress } from './drive/DriveFileList'
import { isRetryableUploadError, runRendererUpload } from './drive/upload-client'

export interface DrivePageProps {
  workspaceId: string
  folderId?: string
}

export default function DrivePage({ workspaceId, folderId }: DrivePageProps) {
  const { t } = useTranslation()
  const [quota, setQuota] = useState<DriveQuota | null>(null)
  const [listing, setListing] = useState<DriveListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importProvider, setImportProvider] = useState<ImportProviderId | undefined>(undefined)
  const [backupOpen, setBackupOpen] = useState(false)
  const [uploads, setUploads] = useState<DriveFileUploadProgress[]>([])
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')

  const currentFolderId = folderId ?? null

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false)
      setErrorText(t('drive.errors.noWorkspace'))
      return
    }
    setLoading(true)
    setErrorText(null)
    try {
      const [nextQuota, nextListing] = await Promise.all([
        window.electronAPI.driveQuota(workspaceId),
        window.electronAPI.driveList(workspaceId, currentFolderId ?? undefined),
      ])
      setQuota(nextQuota)
      setListing(nextListing)
    } catch (cause) {
      setErrorText(toErrorMessage(cause))
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
      setErrorText(toErrorMessage(cause))
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
      setErrorText(toErrorMessage(cause))
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
        setErrorText(`${file.name}: ${toErrorMessage(cause)}${isRetryableUploadError(cause) ? ` (${t('drive.errors.retryable')})` : ''}`)
      }
    }
    await refresh()
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4" data-testid="drive-page">
      <DriveQuotaMeter quota={quota} />

      <DriveActionTiles
        onOpenBackup={() => setBackupOpen(true)}
        onGoogleImport={() => {
          setImportProvider('google-drive')
          setImportOpen(true)
        }}
        onOtherImport={() => {
          setImportProvider(undefined)
          setImportOpen(true)
        }}
      />

      <DriveAppDataSection onOpenBackup={() => setBackupOpen(true)} />

      <ImportFlowDialog
        open={importOpen}
        initialProvider={importProvider}
        api={window.electronAPI}
        onOpenChange={next => {
          setImportOpen(next)
          if (!next) void refresh()
        }}
      />

      {backupOpen && (
        <BackupChooser
          workspaceId={workspaceId}
          api={window.electronAPI}
          onClose={() => setBackupOpen(false)}
          onUploaded={() => void refresh()}
        />
      )}

      {errorText && (
        <div role="alert" data-testid="drive-error" className="rounded-lg border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {errorText}
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