interface NavigableSurfaceTab { panelId: string }

/** Filtering a focused browser tab must not remove the strip's only Tab stop. */
export function surfaceTabRovingId(tabs: readonly NavigableSurfaceTab[], focusedPanelId: string | null): string | null {
  return tabs.find((tab) => tab.panelId === focusedPanelId)?.panelId ?? tabs[0]?.panelId ?? null
}

/** Closing the keyboard tab stop restores DOM focus without activating a hidden browser's sibling. */
export function surfaceTabCloseTarget(tabs: readonly NavigableSurfaceTab[], closingId: string, focusedPanelId: string | null): string | null {
  const index = tabs.findIndex(tab => tab.panelId === closingId)
  if (index < 0) return null
  if (closingId === focusedPanelId) return tabs[index + 1]?.panelId ?? tabs[index - 1]?.panelId ?? null
  return surfaceTabRovingId(tabs.filter(tab => tab.panelId !== closingId), focusedPanelId)
}

export function surfaceTabKeyboardTarget(tabs: readonly NavigableSurfaceTab[], panelId: string, key: string): string | null {
  if (tabs.length === 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return null
  const index = Math.max(0, tabs.findIndex((tab) => tab.panelId === panelId))
  const target = key === 'Home' ? 0 : key === 'End' ? tabs.length - 1
    : (index + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  return tabs[target].panelId
}
