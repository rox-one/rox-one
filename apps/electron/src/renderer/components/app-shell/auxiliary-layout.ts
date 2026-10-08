import type { PanelStackEntry, AuxiliaryTool } from '@/atoms/panel-stack'

/** Return IDs only: hidden panes stay mounted so drafts and scroll survive. */
export function visibleWorkspacePanels(panels: readonly PanelStackEntry[], width: number,
  focusedId: string | null, lastTool: AuxiliaryTool | null, primaryId: string | null): string[] {
  const primary = panels.find(panel => panel.id === primaryId && !panel.tool) ?? panels.find(panel => !panel.tool)
  const agent = panels.find(panel => panel.tool === 'agent')
  const focused = panels.find(panel => panel.id === focusedId)
  const tool = panels.find(panel => panel.tool === lastTool) ?? panels.find(panel => panel.tool && panel.tool !== 'agent')
  if (!panels.some(panel => panel.tool)) return panels.map(panel => panel.id)
  if (width < 820) return [(focused ?? primary ?? panels[0])?.id].filter((id): id is string => !!id)
  if (width < 1180) return [primary?.id, (focused?.tool ? focused : tool ?? agent)?.id].filter((id): id is string => !!id)
  return [primary?.id, agent?.id, tool?.id].filter((id): id is string => !!id)
}
