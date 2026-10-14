import { expect, test } from 'bun:test'
import { actorOrigin, applyEntitySnapshot, CanvasDoc, createEntityCard, EntityKindRegistry, entityCards, linkEntityCard, removeEntityCards, type EntityCardContext, type EntityRef } from '../index.ts'

function setup() {
  const store = new Map<string, { title: string; status?: string }>()
  const links: string[] = []
  const deleted: string[] = []
  const registry = new EntityKindRegistry()
  registry.register({
    kind: 'task', labelKey: 'k.task', icon: 'ListTodo', creatable: true,
    async create({ title }) { const id = `t${store.size + 1}`; store.set(id, { title, status: 'todo' }); return { kind: 'task', id } },
    async read(ref) { return store.get(ref.id) ?? null },
    open() {},
    async delete(ref) { deleted.push(ref.id); store.delete(ref.id) },
  })
  registry.register({ kind: 'session', labelKey: 'k.s', icon: 'M', creatable: false, async read(r) { return { title: `S ${r.id}` } }, open() {} })
  const ctx: EntityCardContext = {
    board: new CanvasDoc(), boardId: 'b1', workspaceId: 'w1', registry, origin: actorOrigin('user', 'u'),
    linker: {
      async link(f, to: EntityRef) { links.push(`+${f.boardId}#${f.objectId}->${to.kind}:${to.id}`) },
      async unlink(f, to: EntityRef) { links.push(`-${f.boardId}#${f.objectId}->${to.kind}:${to.id}`) },
    },
  }
  return { ctx, store, links, deleted, registry }
}

test('create mints a real entity, places a card and links it', async () => {
  const { ctx, store, links } = setup()
  const id = await createEntityCard(ctx, 'task', 'Ship it', { x: 0, y: 0 })
  expect(store.get('t1')?.title).toBe('Ship it')
  expect(links).toEqual([`+b1#${id}->task:t1`])
  expect(ctx.board.get(id)!.props.provenance).toBe('created')
  await expect(createEntityCard(ctx, 'session', 'x', { x: 0, y: 0 })).rejects.toThrow()
})

test('dropping an existing entity links it; snapshot updates show on the card', async () => {
  const { ctx } = setup()
  const id = await linkEntityCard(ctx, { kind: 'session', id: 's9' }, { x: 1, y: 1 })
  expect((ctx.board.get(id)!.props.snapshot as { title: string }).title).toBe('S s9')
  applyEntitySnapshot(ctx.board, id, { title: 'Renamed', status: 'done' }, ctx.origin)
  expect(ctx.board.get(id)!.props.snapshot).toEqual({ title: 'Renamed', status: 'done' })
  expect(entityCards(ctx.board)).toEqual([{ objectId: id, ref: { kind: 'session', id: 's9' } }])
})

test('deleting a card unlinks; the entity is deleted only on explicit choice', async () => {
  const { ctx, store, links, deleted } = setup()
  const a = await createEntityCard(ctx, 'task', 'A', { x: 0, y: 0 })
  const b = await createEntityCard(ctx, 'task', 'B', { x: 0, y: 0 })
  await removeEntityCards(ctx, [a])
  expect(store.has('t1')).toBe(true)
  expect(links).toContain(`-b1#${a}->task:t1`)
  await removeEntityCards(ctx, [b], { deleteEntities: true })
  expect(deleted).toEqual(['t2'])
})

test('registry is generic: new kinds plug in and notify', () => {
  const { registry } = setup()
  let changed = 0
  registry.onChange(() => changed++)
  const off = registry.register({ kind: 'dashboard', labelKey: 'k.d', icon: 'G', creatable: true, async create() { return { kind: 'dashboard', id: 'd' } }, async read() { return null }, open() {} })
  expect(registry.creatable().map(a => a.kind)).toEqual(['task', 'dashboard'])
  off()
  expect(changed).toBe(2)
  expect(() => registry.register({ kind: 'task', labelKey: '', icon: '', creatable: false, async read() { return null }, open() {} })).toThrow()
})
