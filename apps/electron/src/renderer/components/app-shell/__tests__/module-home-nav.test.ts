import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellSource = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')
const mainContentSource = readFileSync(join(__dirname, '../MainContentPanel.tsx'), 'utf8')

describe('module home navigator parity (Memory/Tasks/Meetings/Projects/Pages)', () => {
  it('collapses the middle navigator for all module homes', () => {
    expect(appShellSource).toContain('hideModuleMiddleNav')
    // W3.2: Встречи is a unified surface, covered by isModeScreenView.
    expect(appShellSource).toContain('isMemoryView || isTasksView || isProjectsView || isPagesView')
    expect(appShellSource).toContain('isModeScreenView')
    expect(appShellSource).toContain('isNotesNavigation(navState) || isHomeNavigation(navState) || isConnectionsNavigation(navState) || hideModuleMiddleNav')
    expect(appShellSource).toContain('!isBoardView && !hideModuleMiddleNav')
  })

  it('hosts PagesHome-pattern surfaces in main content', () => {
    expect(mainContentSource).toContain('MemoryScreen')
    expect(mainContentSource).toContain('LearningScreen')
    expect(mainContentSource).toContain('TasksPage')
    // W3.2: the calendar surface hosts Встречи through the slot registry.
    expect(mainContentSource).toContain('SurfaceHost')
    expect(mainContentSource).not.toContain('MeetingsPage')
    expect(mainContentSource).toContain('PagesHome')
    expect(mainContentSource).toContain('ProjectsHomeInMain')
    expect(mainContentSource).not.toContain('projectsList.noProjectSelected')
  })
})
