import { describe, expect, it } from 'bun:test'
import { parseDeepLink } from '../deep-link'
import { COMPOUND_ROUTE_PREFIXES, parseRouteToNavigationState } from '../../shared/route-parser'

/**
 * rox://<route> must accept every view route the renderer navigator knows,
 * not just the historical allSessions/flagged/state/sources/settings/skills.
 */
describe('parseDeepLink view routes', () => {
  const NAVIGATOR_ROUTES = [
    'home',
    'tasks',
    'notes',
    'meetings',
    'knowledge',
    'projects',
    'pages',
    'memory',
    'automations',
    'connections',
    'skills',
    'sources',
    'settings',
    'allSessions',
    'flagged',
    'archived',
    'board',
    'table',
    'heatmap',
  ]

  for (const route of NAVIGATOR_ROUTES) {
    it(`accepts rox://${route}`, () => {
      const target = parseDeepLink(`rox://${route}`)
      expect(target).not.toBeNull()
      expect(target?.view).toBe(route)
      // The renderer must be able to turn the forwarded view into navigation state.
      expect(parseRouteToNavigationState(route)).not.toBeNull()
    })
  }

  it('keeps nested segments for detail routes', () => {
    expect(parseDeepLink('rox://tasks/task/t-1')?.view).toBe('tasks/task/t-1')
    expect(parseDeepLink('rox://notes/note/n-1')?.view).toBe('notes/note/n-1')
    expect(parseDeepLink('rox://meetings/meeting/m-1')?.view).toBe('meetings/meeting/m-1')
    expect(parseDeepLink('rox://label/bug')?.view).toBe('label/bug')
    expect(parseDeepLink('rox://settings/shortcuts')?.view).toBe('settings/shortcuts')
    expect(parseDeepLink('rox://browser/instance/b-1')?.view).toBe('browser/instance/b-1')
  })

  it('accepts every shared compound prefix', () => {
    for (const prefix of COMPOUND_ROUTE_PREFIXES) {
      expect(parseDeepLink(`rox://${prefix}`)?.view).toBe(prefix)
    }
  })

  it('supports workspace-targeted view routes', () => {
    const target = parseDeepLink('rox://workspace/ws1/tasks?window=focused')
    expect(target?.workspaceId).toBe('ws1')
    expect(target?.view).toBe('tasks')
    expect(target?.windowMode).toBe('focused')
  })

  it('forwards view queries while retaining separate window and sidebar controls', () => {
    const target = parseDeepLink('rox://search?q=two%20words&mode=future&window=focused&sidebar=history')
    expect(target?.view).toBe('search?q=two%20words&mode=future')
    expect(target?.windowMode).toBe('focused')
    expect(target?.rightSidebar).toBe('history')
    expect(parseDeepLink('rox://workspace/ws1/tasks?view=calendar&view=other&window=full')?.view)
      .toBe('tasks?view=calendar&view=other')
  })

  it('opens a scoped runtime selection as a read-only view and refuses send intent', () => {
    const target = parseDeepLink('rox://runtime?workspace=ws1&session=s1&run=r1&event=tool-1')
    expect(target?.workspaceId).toBe('ws1')
    expect(target?.view).toBe('allSessions/session/s1?runtimeRun=r1&runtimeEvent=tool-1')
    expect(target?.action).toBeUndefined()
    expect(parseRouteToNavigationState(target!.view!)).not.toBeNull()
    expect(parseDeepLink('rox://runtime?workspace=ws1&session=s1&run=r1&event=tool-1&send=true')).toBeNull()
  })

  it('still rejects unknown hosts and passes auth callbacks through', () => {
    expect(parseDeepLink('rox://definitely-not-a-route')).toBeNull()
    expect(parseDeepLink('rox://auth-callback?code=1')).toBeNull()
  })

  it('still parses actions', () => {
    const target = parseDeepLink('rox://action/new-chat?input=hi')
    expect(target?.action).toBe('new-chat')
    expect(target?.actionParams).toEqual({ input: 'hi' })
  })
})
