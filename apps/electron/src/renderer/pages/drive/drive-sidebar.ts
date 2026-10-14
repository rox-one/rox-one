/**
 * Second-sidebar groups for Диск: Быстрый доступ / Папки / Хранилище, built
 * from the live drive listing + quota (no fixtures) into the shell contract.
 */
import { ArrowUp, CloudDownload, Folder, HardDrive, HardDriveUpload, Import } from 'lucide-react'
import type { DriveListing, DriveQuota } from '@rox/shared/drive'
import type { SidebarGroup } from '@/components/shell/screen-sidebar'

export interface DriveSidebarLabels {
  quick: string; myDrive: string; backup: string; importGoogle: string; importOther: string
  folders: string; up: string; storage: string
  /** Translated usage row for the quota (e.g. «1 ГБ из 1 ТБ», «999 ГБ свободно»). */
  usage(q: DriveQuota): { label: string; secondary: string }
  emptyFolders: string; newFolder: string; error: string
}

export interface DriveSidebarInput {
  listing: DriveListing | null
  quota: DriveQuota | null
  currentFolderId: string | null
  loading: boolean
  error: string | null
  labels: DriveSidebarLabels
  onOpenFolder(id: string | null): void
  onBackup(): void
  onImport(provider: 'google-drive' | undefined): void
  onCreateFolder(): void
  onRetry(): void
  /** Reveal the storage details (the page's quota meter). */
  onOpenStorage(): void
}

export function buildDriveSidebarGroups(input: DriveSidebarInput): SidebarGroup[] {
  const { labels: l } = input
  const quick: SidebarGroup = {
    id: 'quick',
    title: l.quick,
    initialVisible: 4,
    items: [
      { id: 'root', label: l.myDrive, icon: HardDrive, active: input.currentFolderId === null, onSelect: () => input.onOpenFolder(null) },
      { id: 'backup', label: l.backup, icon: HardDriveUpload, onSelect: input.onBackup },
      { id: 'import-google', label: l.importGoogle, icon: CloudDownload, onSelect: () => input.onImport('google-drive') },
      { id: 'import-other', label: l.importOther, icon: Import, onSelect: () => input.onImport(undefined) },
    ],
  }
  const newFolder = { id: 'new-folder', label: l.newFolder, onSelect: input.onCreateFolder }
  let folders: SidebarGroup
  // Only a failed listing load replaces the folders; action errors (upload,
  // move, create) are toasts and keep the loaded list.
  if (input.error && !input.listing) {
    folders = { id: 'folders', title: l.folders, items: [], state: { kind: 'error', label: l.error, onRetry: input.onRetry } }
  } else if (input.loading && (!input.listing || isStaleListing(input.listing, input.currentFolderId))) {
    // Navigated into another folder: never show the previous folder's children/«Up».
    folders = { id: 'folders', title: l.folders, items: [], state: { kind: 'loading' } }
  } else {
    const path = input.listing?.path ?? []
    const parent = path.length >= 2 ? path[path.length - 2]! : null
    const items = [
      ...(input.currentFolderId !== null
        ? [{ id: 'up', label: parent ? `${l.up} · ${parent.name}` : l.up, icon: ArrowUp, onSelect: () => input.onOpenFolder(parent && parent.parentId !== null ? parent.id : null) }]
        : []),
      ...(input.listing?.folders ?? []).map((f) => ({ id: `folder-${f.id}`, label: f.name, icon: Folder, onSelect: () => input.onOpenFolder(f.id) })),
    ]
    folders = {
      id: 'folders', title: l.folders, initialVisible: 8, items, actions: [newFolder],
      ...(items.length === 0 ? { state: { kind: 'empty' as const, label: l.emptyFolders, action: newFolder } } : {}),
    }
  }
  const groups = [quick, folders]
  if (input.quota) {
    const q = input.quota
    groups.push({
      id: 'storage',
      title: l.storage,
      items: [{
        id: 'usage',
        ...l.usage(q),
        icon: HardDrive,
        onSelect: input.onOpenStorage,
      }],
    })
  }
  return groups
}

/** The loaded listing belongs to a different folder than the one being opened. */
export function isStaleListing(listing: DriveListing, currentFolderId: string | null): boolean {
  return currentFolderId !== null ? listing.folderId !== currentFolderId : listing.path.length > 1
}
