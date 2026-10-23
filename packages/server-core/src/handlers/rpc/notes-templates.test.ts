import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  listNoteTemplatesForRoot,
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

  it('rejects path escape in template id', async () => {
    await expect(readNoteTemplateContent(notesRoot, '../secret')).rejects.toThrow()
    await expect(saveNoteAsTemplateForRoot(notesRoot, {
      templateId: 'templates/evil',
      title: 'Evil',
      body: 'nope',
    })).rejects.toThrow()
  })
})
