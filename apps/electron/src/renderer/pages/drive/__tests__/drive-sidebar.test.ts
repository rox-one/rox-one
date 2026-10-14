import { describe, expect, it, mock } from 'bun:test'
import type { DriveListing, DriveQuota } from '@rox/shared/drive'
import { buildDriveSidebarGroups, type DriveSidebarInput } from '../drive-sidebar'

const labels = {
  quick: 'Q', myDrive: 'My', backup: 'B', importGoogle: 'G', importOther: 'O', folders: 'F', up: 'Up',
  storage: 'S', usage: (q: DriveQuota) => ({ label: `${q.usedBytes}/${q.totalBytes}`, secondary: `${q.freeBytes}` }),
  emptyFolders: 'None', newFolder: 'New', error: 'Err',
}
const folder = (id: string, name: string, parentId: string | null) => ({ id, name, parentId, createdAt: '2026-10-01T00:00:00Z' })
function input(o: Partial<DriveSidebarInput>): DriveSidebarInput {
  return { listing: null, quota: null, currentFolderId: null, loading: false, error: null, labels,
    onOpenFolder: mock(), onBackup: mock(), onImport: mock(), onCreateFolder: mock(), onRetry: mock(), ...o }
}

describe('buildDriveSidebarGroups', () => {
  it('quick access rows are wired', () => {
    const onImport = mock(); const onBackup = mock(); const onOpenFolder = mock()
    const g = buildDriveSidebarGroups(input({ onImport, onBackup, onOpenFolder }))
    const quick = g[0]!
    expect(quick.items.map((i) => i.id)).toEqual(['root', 'backup', 'import-google', 'import-other'])
    expect(quick.items[0]!.active).toBe(true)
    quick.items[0]!.onSelect(); quick.items[1]!.onSelect(); quick.items[2]!.onSelect(); quick.items[3]!.onSelect()
    expect(onOpenFolder).toHaveBeenCalledWith(null)
    expect(onBackup).toHaveBeenCalled()
    expect(onImport.mock.calls).toEqual([['google-drive'], [undefined]])
  })
  it('lists subfolders and an up row inside a folder', () => {
    const root = folder('root', 'Мой диск', null); const a = folder('a', 'A', 'root'); const b = folder('b', 'B', 'a')
    const listing = { folderId: 'b', path: [root, a, b], folders: [folder('c', 'C', 'b')], files: [] } as DriveListing
    const onOpenFolder = mock()
    const g = buildDriveSidebarGroups(input({ listing, currentFolderId: 'b', onOpenFolder }))
    const folders = g.find((x) => x.id === 'folders')!
    expect(folders.items.map((i) => i.id)).toEqual(['up', 'folder-c'])
    folders.items[0]!.onSelect()
    expect(onOpenFolder).toHaveBeenCalledWith('a')
    folders.items[1]!.onSelect()
    expect(onOpenFolder).toHaveBeenCalledWith('c')
  })
  it('up from a first-level folder goes to root', () => {
    const root = folder('root', 'Мой диск', null); const a = folder('a', 'A', 'root')
    const onOpenFolder = mock()
    const g = buildDriveSidebarGroups(input({ listing: { folderId: 'a', path: [root, a], folders: [], files: [] } as DriveListing, currentFolderId: 'a', onOpenFolder }))
    g.find((x) => x.id === 'folders')!.items[0]!.onSelect()
    expect(onOpenFolder).toHaveBeenCalledWith(null)
  })
  it('empty, loading, error states and storage row', () => {
    const empty = buildDriveSidebarGroups(input({ listing: { folderId: 'root', path: [], folders: [], files: [] } as DriveListing }))
    expect(empty.find((x) => x.id === 'folders')!.state?.kind).toBe('empty')
    expect(buildDriveSidebarGroups(input({ loading: true })).find((x) => x.id === 'folders')!.state).toEqual({ kind: 'loading' })
    const onRetry = mock()
    const err = buildDriveSidebarGroups(input({ error: 'x', onRetry })).find((x) => x.id === 'folders')!.state
    if (err?.kind === 'error') err.onRetry()
    expect(onRetry).toHaveBeenCalled()
    const quota = { totalBytes: 10, usedBytes: 3, reservedBytes: 0, freeBytes: 7 }
    const storage = buildDriveSidebarGroups(input({ quota })).find((x) => x.id === 'storage')!
    expect(storage.items[0]!.label).toBe('3/10')
    expect(storage.items[0]!.secondary).toBe('7')
  })
})
