/**
 * OS-window browsers as extra Surface tabs (ADR-0001).
 *
 * Embedded panes normally live in the panel stack as `kind: 'browser'`.
 * Non-embedded OS windows must not be pushed into `panelStackAtom` (that
 * would mount BrowserPanelPage for a real OS window). They join the tab
 * strip as a parallel list.
 *
 * A retained embedded instance can temporarily outlive its route when the route
 * is detached without explicit close. In that case it is exposed as a resumable
 * tab until the user explicitly terminates it or reopens its canonical route.
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

export interface RetainedEmbeddedBrowserSurfaceTab {
  instanceId: string
  title: string
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

export function retainedEmbeddedBrowserSurfaceTabs(
  instances: readonly OsBrowserInstanceLike[],
  openBrowserInstanceIds: ReadonlySet<string>,
  fallbackTitle: string,
): RetainedEmbeddedBrowserSurfaceTab[] {
  return instances
    .filter((instance) => instance.embedded && !openBrowserInstanceIds.has(instance.id))
    .map((instance) => ({
      instanceId: instance.id,
      title: instance.title.trim() || fallbackTitle,
    }))
}
