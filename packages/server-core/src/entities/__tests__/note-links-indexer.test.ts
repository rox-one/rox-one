/**
 * W1-02 (#1499) note-mention indexer units (fix5 B + review 4): explicit-
 * syntax extraction from Markdown, atomic idempotent reconcile limited to
 * indexer-owned rows, silent anchor refresh, emoji-safe prefix cleanup,
 * native-path ordering, phantom-source pruning, extraction caps, flag-off
 * inertia.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeEntityLinkStores, EntityLinkStore, getEntityLinkStore } from '../link-store.ts'
import {
  __resetNoteLinksPruneStateForTests,
  createNoteLinksIndexer,
  createNoteLinksSerializer,
  ensureNoteLinksPruned,
  extractNoteLinks,
  noteLinkSourceExists,
  NOTE_LINKS_INDEXER_ACTOR,
  NOTE_LINKS_INDEXER_OWNERSHIP,
  NOTE_LINKS_MAX_LINE_CHARS,
  NOTE_LINKS_MAX_SCAN_BYTES,
  observeEntitiesLinksEnabled,
  setNoteLinksSourceProbe,
} from '../note-links-indexer.ts'

const OWNER = { createdBy: 'a', relations: ['mentions', 'embeds'] as const }

const roots: string[] = []
const tempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'rox-note-links-unit-'))
  roots.push(root)
  return root
}
afterEach(() => {
  closeEntityLinkStores()
  __resetNoteLinksPruneStateForTests()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('extractNoteLinks (explicit syntax only)', () => {
  it('links wikilinks, embeds, plain titles and rox:// with first-occurrence lines', () => {
    const md = ['# Title', 'See [[task:42|Fix]] and ![[note:Plan]].', 'rox://goals/goal/g1, [[Итоги#Решения]], [[task:42]] again'].join('\n')
    expect(extractNoteLinks(md)).toEqual([
      { to: { kind: 'task', id: '42' }, relation: 'mentions', line: 2 },
      { to: { kind: 'note', id: 'Plan' }, relation: 'embeds', line: 2 },
      { to: { kind: 'note', id: 'Итоги' }, relation: 'mentions', line: 3 },
      { to: { kind: 'goal', id: 'g1' }, relation: 'mentions', line: 3 },
    ])
  })

  it('never links bare kind:id, URLs or escaped wikilinks', () => {
    expect(extractNoteLinks('task:42 doc:2 user:admin file:///Users/x https://example.com/doc:2 \\[\\[task:1\\]\\]')).toEqual([])
  })

  it('applies the approved note-title rules', () => {
    expect(extractNoteLinks('[[Встреча: итоги]] [[Проект:Альфа]]').map(link => link.to)).toEqual([
      { kind: 'note', id: 'Встреча: итоги' },
      { kind: 'note', id: 'Проект:Альфа' },
    ])
  })

  it('skips frontmatter, fenced code blocks and inline code', () => {
    const md = [
      '---', 'related: "[[task:fm]]"', '---',
      '`[[task:inline]]` and ``[[task:double]]``',
      '```ts', '[[task:fenced]]', '```',
      '~~~~', '[[task:tilde]]', '~~~', 'still fenced [[task:still]]', '~~~~',
      'after [[task:after]]',
    ].join('\n')
    expect(extractNoteLinks(md).map(link => link.to.id)).toEqual(['after'])
  })

  it('drops self links', () => {
    expect(extractNoteLinks('[[note:me]] [[task:1]]', { kind: 'note', id: 'me' }).map(link => link.to.id)).toEqual(['1'])
  })
})

describe('EntityLinkStore.replaceOutgoing', () => {
  const from = { kind: 'note' as const, id: 'n1' }
  it('adds, keeps, refreshes anchors silently and removes stale links; idempotent', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    const other = { kind: 'note' as const, id: 'n2' }
    store.add({ from: other, to: { kind: 'task', id: 't9' }, relation: 'mentions', createdBy: 'a' })
    expect(store.replaceOutgoing(from, [
      { to: { kind: 'task', id: 't1' }, relation: 'mentions', anchor: { line: 1 } },
      { to: { kind: 'task', id: 't2' }, relation: 'mentions', anchor: { line: 2 } },
      { to: { kind: 'task', id: 't1' }, relation: 'mentions', anchor: { line: 9 } },
    ], OWNER)).toEqual({ added: 2, removed: 0, refreshed: 0 })
    expect(store.replaceOutgoing(from, [
      { to: { kind: 'task', id: 't1' }, relation: 'mentions', anchor: { line: 1 } },
      { to: { kind: 'task', id: 't2' }, relation: 'mentions', anchor: { line: 2 } },
    ], OWNER)).toEqual({ added: 0, removed: 0, refreshed: 0 })
    const t1Before = store.outgoing(from).find(link => link.to.id === 't1')!
    expect(store.replaceOutgoing(from, [
      { to: { kind: 'task', id: 't1' }, relation: 'mentions', anchor: { line: 5 } },
      { to: { kind: 'task', id: 't3' }, relation: 'embeds' },
    ], OWNER)).toEqual({ added: 1, removed: 1, refreshed: 1 })
    const links = store.outgoing(from)
    expect(links.map(link => `${link.relation}:${link.to.id}`).sort()).toEqual(['embeds:t3', 'mentions:t1'])
    const t1After = links.find(link => link.to.id === 't1')!
    expect(t1After.linkId).toBe(t1Before.linkId)
    expect(t1After.anchor).toEqual({ line: 5 })
    // Review 4 #2: an anchor move is not a link change — no revision bump.
    expect(t1After.revision).toBe(t1Before.revision)
    // Other notes' links are untouched.
    expect(store.outgoing(other)).toHaveLength(1)
    expect(store.replaceOutgoing(from, [], OWNER)).toEqual({ added: 0, removed: 2, refreshed: 0 })
    expect(store.count()).toBe(1)
    store.close()
  })

  it('reconciles only owned rows: manual links (other relation, author, role, anchor) survive (review 4 #1)', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    // A manual `relates-to` link and a manual same-key `mentions` with a role/anchor.
    store.add({ from, to: { kind: 'goal', id: 'g1' }, relation: 'relates-to', createdBy: 'user-1' })
    const manual = store.add({ from, to: { kind: 'task', id: 't1' }, relation: 'mentions', role: 'owner', anchor: { blockId: 'b7' }, createdBy: 'user-1' })
    // Indexer saves: t1 (same key as the manual row) + t2; then t2 only; then nothing.
    expect(store.replaceOutgoing(from, [
      { to: { kind: 'task', id: 't1' }, relation: 'mentions', anchor: { line: 3 } },
      { to: { kind: 'task', id: 't2' }, relation: 'mentions', anchor: { line: 4 } },
    ], OWNER)).toEqual({ added: 1, removed: 0, refreshed: 0 })
    expect(store.replaceOutgoing(from, [{ to: { kind: 'task', id: 't2' }, relation: 'mentions', anchor: { line: 1 } }], OWNER))
      .toEqual({ added: 0, removed: 0, refreshed: 1 })
    expect(store.replaceOutgoing(from, [], OWNER)).toEqual({ added: 0, removed: 1, refreshed: 0 })
    const left = store.outgoing(from)
    expect(left.map(link => `${link.relation}:${link.to.id}:${link.createdBy}`).sort()).toEqual(['mentions:t1:user-1', 'relates-to:g1:user-1'])
    const t1 = left.find(link => link.to.id === 't1')!
    expect(t1).toEqual(manual)
    // Desired links outside the owned relations are ignored, never written.
    expect(store.replaceOutgoing(from, [{ to: { kind: 'task', id: 'x' }, relation: 'relates-to' }], OWNER)).toEqual({ added: 0, removed: 0, refreshed: 0 })
    // Owner-scoped deletes leave manual rows too.
    expect(store.removeOutgoing(from, OWNER)).toBe(0)
    expect(store.removeOutgoingByIdPrefix('note', 'n', OWNER)).toBe(0)
    expect(store.outgoing(from)).toHaveLength(2)
    store.close()
  })

  it('rolls back the whole reconcile on failure', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    store.replaceOutgoing(from, [{ to: { kind: 'task', id: 't1' }, relation: 'mentions' }], OWNER)
    // Throws only once the write phase reads it again (after t1 was deleted
    // inside the transaction), so the rollback is really exercised.
    let reads = 0
    const poisoned = { get kind() { if (++reads > 1) throw new Error('boom'); return 'task' }, id: 'x' } as unknown as { kind: 'task'; id: string }
    expect(() => store.replaceOutgoing(from, [
      { to: { kind: 'task', id: 't2' }, relation: 'mentions' },
      { to: poisoned, relation: 'mentions' },
    ], OWNER)).toThrow()
    expect(store.outgoing(from).map(link => link.to.id)).toEqual(['t1'])
    // The connection is usable again after the rollback.
    expect(store.replaceOutgoing(from, [], OWNER).removed).toBe(1)
    store.close()
  })

  it('removeOutgoingByIdPrefix is an exact prefix match', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    for (const id of ['a/x', 'a/b/y', 'ab/z', 'a%/w']) {
      store.add({ from: { kind: 'note', id }, to: { kind: 'task', id: 't' }, relation: 'mentions', createdBy: 'u' })
    }
    expect(store.removeOutgoingByIdPrefix('note', 'a/')).toBe(2)
    expect(store.count()).toBe(2)
    store.close()
  })

  it('removeOutgoingByIdPrefix matches astral (emoji) folder prefixes (review 4 #3)', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    for (const id of ['📁 Projects/a', '📁 Projects/sub/b', '📁 Projectsx/c', '📁 Other/d']) {
      store.add({ from: { kind: 'note', id }, to: { kind: 'task', id: 't' }, relation: 'mentions', createdBy: NOTE_LINKS_INDEXER_ACTOR })
    }
    expect(store.removeOutgoingByIdPrefix('note', '📁 Projects/', NOTE_LINKS_INDEXER_OWNERSHIP)).toBe(2)
    expect(store.outgoingSourceIds('note').sort()).toEqual(['📁 Other/d', '📁 Projectsx/c'])
    store.close()
  })

  it('backlinks hide sources that can no longer be found, paging over raw rows', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    for (const id of ['alive', 'gone']) store.add({ from: { kind: 'note', id }, to: { kind: 'task', id: 't' }, relation: 'mentions', createdBy: 'u' })
    store.add({ from: { kind: 'task', id: 'other' }, to: { kind: 'task', id: 't' }, relation: 'relates-to', createdBy: 'u' })
    const exists = (ref: { kind: string; id: string }) => !(ref.kind === 'note' && ref.id === 'gone')
    expect(store.backlinks({ kind: 'task', id: 't' }, {}, { sourceExists: exists }).links.map(link => link.from.id).sort()).toEqual(['alive', 'other'])
    const first = store.backlinks({ kind: 'task', id: 't' }, { limit: 1 }, { sourceExists: () => false })
    expect(first.links).toEqual([])
    expect(first.nextCursor).toBeDefined()
    store.close()
  })
})

describe('createNoteLinksIndexer', () => {
  it('flag off: writes nothing and never opens the store', () => {
    const root = tempRoot()
    const pushes: string[] = []
    const indexer = createNoteLinksIndexer({ isEnabled: () => false, notify: id => pushes.push(id) })
    expect(indexer.index({ id: 'ws', rootPath: root }, 'n1', '[[task:1]]')).toBe(false)
    expect(indexer.remove({ id: 'ws', rootPath: root }, 'n1')).toBe(false)
    expect(indexer.removeFolder({ id: 'ws', rootPath: root }, 'folder')).toBe(false)
    expect(existsSync(join(root, '.rox'))).toBe(false)
    expect(pushes).toEqual([])
  })

  it('flag on: reconciles, notifies only on change, never rewrites content', () => {
    const root = tempRoot()
    const pushes: string[] = []
    const indexer = createNoteLinksIndexer({ isEnabled: () => true, notify: id => pushes.push(id) })
    const workspace = { id: 'ws', rootPath: root }
    const content = 'Mentions [[task:1]] and [[task:2]]'
    expect(indexer.index(workspace, 'n1', content)).toBe(true)
    expect(indexer.index(workspace, 'n1', content)).toBe(false)
    expect(pushes).toEqual(['ws'])
    const store = getEntityLinkStore(root)
    expect(store.outgoing({ kind: 'note', id: 'n1' }).map(link => [link.to.id, link.createdBy])).toEqual([
      ['1', NOTE_LINKS_INDEXER_ACTOR],
      ['2', NOTE_LINKS_INDEXER_ACTOR],
    ])
    expect(indexer.index(workspace, 'n1', 'Only [[task:2]]')).toBe(true)
    expect(store.backlinks({ kind: 'task', id: '1' }).links).toEqual([])
    expect(indexer.remove(workspace, 'n1')).toBe(true)
    expect(indexer.remove(workspace, 'n1')).toBe(false)
    expect(store.count()).toBe(0)
    expect(pushes).toEqual(['ws', 'ws', 'ws'])
  })

  it('a failing notify is logged, not thrown', () => {
    const warnings: unknown[] = []
    const indexer = createNoteLinksIndexer({
      isEnabled: () => true,
      notify: () => { throw new Error('push failed') },
      logger: { warn: (...args: unknown[]) => { warnings.push(args) } },
    })
    expect(indexer.index({ id: 'ws', rootPath: tempRoot() }, 'n1', '[[task:1]]')).toBe(true)
    expect(warnings).toHaveLength(1)
  })

  it('a manual relates link survives every save of the note (review 4 #1)', () => {
    const root = tempRoot()
    const indexer = createNoteLinksIndexer({ isEnabled: () => true })
    const workspace = { id: 'ws', rootPath: root }
    const store = getEntityLinkStore(root)
    store.add({ from: { kind: 'note', id: 'n1' }, to: { kind: 'goal', id: 'g1' }, relation: 'relates-to', createdBy: 'user-1' })
    indexer.index(workspace, 'n1', 'See [[task:1]]')
    indexer.index(workspace, 'n1', 'Nothing linked any more')
    indexer.remove(workspace, 'n1')
    expect(store.outgoing({ kind: 'note', id: 'n1' }).map(link => `${link.relation}:${link.to.id}`)).toEqual(['relates-to:g1'])
  })

  it('inserting a line above the links: 0 pushes, 0 revision bumps, anchors refreshed (review 4 #2)', () => {
    const root = tempRoot()
    const pushes: string[] = []
    const indexer = createNoteLinksIndexer({ isEnabled: () => true, notify: id => pushes.push(id) })
    const workspace = { id: 'ws', rootPath: root }
    const body = 'Intro\nSee [[task:1]] and ![[note:Plan]]\nrox://goals/goal/g1'
    expect(indexer.index(workspace, 'n1', body)).toBe(true)
    const store = getEntityLinkStore(root)
    const before = store.outgoing({ kind: 'note', id: 'n1' })
    pushes.length = 0
    expect(indexer.index(workspace, 'n1', `A new first line\n${body}`)).toBe(false)
    expect(pushes).toEqual([])
    const after = store.outgoing({ kind: 'note', id: 'n1' })
    expect(after.map(link => link.revision)).toEqual(before.map(link => link.revision))
    expect(after.map(link => link.anchor?.line)).toEqual(before.map(link => (link.anchor?.line ?? 0) + 1))
  })
})

describe('extraction caps (review 4 #6)', () => {
  it('pathological lines stay fast (unmatched [[ and backtick runs)', () => {
    const brackets = '[['.repeat(Math.floor((NOTE_LINKS_MAX_LINE_CHARS - 10) / 2))
    const ticks = '` ``'.repeat(Math.floor((NOTE_LINKS_MAX_LINE_CHARS - 10) / 4))
    const mixed = '[[a `'.repeat(Math.floor((NOTE_LINKS_MAX_LINE_CHARS - 10) / 5))
    const md = [brackets, ticks, mixed, 'tail [[task:ok]]'].join('\n').repeat(4)
    const started = performance.now()
    const links = extractNoteLinks(md, undefined, { logger: { warn: () => {} } })
    const elapsed = performance.now() - started
    expect(links.map(link => link.to.id)).toEqual(['ok'])
    // The previous unbounded regex took ~0.5 s per such line (~2 s here).
    expect(elapsed).toBeLessThan(1000)
  })

  it('skips lines over the char cap and logs once', () => {
    const warnings: string[] = []
    const md = [`${'x'.repeat(NOTE_LINKS_MAX_LINE_CHARS + 1)} [[task:hidden]]`, '[[task:seen]]'].join('\n')
    expect(extractNoteLinks(md, undefined, { logger: { warn: (line: string) => { warnings.push(line) } }, label: 'n1' }).map(link => link.to.id)).toEqual(['seen'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('skipped 1 line(s)')
    expect(warnings[0]).toContain('n1')
  })

  it('stops scanning notes over the byte cap with a log line', () => {
    const warnings: string[] = []
    const filler = `${'y'.repeat(1000)}\n`.repeat(Math.ceil(NOTE_LINKS_MAX_SCAN_BYTES / 1001) + 10)
    const md = `[[task:early]]\n${filler}[[task:late]]`
    const started = performance.now()
    expect(extractNoteLinks(md, undefined, { logger: { warn: (line: string) => { warnings.push(line) } } }).map(link => link.to.id)).toEqual(['early'])
    expect(performance.now() - started).toBeLessThan(1500)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('stopped at line')
  })

  it('inline-code stripping keeps CommonMark pairing', () => {
    expect(extractNoteLinks('`a` [[task:1]] ``b ` c`` [[task:2]] ` [[task:3]]').map(link => link.to.id)).toEqual(['1', '2', '3'])
    expect(extractNoteLinks('``x [[task:in]] `` [[task:out]]').map(link => link.to.id)).toEqual(['out'])
  })
})

describe('native-path ordering (review 4 #4)', () => {
  it('serializes jobs per note and skips stale out-of-order revisions', async () => {
    const serializer = createNoteLinksSerializer()
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const first = serializer.run('ws', 'n1', async () => { order.push('r3:start'); await gate; order.push('r3:end') }, { revision: { nativeId: 'e1', revision: 3 } })
    // Same note: queued behind r3 even though it arrives while r3 is running.
    const stale = serializer.run('ws', 'n1', () => { order.push('r2') }, { revision: { nativeId: 'e1', revision: 2 } })
    // Another note is not blocked.
    await serializer.run('ws', 'n2', () => { order.push('other') })
    expect(order).toEqual(['r3:start', 'other'])
    release()
    await Promise.all([first, stale])
    expect(order).toEqual(['r3:start', 'other', 'r3:end'])
    await serializer.run('ws', 'n1', () => { order.push('r3-again') }, { revision: { nativeId: 'e1', revision: 3 } })
    await serializer.run('ws', 'n1', () => { order.push('r4') }, { revision: { nativeId: 'e1', revision: 4 } })
    // A different entity at the same path (or a reset create) is never compared.
    await serializer.run('ws', 'n1', () => { order.push('e2-r1') }, { revision: { nativeId: 'e2', revision: 1 } })
    await serializer.run('ws', 'n1', () => { order.push('reset') }, { revision: { nativeId: 'e2', revision: 1 }, reset: true })
    expect(order.slice(3)).toEqual(['r4', 'e2-r1', 'reset'])
  })

  it('a tombstone stops older saves of the deleted entity; job errors are logged', async () => {
    const warnings: unknown[] = []
    const serializer = createNoteLinksSerializer({ warn: (...args: unknown[]) => { warnings.push(args) } })
    const ran: string[] = []
    await serializer.run('ws', 'n1', () => { ran.push('delete') }, { tombstone: { nativeId: 'e1', revision: 5 } })
    await serializer.run('ws', 'n1', () => { ran.push('late-save') }, { revision: { nativeId: 'e1', revision: 5 } })
    await serializer.run('ws', 'n1', () => { throw new Error('boom') })
    await serializer.run('ws', 'n1', () => { ran.push('after-error') })
    expect(ran).toEqual(['delete', 'after-error'])
    expect(warnings).toHaveLength(1)
  })
})

describe('phantom-source pruning (review 4, owner decision)', () => {
  const seed = (root: string) => {
    const store = getEntityLinkStore(root)
    for (const id of ['alive', 'gone', 'Old/moved']) {
      store.replaceOutgoing({ kind: 'note', id }, [{ to: { kind: 'task', id: 't' }, relation: 'mentions' }], NOTE_LINKS_INDEXER_OWNERSHIP)
    }
    store.add({ from: { kind: 'note', id: 'gone' }, to: { kind: 'goal', id: 'g' }, relation: 'relates-to', createdBy: 'user-1' })
    return store
  }

  it('prunes indexer rows of missing notes on first use after enable and on every off → on transition', () => {
    const root = tempRoot()
    const workspace = { id: 'ws', rootPath: root }
    const store = seed(root)
    const existing = new Set(['alive'])
    setNoteLinksSourceProbe((_ws, id) => existing.has(id))
    const pushes: string[] = []
    let enabled = true
    const indexer = createNoteLinksIndexer({ isEnabled: () => enabled, notify: id => pushes.push(id) })
    // First enabled use prunes once: gone + Old/moved indexer rows; the manual row stays.
    expect(indexer.index(workspace, 'alive', '[[task:t]]')).toBe(true)
    expect(pushes).toEqual(['ws'])
    expect(store.outgoingSourceIds('note', NOTE_LINKS_INDEXER_OWNERSHIP)).toEqual(['alive'])
    expect(store.outgoing({ kind: 'note', id: 'gone' }).map(link => link.relation)).toEqual(['relates-to'])
    // Same generation: not pruned again.
    store.replaceOutgoing({ kind: 'note', id: 'ghost' }, [{ to: { kind: 'task', id: 't' }, relation: 'mentions' }], NOTE_LINKS_INDEXER_OWNERSHIP)
    expect(ensureNoteLinksPruned(workspace)).toBe(0)
    // Off period (ops are inert), then on again → pruned on next use.
    enabled = false
    expect(indexer.remove(workspace, 'alive')).toBe(false)
    enabled = true
    expect(indexer.index(workspace, 'alive', '[[task:t]]')).toBe(true)
    expect(store.outgoingSourceIds('note', NOTE_LINKS_INDEXER_OWNERSHIP)).toEqual(['alive'])
  })

  it('eager transition via the workbench flag source; no probe or probe errors never prune or hide', async () => {
    const root = tempRoot()
    const workspace = { id: 'ws', rootPath: root }
    const store = seed(root)
    observeEntitiesLinksEnabled(true)
    expect(ensureNoteLinksPruned(workspace)).toBe(0) // no probe registered
    expect(noteLinkSourceExists(workspace, { kind: 'note', id: 'gone' })).toBe(true)
    setNoteLinksSourceProbe(() => { throw new Error('vault offline') })
    expect(noteLinkSourceExists(workspace, { kind: 'note', id: 'gone' })).toBe(true)
    expect(ensureNoteLinksPruned(workspace)).toBe(0)
    expect(store.outgoingSourceIds('note', NOTE_LINKS_INDEXER_OWNERSHIP)).toHaveLength(3)
    const { setEntitiesWorkbenchFlags, resetEntitiesWorkbenchFlags } = await import('../workbench-flags.ts')
    const { WORKBENCH_FLAG } = await import('@rox/core/platform')
    setNoteLinksSourceProbe((_ws, id) => id === 'alive')
    resetEntitiesWorkbenchFlags() // published off
    setEntitiesWorkbenchFlags([WORKBENCH_FLAG.entitiesLinksV1]) // published on → new generation
    resetEntitiesWorkbenchFlags()
    expect(ensureNoteLinksPruned(workspace)).toBe(2)
    expect(noteLinkSourceExists(workspace, { kind: 'task', id: 'anything' })).toBe(true)
  })
})
