import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../storage.ts'
import { loadProjectRoadmap, saveProjectRoadmap, loadProjectRoadmapPromptText } from '../roadmap-storage.ts'
import { normalizeRoadmap, roadmapToMarkdown, roadmapTimelineRange, shiftMilestone } from '../roadmap.ts'
import { applyProposalItem, parseClarifyResponse, parseSpecResponse, proposalItemKeys } from '../roadmap-ai.ts'

const SPEC = `Here you go:\n\`\`\`json
{"goal":"Запустить лендинг","expectedResult":"Лендинг на проде","doneCriteria":["LCP < 2.5s"],
"milestones":[{"title":"Дизайн","description":"Макеты","durationDays":5,"stages":[{"title":"Вайрфреймы","substages":["Hero"]}]},{"title":"Разработка","durationDays":10,"stages":["Вёрстка"]}],
"requirements":[{"kind":"quantitative","text":"LCP","acceptance":["< 2.5 s на 4G"]},{"kind":"кач","text":"Тон бренда","acceptance":[]}],
"risks":["Нет контента"],"openQuestions":["Кто пишет тексты?"]}
\`\`\``

describe('project roadmap', () => {
  it('normalizes missing/garbled data without throwing', () => {
    const empty = normalizeRoadmap(undefined)
    expect(empty.milestones).toEqual([])
    const r = normalizeRoadmap({ goal: 5, milestones: [{ title: 'A', status: 'weird', startDate: '2026-10-10', dueDate: '2026-10-01' }, { title: '' }], requirements: [{ text: 'x', kind: 'nope', milestoneId: 'missing' }] })
    expect(r.goal).toBe('')
    expect(r.milestones).toHaveLength(1)
    expect(r.milestones[0]!.status).toBe('planned')
    expect(r.milestones[0]!.startDate).toBe('2026-10-01')
    expect(r.requirements[0]!.kind).toBe('functional')
    expect(r.requirements[0]!.milestoneId).toBeUndefined()
  })

  it('parses spec answers with fences and applies items one by one', () => {
    const p = parseSpecResponse(SPEC)!
    expect(p.milestones).toHaveLength(2)
    expect(p.requirements[1]!.kind).toBe('qualitative')
    let r = normalizeRoadmap(undefined)
    for (const key of proposalItemKeys(p)) r = applyProposalItem(r, p, key, '2026-10-01')
    expect(r.goal).toBe('Запустить лендинг')
    expect(r.milestones[0]!.startDate).toBe('2026-10-01')
    expect(r.milestones[0]!.dueDate).toBe('2026-10-05')
    expect(r.milestones[1]!.startDate).toBe('2026-10-06')
    expect(r.milestones[0]!.stages[0]!.substages[0]!.title).toBe('Hero')
    // accepting twice does not duplicate
    const again = applyProposalItem(r, p, { section: 'milestones', index: 0 }, '2026-10-01')
    expect(again.milestones).toHaveLength(2)
    expect(parseSpecResponse('no json here')).toBeNull()
  })

  it('parses clarify questions from JSON or bullet fallback', () => {
    expect(parseClarifyResponse('{"questions":["Кто?","Когда?"]}')).toEqual(['Кто?', 'Когда?'])
    expect(parseClarifyResponse('1. Кто аудитория?\n2) Какой бюджет?\nспасибо')).toEqual(['Кто аудитория?', 'Какой бюджет?'])
  })

  it('shifts milestones and computes a timeline window', () => {
    const r = normalizeRoadmap({ milestones: [{ title: 'A', startDate: '2026-10-01', dueDate: '2026-10-03' }] })
    const moved = shiftMilestone(r.milestones[0]!, 5)
    expect(moved.startDate).toBe('2026-10-06')
    expect(moved.dueDate).toBe('2026-10-08')
    expect(roadmapTimelineRange(r.milestones, '2026-10-02')).not.toBeNull()
    expect(roadmapTimelineRange([], '2026-10-02')).toBeNull()
  })

  it('persists roadmap.json + roadmap.md next to config.json and backs up corrupt files', () => {
    const root = mkdtempSync(join(tmpdir(), 'roadmap-'))
    const project = createProject(root, { name: 'Лендинг' })
    expect(loadProjectRoadmap(root, project.slug).exists).toBe(false)
    const p = parseSpecResponse(SPEC)!
    let r = normalizeRoadmap(undefined)
    for (const key of proposalItemKeys(p)) r = applyProposalItem(r, p, key, '2026-10-01')
    saveProjectRoadmap(root, project.slug, r)
    const dir = join(root, 'projects', project.slug)
    const loaded = loadProjectRoadmap(root, project.slug)
    expect(loaded.exists).toBe(true)
    expect(loaded.roadmap.milestones.map((m) => m.title)).toEqual(['Дизайн', 'Разработка'])
    const md = readFileSync(join(dir, 'roadmap.md'), 'utf-8')
    expect(md).toContain('## Вехи')
    expect(md).toContain('### Количественные')
    expect(loadProjectRoadmapPromptText(root, project.slug)).toContain('Goal: Запустить лендинг')
    writeFileSync(join(dir, 'roadmap.json'), '{broken')
    expect(loadProjectRoadmap(root, project.slug).corrupt).toBe(true)
    saveProjectRoadmap(root, project.slug, r)
    expect(readdirSync(dir).some((f) => f.startsWith('roadmap.corrupt-'))).toBe(true)
    expect(existsSync(join(dir, 'config.json'))).toBe(true)
  })

  it('renders markdown export', () => {
    const md = roadmapToMarkdown(normalizeRoadmap({ goal: 'G', risks: ['R'] }), 'P')
    expect(md.startsWith('# P')).toBe(true)
    expect(md).toContain('## Риски')
  })
})
