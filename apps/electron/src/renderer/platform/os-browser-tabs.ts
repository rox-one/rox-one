/**
 * OS-window browsers as extra Surface tabs (ADR-0001).
 *
 * Embedded panes already live in the panel stack as `kind: 'browser'`.
 * Non-embedded OS windows must not be pushed into `panelStackAtom` (that
 * would mount BrowserPanelPage for a real OS window). They join the tab
 * strip as a parallel list.
 */

export interface OsBrowserInstanceLike {
  id: string
  title: string
  url: string
  embedded?: boolean
  boundSessionId: string | null
  ownerSessionId: string | null
  agentControlActive: boolean
}

export interface OsBrowserSurfaceTab {
  instanceId: string
  title: string
  focused: boolean
  boundSessionId: string | null
  agentControlActive: boolean
}

export function osBrowserSurfaceTabs(
  instances: readonly OsBrowserInstanceLike[],
  activeInstanceId: string | null,
  fallbackTitle: string,
): OsBrowserSurfaceTab[] {
  return instances
    .filter((instance) => !instance.embedded)
    .map((instance) => {
      const boundSessionId = instance.boundSessionId ?? instance.ownerSessionId
      const title = instance.title.trim() || fallbackTitle
      return {
        instanceId: instance.id,
        title,
        focused: instance.id === activeInstanceId,
        boundSessionId,
        agentControlActive: instance.agentControlActive,
      }
    })
}
