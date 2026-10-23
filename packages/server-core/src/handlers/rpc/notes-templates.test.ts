import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  assertSafeCreateFolder,
  listNoteTemplatesForRoot,
  materializeTemplateNoteContent,
  readNoteTemplateContent,
  saveNoteAsTemplateForRoot,
} from './notes'

let notesRoot: string

beforeEach(() => {
  notesRoot = join(tmpdir(), `rox-notes-templates-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(join(notesRoot, 'templates'), { recursive: true })
  writeFileSync(
    join(notesRoot, 'templates', 'daily.md'),
    '---\ntitle: Daily\ntags: []\n---\n\n# {{date}}\n\n- [ ] Focus\n',
    'utf-8',
  )
  writeFileSync(
    join(notesRoot, 'templates', 'meeting.md'),
    '---\ntitle: Meeting notes\ntags:\n  - meeting\nicon: "📝"\n---\n\n## Agenda\n\n## Notes\n',
    'utf-8',
  )
})

afterEach(() => {
  rmSync(notesRoot, { recursive: true, force: true })
})

describe('note templates library', () => {
  it('lists templates sorted by title with safe ids', async () => {
    const listed = await listNoteTemplatesForRoot(notesRoot)
    expect(listed.map((item) => item.id)).toEqual(['daily', 'meeting'])
    expect(listed[0]?.title).toBe('Daily')
    expect(listed[1]?.title).toBe('Meeting notes')
    expect(listed[1]?.relativePath).toBe('templates/meeting.md')
  })

  it('reads template body and properties without title', async () => {
    const meeting = await readNoteTemplateContent(notesRoot, 'meeting')
    expect(meeting.title).toBe('Meeting notes')
    expect(meeting.body).toContain('## Agenda')
    expect(meeting.properties.icon).toBe('📝')
    expect(meeting.properties.title).toBeUndefined()
  })

  it('saves a note as template and strips cover/icon/createdAt', async () => {
    const saved = await saveNoteAsTemplateForRoot(notesRoot, {
      templateId: 'standup',
      title: 'Standup',
      body: '## Yesterday\n\n## Today\n',
      properties: { tags: ['team'], cover: 'linear-gradient(red, blue)', icon: '🚀', createdAt: 1 },
    })
    expect(saved.id).toBe('standup')
    expect(saved.title).toBe('Standup')
    const raw = readFileSync(join(notesRoot, 'templates', 'standup.md'), 'utf-8')
    expect(raw).toContain('title: Standup')
    expect(raw).toContain('## Yesterday')
    expect(raw).not.toContain('cover:')
    expect(raw).not.toContain('icon:')
    expect(raw).not.toContain('createdAt:')
    const listed = await listNoteTemplatesForRoot(notesRoot)
    expect(listed.some((item) => item.id === 'standup')).toBe(true)
  })

  it('refuses silent overwrite without confirmReplace; replaces only when confirmed', async () => {
    await saveNoteAsTemplateForRoot(notesRoot, {
      templateId: 'daily',
      title: 'Daily v2',
      body: 'new body',
    }).then(
      () => { throw new Error('expected conflict') },
      (error: { code?: string }) => { expect(error.code).toBe('CONFLICT') },
    )
    expect(readFileSync(join(notesRoot, 'templates', 'daily.md'), 'utf-8')).toContain('# {{date}}')

    const replaced = await saveNoteAsTemplateForRoot(notesRoot, {
      templateId: 'daily',
      title: 'Daily v2',
      body: 'replaced body',
      confirmReplace: true,
    })
    expect(replaced.title).toBe('Daily v2')
    expect(readFileSync(join(notesRoot, 'templates', 'daily.md'), 'utf-8')).toContain('replaced body')
    expect(readFileSync(join(notesRoot, 'templates', 'daily.md'), 'utf-8')).not.toContain('# {{date}}')
  })

  it('rejects path escape in template id', async () => {
    await expect(readNoteTemplateContent(notesRoot, '../secret')).rejects.toThrow()
    await expect(saveNoteAsTemplateForRoot(notesRoot, {
      templateId: 'templates/evil',
      title: 'Evil',
      body: 'nope',
    })).rejects.toThrow()
  })

  it('lists empty when templates dir is missing and does not create it', async () => {
    const bare = join(tmpdir(), `rox-notes-templates-bare-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(bare, { recursive: true })
    try {
      const listed = await listNoteTemplatesForRoot(bare)
      expect(listed).toEqual([])
      expect(() => readFileSync(join(bare, 'templates'))).toThrow()
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it('skips templates whose basename casing does not match normalized id', async () => {
    writeFileSync(join(notesRoot, 'templates', 'Weekly.MD'), '---\ntitle: Weekly\n---\n\nbody\n', 'utf-8')
    const listed = await listNoteTemplatesForRoot(notesRoot)
    expect(listed.map((item) => item.id)).toEqual(['daily', 'meeting'])
  })

  it('materializes a note without inheriting cover/icon/createdAt from the template', async () => {
    writeFileSync(
      join(notesRoot, 'templates', 'with-meta.md'),
      '---\ntitle: With Meta\ncover: "#112233"\nicon: "🔥"\ncreatedAt: 42\ntags:\n  - x\n---\n\nHello\n',
      'utf-8',
    )
    const { noteTitle, initialContent } = await materializeTemplateNoteContent(notesRoot, 'with-meta', 'Fresh')
    expect(noteTitle).toBe('Fresh')
    expect(initialContent).toContain('title: Fresh')
    expect(initialContent).toContain('Hello')
    expect(initialContent).not.toContain('cover:')
    expect(initialContent).not.toContain('icon:')
    expect(initialContent).not.toContain('createdAt: 42')
    expect(initialContent).toMatch(/createdAt:\s*\d{10,}/)
  })


  it('skips nested templates whose directory casing does not match normalized id', async () => {
    mkdirSync(join(notesRoot, 'templates', 'Foo'), { recursive: true })
    writeFileSync(join(notesRoot, 'templates', 'Foo', 'daily.md'), '---\ntitle: Nested\n---\n\nbody\n', 'utf-8')
    const listed = await listNoteTemplatesForRoot(notesRoot)
    expect(listed.map((item) => item.id)).toEqual(['daily', 'meeting'])
  })

  it('lists nested templates when the full relative path matches normalized id', async () => {
    mkdirSync(join(notesRoot, 'templates', 'team'), { recursive: true })
    writeFileSync(join(notesRoot, 'templates', 'team', 'weekly.md'), '---\ntitle: Team Weekly\n---\n\nbody\n', 'utf-8')
    const listed = await listNoteTemplatesForRoot(notesRoot)
    expect(listed.some((item) => item.id === 'team/weekly')).toBe(true)
    expect(listed.find((item) => item.id === 'team/weekly')?.relativePath).toBe('templates/team/weekly.md')
  })

  it('read does not create templates dirs; materialize coerces string tags', async () => {
    const bare = join(tmpdir(), `rox-notes-templates-read-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(bare, { recursive: true })
    try {
      await expect(readNoteTemplateContent(bare, 'missing')).rejects.toThrow()
      expect(() => readFileSync(join(bare, 'templates'))).toThrow()
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }

    writeFileSync(
      join(notesRoot, 'templates', 'string-tags.md'),
      '---\ntitle: String Tags\ntags: meeting\n---\n\nHi\n',
      'utf-8',
    )
    const { initialContent } = await materializeTemplateNoteContent(notesRoot, 'string-tags')
    expect(initialContent).toMatch(/tags:\s*\n\s*-\s*meeting/)
    expect(initialContent).not.toContain('tags: []')
  })

  it('caps template ids at 80 characters like the client', async () => {
    const long = `t${'x'.repeat(100)}`
    const saved = await saveNoteAsTemplateForRoot(notesRoot, {
      templateId: long,
      title: 'Long',
      body: 'x',
    })
    expect(saved.id.length).toBeLessThanOrEqual(80)
    expect(saved.id).toBe(long.slice(0, 80))
  })


  it('rejects non-object properties on saveAsTemplate', async () => {
    await expect(saveNoteAsTemplateForRoot(notesRoot, {
      templateId: 'bad-props',
      title: 'Bad',
      body: 'x',
      properties: ['not', 'an', 'object'] as unknown as Record<string, unknown>,
    })).rejects.toThrow(/Invalid template properties/)
  })

  it('rejects create folders under reserved templates/assets segments', () => {
    expect(() => assertSafeCreateFolder('templates')).toThrow(/Invalid note folder/)
    expect(() => assertSafeCreateFolder('assets')).toThrow(/Invalid note folder/)
    expect(() => assertSafeCreateFolder('team/templates')).toThrow(/Invalid note folder/)
    expect(() => assertSafeCreateFolder('projects/inbox')).not.toThrow()
    expect(assertSafeCreateFolder(undefined)).toBe('')
  })

})
