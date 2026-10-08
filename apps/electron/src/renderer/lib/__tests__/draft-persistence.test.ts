import { test, expect } from 'bun:test'
import { DraftPersistence } from '../draft-persistence'
test('a slow old write cannot overwrite a newer snapshot with attachments', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), written: string[] = []
  const queue = new DraftPersistence(async (_id, draft) => { if (draft.text === 'old') await gate; written.push(JSON.stringify(draft)) })
  void queue.save('session', { text: 'old' })
  const draft = { text: 'new', attachments: [{ path: '/fixture/file.txt', name: 'file.txt' }] }
  const done = queue.save('session', draft); draft.text = 'changed after scheduling'
  await Promise.resolve(); expect(written).toEqual([])
  release(); await done; await queue.flush()
  expect(written.map(value => JSON.parse(value).text)).toEqual(['old', 'new'])
  expect(JSON.parse(written[1]).attachments).toHaveLength(1)
})
test('retrying a flush recovers a transient failure without changing the draft', async () => {
  let fail = true
  const written: string[] = []
  const queue = new DraftPersistence(async (_id, draft) => { if (fail) throw new Error('offline'); written.push(draft.text) })
  await expect(queue.save('session', { text: 'preserve' })).rejects.toThrow('offline')
  fail = false
  await queue.flush()
  expect(written).toEqual(['preserve'])
})
test('a failed write is visible and an explicit new save recovers', async () => {
  const written: string[] = []
  const queue = new DraftPersistence(async (id, draft) => { if (draft.text === 'fail') throw new Error('write failed'); written.push(`${id}:${draft.text}`) })
  await expect(queue.save('a', { text: 'fail' })).rejects.toThrow('write failed')
  await expect(queue.flush()).rejects.toThrow('write failed')
  await queue.save('b', { text: 'independent' }); await queue.save('a', { text: 'retry' }); await queue.flush()
  expect(written).toEqual(['b:independent', 'a:retry'])
})
