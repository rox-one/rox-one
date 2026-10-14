import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { actorOrigin } from '../index.ts'
import { CanvasFileStore } from '../node/file-store.ts'

test('trashed board is listed and restorable with its content', async () => {
  const s = new CanvasFileStore(mkdtempSync(join(tmpdir(), 'trash-')))
  const { id } = await s.createBoard('Roadmap')
  const doc = await s.openBoard(id)
  doc.add([{ type: 'shape', x: 1, y: 2, w: 10, h: 10, props: { kind: 'rect' } }], actorOrigin('user','t'))
  await s.flush()
  await s.trashBoard(id)
  expect((await s.listBoards()).some(b => b.id === id)).toBe(false)
  const trash = await s.listTrash()
  expect(trash).toHaveLength(1)
  expect(trash[0]!.title).toBe('Roadmap')
  await s.restoreBoard(id, trash[0]!.stamp)
  expect((await s.listBoards()).map(b => b.title)).toContain('Roadmap')
  expect(await s.listTrash()).toHaveLength(0)
  const back = await s.openBoard(id)
  expect(back.list().length).toBe(1)
  await expect(s.restoreBoard(id, trash[0]!.stamp)).rejects.toThrow()
})
