import { describe, expect, it } from 'bun:test'
import {
  composeFolderGroups,
  effectiveFolderAssignments,
  folderIdFromGroupKey,
  snapshotFolder,
  UNGROUPED_FOLDER_KEY,
} from '../chat-folders-model'
import { applyChatFoldersOp } from '@rox/shared/chat-folders'

const folders = [{ id: 'a', name: 'Research', createdAt: 0 }, { id: 'b', name: 'Empty', createdAt: 0 }]
const modeGroups = [
  { key: '2026-10-14', label: 'Today', items: ['s2'], collapsible: true },
  { key: '2026-10-13', label: 'Yesterday', items: [] as string[], collapsible: true, collapsedCount: 4 },
]

describe('composeFolderGroups', () => {
  it('is a no-op without folders', () => {
    const r = composeFolderGroups({ folders: [], folderRows: new Map(), collapsedMeta: [], modeGroups, ungroupedLabel: 'U' })
    expect(r.groups).toBe(modeGroups)
  })
  it('puts folders first (empty ones too), then the Ungrouped header, then mode groups', () => {
    const r = composeFolderGroups({
      folders,
      folderRows: new Map([['a', ['s1']]]),
      collapsedMeta: [],
      modeGroups,
      ungroupedLabel: 'Без папки',
    })
    expect(r.groups.map(g => g.key)).toEqual(['folder:a', 'folder:b', UNGROUPED_FOLDER_KEY, '2026-10-14', '2026-10-13'])
    expect(r.groups[1]!.items).toEqual([])
    expect(r.headers.get(UNGROUPED_FOLDER_KEY)).toEqual({ kind: 'ungrouped', count: 5 })
    expect(r.headers.get('folder:a')!.count).toBe(1)
  })
  it('uses collapsed counts for collapsed folders', () => {
    const r = composeFolderGroups({ folders, folderRows: new Map(), collapsedMeta: [{ key: 'folder:a', count: 7 }], modeGroups: [], ungroupedLabel: 'U' })
    expect(r.groups[0]!.collapsedCount).toBe(7)
    expect(r.headers.get('folder:a')!.count).toBe(7)
  })
})

describe('keys and assignments', () => {
  it('parses folder group keys', () => {
    expect(folderIdFromGroupKey('folder:a')).toBe('a')
    expect(folderIdFromGroupKey(UNGROUPED_FOLDER_KEY)).toBeNull()
    expect(folderIdFromGroupKey('status-todo')).toBeUndefined()
  })
  it('ignores assignments to missing folders', () => {
    const eff = effectiveFolderAssignments({ version: 1, folders, assignments: { s1: 'a', s2: 'gone' } })
    expect({ ...eff }).toEqual({ s1: 'a' })
  })
  it('snapshots a folder for undo and restores it', () => {
    let s = { version: 1 as const, folders, assignments: { s1: 'a', s2: 'a', s3: 'b' } as Record<string, string> }
    const snap = snapshotFolder(s, 'a')!
    expect(snap.sessionIds.sort()).toEqual(['s1', 's2'])
    s = applyChatFoldersOp(s, { kind: 'delete', folderId: 'a' })
    s = applyChatFoldersOp(s, { kind: 'move', sessionIds: ['s2'], folderId: 'b' }) // re-filed after delete
    s = applyChatFoldersOp(s, { kind: 'restore', folderId: snap.folder.id, name: snap.folder.name, index: snap.index, sessionIds: snap.sessionIds })
    expect(s.folders.map(f => f.id)).toEqual(['a', 'b'])
    expect({ ...s.assignments }).toEqual({ s1: 'a', s2: 'b', s3: 'b' })
  })
})
