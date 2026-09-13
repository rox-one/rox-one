import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeNotesEngine } from '@craft-agent/core/rox2'
import { MeetingNotePersistStore } from '../note-persist.ts'

const tmpDirs: string[] = []

beforeEach(() => {
  tmpDirs.push(mkdtempSync(join(tmpdir(), 'meeting-note-persist-')))
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

function root(): string {
  return tmpDirs[tmpDirs.length - 1]!
}

describe('MeetingNotePersistStore', () => {
  it('put then get returns the engine note and revision', () => {
    const store = new MeetingNotePersistStore(root())
    const note = createNativeNotesEngine().create('meeting-n1', '# Minutes\n\nok')
    const saved = store.put(note)
    expect(saved.note.noteId).toBe('meeting-n1')
    expect(saved.revision).toBe(note.revision)
    expect(saved.revision).not.toBe('1')
    expect(store.get('meeting-n1')?.revision).toBe(note.revision)
    expect(existsSync(join(store.dir, 'meeting-n1.json'))).toBe(true)
  })

  it('put is idempotent by id: same payload keeps revision', () => {
    const store = new MeetingNotePersistStore(root())
    const note = createNativeNotesEngine().create('meeting-n1', '# Minutes\n\nok')
    const first = store.put(note)
    const second = store.put(note)
    expect(second.revision).toBe(first.revision)
    expect(store.list()).toHaveLength(1)
  })

  it('changed markdown keeps one file and uses the new engine revision', () => {
    const store = new MeetingNotePersistStore(root())
    const engine = createNativeNotesEngine()
    const created = engine.create('meeting-n1', '# Minutes\n\nok')
    const first = store.put(created)
    const saved = engine.save({
      noteId: 'meeting-n1',
      markdown: '# Minutes\n\nupdated',
      expectedRevision: created.revision,
    })
    expect(saved.status).toBe('ok')
    if (saved.status !== 'ok') throw new Error('expected save')
    const updated = store.put(saved.note)
    expect(store.list()).toHaveLength(1)
    expect(updated.note.markdown).toContain('updated')
    expect(updated.revision).not.toBe(first.revision)
    expect(updated.revision).not.toBe('1')
  })

  it('re-open from the same dir yields the same note', () => {
    const store = new MeetingNotePersistStore(root())
    const note = createNativeNotesEngine().create('meeting-n1', '# Minutes\n\nok')
    store.put(note)
    const reopened = new MeetingNotePersistStore(root())
    expect(reopened.get('meeting-n1')?.note.markdown).toContain('ok')
    expect(reopened.get('meeting-n1')?.revision).toBe(note.revision)
    expect(createNativeNotesEngine(reopened.list()).read('meeting-n1')?.revision).toBe(note.revision)
  })

  it('refuses path-unsafe ids and does not write outside the store dir', () => {
    const store = new MeetingNotePersistStore(root())
    const note = createNativeNotesEngine().create('safe', '# A\n\n')
    expect(() => store.put({ ...note, noteId: '../escape', entityId: 'note:../escape' })).toThrow(TypeError)
    expect(store.get('../escape')).toBeNull()
    expect(store.list()).toEqual([])
    expect(readdirSync(root()).every((name) => name === 'meeting-notes' || !existsSync(join(root(), name, 'escape.json')))).toBe(true)
  })

  it('skips a corrupt record file without wiping siblings', () => {
    const store = new MeetingNotePersistStore(root())
    const good = createNativeNotesEngine().create('good', '# Keep\n\nme')
    store.put(good)
    writeFileSync(join(store.dir, 'bad.json'), 'not json {{{', 'utf8')
    expect(store.get('good')?.note.noteId).toBe('good')
    expect(store.get('bad')).toBeNull()
    expect(store.list().map((note) => note.noteId)).toEqual(['good'])
    expect(readFileSync(join(store.dir, 'bad.json'), 'utf8')).toBe('not json {{{')
  })
})
