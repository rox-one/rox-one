import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(__dirname, '../TasksPage.tsx'), 'utf8')

describe('Issue 17 TasksPage', () => {
  it('uses i18n for user-facing copy and avoids native select', () => {
    expect(page).toContain("t('tasks.quickEntryPlaceholder')")
    expect(page).toContain('t(`tasks.projection.${id}`)')
    expect(page).toContain("t('tasks.complete')")
    expect(page).toContain("t('tasks.export')")
    expect(page).toContain("t('tasks.import')")
    expect(page).toContain("t('tasks.addLink')")
    expect(page).toContain('t(`tasks.linkKind.${link.kind}`)')
    expect(page).toContain('localStorage')
    expect(page).toContain('loadPersonalTasks')
    expect(page).toContain('savePersonalTasks')
    expect(page).toContain("t('tasks.saveFailed')")
    expect(page).not.toMatch(/<select\b/)
  })

  it('keeps completing a task in-page without dropping the store', () => {
    expect(page).toContain('current.complete')
    expect(page).toContain('current.reopen')
    expect(page).toContain('current.link')
    expect(page).toContain('current.unlink')
    expect(page).toContain('current.reorder')
    expect(page).toContain('draggable')
  })
})
