import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../../../../../../../packages/shared/src/i18n/locales/en.json'
import { TaskSidebar, type TaskSidebarProps } from '../TaskSidebar'

const i18n = createInstance()
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } } })

function fixture(overrides: Partial<TaskSidebarProps> = {}): TaskSidebarProps {
  return {
    view: { kind: 'list', id: 'today' }, onSelect: () => {},
    listCount: id => id === 'today' ? 4 : 2, overdueCount: 1, trashCount: 3,
    tasks: [
      { id: 'open', title: 'Open task', projectId: 'project-a', list: 'today', notes: '', tags: [], priority: 'none', evening: false, links: [], order: 1, createdAt: 1 },
      { id: 'done', title: 'Done task', projectId: 'project-a', list: 'today', notes: '', tags: [], priority: 'none', evening: false, links: [], order: 2, createdAt: 1, completedAt: 2 },
    ],
    areas: [{ id: 'area-a', name: 'Work', order: 1 }],
    personalProjects: [{ id: 'project-a', name: 'Launch', areaId: 'area-a', order: 1 }],
    workspaceProjects: [{ id: 'workspace-project', name: 'Repository' }],
    tags: [{ tag: 'urgent', count: 2 }], agents: { board: 4, running: 1, review: 2, conductor: 1 },
    dropProps: destination => ({ className: 'drop-target', 'data-drop-destination': destination }),
    onToggleArea: () => {}, footer: <button type="button">New project</button>,
    ...overrides,
  }
}

function render(props: Partial<TaskSidebarProps> = {}, copies = 1): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      {Array.from({ length: copies }, (_, index) => <TaskSidebar key={index} {...fixture(props)} />)}
    </I18nextProvider>,
  )
}

function button(html: string, testId: string): string {
  return html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>[\\s\\S]*?</button>`))?.[0] ?? ''
}

describe('Tasks contextual sidebar', () => {
  it('groups all task projections behind a named accessible disclosure', () => {
    const html = render()
    const group = html.match(/<button[^>]*aria-controls="([^"]+)"[^>]*aria-label="Collapse Statuses"[^>]*>/)
    expect(group).not.toBeNull()
    expect(group?.[0]).toContain('aria-expanded="true"')
    expect(html).toContain(`<div id="${group?.[1]}">`)
    for (const id of ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook', 'trash']) {
      expect(button(html, `tasks-nav-${id}`)).not.toBe('')
    }
    expect(button(html, 'tasks-nav-today')).toContain('aria-current="page"')
    expect(button(html, 'tasks-nav-today')).toContain('1 overdue')
    expect(button(html, 'tasks-nav-today')).toContain('>4</span>')
    expect(button(html, 'tasks-nav-trash')).toContain('>3</span>')
  })

  it('gives each projection a distinct icon and an explicit color', () => {
    const html = render()
    const icons = [
      ['inbox', 'inbox', 'text-info'], ['today', 'sun', 'warning'],
      ['upcoming', 'calendar-days', 'text-accent'], ['anytime', 'list-checks', 'text-success'],
      ['someday', 'hourglass', 'text-violet-500'], ['logbook', 'book-check', 'text-text-muted'],
      ['trash', 'trash-2', 'text-destructive'],
    ]
    for (const [id, icon, color] of icons) {
      const item = button(html, `tasks-nav-${id}`)
      expect(item).toContain(`lucide-${icon}`)
      expect(item).toContain(color!)
    }
    expect(button(html, 'tasks-nav-project-project-a')).toContain('lucide-folder-kanban')
    expect(button(html, 'tasks-nav-agents-running')).toContain('lucide-play')
  })

  it('honors saved area folding while retaining project selection and progress', () => {
    const html = render({ view: { kind: 'project', id: 'project-a' }, areas: [{ id: 'area-a', name: 'Work', order: 1, collapsed: true }] })
    const toggle = html.match(/<button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"[^>]*aria-label="Expand Work"[^>]*>/)
    expect(toggle).not.toBeNull()
    expect(html).toContain(`<div id="${toggle?.[1]}" hidden="">`)
    const project = button(html, 'tasks-nav-project-project-a')
    expect(project).toContain('aria-current="page"')
    expect(project).toContain('1 of 2 done')
    expect(project).toContain('>1</span>')
    expect(button(html, 'tasks-nav-area-area-a')).not.toContain('aria-expanded')
    expect([...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].every(match => !match[0].slice(7).includes('<button'))).toBe(true)
  })

  it('keeps status, area and project drop destinations on their original targets', () => {
    const destinations: string[] = []
    render({ dropProps: destination => { destinations.push(destination); return { className: 'drop-target' } } })
    expect(destinations).toEqual([
      'list:inbox', 'when:today', 'when:upcoming', 'when:anytime', 'when:someday', 'logbook', 'trash',
      'area:area-a', 'project:project-a', 'project:workspace-project',
    ])
  })

  it('marks the selected area, tag and agent view independently', () => {
    for (const [view, testId] of [
      [{ kind: 'area', id: 'area-a' }, 'tasks-nav-area-area-a'],
      [{ kind: 'tag', id: 'urgent' }, 'tasks-nav-tag-urgent'],
      [{ kind: 'agents', id: 'review' }, 'tasks-nav-agents-review'],
    ] as const) {
      const html = render({ view })
      expect(button(html, testId)).toContain('aria-current="page"')
      expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1)
    }
  })

  it('avoids duplicate disclosure ids when Tasks is open in two panels', () => {
    const html = render({}, 2)
    const ids = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(html).toContain(`id="${id}"`)
  })

  it('keeps workspace project emptiness and navigation creation visible', () => {
    const html = render({ workspaceProjects: [], personalProjects: [], areas: [], tags: [] })
    expect(html).toContain('No projects in this workspace')
    expect(html).toContain('New project')
    expect(html).not.toContain('tasks-nav-project-')
    expect(html).not.toContain('tasks-nav-area-')
    expect(html).not.toContain('tasks-nav-tag-')
  })
})
