import { describe, expect, test } from 'bun:test'
import {
  createNativeNotesEngine,
  extractWikilinks,
  migrateNotesVault,
  parseBlocks,
  rewriteWikilinks,
} from '../notes-engine.ts'

describe('ROX-AUD-031 native notes engine', () => {
  test('CRUD and restart work without SiYuan', () => {
    const engine = createNativeNotesEngine()
    const created = engine.create('daily', '# Daily\n\nHello [[Inbox]]\n')
    expect(created.entityId).toBe('note:daily')
    expect(created.wikilinks).toEqual(['Inbox'])
    expect(engine.read('daily')?.markdown).toContain('Hello')
    const saved = engine.save({ noteId: 'daily', markdown: '# Daily\n\nUpdated', expectedRevision: created.revision })
    expect(saved.status).toBe('ok')
    const restarted = createNativeNotesEngine(engine.list())
    expect(restarted.read('daily')?.markdown).toContain('Updated')
    expect(restarted.search('updated')).toHaveLength(1)
  })

  test('rename keeps block ids and rewrites wikilinks', () => {
    const engine = createNativeNotesEngine()
    engine.create('inbox', '# Inbox\n\n<!-- block:keep -->Stay\n')
    engine.create('daily', '# Daily\n\nSee [[Inbox]]\n')
    const renamed = engine.rename('inbox', 'Inbox v2')
    expect(renamed?.title).toBe('Inbox v2')
    expect(renamed?.blocks.some((block) => block.id === 'keep')).toBe(true)
    expect(engine.read('daily')?.markdown).toContain('[[Inbox v2]]')
    expect(engine.read('daily')?.markdown).not.toContain('[[Inbox]]')
  })

  test('concurrent save without current revision is not a silent overwrite', () => {
    const engine = createNativeNotesEngine()
    const created = engine.create('daily', '# Daily\n\nA')
    const stale = engine.save({ noteId: 'daily', markdown: '# Daily\n\nB', expectedRevision: 'stale-rev' })
    expect(stale.status).toBe('conflict')
    if (stale.status === 'conflict') {
      expect(stale.currentRevision).toBe(created.revision)
      expect(stale.note.markdown).toContain('A')
    }
    expect(engine.read('daily')?.markdown).toContain('A')
    const ok = engine.save({ noteId: 'daily', markdown: '# Daily\n\nB', expectedRevision: created.revision })
    expect(ok.status).toBe('ok')
  })

  test('export/import is lossless for fields, attachments, and extra', () => {
    const engine = createNativeNotesEngine()
    engine.create('daily', '# Daily\n\nBody', { attachments: ['assets/a.png'], color: 'blue' })
    const { backup, count, hash } = migrateNotesVault(engine)
    expect(count).toBe(1)
    expect(backup.hash).toBe(hash)
    const other = createNativeNotesEngine()
    const restored = other.importVault(backup)
    expect(restored.restored).toBe(1)
    expect(other.read('daily')?.extra.color).toBe('blue')
    expect(other.read('daily')?.attachments).toEqual(['assets/a.png'])
    expect(other.revisions('daily').length).toBeGreaterThan(0)
  })

  test('multi-revision export/import restores full parent chain and tip', () => {
    const engine = createNativeNotesEngine()
    const v1 = engine.create('daily', '# Daily\n\nA', { color: 'red' }, 1000)
    const v2 = engine.save({ noteId: 'daily', markdown: '# Daily\n\nB', expectedRevision: v1.revision, extra: { color: 'green' }, now: 2000 })
    expect(v2.status).toBe('ok')
    const v3 = engine.save({
      noteId: 'daily',
      markdown: '# Daily\n\nC',
      expectedRevision: v2.status === 'ok' ? v2.note.revision : '',
      extra: { color: 'blue' },
      now: 3000,
    })
    expect(v3.status).toBe('ok')
    const v4 = engine.save({
      noteId: 'daily',
      markdown: '# Daily\n\nD',
      expectedRevision: v3.status === 'ok' ? v3.note.revision : '',
      now: 4000,
    })
    expect(v4.status).toBe('ok')
    expect(engine.revisions('daily')).toHaveLength(4)
    const backup = engine.exportVault()
    const other = createNativeNotesEngine()
    other.create('scratch', '# Scratch\n\nignore')
    other.importVault(backup)
    expect(other.revisions('daily')).toEqual(engine.revisions('daily'))
    expect(other.revisions('daily')).toHaveLength(4)
    expect(other.read('daily')?.revision).toBe(engine.read('daily')?.revision)
    expect(other.read('daily')?.markdown).toBe('# Daily\n\nD')
    expect(other.revisions('scratch')).toHaveLength(0)
  })

  test('invalid or throwing mid-import leaves original notes and history intact', () => {
    const engine = createNativeNotesEngine()
    const v1 = engine.create('daily', '# Daily\n\nA', { tag: 'keep' }, 1000)
    const v2 = engine.save({ noteId: 'daily', markdown: '# Daily\n\nB', expectedRevision: v1.revision, now: 2000 })
    expect(v2.status).toBe('ok')
    const originalNote = engine.read('daily')
    const originalHistory = engine.revisions('daily')
    expect(originalHistory).toHaveLength(2)

    expect(() =>
      engine.importVault({
        notes: [{ ...(originalNote!), markdown: undefined as unknown as string }],
        revisions: {},
        count: 1,
        hash: 'invalid',
      }),
    ).toThrow()
    expect(engine.read('daily')).toEqual(originalNote)
    expect(engine.revisions('daily')).toEqual(originalHistory)

    const backup = engine.exportVault()
    let clones = 0
    const poisonedRevisions: Record<string, typeof backup.revisions[string]> = {}
    for (const [noteId, log] of Object.entries(backup.revisions)) {
      poisonedRevisions[noteId] = log.map((revision) => {
        const clone = { ...revision, sidecar: { ...revision.sidecar } }
        Object.defineProperty(clone, 'markdown', {
          enumerable: true,
          get() {
            clones += 1
            if (clones > 1) throw new Error('mid-import')
            return revision.markdown
          },
        })
        return clone
      })
    }
    expect(() =>
      engine.importVault({
        ...backup,
        revisions: poisonedRevisions,
      }),
    ).toThrow()
    expect(engine.read('daily')).toEqual(originalNote)
    expect(engine.revisions('daily')).toEqual(originalHistory)
  })

  test('block and wikilink helpers are lossless', () => {
    const markdown = '<!-- block:a -->One\n\n<!-- block:b -->Two [[Inbox]]'
    expect(parseBlocks(markdown).map((block) => block.id)).toEqual(['a', 'b'])
    expect(extractWikilinks(markdown)).toEqual(['Inbox'])
    expect(rewriteWikilinks('See [[Inbox#top|x]]', 'Inbox', 'Inbox v2')).toBe('See [[Inbox v2#top|x]]')
  })

  test('unlabeled paragraph insert keeps existing block ids', () => {
    const original = 'Alpha paragraph\n\nBeta paragraph'
    const [first, second] = parseBlocks(original)
    expect(first?.id).toBeTruthy()
    expect(second?.id).toBeTruthy()
    expect(first?.id).not.toBe(second?.id)
    const prepended = parseBlocks(`Intro paragraph\n\n${original}`)
    expect(prepended).toHaveLength(3)
    expect(prepended[1]?.id).toBe(first?.id)
    expect(prepended[2]?.id).toBe(second?.id)
    expect(prepended[0]?.id).not.toBe(first?.id)
    expect(prepended[1]?.text).toBe(first?.text)
    expect(prepended[2]?.text).toBe(second?.text)

    const engine = createNativeNotesEngine()
    const created = engine.create('daily', `# Daily\n\n${original}`)
    const originalIds = created.blocks.filter((block) => block.text === 'Alpha paragraph' || block.text === 'Beta paragraph').map((block) => block.id)
    const saved = engine.save({
      noteId: 'daily',
      markdown: `# Daily\n\nIntro paragraph\n\n${original}`,
      expectedRevision: created.revision,
    })
    expect(saved.status).toBe('ok')
    if (saved.status !== 'ok') return
    const shifted = saved.note.blocks.filter((block) => block.text === 'Alpha paragraph' || block.text === 'Beta paragraph')
    expect(shifted.map((block) => block.id)).toEqual(originalIds)
  })

  test('same markdown with different extra yields a new revision id and CAS conflict', () => {
    const engine = createNativeNotesEngine()
    const created = engine.create('daily', '# Daily\n\nBody', { color: 'red', order: 2 }, 1000)
    const meta = engine.save({
      noteId: 'daily',
      markdown: '# Daily\n\nBody',
      expectedRevision: created.revision,
      extra: { order: 2, color: 'blue' },
      now: 2000,
    })
    expect(meta.status).toBe('ok')
    if (meta.status !== 'ok') throw new Error('expected metadata save to succeed')
    expect(meta.note.revision).not.toBe(created.revision)
    expect(meta.note.extra.color).toBe('blue')
    expect(engine.revisions('daily').map((revision) => revision.id)).toEqual([
      created.revision,
      meta.note.revision,
    ])

    const stale = engine.save({
      noteId: 'daily',
      markdown: '# Daily\n\nBody',
      expectedRevision: created.revision,
      extra: { color: 'green' },
      now: 3000,
    })
    expect(stale.status).toBe('conflict')
    if (stale.status === 'conflict') {
      expect(stale.currentRevision).toBe(meta.note.revision)
    }
    expect(engine.read('daily')?.extra.color).toBe('blue')
  })
})
