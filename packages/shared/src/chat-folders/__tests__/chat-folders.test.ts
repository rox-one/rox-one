import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyChatFoldersOp,
  groupSessionsByFolder,
  normalizeChatFoldersState,
} from '../ops.ts'
import { EMPTY_CHAT_FOLDERS, type ChatFoldersState } from '../types.ts'
import { chatFoldersPath, loadChatFolders, mutateChatFolders } from '../storage.ts'

const base = (): ChatFoldersState => applyChatFoldersOp(
  applyChatFoldersOp(EMPTY_CHAT_FOLDERS, { kind: 'create', name: 'Work', id: 'a' }, 1),
  { kind: 'create', name: 'Home', id: 'b' }, 2)

describe('chat folders ops', () => {
  it('creates, renames, reorders', () => {
    let s = base()
    expect(s.folders.map(f => f.name)).toEqual(['Work', 'Home'])
    s = applyChatFoldersOp(s, { kind: 'rename', folderId: 'a', name: '  Job \n stuff ' })
    expect(s.folders[0]!.name).toBe('Job stuff')
    s = applyChatFoldersOp(s, { kind: 'reorder', folderIds: ['b'] })
    expect(s.folders.map(f => f.id)).toEqual(['b', 'a'])
  })

  it('rejects blank names, duplicate ids and unknown folders', () => {
    expect(() => applyChatFoldersOp(base(), { kind: 'create', name: '   ' })).toThrow()
    expect(() => applyChatFoldersOp(base(), { kind: 'create', name: 'x', id: 'a' })).toThrow()
    expect(() => applyChatFoldersOp(base(), { kind: 'move', sessionIds: ['s1'], folderId: 'zzz' })).toThrow()
    expect(() => applyChatFoldersOp(base(), { kind: 'rename', folderId: 'zzz', name: 'x' })).toThrow()
  })

  it('moves chats and un-assigns on delete (chats are never deleted)', () => {
    let s = applyChatFoldersOp(base(), { kind: 'move', sessionIds: ['s1', 's2'], folderId: 'a' })
    expect(s.assignments).toEqual({ s1: 'a', s2: 'a' })
    s = applyChatFoldersOp(s, { kind: 'move', sessionIds: ['s2'], folderId: null })
    expect({ ...s.assignments }).toEqual({ s1: 'a' })
    s = applyChatFoldersOp(s, { kind: 'delete', folderId: 'a' })
    expect({ ...s.assignments }).toEqual({})
    expect(s.folders.map(f => f.id)).toEqual(['b'])
  })

  it('refuses prototype-polluting session ids', () => {
    expect(() => applyChatFoldersOp(base(), { kind: 'move', sessionIds: ['__proto__'], folderId: 'a' })).toThrow()
    const s = normalizeChatFoldersState(JSON.parse('{"folders":[{"id":"a","name":"A"}],"assignments":{"__proto__":"a","ok":"a","bad":"missing"}}'))
    expect(Object.keys(s.assignments)).toEqual(['ok'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('normalizes garbage input', () => {
    expect(normalizeChatFoldersState('nope')).toEqual({ version: 1, folders: [], assignments: {} })
    const s = normalizeChatFoldersState({ folders: [{ id: 'a', name: 'A' }, { id: 'a', name: 'dup' }, { id: 'bad id!', name: 'x' }, { id: 'c', name: '' }] })
    expect(s.folders.map(f => f.id)).toEqual(['a'])
  })

  it('groups by folder with Ungrouped last, newest first', () => {
    const s = applyChatFoldersOp(base(), { kind: 'move', sessionIds: ['s1', 's3'], folderId: 'b' })
    const groups = groupSessionsByFolder([
      { id: 's1', lastMessageAt: 1 }, { id: 's2', lastMessageAt: 5 }, { id: 's3', lastMessageAt: 9 },
    ], s)
    expect(groups.map(g => g.folder?.id ?? null)).toEqual(['a', 'b', null])
    expect(groups[1]!.items.map(i => i.id)).toEqual(['s3', 's1'])
    expect(groups[2]!.items.map(i => i.id)).toEqual(['s2'])
    expect(groupSessionsByFolder([{ id: 'x' }], base()).at(-1)!.folder).toBeNull()
    expect(groupSessionsByFolder([], EMPTY_CHAT_FOLDERS)).toEqual([{ folder: null, items: [] }])
  })
})

describe('chat folders storage', () => {
  it('persists to chat-folders.json and survives a corrupt file', () => {
    const root = mkdtempSync(join(tmpdir(), 'chat-folders-'))
    try {
      expect(loadChatFolders(root)).toEqual({ version: 1, folders: [], assignments: {} })
      mutateChatFolders(root, { kind: 'create', name: 'Work', id: 'w' })
      mutateChatFolders(root, { kind: 'move', sessionIds: ['s1'], folderId: 'w' })
      const disk = JSON.parse(readFileSync(chatFoldersPath(root), 'utf8'))
      expect(disk.folders[0].name).toBe('Work')
      expect(disk.assignments).toEqual({ s1: 'w' })
      expect(loadChatFolders(root).assignments.s1).toBe('w')
      writeFileSync(chatFoldersPath(root), '{not json')
      expect(loadChatFolders(root).folders).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
