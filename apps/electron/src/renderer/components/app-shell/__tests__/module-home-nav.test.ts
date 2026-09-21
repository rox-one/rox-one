import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellSource = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')
const mainContentSource = readFileSync(join(__dirname, '../MainContentPanel.tsx'), 'utf8')

describe('module home navigator parity (Memory/Tasks/Meetings/Projects/Pages)', () => {
  it('collapses the middle navigator for all five module homes', () => {
    expect(appShellSource).toContain('hideModuleMiddleNav')
    expect(appShellSource).toContain('isMemoryView || isTasksView || isMeetingsView || isProjectsView || isPagesView')
    expect(appShellSource).toContain('isNotesNavigation(navState) || isHomeNavigation(navState) || isConnectionsNavigation(navState) || hideModuleMiddleNav')
    expect(appShellSource).toContain('!isBoardView && !hideModuleMiddleNav')
  })

  it('hosts PagesHome-pattern surfaces in main content', () => {
    expect(mainContentSource).toContain('MemoryListPanel')
    expect(mainContentSource).toContain('TasksPage')
    expect(mainContentSource).toContain('MeetingsPage')
    expect(mainContentSource).toContain('PagesHome')
    expect(mainContentSource).toContain('ProjectsHomeInMain')
    expect(mainContentSource).not.toContain('projectsList.noProjectSelected')
  })
})
