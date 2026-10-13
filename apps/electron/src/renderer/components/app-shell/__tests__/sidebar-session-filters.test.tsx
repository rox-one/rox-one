import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Home, Tag } from 'lucide-react'
import { LeftSidebar, isSeparatorItem, type LinkItem } from '../LeftSidebar'
import { buildSessionFilters } from '../ShellSidebarNav'

const noop = () => {}
const status = (id: string, count: number, active = false): LinkItem => ({
  id: `nav:state:${id}`, title: id, label: String(count), icon: Home, variant: active ? 'default' : 'ghost', onClick: noop,
})
const sessions: LinkItem = {
  id: 'nav:allSessions', title: 'Sessions', icon: Home, variant: 'default', onClick: noop, expandable: true, expanded: true,
  sortable: { onReorder: noop },
  items: [
    status('backlog', 0), status('todo', 229), status('review', 0, true), status('done', 0),
    { id: 'separator:states-flagged', type: 'separator' },
    { id: 'nav:flagged', title: 'Flagged', icon: Tag, variant: 'ghost', onClick: noop },
  ],
}
const t = (key: string) => key
const ids = (links: ReturnType<typeof buildSessionFilters>['links']) =>
  ((links[0] as LinkItem).items ?? []).map(item => item.id)

describe('WP5 contextual session filters', () => {
  it('hides empty inactive buckets and disables DnD on the partial list', () => {
    const { links, emptyCount } = buildSessionFilters(sessions, { showEmpty: false, open: true, onToggle: noop }, t)
    expect(emptyCount).toBe(2)
    expect(ids(links)).toEqual(['nav:state:todo', 'nav:state:review', 'separator:session-filters', 'nav:flagged'])
    expect((links[0] as LinkItem).sortable).toBeUndefined()
  })

  it('«show empty» restores every bucket and drag-and-drop reorder', () => {
    const { links } = buildSessionFilters(sessions, { showEmpty: true, open: true, onToggle: noop }, t)
    expect(ids(links).filter(id => id.startsWith('nav:state:'))).toHaveLength(4)
    expect((links[0] as LinkItem).sortable).toBe(sessions.sortable)
    expect(((links[0] as LinkItem).items ?? []).some(isSeparatorItem)).toBe(true)
  })
})

describe('WP5 one icon column', () => {
  it('top-level rows without a chevron reserve the disclosure slot', () => {
    const html = renderToStaticMarkup(
      <LeftSidebar isCollapsed={false} links={[{ id: 'nav:memory', title: 'Memory', icon: Home, variant: 'ghost', onClick: noop }]} />,
    )
    expect(html).toContain('data-disclosure-slot')
  })

  it('nested rows do not', () => {
    const html = renderToStaticMarkup(
      <LeftSidebar isCollapsed={false} isNested links={[{ id: 'nav:memory', title: 'Memory', icon: Home, variant: 'ghost', onClick: noop }]} />,
    )
    expect(html).not.toContain('data-disclosure-slot')
  })
})
