import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(__dirname, '../TasksPage.tsx'), 'utf8')
const personalTasks = readFileSync(join(__dirname, '../../lib/personal-tasks.ts'), 'utf8')
const projectPage = readFileSync(join(__dirname, '../ProjectInfoPage.tsx'), 'utf8')

describe('P35-10 TasksPage', () => {
  it('uses i18n for user-facing copy and avoids native select', () => {
    expect(page).toContain("t('tasks.quickEntryPlaceholder')")
    expect(page).toContain("t('tasks.newTask')")
    expect(page).toContain('tasks.projection.${id}')
    expect(page).toContain("t('tasks.complete')")
    expect(page).toContain("t('tasks.export')")
    expect(page).toContain("t('tasks.import')")
    expect(page).toContain("t('tasks.addLink')")
    expect(page).toContain('t(`tasks.linkKind.${link.kind}`)')
    expect(page).not.toMatch(/<select\b/)
  })

  it('creates tasks from a visible New Task button without a calendar', () => {
    expect(page).toContain('data-testid="new-task-button"')
    expect(page).toContain('onCreateTask')
    expect(page).toContain("filter === 'all'")
    expect(page).not.toContain('calendarRequired')
  })

  it('keeps completing a task in-page without dropping the store', () => {
    expect(page).toContain('current.complete')
    expect(page).toContain('current.reopen')
    expect(page).toContain('current.link')
    expect(page).toContain('current.unlink')
    expect(page).toContain('current.reorder')
    expect(page).toContain('draggable')
    expect(personalTasks).toContain('localStorage')
  })

  it('filters and sorts the unified list by workspace project id', () => {
    expect(page).toContain('filterAndSortTasks')
    expect(page).toContain('project.config.id')
    expect(page).toContain('tasks.assignProject')
    expect(page).toContain('tasks.filterProject')
  })

  it('shows one-line purposes for plan / overview / process', () => {
    expect(page).toContain('ViewPurposeList')
    expect(page).toContain('tasks.view.overviewPurpose')
    expect(page).toContain('tasks.view.planPurpose')
    expect(page).toContain('tasks.view.processPurpose')
  })
})

describe('P35-10 project task join', () => {
  it('lists tasks on the Projects page using the same project ids', () => {
    expect(projectPage).toContain("t('projectInfo.tabTasks')")
    expect(projectPage).toContain('tasksForWorkspaceProject')
    expect(projectPage).toContain('project.config.id')
    expect(projectPage).toContain('data-testid="project-new-task"')
  })
})
