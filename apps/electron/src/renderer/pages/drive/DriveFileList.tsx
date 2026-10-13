/**
 * DriveFileList — folders and files of one Drive folder.
 *
 * «Мой диск» is the root. Folder rows navigate; file rows show size, source and
 * a delete action. Empty folders show an honest empty state with the two ways
 * to add content (browser upload / device backup), never a fake spinner.
 */
import { useTranslation } from 'react-i18next'
import { File as FileIcon, Folder, HardDriveUpload, Loader2, Trash2 } from 'lucide-react'
import type { DriveFile, DriveListing } from '@rox/shared/drive'
import { Button } from '@/components/ui/button'
import { formatBytes } from './format'

export interface DriveFileUploadProgress {
  name: string
  doneBytes: number
  totalBytes: number
}

export interface DriveFileListProps {
  listing: DriveListing | null
  loading: boolean
  breadcrumb: Array<{ id: string; name: string }>
  activeUploads: DriveFileUploadProgress[]
  onOpenFolder: (folderId: string | null) => void
  onDeleteFile: (fileId: string) => void
  onCreateFolder: () => void
  onPickFiles: (files: FileList) => void
}

const SOURCE_LABEL_KEY: Record<DriveFile['source'], string> = {
  upload: 'drive.source.upload',
  'device-backup': 'drive.source.deviceBackup',
  import: 'drive.source.import',
}

export function DriveFileList({
  listing, loading, breadcrumb, activeUploads, onOpenFolder, onDeleteFile, onCreateFolder, onPickFiles,
}: DriveFileListProps) {
  const { t } = useTranslation()
  return (
    <section data-testid="drive-file-list" className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-card/60">
      <header className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
        <nav aria-label={t('drive.list.breadcrumb')} className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
          {breadcrumb.map((crumb, index) => (
            <span key={crumb.id} className="flex items-center gap-1">
              {index > 0 && <span aria-hidden="true">/</span>}
              <button
                type="button"
                className="truncate hover:text-foreground"
                onClick={() => onOpenFolder(crumb.id === 'root' ? null : crumb.id)}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
        <Button variant="ghost" size="sm" onClick={onCreateFolder}>{t('drive.list.newFolder')}</Button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs hover:border-primary/50">
          <HardDriveUpload className="icon-caption" />
          {t('drive.list.upload')}
          <input
            type="file"
            multiple
            hidden
            data-testid="drive-file-input"
            onChange={event => {
              if (event.target.files && event.target.files.length > 0) onPickFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </label>
      </header>

      {activeUploads.length > 0 && (
        <ul className="space-y-1 border-b border-border/50 px-3 py-2" data-testid="drive-active-uploads">
          {activeUploads.map(upload => (
            <li key={upload.name} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="icon-status animate-spin" />
              <span className="truncate">{upload.name}</span>
              <span className="ml-auto numeric">{formatBytes(upload.doneBytes)} / {formatBytes(upload.totalBytes)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p role="status" className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 className="icon-toolbar animate-spin" />{t('common.loading')}
          </p>
        ) : !listing || (listing.folders.length === 0 && listing.files.length === 0) ? (
          <p className="p-3 text-sm text-muted-foreground" data-testid="drive-empty">{t('drive.list.empty')}</p>
        ) : (
          <ul className="space-y-0.5">
            {listing.folders.map(folder => (
              <li key={folder.id}>
                <button
                  type="button"
                  data-testid={`drive-folder-${folder.id}`}
                  onClick={() => onOpenFolder(folder.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                >
                  <Folder className="icon-toolbar text-primary/80" />
                  <span className="truncate">{folder.name}</span>
                </button>
              </li>
            ))}
            {listing.files.map(file => (
              <li key={file.id} data-testid={`drive-file-${file.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                <FileIcon className="icon-toolbar text-muted-foreground" />
                <span className="truncate">{file.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">{t(SOURCE_LABEL_KEY[file.source])}</span>
                <span className="ml-auto numeric text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('drive.list.delete')}
                  onClick={() => onDeleteFile(file.id)}
                >
                  <Trash2 className="icon-caption" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}