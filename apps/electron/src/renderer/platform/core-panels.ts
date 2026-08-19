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
export function registerCorePanels(
  registry: PanelRegistry = getAppPanelRegistry(),
  render: PanelRenderer = () => null,
): PanelRegistry {
  if (!registry.get(KNOWLEDGE_INSPECTOR_PANEL_ID)) {
    registry.register(knowledgeInspectorContribution(render))
  }
  return registry
}
