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

  test('block and wikilink helpers are lossless', () => {
    const markdown = '<!-- block:a -->One\n\n<!-- block:b -->Two [[Inbox]]'
    expect(parseBlocks(markdown).map((block) => block.id)).toEqual(['a', 'b'])
    expect(extractWikilinks(markdown)).toEqual(['Inbox'])
    expect(rewriteWikilinks('See [[Inbox#top|x]]', 'Inbox', 'Inbox v2')).toBe('See [[Inbox v2#top|x]]')
  })
})
