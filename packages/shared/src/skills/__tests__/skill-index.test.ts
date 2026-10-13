import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { join } from 'node:path'
import {
  APP_MANAGED_SKILLS_DIR,
  GLOBAL_AGENT_SKILLS_DIR,
  getSkillRootPlan,
} from '../storage.ts'
import { OMP_GLOBAL_SKILLS_DIR } from '../omp-discovery.ts'
import {
  markSkillIndexDirty,
  querySkills,
  resetSkillIndexForTests,
  setSkillIndexCoalesceClockForTests,
  setSkillIndexIoForTests,
  subscribeSkillIndexChanged,
  type SkillIndexIo,
} from '../skill-index.ts'

const workspace = join('/tmp', 'skill-index-fixture')
const skillsRoot = join(workspace, 'skills')
const COUNT = 50

function skillMd(slug: string, extra = ''): string {
  return `---\nname: ${slug}\ndescription: ${slug} desc\n---\nbody ${extra}`
}

function createMemoryIo(fixtureCount = COUNT): { io: SkillIndexIo; files: Map<string, { content: string; mtimeMs: number; size: number }>; dirs: Map<string, Set<string>>; headReads: string[] } {
  const files = new Map<string, { content: string; mtimeMs: number; size: number }>()
  const dirs = new Map<string, Set<string>>()
  const headReads: string[] = []

  function addDir(path: string): void {
    if (!dirs.has(path)) dirs.set(path, new Set())
    const parent = path.replace(/\/[^/]+$/, '')
    if (parent && parent !== path) {
      addDir(parent)
      dirs.get(parent)!.add(path.slice(parent.length + 1))
    }
  }

  function addFile(path: string, content: string, mtimeMs: number): void {
    files.set(path, { content, mtimeMs, size: Buffer.byteLength(content) })
    const parent = path.replace(/\/[^/]+$/, '')
    addDir(parent)
    dirs.get(parent)!.add(path.slice(parent.length + 1))
  }

  addDir(skillsRoot)
  for (let i = 0; i < fixtureCount; i++) {
    const slug = `skill-${String(i).padStart(2, '0')}`
    addFile(join(skillsRoot, slug, 'SKILL.md'), skillMd(slug), 1_000)
  }

  const io: SkillIndexIo = {
    async readdir(dir) {
      return [...(dirs.get(dir) ?? [])]
    },
    async stat(path) {
      const file = files.get(path)
      if (file) return { mtimeMs: file.mtimeMs, size: file.size, isFile: true }
      if (dirs.has(path)) return { mtimeMs: 0, size: 0, isFile: false }
      return null
    },
    async readFile(path) {
      const file = files.get(path)
      if (!file) throw new Error(`ENOENT ${path}`)
      if (path.endsWith('SKILL.md')) headReads.push(path)
      return file.content
    },
    async writeFile(path, data) {
      addFile(path, data, 2_000)
    },
    async mkdir(path) {
      addDir(path)
    },
  }
  return { io, files, dirs, headReads }
}

function createClock() {
  let now = 0
  const timers: Array<{ at: number; fn: () => void; id: number }> = []
  let nextId = 1
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++
      timers.push({ at: now + Number(ms), fn, id })
      return id
    },
    clearTimeout(id: unknown) {
      const index = timers.findIndex((timer) => timer.id === (id as number))
      if (index >= 0) timers.splice(index, 1)
    },
    advance(ms: number) {
      now += ms
      const due = timers.filter((timer) => timer.at <= now)
      for (const timer of due) {
        const index = timers.indexOf(timer)
        if (index >= 0) timers.splice(index, 1)
        timer.fn()
      }
    },
  }
}

afterEach(() => {
  resetSkillIndexForTests()
  setSkillIndexIoForTests(null)
  setSkillIndexCoalesceClockForTests(null)
})

describe('incremental skill catalog index', () => {
  test('warm query of 50 fixtures returns total=50 and no skill-root sync fs', async () => {
    const { io } = createMemoryIo()
    setSkillIndexIoForTests(io)
    const readdir = spyOn(fs, 'readdirSync')
    const readFile = spyOn(fs, 'readFileSync')
    try {
      const page = await querySkills({ workspaceRoot: workspace, offset: 0, limit: 50 })
      expect(page.total).toBe(COUNT)
      expect(page.items).toHaveLength(COUNT)
      expect(page.items.every((skill) => skill.content === '')).toBe(true)
      const skillRoots = new Set([
        skillsRoot,
        GLOBAL_AGENT_SKILLS_DIR,
        APP_MANAGED_SKILLS_DIR,
        OMP_GLOBAL_SKILLS_DIR,
        ...getSkillRootPlan(workspace).map((tier) => tier.root),
      ])
      expect(readdir.mock.calls.filter(([dir]) => skillRoots.has(String(dir)))).toHaveLength(0)
      expect(readFile.mock.calls.filter(([path]) => String(path).includes(`${skillsRoot}/`))).toHaveLength(0)
    } finally {
      readdir.mockRestore()
      readFile.mockRestore()
    }
  })

  test('editing one SKILL.md re-reads that head once and coalesces one change', async () => {
    const { io, files, headReads } = createMemoryIo()
    setSkillIndexIoForTests(io)
    const clock = createClock()
    setSkillIndexCoalesceClockForTests(clock)
    await querySkills({ workspaceRoot: workspace, offset: 0, limit: 1 })
    headReads.length = 0
    const payloads: Array<{ revision: number; changed: string[]; removed: string[] }> = []
    const stop = subscribeSkillIndexChanged((payload) => payloads.push(payload))
    const edited = join(skillsRoot, 'skill-00', 'SKILL.md')
    const next = skillMd('skill-00', 'changed')
    files.set(edited, { content: next, mtimeMs: 9_000, size: Buffer.byteLength(next) })
    await querySkills({ workspaceRoot: workspace, offset: 0, limit: 50 })
    expect(headReads).toEqual([edited])
    await markSkillIndexDirty(join(skillsRoot, 'skill-00'))
    await markSkillIndexDirty(join(skillsRoot, 'skill-00'))
    clock.advance(250)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]!.changed).toEqual(['skill-00'])
    expect(payloads[0]!.removed).toEqual([])
    stop()
  })

  test('warm restart serves the snapshot with 0 SKILL.md reads', async () => {
    const { io, headReads } = createMemoryIo()
    setSkillIndexIoForTests(io)
    const first = await querySkills({ workspaceRoot: workspace, offset: 0, limit: 50 })
    expect(first.total).toBe(COUNT)
    expect(headReads.filter((path) => path.endsWith('SKILL.md')).length).toBe(COUNT)
    headReads.length = 0
    resetSkillIndexForTests()
    const second = await querySkills({ workspaceRoot: workspace, offset: 0, limit: 50 })
    expect(second.total).toBe(COUNT)
    expect(second.items).toHaveLength(COUNT)
    expect(headReads.filter((path) => path.endsWith('SKILL.md'))).toEqual([])
  })
})
