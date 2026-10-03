import type { NavigationState } from '../../../../shared/types'
import { routes, type ViewRoute } from '../../../../shared/routes'
import { buildExtraScreenRoute } from '../../../../shared/extra-screens'
import type { RouteKey, TourBinding, TourDefinition } from '../contracts'

export function navigationEntity(nav: NavigationState): { sessionId?: string; entityId?: string } {
  if (!('details' in nav) || !nav.details) return {}
  const d = nav.details
  if ('sessionId' in d) return { sessionId: d.sessionId }
  if ('sourceSlug' in d) return { entityId: d.sourceSlug }
  if ('pageSlug' in d) return { entityId: d.pageSlug }
  if ('automationId' in d) return { entityId: d.automationId }
  if ('noteId' in d) return { entityId: d.noteId }
  if ('taskId' in d) return { entityId: d.taskId }
  if ('meetingId' in d) return { entityId: d.meetingId }
  if ('projectSlug' in d) return { entityId: d.projectSlug }
  if ('itemId' in d) return { entityId: d.itemId }
  return {}
}

/** Read-only view routes; catalogue data can never dispatch an action route. */
export function resolveTourRoute(key: RouteKey, binding: TourBinding): ViewRoute | null {
  switch (key) {
    case 'keep': return null
    case 'current-session': return binding.sessionId ? routes.view.allSessions(binding.sessionId) : routes.view.allSessions()
    case 'agents': return buildExtraScreenRoute('agents')
    case 'connections': return routes.view.connections()
    case 'feed': return routes.view.feed()
    case 'inbox': return routes.view.inbox()
    case 'learning': return routes.view.settings('learning')
    case 'meetings': return routes.view.meetings(binding.entityId)
    case 'memory': return routes.view.memory()
    case 'notes': return routes.view.notes()
    case 'projects': return routes.view.projects()
    case 'search': return routes.view.search()
    case 'selected-automation': return routes.view.automations(binding.entityId ? { automationId: binding.entityId } : undefined)
    case 'selected-page': return routes.view.pages(binding.entityId)
    case 'selected-source': return routes.view.sources({ sourceSlug: binding.entityId })
    case 'settings-ai': return routes.view.settings('ai')
    case 'skills': return routes.view.skills()
    case 'sources': return routes.view.sources()
    case 'tasks': return routes.view.tasks()
  }
}

export function prerequisiteRoute(tour: TourDefinition, nav: NavigationState): ViewRoute | null {
  const entity = navigationEntity(nav)
  if (['OBT-01', 'OBT-03', 'OBT-04', 'OBT-05', 'OBT-06', 'OBT-08', 'OBT-09', 'OBT-10', 'OBT-11', 'OBT-13', 'OBT-14'].includes(tour.id) && !entity.sessionId) return routes.view.allSessions()
  if (tour.id === 'OBT-16' && nav.navigator !== 'pages') return routes.view.pages()
  if (tour.id === 'OBT-16' && !entity.entityId) return routes.view.pages()
  if (tour.id === 'OBT-23' && (nav.navigator !== 'automations' || !entity.entityId)) return routes.view.automations()
  return null
}
