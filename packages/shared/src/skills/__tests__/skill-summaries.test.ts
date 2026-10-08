import { afterAll, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// APP_MANAGED_SKILLS_DIR is resolved at import time from ROX_CONFIG_DIR.
const sandbox = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'skill-summaries-')))
const previous = process.env.ROX_CONFIG_DIR
process.env.ROX_CONFIG_DIR = join(sandbox, 'config')
const skills = await import('../index.ts')

function createSkill(directory: string, body: string) {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(join(directory, 'SKILL.md'), `---\nname: Summary\ndescription: Listed\n---\n${body}`)
}

afterAll(() => {
  if (previous === undefined) delete process.env.ROX_CONFIG_DIR
  else process.env.ROX_CONFIG_DIR = previous
  fs.rmSync(sandbox, { recursive: true, force: true })
})

test('toSkillSummary drops the body and keeps its length; metadata is untouched', () => {
  const skill = {
    slug: 'a', metadata: { name: 'A', description: 'd' }, content: 'Body 日本語', path: '/x/a', source: 'workspace' as const,
  }
  expect(skills.toSkillSummary(skill)).toEqual({ ...skill, content: '', contentLength: 'Body 日本語'.length })
  expect(skill.content).toBe('Body 日本語')
  const empty = { ...skill, content: '' }
  expect(skills.toSkillSummary(empty)).toBe(empty)
  expect(skills.toSkillSummaries([skill, empty]).map(s => s.content)).toEqual(['', ''])
})

test('loadAllSkills scans the app-managed skills directory once', () => {
  const slug = `app-managed-${crypto.randomUUID()}`
  createSkill(join(skills.APP_MANAGED_SKILLS_DIR, slug), 'App body')
  const workspaceRoot = join(sandbox, 'workspace')
  fs.mkdirSync(workspaceRoot, { recursive: true })
  skills.invalidateSkillsCache()
  const readdir = spyOn(fs, 'readdirSync')
  try {
    const loaded = skills.loadAllSkills(workspaceRoot)
    expect(loaded.find(s => s.slug === slug)?.content).toBe('App body')
    const appScans = readdir.mock.calls.filter(([dir]) => String(dir) === skills.APP_MANAGED_SKILLS_DIR)
    expect(appScans).toHaveLength(1)
  } finally {
    readdir.mockRestore()
  }
})
