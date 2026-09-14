interface NavigableSurfaceTab { panelId: string }

/** Filtering a focused browser tab must not remove the strip's only Tab stop. */
export function surfaceTabRovingId(tabs: readonly NavigableSurfaceTab[], focusedPanelId: string | null): string | null {
  return tabs.find((tab) => tab.panelId === focusedPanelId)?.panelId ?? tabs[0]?.panelId ?? null
}

export function surfaceTabKeyboardTarget(tabs: readonly NavigableSurfaceTab[], panelId: string, key: string): string | null {
  if (tabs.length === 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return null
  const index = Math.max(0, tabs.findIndex((tab) => tab.panelId === panelId))
  const target = key === 'Home' ? 0 : key === 'End' ? tabs.length - 1
    : (index + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  return tabs[target].panelId
}
