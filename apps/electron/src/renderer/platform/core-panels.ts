/**
 * Core PanelHost contributions (ticket 11).
 *
 * W1 shipped an empty app registry — PanelHost was a no-op. This module
 * registers the first real contribution: Knowledge inspector, gated by
 * `activeSurface=='knowledge'`. Other slots stay empty on purpose
 * (KEEP_EXPERIMENTAL — see docs/unified-shell-verdict.md).
 *
 * `render` is injected so listing tests stay React-free; PanelHost passes
 * `KnowledgeInspectorPanel` (real KnowledgeInspector, not a stub).
 */

import type {
  PanelContribution,
  PanelRegistry,
  PanelRenderer,
} from '@craft-agent/core/platform'
import { knowledgeEntityCompanionRef } from '@/knowledge/knowledge-entity-ref'
import type { KnowledgeRef } from '../../shared/types'
import { surfaceTabFromRoute } from './layout-snapshot'
import { getAppPanelRegistry } from './panel-registry-state'

export const KNOWLEDGE_INSPECTOR_PANEL_ID = 'knowledge.inspector'

export const KNOWLEDGE_INSPECTOR_WHEN = "activeSurface=='knowledge'"

export const SESSION_INSPECTOR_WHEN = "activeSurface=='session'"

export const SESSION_INSPECTOR_PANEL_IDS = {
  files: 'session.inspector.files',
  git: 'session.inspector.git',
  browser: 'session.inspector.browser',
  context: 'session.inspector.context',
} as const

export function knowledgeInspectorContribution(render: PanelRenderer): PanelContribution {
  return {
    id: KNOWLEDGE_INSPECTOR_PANEL_ID,
    title: 'Inspector',
    icon: 'info',
    slot: 'inspector',
    defaultOrder: 10,
    when: KNOWLEDGE_INSPECTOR_WHEN,
    defaultVisible: true,
    resizable: true,
    source: { type: 'core', id: 'knowledge' },
    render,
  }
}

/**
 * Companion ref for the focused knowledge surface, or null when the route is
 * not a document/block (notebooks, databases, sessions, missing route).
 */
export function knowledgeCompanionRefFromRoute(route: string | null): KnowledgeRef | null {
  if (!route) return null
  const surface = surfaceTabFromRoute(route)
  if (surface?.kind !== 'knowledge') return null
  return knowledgeEntityCompanionRef(surface.ref.kind, surface.ref.id)
}

/** Idempotent. Safe to call from PanelHost and from tests. */
function sessionInspectorContribution(
  id: string,
  icon: string,
  order: number,
  render: PanelRenderer,
): PanelContribution {
  return {
    id,
    title: id,
    icon,
    slot: 'inspector',
    defaultOrder: order,
    when: SESSION_INSPECTOR_WHEN,
    defaultVisible: true,
    resizable: true,
    source: { type: 'core', id: 'session-harness' },
    render,
  }
}

export function registerCorePanels(
  registry: PanelRegistry = getAppPanelRegistry(),
  render: PanelRenderer = () => null,
): PanelRegistry {
  if (!registry.get(KNOWLEDGE_INSPECTOR_PANEL_ID)) {
    registry.register(knowledgeInspectorContribution(render))
  }
  const sessionPanels: Array<[string, string, number]> = [
    [SESSION_INSPECTOR_PANEL_IDS.files, 'files', 20],
    [SESSION_INSPECTOR_PANEL_IDS.git, 'git', 21],
    [SESSION_INSPECTOR_PANEL_IDS.browser, 'browser', 22],
    [SESSION_INSPECTOR_PANEL_IDS.context, 'context', 23],
  ]
  for (const [id, icon, order] of sessionPanels) {
    if (!registry.get(id)) {
      registry.register(sessionInspectorContribution(id, icon, order, render))
    }
  }
  return registry
}
