import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { NoteCommentAnchor } from '@craft-agent/shared/protocol'
import {
  createNoteCommentForRoot,
  deleteNoteCommentForRoot,
  listNoteCommentsForRoot,
  updateNoteCommentForRoot,
} from './notes'

let notesRoot: string
let extraRoots: string[]

const anchor: NoteCommentAnchor = {
  selectedText: 'важный фрагмент',
  selectors: [
    { type: 'text-position', start: 4, end: 19 },
    { type: 'text-quote', exact: 'важный фрагмент', prefix: 'Это ', suffix: ' текста' },
  ],
}

beforeEach(() => {
  extraRoots = []
  notesRoot = join(tmpdir(), `rox-notes-comments-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(notesRoot, { recursive: true })
  writeFileSync(join(notesRoot, 'Daily.md'), 'Это важный фрагмент текста\n', 'utf-8')
})

afterEach(() => {
  rmSync(notesRoot, { recursive: true, force: true })
  for (const root of extraRoots) rmSync(root, { recursive: true, force: true })
})

function sidecarPath(noteId = 'Daily'): string {
  return join(notesRoot, '.rox', 'comments', `${Buffer.from(noteId, 'utf8').toString('base64url')}.json`)
}

function makeOutsideRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-notes-comments-outside-'))
  extraRoots.push(root)
  return root
}

describe('local note comment sidecars', () => {
  it('creates, lists, edits, resolves, reopens, and deletes comments', async () => {
    const created = await createNoteCommentForRoot(notesRoot, {
      noteId: 'Daily',
      body: 'Проверить формулировку',
      anchor,
    })

    expect(created.noteId).toBe('Daily')
    expect(created.author).toBe('Вы')
    expect(created.resolvedAt).toBeUndefined()
    expect(readdirSync(join(notesRoot, '.rox', 'comments')).length).toBe(1)

    const listed = await listNoteCommentsForRoot(notesRoot, 'Daily')
    expect(listed).toHaveLength(1)
    expect(listed[0].body).toBe('Проверить формулировку')

    const edited = await updateNoteCommentForRoot(notesRoot, {
      noteId: 'Daily',
      commentId: created.id,
      body: 'Уточнить термин',
    })
    expect(edited.body).toBe('Уточнить термин')

    const resolved = await updateNoteCommentForRoot(notesRoot, {
      noteId: 'Daily',
      commentId: created.id,
      resolved: true,
    })
    expect(typeof resolved.resolvedAt).toBe('number')

    const reopened = await updateNoteCommentForRoot(notesRoot, {
      noteId: 'Daily',
      commentId: created.id,
      resolved: false,
    })
    expect(reopened.resolvedAt).toBeUndefined()

    await deleteNoteCommentForRoot(notesRoot, 'Daily', created.id)
    expect(await listNoteCommentsForRoot(notesRoot, 'Daily')).toEqual([])
  })

  it('rejects comment creation for missing notes', async () => {
    await expect(createNoteCommentForRoot(notesRoot, {
      noteId: 'Missing',
      body: 'Нельзя сохранить без заметки',
      anchor,
    })).rejects.toThrow('Note not found')
  })

  it('rejects a symlinked comments directory without writing outside notes root', async () => {
    mkdirSync(join(notesRoot, '.rox'), { recursive: true })
    const outsideRoot = makeOutsideRoot()
    symlinkSync(outsideRoot, join(notesRoot, '.rox', 'comments'))

    await expect(createNoteCommentForRoot(notesRoot, {
      noteId: 'Daily',
      body: 'Не уходить наружу',
      anchor,
    })).rejects.toThrow(/Invalid note (path|comments path)/)

    expect(readdirSync(outsideRoot)).toEqual([])
  })

  it('rejects a symlinked comment sidecar file without overwriting its target', async () => {
    mkdirSync(join(notesRoot, '.rox', 'comments'), { recursive: true })
    const outsideRoot = makeOutsideRoot()
    const outsideFile = join(outsideRoot, 'Daily.json')
    writeFileSync(outsideFile, 'outside-data', 'utf-8')
    symlinkSync(outsideFile, sidecarPath())

    await expect(createNoteCommentForRoot(notesRoot, {
      noteId: 'Daily',
      body: 'Не переписывать symlink target',
      anchor,
    })).rejects.toThrow('Invalid note comments path')

    expect(readFileSync(outsideFile, 'utf-8')).toBe('outside-data')
    expect(existsSync(sidecarPath())).toBe(true)
  })

  it('preserves both comments created in parallel for the same note', async () => {
    await Promise.all([
      createNoteCommentForRoot(notesRoot, { noteId: 'Daily', body: 'Первый параллельный', anchor }),
      createNoteCommentForRoot(notesRoot, { noteId: 'Daily', body: 'Второй параллельный', anchor }),
    ])

    const listed = await listNoteCommentsForRoot(notesRoot, 'Daily')
    expect(listed.map(comment => comment.body).sort()).toEqual(['Второй параллельный', 'Первый параллельный'].sort())
  })

  it('serializes concurrent update and delete in invocation order', async () => {
    const first = await createNoteCommentForRoot(notesRoot, {
      noteId: 'Daily',
      body: 'Сначала обновить',
      anchor,
    })

    const [updated] = await Promise.all([
      updateNoteCommentForRoot(notesRoot, {
        noteId: 'Daily',
        commentId: first.id,
        resolved: true,
      }),
      deleteNoteCommentForRoot(notesRoot, 'Daily', first.id),
    ])

    expect(updated.resolvedAt).toBeNumber()
    expect(await listNoteCommentsForRoot(notesRoot, 'Daily')).toEqual([])

    const second = await createNoteCommentForRoot(notesRoot, {
      noteId: 'Daily',
      body: 'Сначала удалить',
      anchor,
    })

    const results = await Promise.allSettled([
      deleteNoteCommentForRoot(notesRoot, 'Daily', second.id),
      updateNoteCommentForRoot(notesRoot, {
        noteId: 'Daily',
        commentId: second.id,
        body: 'Это обновление должно увидеть удаление',
      }),
    ])

    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
    if (results[1].status === 'rejected') {
      expect(results[1].reason).toBeInstanceOf(Error)
      expect((results[1].reason as Error).message).toContain(`Comment not found: ${second.id}`)
    }
    expect(await listNoteCommentsForRoot(notesRoot, 'Daily')).toEqual([])
  })
})
